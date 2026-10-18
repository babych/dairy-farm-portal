import { describe, it } from 'node:test';
import assert from 'node:assert';
import { handleAnimals } from '../functions/api/animals.js';

describe('Animals API & Clinical Events Suite', () => {
    it('successfully records INSEMINATION reproduction event and updates cow status', async () => {
        const statements = [];
        const mockAnimal = {
            id: 'cow-101',
            farm_id: 'farm-1',
            current_status: 'Open',
            lactation_number: 2
        };

        const mockDb = {
            prepare(sql) {
                return {
                    bind(...params) {
                        return {
                            async first() {
                                if (sql.includes('SELECT * FROM animals WHERE id = ?')) {
                                    return mockAnimal;
                                }
                                return null;
                            },
                            async run() {
                                statements.push({ sql, params });
                                return { success: true };
                            }
                        };
                    }
                };
            }
        };

        const jsonResponse = (data, status = 200) => ({ status, data });

        const reqBody = {
            event_type: 'INSEMINATION',
            event_date: '2026-10-01',
            bull_code: 'UA-BULL-999',
            operator_name: 'Семенюк В.',
            notes: 'Перше осіменіння після отелення'
        };

        const request = {
            json: async () => reqBody
        };

        const res = await handleAnimals({
            path: '/api/animals/cow-101/repro',
            method: 'POST',
            request,
            url: new URL('https://test.local/api/animals/cow-101/repro'),
            db: mockDb,
            jsonResponse,
            getActiveFarmId: () => 'farm-1'
        });

        assert.strictEqual(res.status, 201);
        assert.strictEqual(res.data.status, 'success');
        assert.strictEqual(res.data.new_status, 'Inseminated');
        assert.ok(res.data.expected_calving_date);

        // Check insert into reproduction_events
        const reproInsert = statements.find(s => s.sql.includes('INSERT INTO reproduction_events'));
        assert.ok(reproInsert);
        assert.strictEqual(reproInsert.params[1], 'cow-101');
        assert.strictEqual(reproInsert.params[2], 'INSEMINATION');
        assert.strictEqual(reproInsert.params[3], '2026-10-01');

        // Check update on animals
        const animalUpdate = statements.find(s => s.sql.includes('UPDATE animals SET'));
        assert.ok(animalUpdate);
        assert.strictEqual(animalUpdate.params[0], '2026-10-01'); // last_insemination_date
        assert.ok(animalUpdate.params[1]); // expected_calving_date
        assert.strictEqual(animalUpdate.params[2], 'cow-101');
    });

    it('successfully records PREGNANCY_CHECK positive and updates cow status to Pregnant', async () => {
        const statements = [];
        const mockAnimal = {
            id: 'cow-101',
            farm_id: 'farm-1',
            current_status: 'Inseminated',
            last_insemination_date: '2026-08-01',
            lactation_number: 2
        };

        const mockDb = {
            prepare(sql) {
                return {
                    bind(...params) {
                        return {
                            async first() {
                                if (sql.includes('SELECT * FROM animals WHERE id = ?')) {
                                    return mockAnimal;
                                }
                                return null;
                            },
                            async run() {
                                statements.push({ sql, params });
                                return { success: true };
                            }
                        };
                    }
                };
            }
        };

        const jsonResponse = (data, status = 200) => ({ status, data });

        const reqBody = {
            event_type: 'PREGNANCY_CHECK',
            event_date: '2026-10-01',
            result: 'Pregnant',
            operator_name: 'Лікар Іван'
        };

        const request = {
            json: async () => reqBody
        };

        const res = await handleAnimals({
            path: '/api/animals/cow-101/repro',
            method: 'POST',
            request,
            url: new URL('https://test.local/api/animals/cow-101/repro'),
            db: mockDb,
            jsonResponse,
            getActiveFarmId: () => 'farm-1'
        });

        assert.strictEqual(res.status, 201);
        assert.strictEqual(res.data.status, 'success');
        assert.strictEqual(res.data.new_status, 'Pregnant');
        assert.ok(res.data.days_pregnant >= 60);

        const animalUpdate = statements.find(s => s.sql.includes('UPDATE animals SET'));
        assert.ok(animalUpdate);
        assert.strictEqual(animalUpdate.params[0], 'Pregnant');
    });

    it('successfully records CALVING event, increments lactation, resets pregnancy', async () => {
        const statements = [];
        const mockAnimal = {
            id: 'cow-101',
            farm_id: 'farm-1',
            current_status: 'Dry',
            lactation_number: 2
        };

        const mockDb = {
            prepare(sql) {
                return {
                    bind(...params) {
                        return {
                            async first() {
                                if (sql.includes('SELECT * FROM animals WHERE id = ?')) {
                                    return mockAnimal;
                                }
                                return null;
                            },
                            async run() {
                                statements.push({ sql, params });
                                return { success: true };
                            }
                        };
                    }
                };
            }
        };

        const jsonResponse = (data, status = 200) => ({ status, data });

        const reqBody = {
            event_type: 'CALVING',
            event_date: '2026-10-01',
            result: 'Heifer Calf',
            operator_name: 'Бригадир'
        };

        const request = {
            json: async () => reqBody
        };

        const res = await handleAnimals({
            path: '/api/animals/cow-101/repro',
            method: 'POST',
            request,
            url: new URL('https://test.local/api/animals/cow-101/repro'),
            db: mockDb,
            jsonResponse,
            getActiveFarmId: () => 'farm-1'
        });

        assert.strictEqual(res.status, 201);
        assert.strictEqual(res.data.status, 'success');
        assert.strictEqual(res.data.new_status, 'Fresh');
        assert.strictEqual(res.data.lactation_number, 3);

        const animalUpdate = statements.find(s => s.sql.includes('UPDATE animals SET'));
        assert.ok(animalUpdate);
        assert.strictEqual(animalUpdate.params[0], 3); // lactation_number
        assert.strictEqual(animalUpdate.params[1], '2026-10-01'); // last_calving_date
        assert.strictEqual(animalUpdate.params[2], 'cow-101');
    });

    it('successfully records health treatment with medication and milk quarantine calculation', async () => {
        const statements = [];
        const mockAnimal = {
            id: 'cow-202',
            farm_id: 'farm-1',
            current_status: 'Lactating'
        };

        const mockMedication = {
            id: 'med-1',
            name: 'Мастиджект Форте',
            default_milk_withdrawal_days: 5,
            default_meat_withdrawal_days: 14
        };

        const mockDb = {
            prepare(sql) {
                return {
                    bind(...params) {
                        return {
                            async first() {
                                if (sql.includes('animals WHERE id = ?')) {
                                    return mockAnimal;
                                }
                                if (sql.includes('medications WHERE name = ?')) {
                                    return mockMedication;
                                }
                                return null;
                            },
                            async run() {
                                statements.push({ sql, params });
                                return { success: true };
                            }
                        };
                    }
                };
            }
        };

        const jsonResponse = (data, status = 200) => ({ status, data });

        const today = new Date().toISOString().split('T')[0];
        const reqBody = {
            event_date: today,
            diagnosis: 'Клінічний мастит лівої передньої чверті',
            medication_name: 'Мастиджект Форте',
            dosage: '1 шприц інтрацистернально',
            notes: 'Повторний огляд через 24 години'
        };

        const request = {
            json: async () => reqBody
        };

        const res = await handleAnimals({
            path: '/api/animals/cow-202/health',
            method: 'POST',
            request,
            url: new URL('https://test.local/api/animals/cow-202/health'),
            db: mockDb,
            jsonResponse,
            getActiveFarmId: () => 'farm-1'
        });

        assert.strictEqual(res.status, 201);
        assert.strictEqual(res.data.status, 'success');
        assert.strictEqual(res.data.is_active_withholding, 1);
        assert.ok(res.data.milk_withholding_until);

        const healthInsert = statements.find(s => s.sql.includes('INSERT INTO health_events'));
        assert.ok(healthInsert);
        assert.strictEqual(healthInsert.params[1], 'cow-202');
        assert.strictEqual(healthInsert.params[3], 'Клінічний мастит лівої передньої чверті');
        assert.strictEqual(healthInsert.params[4], 'Мастиджект Форте');
        assert.strictEqual(healthInsert.params[8], 1); // is_active_withholding
    });

    it('returns 404 if animal does not exist', async () => {
        const mockDb = {
            prepare(sql) {
                return {
                    bind() {
                        return {
                            async first() { return null; },
                            async run() { return { success: true }; }
                        };
                    }
                };
            }
        };

        const jsonResponse = (data, status = 200) => ({ status, data });
        const request = { json: async () => ({ event_type: 'INSEMINATION', event_date: '2026-10-01' }) };

        const res = await handleAnimals({
            path: '/api/animals/non-existent/repro',
            method: 'POST',
            request,
            url: new URL('https://test.local/api/animals/non-existent/repro'),
            db: mockDb,
            jsonResponse,
            getActiveFarmId: () => 'farm-1'
        });

        assert.strictEqual(res.status, 404);
        assert.strictEqual(res.data.detail, 'Animal not found');
    });

    it('successfully updates animal record via PUT /api/animals/:id', async () => {
        let updateExecuted = false;
        let selectedId = null;

        const mockAnimal = {
            id: 'cow-update-1',
            farm_id: 'farm-1',
            farm_number: '101',
            official_tag: 'UA0000000101',
            name: 'Зірка',
            current_status: 'Active',
            lactation_number: 2,
            birth_date: '2022-01-15',
            last_calving_date: '2026-05-10',
            expected_calving_date: null
        };

        const mockDb = {
            prepare(sql) {
                return {
                    bind(...params) {
                        return {
                            async first() {
                                if (sql.includes('SELECT * FROM animals WHERE id = ?')) {
                                    selectedId = params[0];
                                    return mockAnimal;
                                }
                                return null;
                            },
                            async run() {
                                if (sql.includes('UPDATE animals SET')) {
                                    updateExecuted = true;
                                }
                                return { success: true };
                            }
                        };
                    }
                };
            }
        };

        const jsonResponse = (data, status = 200) => ({ status, data });
        const reqBody = {
            farm_number: '101',
            official_tag: 'UA0000000101',
            name: 'Зірка Нова',
            current_status: 'Pregnant',
            lactation_number: 2,
            birth_date: '2022-01-15',
            last_calving_date: '2026-05-10',
            expected_calving_date: '2027-02-14'
        };

        const res = await handleAnimals({
            path: '/api/animals/cow-update-1',
            method: 'PUT',
            request: { json: async () => reqBody },
            url: new URL('https://test.local/api/animals/cow-update-1'),
            db: mockDb,
            jsonResponse,
            getActiveFarmId: () => 'farm-1'
        });

        assert.strictEqual(res.status, 200);
        assert.strictEqual(res.data.status, 'success');
        assert.strictEqual(updateExecuted, true);
    });

    it('successfully creates animal record via POST /api/animals', async () => {
        let insertExecuted = false;

        const mockDb = {
            prepare(sql) {
                return {
                    bind(...params) {
                        return {
                            async first() {
                                if (sql.includes("SELECT id FROM farms")) {
                                    return { id: 'farm-1' };
                                }
                                return null;
                            },
                            async run() {
                                if (sql.includes('INSERT INTO animals')) {
                                    insertExecuted = true;
                                }
                                return { success: true };
                            }
                        };
                    }
                };
            }
        };

        const jsonResponse = (data, status = 200) => ({ status, data });
        const reqBody = {
            farm_number: '555',
            official_tag: 'UA1234567890',
            name: 'Красуня',
            current_status: 'Active',
            lactation_number: 1
        };

        const res = await handleAnimals({
            path: '/api/animals',
            method: 'POST',
            request: { json: async () => reqBody },
            url: new URL('https://test.local/api/animals?farm_id=farm-1'),
            db: mockDb,
            jsonResponse,
            getActiveFarmId: () => 'farm-1'
        });

        assert.strictEqual(res.status, 201);
        assert.strictEqual(res.data.status, 'success');
        assert.strictEqual(res.data.inserted_count, 1);
        assert.strictEqual(insertExecuted, true);
    });
});
