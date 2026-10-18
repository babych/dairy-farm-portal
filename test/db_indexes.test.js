import { describe, it, before } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

describe('Database Index & Query Plan Integrity Suite (No-Scan Guard)', () => {
    let db;

    before(() => {
        db = new DatabaseSync(':memory:');
        const sqlPath = path.resolve('schema_indexes.sql');
        const schemaSql = fs.readFileSync(sqlPath, 'utf8');
        db.exec(schemaSql);

        // Seed sample rows to allow query planner to estimate index usage
        db.exec(`
            INSERT INTO farms (id, code, name) VALUES ('farm_1', 'FARM_1', 'Test Farm');
            INSERT INTO animals (id, farm_id, farm_number, official_tag, current_status, expected_calving_date, days_pregnant)
            VALUES 
                ('a1', 'farm_1', '101', 'UA123', 'Active', '2026-11-01', 0),
                ('a2', 'farm_1', '102', 'UA124', 'Pregnant', '2026-10-25', 225),
                ('a3', 'farm_1', '103', 'UA125', 'Dry', '2026-10-20', 250);
            INSERT INTO reproduction_events (id, animal_id, event_type, event_date)
            VALUES ('r1', 'a1', 'INSEMINATION', '2026-08-01');
            INSERT INTO health_events (id, animal_id, event_date, diagnosis, is_active_withholding, milk_withholding_until)
            VALUES ('h1', 'a1', '2026-08-05', 'Mastitis', 1, '2026-10-30');
        `);
    });

    function explain(query) {
        return db.prepare(`EXPLAIN QUERY PLAN ${query}`).all();
    }

    it('1. schema defines all mandatory performance indexes', () => {
        const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all();
        const names = rows.map(r => r.name);

        const mandatory = [
            'idx_animals_farm_status',
            'idx_animals_farm_number',
            'idx_animals_official_tag',
            'idx_animals_calving_dates',
            'idx_animals_calving_watch',
            'idx_health_quarantine_active',
            'idx_health_quarantine_until',
            'idx_health_animal',
            'idx_repro_animal',
            'idx_repro_type_date'
        ];

        for (const idx of mandatory) {
            assert.ok(names.includes(idx), `Missing mandatory index in schema: ${idx}`);
        }
    });

    it('2. Animal search by farm_id & status MUST use index and NEVER SCAN TABLE animals', () => {
        const plan = explain("SELECT * FROM animals WHERE farm_id = 'farm_1' AND current_status = 'Pregnant'");
        const planStr = JSON.stringify(plan);
        assert.ok(!planStr.includes("SCAN TABLE animals") && !planStr.includes("SCAN animals"), `Full scan detected: ${planStr}`);
        assert.ok(planStr.includes("idx_animals_farm_status"), `Expected idx_animals_farm_status to be used: ${planStr}`);
    });

    it('3. Calving watch query MUST use index and NEVER SCAN TABLE animals', () => {
        const plan = explain("SELECT * FROM animals WHERE farm_id = 'farm_1' AND expected_calving_date >= '2026-10-01' AND expected_calving_date <= '2026-10-31'");
        const planStr = JSON.stringify(plan);
        assert.ok(!planStr.includes("SCAN TABLE animals") && !planStr.includes("SCAN animals"), `Full scan detected: ${planStr}`);
        assert.ok(planStr.includes("idx_animals_calving_watch") || planStr.includes("idx_animals_calving_dates"), `Expected calving index to be used: ${planStr}`);
    });

    it('4. Health quarantine events check MUST use index on health_events', () => {
        const plan = explain("SELECT * FROM health_events WHERE is_active_withholding = 1 OR milk_withholding_until >= '2026-10-01'");
        const planStr = JSON.stringify(plan);
        assert.ok(!planStr.includes("SCAN TABLE health_events") && !planStr.includes("SCAN health_events"), `Full scan detected: ${planStr}`);
        assert.ok(planStr.includes("idx_health_quarantine_active") || planStr.includes("MULTI-INDEX OR"), `Expected quarantine index to be used: ${planStr}`);
    });

    it('5. Animal 360 history queries MUST use indexes for repro and health', () => {
        const reproPlan = explain("SELECT * FROM reproduction_events WHERE animal_id = 'a1' ORDER BY event_date DESC");
        const healthPlan = explain("SELECT * FROM health_events WHERE animal_id = 'a1' ORDER BY event_date DESC");

        assert.ok(!JSON.stringify(reproPlan).includes("SCAN TABLE reproduction_events"), `Full scan on repro: ${JSON.stringify(reproPlan)}`);
        assert.ok(!JSON.stringify(healthPlan).includes("SCAN TABLE health_events"), `Full scan on health: ${JSON.stringify(healthPlan)}`);
    });
});
