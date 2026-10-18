import { AnimalRepository } from './repositories/animalRepo.js';
import { validateAnimalInput, validateReproEventInput, validateHealthEventInput } from './validation.js';
import { calculateExpectedCalvingDate } from './zootech.js';

export async function handleAnimals({ path, method, request, url, db, jsonResponse, getActiveFarmId }) {
    // 1. GET /api/animals
    if (path === "/api/animals" && method === "GET") {
        const limit = parseInt(url.searchParams.get("limit") || "50");
        const offset = parseInt(url.searchParams.get("offset") || "0");
        const search = url.searchParams.get("q") || url.searchParams.get("search") || "";
        const status = url.searchParams.get("status") || "ALL";
        const farmId = getActiveFarmId();

        const result = await AnimalRepository.searchAnimals(db, {
            farmId,
            search,
            status,
            limit,
            offset
        });
        return jsonResponse(result, 200, {
            "Cache-Control": "public, max-age=30, s-maxage=180, stale-while-revalidate=300"
        });
    }

    // 2. POST /api/animals (Insert single animal or batch list)
    if (path === "/api/animals" && method === "POST") {
        const body = await request.json();
        const rawItems = Array.isArray(body) ? body : [body];
        if (rawItems.length === 0) {
            return jsonResponse({ detail: "No animal records provided" }, 400);
        }

        const validItems = [];
        for (let i = 0; i < rawItems.length; i++) {
            const v = validateAnimalInput(rawItems[i]);
            if (!v.isValid) {
                return jsonResponse({ detail: `Animal #${i + 1} validation failed: ${v.errors.join(', ')}` }, 400);
            }
            validItems.push({
                ...v.sanitized,
                farm_id: rawItems[i].farm_id || getActiveFarmId()
            });
        }

        const inserted = await AnimalRepository.batchInsert(db, validItems);
        return jsonResponse({ status: "success", inserted_count: inserted }, 201);
    }

    // 3. PUT /api/animals/:id (Update existing animal record)
    if (path.match(/^\/api\/animals\/[^\/]+$/) && method === "PUT") {
        const animalId = path.split("/")[3];
        const existing = await AnimalRepository.getById(db, animalId);
        if (!existing) {
            return jsonResponse({ detail: "Animal not found" }, 404);
        }

        const body = await request.json();
        const v = validateAnimalInput(body);
        if (!v.isValid) {
            return jsonResponse({ detail: `Validation failed: ${v.errors.join(', ')}` }, 400);
        }

        const updated = await AnimalRepository.updateAnimal(db, animalId, v.sanitized);
        return jsonResponse({ status: "success", animal: updated });
    }

    // 4. DELETE /api/animals/:id
    if (path.startsWith("/api/animals/") && method === "DELETE") {
        const animalId = path.split("/")[3];
        await AnimalRepository.deleteCascade(db, animalId);
        return jsonResponse({ status: "success", deleted_id: animalId });
    }

    // 4. POST /api/animals/:id/repro (Add reproduction event and recalculate status)
    if (path.match(/^\/api\/animals\/[^\/]+\/repro$/) && method === "POST") {
        const animalId = path.split("/")[3];
        const animal = await db.prepare("SELECT * FROM animals WHERE id = ?").bind(animalId).first();
        if (!animal) {
            return jsonResponse({ detail: "Animal not found" }, 404);
        }

        const body = await request.json();
        const v = validateReproEventInput(body);
        if (!v.isValid) {
            return jsonResponse({ detail: `Validation failed: ${v.errors.join(', ')}` }, 400);
        }

        const eventId = crypto.randomUUID();
        const { event_type, event_date, bull_code, result, notes } = v.sanitized;

        await db.prepare(`
            INSERT INTO reproduction_events (id, animal_id, event_type, event_date, bull_code, result, notes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).bind(eventId, animalId, event_type, event_date, bull_code, result, notes).run();

        // Automatic physiological state sync based on zootech rules
        let updatedStatus = animal.current_status;
        let updatedExpectedCalving = animal.expected_calving_date;
        let updatedDaysPregnant = animal.days_pregnant || 0;
        let updatedLactation = animal.lactation_number || 0;

        if (event_type === 'INSEMINATION') {
            const expectedCalv = calculateExpectedCalvingDate(event_date);
            updatedStatus = 'Inseminated';
            updatedExpectedCalving = expectedCalv;
            updatedDaysPregnant = 0;
            await db.prepare(`
                UPDATE animals SET
                    current_status = 'Inseminated',
                    last_insemination_date = ?,
                    days_pregnant = 0,
                    expected_calving_date = ?,
                    updated_at = datetime('now')
                WHERE id = ?
            `).bind(event_date, expectedCalv, animalId).run();
        } else if (event_type === 'PREGNANCY_CHECK') {
            const isPregnant = (result && (result.toUpperCase().includes('POS') || result.toUpperCase().includes('ТІЛЬН') || result === '+' || result.toUpperCase() === 'PREGNANT'));
            if (isPregnant) {
                // Calculate days pregnant from last_insemination_date or event_date
                let daysPreg = 40;
                if (animal.last_insemination_date) {
                    const diffTime = new Date(event_date).getTime() - new Date(animal.last_insemination_date).getTime();
                    if (diffTime > 0) daysPreg = Math.floor(diffTime / (1000 * 60 * 60 * 24));
                }
                const newStatus = daysPreg >= 220 ? 'Dry' : 'Pregnant';
                updatedStatus = newStatus;
                updatedDaysPregnant = daysPreg;
                await db.prepare(`
                    UPDATE animals SET
                        current_status = ?,
                        days_pregnant = ?,
                        updated_at = datetime('now')
                    WHERE id = ?
                `).bind(newStatus, daysPreg, animalId).run();
            } else {
                updatedStatus = 'Open';
                updatedDaysPregnant = 0;
                await db.prepare(`
                    UPDATE animals SET
                        current_status = 'Open',
                        days_pregnant = 0,
                        updated_at = datetime('now')
                    WHERE id = ?
                `).bind(animalId).run();
            }
        } else if (event_type === 'CALVING') {
            const nextLact = (animal.lactation_number || 0) + 1;
            updatedStatus = 'Fresh';
            updatedLactation = nextLact;
            updatedExpectedCalving = null;
            updatedDaysPregnant = 0;
            await db.prepare(`
                UPDATE animals SET
                    current_status = 'Fresh',
                    lactation_number = ?,
                    last_calving_date = ?,
                    expected_calving_date = null,
                    last_insemination_date = null,
                    days_pregnant = 0,
                    updated_at = datetime('now')
                WHERE id = ?
            `).bind(nextLact, event_date, animalId).run();
        } else if (event_type === 'DRY_OFF') {
            updatedStatus = 'Dry';
            await db.prepare(`
                UPDATE animals SET
                    current_status = 'Dry',
                    updated_at = datetime('now')
                WHERE id = ?
            `).bind(animalId).run();
        }

        return jsonResponse({
            status: "success",
            message: "Reproduction event recorded successfully",
            id: eventId,
            new_status: updatedStatus,
            expected_calving_date: updatedExpectedCalving,
            days_pregnant: updatedDaysPregnant,
            lactation_number: updatedLactation
        }, 201);
    }

    // 5. POST /api/animals/:id/health (Add health / treatment event with milk withholding quarantine)
    if (path.match(/^\/api\/animals\/[^\/]+\/health$/) && method === "POST") {
        const animalId = path.split("/")[3];
        const animal = await db.prepare("SELECT * FROM animals WHERE id = ?").bind(animalId).first();
        if (!animal) {
            return jsonResponse({ detail: "Animal not found" }, 404);
        }

        const body = await request.json();
        const v = validateHealthEventInput(body);
        if (!v.isValid) {
            return jsonResponse({ detail: `Validation failed: ${v.errors.join(', ')}` }, 400);
        }

        const eventId = crypto.randomUUID();
        const { diagnosis, event_date, medication_name, dosage, notes } = v.sanitized;

        let milkDays = parseInt(body.milk_withholding_days) || 0;
        let meatDays = parseInt(body.meat_withholding_days) || 0;

        if ((!milkDays && !meatDays) && medication_name) {
            const med = await db.prepare("SELECT default_milk_withdrawal_days, default_meat_withdrawal_days FROM medications WHERE name = ? COLLATE NOCASE LIMIT 1").bind(medication_name).first();
            if (med) {
                milkDays = med.default_milk_withdrawal_days || 0;
                meatDays = med.default_meat_withdrawal_days || 0;
            }
        }

        let milkUntil = null;
        let meatUntil = null;
        const baseDate = new Date(event_date);

        if (milkDays > 0) {
            const d = new Date(baseDate);
            d.setDate(d.getDate() + milkDays);
            milkUntil = d.toISOString().split('T')[0];
        }
        if (meatDays > 0) {
            const d = new Date(baseDate);
            d.setDate(d.getDate() + meatDays);
            meatUntil = d.toISOString().split('T')[0];
        }

        const todayStr = new Date().toISOString().split('T')[0];
        const isActiveWithholding = milkUntil && milkUntil >= todayStr ? 1 : 0;

        await db.prepare(`
            INSERT INTO health_events (
                id, animal_id, event_date, diagnosis, medication_name, dosage,
                milk_withholding_until, meat_withholding_until, is_active_withholding, notes, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).bind(
            eventId, animalId, event_date, diagnosis, medication_name || null, dosage || null,
            milkUntil, meatUntil, isActiveWithholding, notes || null
        ).run();

        return jsonResponse({
            status: "success",
            message: "Health treatment recorded successfully",
            id: eventId,
            milk_withholding_until: milkUntil,
            is_active_withholding: isActiveWithholding
        }, 201);
    }

    // 6. GET /api/animals/:id (Animal Passport + Repro & Health History)
    if (path.startsWith("/api/animals/") && method === "GET") {
        const parts = path.split("/");
        const animalId = parts[3];
        const animalData = await AnimalRepository.getAnimal360(db, animalId);
        if (!animalData) return jsonResponse({ detail: "Animal not found" }, 404);

        return jsonResponse(animalData, 200, {
            "Cache-Control": "public, max-age=30, s-maxage=300, stale-while-revalidate=600"
        });
    }

    return null;
}
