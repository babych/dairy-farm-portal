import { signJWT } from './crypto.js';
import { FarmRepository } from './repositories/farmRepo.js';
import { validateFarmInput } from './validation.js';
import { getCallerUser, requireAuth } from './authGuard.js';

export async function handleFarms({ path, method, request, url, env, db, jsonResponse }) {
    // 1. GET /api/farms
    if (path === "/api/farms" && method === "GET") {
        const caller = getCallerUser(request);
        const userEmail = caller?.email || null;
        let userRole = caller?.role || null;
        let activeFarmId = url.searchParams.get("active_farm_id") || caller?.farm_id || null;

        if (userEmail) {
            try {
                const dbUser = await db.prepare("SELECT role, farm_id FROM users WHERE email = ?").bind(userEmail).first();
                if (dbUser) {
                    userRole = dbUser.role || userRole;
                    if (!activeFarmId) activeFarmId = dbUser.farm_id;
                }
            } catch (e) {}
        }

        const farms = await FarmRepository.listFarms(db, {
            userEmail,
            userRole,
            activeFarmId
        });
        return jsonResponse(farms);
    }

    // 2. POST /api/farms/switch/:id (Switch active farm context)
    if (path.startsWith("/api/farms/switch/") && method === "POST") {
        const farmId = path.split("/")[4];
        const farm = await FarmRepository.getById(db, farmId);
        if (!farm) {
            return jsonResponse({ detail: "Farm not found" }, 404);
        }

        const auth = request.headers.get("authorization") || "";
        let userEmail = "demo.farmer@dairy-erp.farm";
        let userRole = "farmer";
        if (auth.startsWith("Bearer ")) {
            try {
                const tokenPart = auth.split(" ")[1];
                const decoded = JSON.parse(atob(tokenPart.split(".")[1]));
                userEmail = decoded.sub || userEmail;
                userRole = decoded.role || userRole;
            } catch (e) {}
        }

        if (userEmail) {
            try {
                const dbUser = await db.prepare("SELECT role FROM users WHERE email = ?").bind(userEmail).first();
                if (dbUser?.role) userRole = dbUser.role;
            } catch (e) {}
        }

        // Issue updated token scoped to selected farm
        const jwtSecret = env?.JWT_SECRET_KEY || "ephemeral_local_dev_token_key_change_in_prod";
        const payload = {
            sub: userEmail,
            role: userRole,
            farm_id: farm.id,
            exp: Math.floor(Date.now() / 1000) + 86400 * 7
        };
        const token = await signJWT(payload, jwtSecret);

        return jsonResponse({
            status: "success",
            message: `Перемкнуто на ферму '${farm.name}'`,
            access_token: token,
            farm: farm
        });
    }

    // 3. POST /api/farms (Create New Farm)
    if (path === "/api/farms" && method === "POST") {
        const body = await request.json();
        const newFarm = await FarmRepository.create(db, {
            id: body.id,
            code: body.code,
            name: body.name,
            farmerName: body.farmer_name,
            ownerEmail: body.owner_email
        });

        return jsonResponse({
            status: "success",
            message: `Ферму '${newFarm.name}' успішно створено`,
            farm_id: newFarm.id,
            farm: newFarm
        }, 201);
    }

    // 4. PUT /api/farms/:id (Update Farm Passport Info)
    if (path.startsWith("/api/farms/") && method === "PUT") {
        const farmId = path.split("/")[3];
        const body = await request.json();
        const validation = validateFarmInput(body);
        if (!validation.isValid) {
            return jsonResponse({ detail: validation.errors.join("; ") }, 400);
        }

        const targetFarm = await FarmRepository.getById(db, farmId);
        if (!targetFarm) {
            return jsonResponse({ detail: "Ферму не знайдено для оновлення" }, 404);
        }

        const { sanitized } = validation;
        const updated = await FarmRepository.updatePassport(db, farmId, {
            name: sanitized.name,
            farmerName: sanitized.farmer_name,
            city: sanitized.city,
            address: sanitized.address,
            phone: sanitized.phone
        });

        // Audit log
        await db.prepare(`
            INSERT INTO audit_logs (id, entity_type, entity_id, action, summary, created_at)
            VALUES (?, 'FARM', ?, 'UPDATE', ?, datetime('now'))
        `).bind(crypto.randomUUID(), farmId, `Оновлено назву ферми на '${sanitized.name}'`).run();

        return jsonResponse({
            status: "success",
            message: `Паспорт ферми '${sanitized.name}' успішно оновлено!`,
            farm: updated
        });
    }

    // 5. DELETE /api/farms/:id
    if (path.startsWith("/api/farms/") && method === "DELETE") {
        const farmId = path.split("/")[3];

        const targetFarm = await FarmRepository.getById(db, farmId);
        if (!targetFarm) {
            return jsonResponse({ detail: "Ферму не знайдено" }, 404);
        }

        try {
            await FarmRepository.deleteCascade(db, farmId);

            // Audit log
            await db.prepare(`
                INSERT INTO audit_logs (id, entity_type, entity_id, action, summary, created_at)
                VALUES (?, 'FARM', ?, 'DELETE', ?, datetime('now'))
            `).bind(crypto.randomUUID(), farmId, `Видалено ферму '${targetFarm.name}'`).run();

            // Decode caller user context
            const auth = request.headers.get("authorization") || "";
            let userEmail = null;
            let userRole = null;
            if (auth.startsWith("Bearer ")) {
                try {
                    const tokenPart = auth.split(" ")[1];
                    const decoded = JSON.parse(atob(tokenPart.split(".")[1]));
                    userEmail = decoded.sub || null;
                    userRole = decoded.role || null;
                } catch (e) {}
            }

            // Find next available farm for this user
            const remainingFarms = await FarmRepository.listFarms(db, { userEmail, userRole });
            const nextFarm = remainingFarms.length > 0 ? remainingFarms[0] : null;

            let updatedToken = null;
            if (userEmail && nextFarm) {
                // Update user's active farm in DB
                await db.prepare("UPDATE users SET farm_id = ? WHERE email = ?").bind(nextFarm.id, userEmail).run();

                const jwtSecret = env?.JWT_SECRET_KEY || "ephemeral_local_dev_token_key_change_in_prod";
                const payload = {
                    sub: userEmail,
                    role: userRole || "farmer",
                    farm_id: nextFarm.id,
                    exp: Math.floor(Date.now() / 1000) + 86400 * 7
                };
                updatedToken = await signJWT(payload, jwtSecret);
            } else if (userEmail) {
                await db.prepare("UPDATE users SET farm_id = NULL WHERE email = ?").bind(userEmail).run();
            }

            return jsonResponse({
                status: "success",
                message: `Ферму '${targetFarm.name}' та всі пов'язані дані видалено.`,
                next_farm_id: nextFarm ? nextFarm.id : null,
                access_token: updatedToken
            });
        } catch (e) {
            return jsonResponse({ detail: `Помилка видалення ферми: ${e.message}` }, 500);
        }
    }

    // 6. POST /api/farms/clone-demo
    if (path === "/api/farms/clone-demo" && method === "POST") {
        const caller = getCallerUser(request);
        if (!caller || !caller.email) {
            return jsonResponse({ detail: "Необхідна авторизація" }, 401);
        }
        const userEmail = caller.email;

        const demoFarm = await db.prepare("SELECT * FROM farms WHERE owner_email IS NULL ORDER BY created_at ASC LIMIT 1").first();
        if (!demoFarm) {
            return jsonResponse({ detail: "Демо-ферму не знайдено для клонування" }, 404);
        }

        const newFarmId = crypto.randomUUID();
        const newFarmCode = `FARM_${Date.now().toString(36).toUpperCase()}`;
        const newFarmName = `${demoFarm.name} (Копія)`;

        await db.prepare(`
            INSERT INTO farms (id, code, name, farmer_name, address, city, phone, owner_email, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).bind(
            newFarmId,
            newFarmCode,
            newFarmName,
            demoFarm.farmer_name,
            demoFarm.address,
            demoFarm.city,
            demoFarm.phone,
            userEmail
        ).run();

        const demoAnimals = (await db.prepare("SELECT * FROM animals WHERE farm_id = ?").bind(demoFarm.id).all()).results || [];
        const animalIdMap = {};

        for (const a of demoAnimals) {
            const newAnimalId = crypto.randomUUID();
            animalIdMap[a.id] = newAnimalId;
            await db.prepare(`
                INSERT INTO animals (
                    id, farm_id, farm_number, official_tag, name, birth_date,
                    lactation_number, current_status, last_calving_date, expected_calving_date,
                    transponder_code, dam_tag, sire_tag, group_name, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
            `).bind(
                newAnimalId, newFarmId, a.farm_number, a.official_tag, a.name, a.birth_date,
                a.lactation_number, a.current_status, a.last_calving_date, a.expected_calving_date,
                a.transponder_code, a.dam_tag, a.sire_tag, a.group_name
            ).run();
        }

        return jsonResponse({
            status: "success",
            message: `Створено приватну ферму '${newFarmName}' з ${demoAnimals.length} тваринами!`,
            farm_id: newFarmId
        }, 201);
    }

    return null;
}
