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
});
