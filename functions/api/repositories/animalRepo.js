// Repository: Animals Persistence & Data Queries (Cloudflare D1)
import { Animal } from '../models/Animal.js';

export class AnimalRepository {
    /**
     * Search and paginate animals.
     */
    static async searchAnimals(db, { farmId = null, search = "", status = "ALL", limit = 50, offset = 0 } = {}) {
        const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 100));
        const safeOffset = Math.max(0, Number(offset) || 0);
        let activeFarmId = farmId;
        if (!activeFarmId) {
            const defaultFarm = await db.prepare("SELECT id FROM farms WHERE code = 'DEMO_FARM' OR owner_email = 'demo@dairy-erp.farm' OR owner_email IS NULL ORDER BY created_at ASC LIMIT 1").first();
            if (defaultFarm) activeFarmId = defaultFarm.id;
        }

        let query = "SELECT * FROM animals WHERE 1=1";
        const params = [];

        if (activeFarmId) {
            query += " AND farm_id = ?";
            params.push(activeFarmId);
        }
        if (search) {
            query += " AND (farm_number LIKE ? OR official_tag LIKE ? OR name LIKE ?)";
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        if (status === "Quarantine") {
            query += " AND id IN (SELECT animal_id FROM health_events WHERE is_active_withholding = 1 OR milk_withholding_until >= date('now'))";
        } else if (status === "Active") {
            query += " AND current_status != 'Culled'";
        } else if (status === "Open") {
            query += " AND current_status != 'Culled' AND lactation_number > 0 AND (current_status = 'Open' OR (current_status = 'Active' AND (last_insemination_date IS NULL OR current_status NOT IN ('Pregnant', 'Inseminated'))))";
        } else if (status === "Heifer") {
            query += " AND current_status != 'Culled' AND (current_status = 'Heifer' OR (lactation_number = 0 AND current_status NOT IN ('Pregnant', 'Inseminated', 'Dry')))";
        } else if (status !== "ALL") {
            query += " AND current_status = ?";
            params.push(status);
        }

        const countQuery = query.replace("SELECT *", "SELECT count(*) as c");
        const total = (await db.prepare(countQuery).bind(...params).first())?.c || 0;

        query += " ORDER BY farm_number ASC LIMIT ? OFFSET ?";
        params.push(safeLimit, safeOffset);

        const rawItems = (await db.prepare(query).bind(...params).all()).results || [];
        const items = rawItems.map(row => new Animal(row).toJSON());
        return { total, items, offset: safeOffset, limit: safeLimit };
    }

    /**
     * Get single animal by ID with passport details.
     */
    static async getById(db, animalId) {
        const row = await db.prepare("SELECT * FROM animals WHERE id = ?").bind(animalId).first();
        return row ? new Animal(row).toJSON() : null;
    }

    /**
     * Get animal 360 degree details including reproduction and health event history.
     */
    static async getAnimal360(db, animalId) {
        const animal = await this.getById(db, animalId);
        if (!animal) return null;

        const repro = (await db.prepare("SELECT * FROM reproduction_events WHERE animal_id = ? ORDER BY event_date DESC").bind(animalId).all()).results || [];
        const health = (await db.prepare("SELECT * FROM health_events WHERE animal_id = ? ORDER BY event_date DESC").bind(animalId).all()).results || [];

        return {
            ...animal,
            reproduction_history: repro,
            health_history: health
        };
    }

    /**
     * Batch insert or insert single animal.
     */
    static async batchInsert(db, items, defaultFarmId = null) {
        let inserted = 0;
        let fallbackFarmId = defaultFarmId;
        if (!fallbackFarmId) {
            const queryFirst = async (sql) => {
                const prep = db.prepare(sql);
                if (typeof prep.first === 'function') return prep.first();
                if (typeof prep.bind === 'function') {
                    const bound = prep.bind();
                    if (typeof bound.first === 'function') return bound.first();
                }
                return null;
            };
            const defaultFarm = await queryFirst("SELECT id FROM farms WHERE code = 'DEMO_FARM' OR owner_email = 'demo@dairy-erp.farm' OR owner_email IS NULL ORDER BY created_at ASC LIMIT 1");
            fallbackFarmId = defaultFarm?.id || (await queryFirst("SELECT id FROM farms LIMIT 1"))?.id;
        }

        for (const item of items) {
            const id = item.id || crypto.randomUUID();
            const farmId = item.farm_id || fallbackFarmId;
            if (!farmId) {
                throw new Error("No active farm found to associate with animal");
            }
            await db.prepare(`
                INSERT INTO animals (
                    id, farm_id, farm_number, official_tag, name, birth_date,
                    lactation_number, current_status, last_calving_date, expected_calving_date,
                    transponder_code, dam_tag, sire_tag, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
            `).bind(
                id, farmId, item.farm_number || "0", item.official_tag || null, item.name || null, item.birth_date || null,
                item.lactation_number || 0, item.current_status || "Active", item.last_calving_date || null, item.expected_calving_date || null,
                item.transponder_code || null, item.dam_tag || null, item.sire_tag || null
            ).run();
            inserted++;
        }
        return inserted;
    }

    /**
     * Update animal details.
     */
    static async updateAnimal(db, animalId, updates) {
        await db.prepare(`
            UPDATE animals SET
                farm_number = ?,
                official_tag = ?,
                name = ?,
                birth_date = ?,
                lactation_number = ?,
                current_status = ?,
                last_calving_date = ?,
                expected_calving_date = ?,
                updated_at = datetime('now')
            WHERE id = ?
        `).bind(
            updates.farm_number || "0",
            updates.official_tag || null,
            updates.name || null,
            updates.birth_date || null,
            updates.lactation_number || 0,
            updates.current_status || "Active",
            updates.last_calving_date || null,
            updates.expected_calving_date || null,
            animalId
        ).run();

        return this.getById(db, animalId);
    }

    /**
     * Delete animal and all cascade events.
     */
    static async deleteCascade(db, animalId) {
        await db.prepare("DELETE FROM reproduction_events WHERE animal_id = ?").bind(animalId).run();
        await db.prepare("DELETE FROM health_events WHERE animal_id = ?").bind(animalId).run();
        await db.prepare("DELETE FROM animals WHERE id = ?").bind(animalId).run();
    }
}
