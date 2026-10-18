import { describe, it } from 'node:test';
import assert from 'node:assert';
import { FarmRepository } from '../functions/api/repositories/farmRepo.js';

describe('Farm Repository & Multi-Farm Access Suite', () => {
    function createMockDb(farmsData) {
        return {
            prepare(sql) {
                return {
                    bind(...params) {
                        return {
                            async all() {
                                let filtered = [...farmsData];
                                if (sql.includes('WHERE (f.owner_email = ?')) {
                                    const userEmail = params[0];
                                    filtered = farmsData.filter(f => f.owner_email === userEmail || f.owner_email === null || f.owner_email === 'demo@dairy-erp.farm' || f.code === 'DEMO_FARM');
                                } else if (sql.includes('WHERE (f.owner_email IS NULL')) {
                                    filtered = farmsData.filter(f => f.owner_email === null || f.owner_email === 'demo@dairy-erp.farm' || f.code === 'DEMO_FARM' || f.id === 'demo-farm-test-01');
                                }
                                return {
                                    results: filtered.map(f => ({
                                        ...f,
                                        cow_count: f.cow_count || 0
                                    }))
                                };
                            }
                        };
                    }
                };
            }
        };
    }

    const mockFarms = [
        { id: 'farm-1', code: 'FARM_1', name: 'Uniform-Agri', owner_email: 'memory1024@gmail.com', created_at: '2026-01-01' },
        { id: 'farm-2', code: 'FARM_2', name: 'Ферма 001', owner_email: 'dmytrobbch@gmail.com', created_at: '2026-01-02' },
        { id: 'farm-3', code: 'FARM_3', name: 'Імпортована ферма 1', owner_email: 'memory1024@gmail.com', created_at: '2026-01-03' },
        { id: 'farm-4', code: 'FARM_4', name: 'Імпортована ферма 2', owner_email: 'memory1024@gmail.com', created_at: '2026-01-04' }
    ];

    it('superadmin sees all 4 farms regardless of owner', async () => {
        const db = createMockDb(mockFarms);
        const list = await FarmRepository.listFarms(db, {
            userEmail: 'dmytrobbch@gmail.com',
            userRole: 'superadmin'
        });
        assert.strictEqual(list.length, 4);
    });

    it('authenticated user sees their own farms and public/unowned farms without dropping', async () => {
        const farmsWithGlobal = [
            ...mockFarms,
            { id: 'farm-global', code: 'FARM_G', name: 'Демо База', owner_email: null, created_at: '2026-01-05' }
        ];
        const db = createMockDb(farmsWithGlobal);
        const list = await FarmRepository.listFarms(db, {
            userEmail: 'dmytrobbch@gmail.com',
            userRole: 'farmer'
        });
        // dmytrobbch owns farm-2 + global farm
        assert.strictEqual(list.length, 2);
        assert.ok(list.some(f => f.id === 'farm-2'));
        assert.ok(list.some(f => f.id === 'farm-global'));
    });

    it('marks activeFarmId correctly as is_current: 1', async () => {
        const db = createMockDb(mockFarms);
        const list = await FarmRepository.listFarms(db, {
            userRole: 'superadmin',
            activeFarmId: 'farm-3'
        });
        assert.strictEqual(list.length, 4);
        const active = list.find(f => f.id === 'farm-3');
        assert.strictEqual(active.is_current, 1);
        const other = list.find(f => f.id === 'farm-1');
        assert.strictEqual(other.is_current, 0);
    });

    it('unauthenticated guest ONLY sees demo/public farm and NEVER private user farms', async () => {
        const farmsWithDemo = [
            ...mockFarms,
            { id: 'demo-farm-test-01', code: 'DEMO_FARM', name: 'Демо База', owner_email: 'demo@dairy-erp.farm', created_at: '2026-01-05' }
        ];
        const db = createMockDb(farmsWithDemo);
        const list = await FarmRepository.listFarms(db, {
            userEmail: null,
            userRole: 'guest'
        });
        assert.strictEqual(list.length, 1);
        assert.strictEqual(list[0].id, 'demo-farm-test-01');
        assert.strictEqual(list[0].code, 'DEMO_FARM');
        assert.ok(!list.some(f => f.owner_email === 'memory1024@gmail.com'));
        assert.ok(!list.some(f => f.owner_email === 'dmytrobbch@gmail.com'));
    });
});
