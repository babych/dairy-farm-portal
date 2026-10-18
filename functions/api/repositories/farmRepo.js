// Repository: Farms Persistence & Data Queries (Cloudflare D1)
import { Farm } from '../models/Farm.js';

export class FarmRepository {
    /**
     * List farms accessible to the user context with cow counts.
     */
    static async listFarms(db, { userEmail = null, userRole = null, activeFarmId = null } = {}) {
        let query = `
            SELECT f.id, f.code, f.name, f.farmer_name, f.address, f.city, f.phone, f.owner_email,
                   count(a.id) as cow_count, 0 as is_current, f.created_at, f.imported_at
            FROM farms f
            LEFT JOIN animals a ON a.farm_id = f.id
        `;
        const params = [];
        if (userRole === "superadmin") {
            // superadmin sees all farms
        } else if (userEmail) {
            // Users see farms they own, farms without explicit owner (global/demo), or all farms if authorized
            query += " WHERE (f.owner_email = ? OR f.owner_email IS NULL)";
            params.push(userEmail);
        } else {
            // Unauthenticated guest sees default/unassigned farms, or all farms in read-only demo mode
            // (prevents UI freeze when all farms have owners)
        }
        query += " GROUP BY f.id ORDER BY f.created_at ASC";

        const rawFarms = (await db.prepare(query).bind(...params).all()).results || [];
        return rawFarms.map((row, idx) => {
            const isCurrent = activeFarmId ? (String(row.id) === String(activeFarmId)) : (idx === 0);
            return new Farm({ ...row, is_current: isCurrent }).toJSON();
        });
    }

    /**
     * Get a farm by ID.
     */
    static async getById(db, farmId) {
        const row = await db.prepare("SELECT * FROM farms WHERE id = ?").bind(farmId).first();
        return row ? new Farm(row).toJSON() : null;
    }

    /**
     * Get first available farm.
     */
    static async getFirst(db) {
        const row = await db.prepare("SELECT * FROM farms ORDER BY created_at ASC LIMIT 1").first();
        return row ? new Farm(row).toJSON() : null;
    }

    /**
     * Count total farms in database.
     */
    static async countTotal(db) {
        const res = await db.prepare("SELECT count(*) as c FROM farms").first();
        return res?.c || 0;
    }

    /**
     * Create a new farm.
     */
    static async create(db, { id, code, name, farmerName = null, ownerEmail = null }) {
        const farmId = id || crypto.randomUUID();
        const farmCode = code || `FARM_${Date.now().toString(36).toUpperCase()}`;
        const farmName = name || "Нова приватна ферма";

        await db.prepare(`
            INSERT INTO farms (id, code, name, farmer_name, owner_email, created_at)
            VALUES (?, ?, ?, ?, ?, datetime('now'))
        `).bind(farmId, farmCode, farmName, farmerName, ownerEmail).run();

        return { id: farmId, code: farmCode, name: farmName, farmer_name: farmerName, owner_email: ownerEmail };
    }

    /**
     * Update farm passport.
     */
    static async updatePassport(db, farmId, { name, farmerName, city, address, phone }) {
        await db.prepare(`
            UPDATE farms 
            SET name = ?, farmer_name = ?, city = ?, address = ?, phone = ?
            WHERE id = ?
        `).bind(name, farmerName || null, city || null, address || null, phone || null, farmId).run();

        return { id: farmId, name, farmer_name: farmerName, city, address, phone };
    }

    /**
     * Delete farm and all related cascade entities.
     */
    static async deleteCascade(db, farmId) {
        // Unlink users referencing this farm
        await db.prepare("UPDATE users SET farm_id = NULL WHERE farm_id = ?").bind(farmId).run();

        // Cascade delete events & animals
        await db.prepare("DELETE FROM reproduction_events WHERE animal_id IN (SELECT id FROM animals WHERE farm_id = ?)").bind(farmId).run();
        await db.prepare("DELETE FROM health_events WHERE animal_id IN (SELECT id FROM animals WHERE farm_id = ?)").bind(farmId).run();
        await db.prepare("DELETE FROM animals WHERE farm_id = ?").bind(farmId).run();
        await db.prepare("DELETE FROM audit_logs WHERE farm_id = ?").bind(farmId).run();
        await db.prepare("DELETE FROM farms WHERE id = ?").bind(farmId).run();
    }
}
