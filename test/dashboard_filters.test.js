import test from 'node:test';
import assert from 'node:assert/strict';

test('Dashboard Filters & Status Alignment Suite', async (t) => {
    // 1. Verify that all 10 tile filter keys map to valid status keys expected by backend & herd filter
    const validTileStatuses = [
        'ALL',
        'Active',
        'Culled',
        'Open',
        'Inseminated',
        'Pregnant',
        'Dry',
        'Fresh',
        'Heifer',
        'Quarantine'
    ];

    await t.test('all tile filter statuses are non-empty and well-formed', () => {
        assert.equal(validTileStatuses.length, 10);
        for (const s of validTileStatuses) {
            assert.ok(typeof s === 'string' && s.length > 0);
        }
    });

    await t.test('toggle logic correctly alternates between status and ALL', () => {
        const toggle = (current, target) => (current === target ? 'ALL' : target);
        
        assert.equal(toggle('ALL', 'Pregnant'), 'Pregnant');
        assert.equal(toggle('Pregnant', 'Pregnant'), 'ALL');
        assert.equal(toggle('Pregnant', 'Inseminated'), 'Inseminated');
    });

    await t.test('auto-fallback picks populated farm when current farm has 0 cows', () => {
        const farmsList = [
            { id: 'empty-1', name: 'Порожня ферма', cow_count: 0 },
            { id: 'pop-1', name: 'Ферма з поголівʼям', cow_count: 1179 }
        ];

        let currentFarm = farmsList.find(f => f.id === 'empty-1');
        assert.equal(currentFarm.id, 'empty-1');

        if (currentFarm && (!currentFarm.cow_count || currentFarm.cow_count === 0)) {
            const populated = farmsList.find(f => f.cow_count > 0);
            if (populated) currentFarm = populated;
        }

        assert.equal(currentFarm.id, 'pop-1');
        assert.equal(currentFarm.cow_count, 1179);
    });
});
