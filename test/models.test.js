import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Farm, Animal } from '../functions/api/models/index.js';

describe('Domain Models Suite', () => {
    describe('1. Farm Domain Model', () => {
        it('instantiates correctly from raw DB row with defaults', () => {
            const rawRow = {
                id: 'farm-123',
                name: '  Ферма Сонячна  ',
                cow_count: '42',
                is_current: 1
            };
            const farm = new Farm(rawRow);
            assert.strictEqual(farm.id, 'farm-123');
            assert.strictEqual(farm.name, 'Ферма Сонячна');
            assert.strictEqual(farm.cowCount, 42);
            assert.strictEqual(farm.isCurrent, true);
        });

        it('handles null values safely in toJSON serialization', () => {
            const farm = new Farm({});
            const json = farm.toJSON();
            assert.strictEqual(json.name, 'Моя ферма');
            assert.strictEqual(json.cow_count, 0);
            assert.strictEqual(json.is_current, 0);
            assert.strictEqual(json.farmer_name, null);
            assert.strictEqual(json.created_at, null);
            assert.strictEqual(json.imported_at, null);
        });

        it('retains created_at and imported_at lifecycle timestamps', () => {
            const farm = new Farm({
                created_at: '2026-01-10T12:00:00Z',
                imported_at: '2026-10-12T09:30:00Z'
            });
            const json = farm.toJSON();
            assert.strictEqual(json.created_at, '2026-01-10T12:00:00Z');
            assert.strictEqual(json.imported_at, '2026-10-12T09:30:00Z');
        });
    });

    describe('2. Animal Domain Model', () => {
        it('instantiates correctly and normalizes fields', () => {
            const rawRow = {
                id: 'cow-777',
                farm_number: '1042',
                official_tag: 'UA 12345678',
                lactation_number: '3',
                current_status: 'Pregnant'
            };
            const animal = new Animal(rawRow);
            assert.strictEqual(animal.farmNumber, '1042');
            assert.strictEqual(animal.lactationNumber, 3);
            assert.strictEqual(animal.currentStatus, 'Pregnant');
        });

        it('computes Days In Milk (DIM) correctly from last_calving_date', () => {
            const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            const animal = new Animal({
                last_calving_date: twentyDaysAgo
            });
            assert.strictEqual(animal.dim, 20);
        });

        it('returns null DIM if animal has never calved (heifer)', () => {
            const animal = new Animal({
                last_calving_date: null
            });
            assert.strictEqual(animal.dim, null);
        });

        it('serializes to predictable JSON schema including reproduction fields', () => {
            const animal = new Animal({
                farm_number: '99',
                current_status: 'Pregnant',
                last_insemination_date: '2026-08-15',
                days_pregnant: 64
            });
            const json = animal.toJSON();
            assert.strictEqual(json.farm_number, '99');
            assert.strictEqual(json.current_status, 'Pregnant');
            assert.strictEqual(json.last_insemination_date, '2026-08-15');
            assert.strictEqual(json.days_pregnant, 64);
            assert.strictEqual(json.group_name, 'Група 1');
            assert.strictEqual(json.dim, null);
        });
    });
});
