import { describe, it } from 'node:test';
import assert from 'node:assert';
import { handleSystem } from '../functions/api/system.js';

describe('System Backup & Restore Integration Suite', () => {
    // Mock D1 database
    function createMockDb() {
        const farmRow = {
            id: 'farm-123',
            name: 'Тестова ферма Полісся',
            farmer_name: 'Іван Петренко',
            created_at: '2026-01-01T00:00:00Z'
        };
        const animalRows = [
            {
                id: 'cow-1',
                farm_id: 'farm-123',
                farm_number: '101',
                official_tag: 'UA12345678',
                name: 'Зірка',
                birth_date: '2022-03-15',
                current_status: 'Active',
                lactation_number: 2,
                last_calving_date: '2025-08-10',
                expected_calving_date: '2026-05-17'
            },
            {
                id: 'cow-2',
                farm_id: 'farm-123',
                farm_number: '102',
                official_tag: 'UA87654321',
                name: 'Лиска',
                birth_date: '2023-01-20',
                current_status: 'Active',
                lactation_number: 1,
                last_calving_date: '2025-11-01',
                expected_calving_date: null
            }
        ];

        return {
            insertedFarms: [],
            insertedAnimals: [],
            prepare(query) {
                return {
                    bind(...args) {
                        return {
                            async first() {
                                if (query.includes('FROM farms')) return farmRow;
                                return null;
                            },
                            async all() {
                                if (query.includes('FROM animals WHERE farm_id = ?')) {
                                    return { results: animalRows };
                                }
                                if (query.includes('FROM animals LIMIT')) {
                                    return { results: animalRows };
                                }
                                return { results: [] };
                            },
                            async run() {
                                return { success: true };
                            }
                        };
                    },
                    async first() {
                        if (query.includes('FROM farms')) return farmRow;
                        return null;
                    },
                    async all() {
                        return { results: [] };
                    }
                };
            },
            async batch(stmts) {
                return stmts.map(() => ({ success: true }));
            }
        };
    }

    it('generates valid full JSON backup with farm profile and animals', async () => {
        const mockDb = createMockDb();
        const request = new Request('https://test.local/api/system/backup?farm_id=farm-123', {
            headers: { 'Authorization': 'Bearer header.eyJzdWIiOiJ0ZXN0QGZhcm0udWEiLCJmYXJtX2lkIjoiZmFybS0xMjMifQ.sig' }
        });

        const jsonResponse = (data, status = 200, headers = {}) => {
            return new Response(JSON.stringify(data), { status, headers });
        };

        const res = await handleSystem({
            path: '/api/system/backup',
            method: 'GET',
            request,
            url: new URL('https://test.local/api/system/backup?farm_id=farm-123'),
            env: {},
            db: mockDb,
            jsonResponse
        });

        assert.strictEqual(res.status, 200);
        const disposition = res.headers.get('content-disposition');
        assert.ok(disposition && disposition.includes('attachment; filename='));

        const backup = await res.json();
        assert.strictEqual(backup.version, '2.5.0');
        assert.strictEqual(backup.farm_profile.name, 'Тестова ферма Полісся');
        assert.strictEqual(backup.counts.animals, 2);
        assert.strictEqual(backup.animals.length, 2);
        assert.strictEqual(backup.animals[0].farm_number, '101');
        assert.strictEqual(backup.animals[0].name, 'Зірка');
    });

    it('successfully restores/imports from JSON backup file directly', async () => {
        const mockDb = createMockDb();
        const backupPayload = {
            version: '2.5.0',
            farm_profile: {
                name: 'Відновлена ферма з бекапу'
            },
            animals: [
                { farm_number: '501', official_tag: 'UA50100', name: 'Красуня', current_status: 'Active' },
                { farm_number: '502', official_tag: 'UA50200', name: 'Берізка', current_status: 'Active' }
            ],
            medications: [
                {
                    name: 'Окситетрациклін 200',
                    active_substance: 'Окситетрациклін',
                    batch_number: 'B-2026-01',
                    stock_quantity: 15,
                    milk_withdrawal_days: 7,
                    meat_withdrawal_days: 28
                }
            ]
        };

        const formData = new FormData();
        const jsonBlob = new Blob([JSON.stringify(backupPayload)], { type: 'application/json' });
        formData.append('file', jsonBlob, 'backup_export.json');
        formData.append('mode', 'create_new');

        const request = new Request('https://test.local/api/import/uniform', {
            method: 'POST',
            body: formData
        });

        const jsonResponse = (data, status = 200, headers = {}) => {
            return new Response(JSON.stringify(data), { status, headers });
        };

        const res = await handleSystem({
            path: '/api/import/uniform',
            method: 'POST',
            request,
            url: new URL('https://test.local/api/import/uniform'),
            env: {},
            db: mockDb,
            jsonResponse
        });

        assert.strictEqual(res.status, 200);
        const result = await res.json();
        assert.strictEqual(result.status, 'success');
        assert.strictEqual(result.cows_imported, 2);
        assert.strictEqual(result.medications_imported, 1);
        assert.strictEqual(result.farm_name, 'Відновлена ферма з бекапу');
    });

    it('smart upsert: updates existing animal data and inserts only new animals without creating duplicates', async () => {
        const existingAnimals = [
            { id: 'cow-101', farm_id: 'farm-123', farm_number: '101', name: 'Зірка', current_status: 'Active', days_pregnant: 0 }
        ];

        let updatedCount = 0;
        let insertedCount = 0;

        const mockDb = {
            prepare(query) {
                return {
                    bind(...args) {
                        return {
                            async first() { return null; },
                            async all() {
                                if (query.includes('SELECT id, farm_number FROM animals')) {
                                    return { results: existingAnimals };
                                }
                                return { results: [] };
                            },
                            async run() { return { success: true }; }
                        };
                    },
                    async first() { return null; },
                    async all() { return { results: [] }; }
                };
            },
            async batch(stmts) {
                // Statements are prepared queries
                return stmts.map(() => ({ success: true }));
            }
        };

        const backupPayload = {
            farm_profile: { name: 'Smart Farm' },
            animals: [
                // Cow 101 already exists -> should update
                { farm_number: '101', official_tag: 'UA101', name: 'Зірка-Оновлена', current_status: 'Pregnant', days_pregnant: 45 },
                // Cow 103 is new -> should insert
                { farm_number: '103', official_tag: 'UA103', name: 'Новачка', current_status: 'Heifer', days_pregnant: 0 }
            ]
        };

        const formData = new FormData();
        const jsonBlob = new Blob([JSON.stringify(backupPayload)], { type: 'application/json' });
        formData.append('file', jsonBlob, 'smart_merge.json');
        formData.append('mode', 'merge');
        formData.append('farm_id', 'farm-123');

        const request = new Request('https://test.local/api/import/uniform', {
            method: 'POST',
            body: formData
        });

        const jsonResponse = (data, status = 200, headers = {}) => {
            return new Response(JSON.stringify(data), { status, headers });
        };

        const res = await handleSystem({
            path: '/api/import/uniform',
            method: 'POST',
            request,
            url: new URL('https://test.local/api/import/uniform'),
            env: {},
            db: mockDb,
            jsonResponse
        });

        assert.strictEqual(res.status, 200);
        const result = await res.json();
        assert.strictEqual(result.status, 'success');
        assert.strictEqual(result.cows_imported, 1, 'Only 1 new cow should be inserted');
        assert.strictEqual(result.cows_updated, 1, '1 existing cow should be updated');
    });

    it('diff_check mode: accurately computes added, modified and unchanged counts with detailed changes', async () => {
        const existingAnimals = [
            { id: 'cow-1', farm_id: 'farm-123', farm_number: '101', name: 'Зірка', current_status: 'Active', lactation_number: 1, official_tag: 'UA101' },
            { id: 'cow-2', farm_id: 'farm-123', farm_number: '102', name: 'Лиска', current_status: 'Active', lactation_number: 2, official_tag: 'UA102' }
        ];

        const mockDb = {
            prepare(query) {
                return {
                    bind(...args) {
                        return {
                            async first() {
                                if (query.includes('FROM farms WHERE id = ?')) return { id: 'farm-123', name: 'Ферма Полісся' };
                                return null;
                            },
                            async all() {
                                if (query.includes('FROM animals WHERE farm_id = ?')) return { results: existingAnimals };
                                return { results: [] };
                            },
                            async run() { return { success: true }; }
                        };
                    },
                    async first() {
                        if (query.includes('FROM farms')) return { id: 'farm-123', name: 'Ферма Полісся' };
                        return null;
                    },
                    async all() { return { results: [] }; }
                };
            }
        };

        const backupPayload = {
            farm_profile: { name: 'Ферма Полісся' },
            animals: [
                // Cow 101 has modified status and name
                { farm_number: '101', official_tag: 'UA101', name: 'Зірка 2', current_status: 'Pregnant', lactation_number: 1 },
                // Cow 102 is completely unchanged
                { farm_number: '102', official_tag: 'UA102', name: 'Лиска', current_status: 'Active', lactation_number: 2 },
                // Cow 103 is completely new
                { farm_number: '103', official_tag: 'UA103', name: 'Нова', current_status: 'Heifer', lactation_number: 0 }
            ]
        };

        const formData = new FormData();
        const jsonBlob = new Blob([JSON.stringify(backupPayload)], { type: 'application/json' });
        formData.append('file', jsonBlob, 'test_diff.json');
        formData.append('mode', 'diff_check');
        formData.append('farm_id', 'farm-123');

        const request = new Request('https://test.local/api/import/uniform', {
            method: 'POST',
            body: formData
        });

        const jsonResponse = (data, status = 200, headers = {}) => {
            return new Response(JSON.stringify(data), { status, headers });
        };

        const res = await handleSystem({
            path: '/api/import/uniform',
            method: 'POST',
            request,
            url: new URL('https://test.local/api/import/uniform'),
            env: {},
            db: mockDb,
            jsonResponse
        });

        assert.strictEqual(res.status, 200);
        const result = await res.json();
        assert.ok(result.diff, 'diff object must be returned');
        assert.strictEqual(result.diff.added_count, 1, '1 new animal added');
        assert.strictEqual(result.diff.modified_count, 1, '1 animal modified');
        assert.strictEqual(result.diff.unchanged_count, 1, '1 animal unchanged');
        assert.strictEqual(result.diff.total_in_backup, 3);
        assert.strictEqual(result.diff.sample_modified.length, 1);
        assert.strictEqual(result.diff.sample_modified[0].farm_number, '101');
        assert.strictEqual(result.diff.sample_modified[0].changes['Кличка'].new, 'Зірка 2');
    });
});
