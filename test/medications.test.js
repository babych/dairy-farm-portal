import { describe, it } from 'node:test';
import assert from 'node:assert';
import { handleDashboard } from '../functions/api/dashboard.js';

describe('Veterinary Medications API Suite', () => {
    it('creates medication with validation and computes withdrawal days correctly', async () => {
        let lastInsertSql = '';
        let lastInsertParams = [];

        const mockDb = {
            prepare(sql) {
                return {
                    bind(...params) {
                        return {
                            async run() {
                                lastInsertSql = sql;
                                lastInsertParams = params;
                                return { success: true };
                            }
                        };
                    }
                };
            }
        };

        const jsonResponse = (data, status = 200) => ({
            status,
            data
        });

        const reqBody = {
            name: 'Амоксицилін 15%',
            active_substance: 'Амоксициліну тригідрат',
            batch_number: 'LOT-2026-X',
            expiration_date: '2027-05-15',
            stock_quantity: '25.5',
            unit: 'флакони',
            default_milk_withdrawal_days: '4',
            default_meat_withdrawal_days: '14',
            instructions: 'Вводити внутрішньом’язово'
        };

        const request = {
            json: async () => reqBody
        };

        const res = await handleDashboard({
            path: '/api/medications',
            method: 'POST',
            request,
            url: new URL('https://test.local/api/medications'),
            db: mockDb,
            jsonResponse
        });

        assert.strictEqual(res.status, 201);
        assert.strictEqual(res.data.status, 'success');
        assert.ok(res.data.id);
        assert.ok(lastInsertSql.includes('INSERT INTO medications'));
        assert.strictEqual(lastInsertParams[1], 'Амоксицилін 15%');
        assert.strictEqual(lastInsertParams[2], 'Амоксициліну тригідрат');
        assert.strictEqual(lastInsertParams[5], 25.5);
        assert.strictEqual(lastInsertParams[6], 'флакони');
        assert.strictEqual(lastInsertParams[7], 4);
        assert.strictEqual(lastInsertParams[8], 14);
    });

    it('rejects medication creation if name is empty', async () => {
        const mockDb = {};
        const jsonResponse = (data, status = 200) => ({ status, data });
        const request = {
            json: async () => ({ name: '   ' })
        };

        const res = await handleDashboard({
            path: '/api/medications',
            method: 'POST',
            request,
            url: new URL('https://test.local/api/medications'),
            db: mockDb,
            jsonResponse
        });

        assert.strictEqual(res.status, 400);
        assert.ok(res.data.detail.toLowerCase().includes("required") || res.data.detail.includes("обов'язковою"));
    });

    it('GET /api/medications normalizes milk_days, meat_days and expiry status', async () => {
        const mockDb = {
            prepare(sql) {
                return {
                    async all() {
                        return {
                            results: [
                                {
                                    id: 'm1',
                                    name: 'Цефтіофур',
                                    expiration_date: '2020-01-01',
                                    default_milk_withdrawal_days: 0,
                                    default_meat_withdrawal_days: 5
                                },
                                {
                                    id: 'm2',
                                    name: 'Окситетрациклін',
                                    expiration_date: '2028-12-31',
                                    default_milk_withdrawal_days: 7,
                                    default_meat_withdrawal_days: 21
                                },
                                {
                                    id: 'm3',
                                    name: 'Вітамін E',
                                    expiration_date: null,
                                    default_milk_withdrawal_days: null,
                                    default_meat_withdrawal_days: null
                                }
                            ]
                        };
                    }
                };
            }
        };

        const jsonResponse = (data, status = 200) => ({ status, data });
        const res = await handleDashboard({
            path: '/api/medications',
            method: 'GET',
            request: {},
            url: new URL('https://test.local/api/medications'),
            db: mockDb,
            jsonResponse
        });

        assert.strictEqual(res.status, 200);
        const list = res.data;
        assert.strictEqual(list.length, 3);
        assert.strictEqual(list[0].status_expiry, 'EXPIRED');
        assert.strictEqual(list[0].milk_days, 0);
        assert.strictEqual(list[0].meat_days, 5);

        assert.strictEqual(list[1].status_expiry, 'OK');
        assert.strictEqual(list[1].milk_days, 7);
        assert.strictEqual(list[1].meat_days, 21);

        assert.strictEqual(list[2].status_expiry, 'OK');
        assert.strictEqual(list[2].milk_days, 0);
        assert.strictEqual(list[2].meat_days, 0);
    });
});
