import { describe, it } from 'node:test';
import assert from 'node:assert';
import { FarmRepository } from '../functions/api/repositories/farmRepo.js';
import { AnimalRepository } from '../functions/api/repositories/animalRepo.js';
import { DashboardRepository } from '../functions/api/repositories/dashboardRepo.js';
import { handleFarms } from '../functions/api/farms.js';
import { signJWT } from '../functions/api/crypto.js';

describe('Multi-Tenant Security, Data Isolation & Demo Protection Suite', () => {
    const JWT_SECRET = 'test_security_secret_12345';

    // Mock farm dataset simulating multi-tenant setup
    const mockFarms = [
        {
            id: 'demo-farm-test-01',
            code: 'DEMO_FARM',
            name: 'Демо-ферма «Світанок» (Тестова)',
            owner_email: 'demo@dairy-erp.farm',
            created_at: '2026-01-01'
        },
        {
            id: 'private-farm-1',
            code: 'PRIV_01',
            name: 'Uniform-Agri (Commercial)',
            owner_email: 'memory1024@gmail.com',
            created_at: '2026-01-02'
        },
        {
            id: 'private-farm-2',
            code: 'PRIV_02',
            name: 'Ферма 001 (VIP)',
            owner_email: 'dmytrobbch@gmail.com',
            created_at: '2026-01-03'
        }
    ];

    // Mock animals in different farms
    const mockAnimals = [
        // 2 cows in demo farm
        { id: 'cow-demo-1', farm_id: 'demo-farm-test-01', farm_number: '101', official_tag: 'UA0000000101', name: 'Зірка', current_status: 'Fresh', lactation_number: 2 },
        { id: 'cow-demo-2', farm_id: 'demo-farm-test-01', farm_number: '102', official_tag: 'UA0000000102', name: 'Ласуня', current_status: 'Pregnant', lactation_number: 3 },
        // 100 cows in private farm 1 (Uniform-Agri)
        { id: 'cow-priv-1', farm_id: 'private-farm-1', farm_number: '888', official_tag: 'UA9999999888', name: 'Commercial-1', current_status: 'Active', lactation_number: 1 },
        { id: 'cow-priv-2', farm_id: 'private-farm-1', farm_number: '889', official_tag: 'UA9999999889', name: 'Commercial-2', current_status: 'Dry', lactation_number: 4 },
        // 50 cows in private farm 2
        { id: 'cow-priv-3', farm_id: 'private-farm-2', farm_number: '555', official_tag: 'UA5555555555', name: 'VIP-Cow', current_status: 'Pregnant', lactation_number: 2 }
    ];

    function createMockDb() {
        return {
            prepare(sql) {
                const executeFirst = async () => {
                    // Default demo farm selection query
                    if (sql.includes("SELECT id FROM farms WHERE code = 'DEMO_FARM'")) {
                        return { id: 'demo-farm-test-01' };
                    }
                    if (sql.includes("SELECT count(*) as c FROM animals")) {
                        return { c: mockAnimals.length };
                    }
                    if (sql.includes("SELECT \n                count(*) as total")) {
                        return {
                            total: mockAnimals.length,
                            lactating: mockAnimals.filter(a => ['Active', 'Fresh'].includes(a.current_status)).length,
                            dry: mockAnimals.filter(a => a.current_status === 'Dry').length,
                            pregnant: mockAnimals.filter(a => a.current_status === 'Pregnant').length,
                            fresh: mockAnimals.filter(a => a.current_status === 'Fresh').length,
                            inseminated: 0,
                            open: 0,
                            heifers: 0,
                            active_herd: mockAnimals.length,
                            culled: 0
                        };
                    }
                    return null;
                };

                return {
                    first: executeFirst,
                    bind(...params) {
                        return {
                            async first() {
                                // Default demo farm selection query
                                if (sql.includes("SELECT id FROM farms WHERE code = 'DEMO_FARM'")) {
                                    return { id: 'demo-farm-test-01' };
                                }
                                if (sql.includes("SELECT * FROM farms WHERE id = ?")) {
                                    const farm = mockFarms.find(f => f.id === params[0]);
                                    return farm || null;
                                }
                                if (sql.includes("SELECT count(*) as c FROM animals")) {
                                    let list = mockAnimals;
                                    if (sql.includes("farm_id = ?")) {
                                        list = list.filter(a => a.farm_id === params[0]);
                                    }
                                    return { c: list.length };
                                }
                                if (sql.includes("SELECT \n                count(*) as total")) {
                                    let list = mockAnimals;
                                    if (sql.includes("WHERE farm_id = ?")) {
                                        list = list.filter(a => a.farm_id === params[0]);
                                    }
                                    return {
                                        total: list.length,
                                        lactating: list.filter(a => ['Active', 'Fresh'].includes(a.current_status)).length,
                                        dry: list.filter(a => a.current_status === 'Dry').length,
                                        pregnant: list.filter(a => a.current_status === 'Pregnant').length,
                                        fresh: list.filter(a => a.current_status === 'Fresh').length,
                                        inseminated: 0,
                                        open: 0,
                                        heifers: 0,
                                        active_herd: list.length,
                                        culled: 0
                                    };
                                }
                                if (sql.includes("SELECT count(DISTINCT animal_id) as c FROM health_events")) {
                                    return { c: 0 };
                                }
                                return null;
                            },
                            async all() {
                                let list = [...mockFarms];
                                if (sql.includes("FROM farms")) {
                                    if (sql.includes("WHERE (f.owner_email IS NULL OR f.owner_email = 'demo@dairy-erp.farm' OR f.code = 'DEMO_FARM' OR f.id = 'demo-farm-test-01')")) {
                                        list = mockFarms.filter(f => f.id === 'demo-farm-test-01' || f.code === 'DEMO_FARM' || f.owner_email === 'demo@dairy-erp.farm' || f.owner_email === null);
                                    } else if (sql.includes("WHERE (f.owner_email = ? OR f.owner_email IS NULL OR f.owner_email = 'demo@dairy-erp.farm' OR f.code = 'DEMO_FARM')")) {
                                        const email = params[0];
                                        list = mockFarms.filter(f => f.owner_email === email || f.id === 'demo-farm-test-01' || f.code === 'DEMO_FARM' || f.owner_email === 'demo@dairy-erp.farm' || f.owner_email === null);
                                    }
                                    return { results: list.map(f => ({ ...f, cow_count: mockAnimals.filter(a => a.farm_id === f.id).length })) };
                                }
                                if (sql.includes("FROM animals")) {
                                    let animals = [...mockAnimals];
                                    if (sql.includes("farm_id = ?")) {
                                        animals = animals.filter(a => a.farm_id === params[0]);
                                    }
                                    return { results: animals };
                                }
                                return { results: [] };
                            },
                            async run() {
                                return { success: true };
                            }
                        };
                    }
                };
            }
        };
    }

    describe('1. FarmRepository Isolation Guard', () => {
        it('Guest context strictly receives ONLY demo farm and 0 private farms', async () => {
            const db = createMockDb();
            const farms = await FarmRepository.listFarms(db, { userEmail: null, userRole: 'guest' });

            assert.strictEqual(farms.length, 1, 'Guest must see exactly 1 demo farm');
            assert.strictEqual(farms[0].id, 'demo-farm-test-01');
            assert.strictEqual(farms[0].code, 'DEMO_FARM');
            // Strict assertion: Private farms must NOT exist in the list
            assert.ok(!farms.some(f => f.owner_email === 'memory1024@gmail.com'), 'Must never leak memory1024 private farm');
            assert.ok(!farms.some(f => f.owner_email === 'dmytrobbch@gmail.com'), 'Must never leak dmytrobbch private farm');
        });

        it('Authenticated farmer sees their own private farm + demo farm, but NEVER other users private farms', async () => {
            const db = createMockDb();
            const farms = await FarmRepository.listFarms(db, { userEmail: 'dmytrobbch@gmail.com', userRole: 'farmer' });

            assert.strictEqual(farms.length, 2, 'Farmer dmytrobbch should see demo farm + their own farm');
            const ids = farms.map(f => f.id);
            assert.ok(ids.includes('demo-farm-test-01'), 'Includes demo farm');
            assert.ok(ids.includes('private-farm-2'), 'Includes private farm 2 owned by dmytrobbch');
            assert.ok(!ids.includes('private-farm-1'), 'Strictly hides private farm 1 owned by memory1024');
        });

        it('Superadmin sees all farms across all tenants', async () => {
            const db = createMockDb();
            const farms = await FarmRepository.listFarms(db, { userEmail: 'admin@dairy-erp.farm', userRole: 'superadmin' });
            assert.strictEqual(farms.length, 3, 'Superadmin has global access to all 3 farms');
        });
    });

    describe('2. Active Farm Context Switching Permissions (/api/farms/switch/:id)', () => {
        function createResponseCollector() {
            let resData = null;
            let resStatus = 200;
            const jsonResponse = (data, status = 200) => {
                resData = data;
                resStatus = status;
                return { data, status };
            };
            return {
                jsonResponse,
                getResult: () => ({ status: resStatus, data: resData })
            };
        }

        it('Guest or unauthorized user attempting to switch to a private farm returns 403 Forbidden', async () => {
            const db = createMockDb();
            const collector = createResponseCollector();

            // Guest token or no token
            const request = new Request('https://portal.farm/api/farms/switch/private-farm-1', {
                method: 'POST',
                headers: {}
            });

            await handleFarms({
                path: '/api/farms/switch/private-farm-1',
                method: 'POST',
                request,
                url: new URL('https://portal.farm/api/farms/switch/private-farm-1'),
                env: { JWT_SECRET_KEY: JWT_SECRET },
                db,
                jsonResponse: collector.jsonResponse
            });

            const result = collector.getResult();
            assert.strictEqual(result.status, 403, 'Must reject unauthorized switch with 403');
            assert.ok(result.data.detail.includes('Доступ заборонено'), 'Reason must specify forbidden access');
        });

        it('User cannot switch to a private farm belonging to another user', async () => {
            const db = createMockDb();
            const collector = createResponseCollector();

            // User token for dmytrobbch
            const token = await signJWT({ sub: 'dmytrobbch@gmail.com', role: 'farmer' }, JWT_SECRET);
            const request = new Request('https://portal.farm/api/farms/switch/private-farm-1', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            await handleFarms({
                path: '/api/farms/switch/private-farm-1',
                method: 'POST',
                request,
                url: new URL('https://portal.farm/api/farms/switch/private-farm-1'),
                env: { JWT_SECRET_KEY: JWT_SECRET },
                db,
                jsonResponse: collector.jsonResponse
            });

            const result = collector.getResult();
            assert.strictEqual(result.status, 403, 'Must reject cross-tenant switch with 403');
        });

        it('User CAN switch to their OWN private farm', async () => {
            const db = createMockDb();
            const collector = createResponseCollector();

            // User token for dmytrobbch switching to private-farm-2 (which they own)
            const token = await signJWT({ sub: 'dmytrobbch@gmail.com', role: 'farmer' }, JWT_SECRET);
            const request = new Request('https://portal.farm/api/farms/switch/private-farm-2', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            await handleFarms({
                path: '/api/farms/switch/private-farm-2',
                method: 'POST',
                request,
                url: new URL('https://portal.farm/api/farms/switch/private-farm-2'),
                env: { JWT_SECRET_KEY: JWT_SECRET },
                db,
                jsonResponse: collector.jsonResponse
            });

            const result = collector.getResult();
            assert.strictEqual(result.status, 200, 'Owner switch to own farm must succeed');
            assert.strictEqual(result.data.status, 'success');
            assert.strictEqual(result.data.farm.id, 'private-farm-2');
        });

        it('Any user/guest CAN switch to DEMO farm freely', async () => {
            const db = createMockDb();
            const collector = createResponseCollector();

            const request = new Request('https://portal.farm/api/farms/switch/demo-farm-test-01', {
                method: 'POST',
                headers: {}
            });

            await handleFarms({
                path: '/api/farms/switch/demo-farm-test-01',
                method: 'POST',
                request,
                url: new URL('https://portal.farm/api/farms/switch/demo-farm-test-01'),
                env: { JWT_SECRET_KEY: JWT_SECRET },
                db,
                jsonResponse: collector.jsonResponse
            });

            const result = collector.getResult();
            assert.strictEqual(result.status, 200, 'Switching to demo farm is always permitted');
            assert.strictEqual(result.data.farm.id, 'demo-farm-test-01');
        });
    });

    describe('3. AnimalRepository Data Boundary (searchAnimals)', () => {
        it('Querying demo farm returns only demo cows (no private cows)', async () => {
            const db = createMockDb();
            const res = await AnimalRepository.searchAnimals(db, { farmId: 'demo-farm-test-01' });

            assert.strictEqual(res.total, 2);
            assert.strictEqual(res.items.length, 2);
            assert.ok(res.items.every(a => a.farm_id === 'demo-farm-test-01'), 'All cows must belong to demo farm');
            assert.ok(!res.items.some(a => a.id === 'cow-priv-1'), 'Private cows from Uniform-Agri must never appear');
        });

        it('Empty farmId defaults safely to DEMO farm, never to a populated private farm', async () => {
            const db = createMockDb();
            const res = await AnimalRepository.searchAnimals(db, { farmId: null });

            assert.strictEqual(res.total, 2);
            assert.ok(res.items.every(a => a.farm_id === 'demo-farm-test-01'), 'Fallback must default strictly to demo farm');
        });

        it('Querying an empty private farm returns 0 cows and never steals cows from another farm', async () => {
            const db = createMockDb();
            // Querying a non-existent or empty farm ID
            const res = await AnimalRepository.searchAnimals(db, { farmId: 'empty-test-farm-99' });

            assert.strictEqual(res.total, 0, 'Empty farm must yield total 0');
            assert.strictEqual(res.items.length, 0, 'Empty farm must return empty items array');
        });
    });

    describe('4. DashboardRepository Boundary (getHerdStats)', () => {
        it('Computes stats strictly for the requested farm without cross-contamination', async () => {
            const db = createMockDb();
            const dashboardRepo = new DashboardRepository(db);

            const demoStats = await dashboardRepo.getHerdStats('demo-farm-test-01');
            assert.strictEqual(demoStats.total_cows, 2, 'Demo farm has exactly 2 cows');

            const privStats = await dashboardRepo.getHerdStats('private-farm-1');
            assert.strictEqual(privStats.total_cows, 2, 'Private farm 1 has 2 cows');

            const emptyStats = await dashboardRepo.getHerdStats('empty-farm-id');
            assert.strictEqual(emptyStats.total_cows, 0, 'Empty farm stats must be 0 without falling back to another farm');
        });

        it('Null farmId defaults safely to demo farm stats', async () => {
            const db = createMockDb();
            const dashboardRepo = new DashboardRepository(db);

            const defaultStats = await dashboardRepo.getHerdStats(null);
            assert.strictEqual(defaultStats.total_cows, 2, 'Default null farmId calculates demo farm only');
        });
    });
});
