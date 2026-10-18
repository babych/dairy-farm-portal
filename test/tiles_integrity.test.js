import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';

// Mock browser globals for Node.js test environment before importing client modules
if (typeof globalThis.document === 'undefined') {
    globalThis.document = {
        querySelectorAll: () => [],
        getElementById: () => null,
        addEventListener: () => {}
    };
}
if (typeof globalThis.window === 'undefined') {
    globalThis.window = {
        location: { origin: 'http://localhost' },
        addEventListener: () => {}
    };
}
if (typeof globalThis.localStorage === 'undefined') {
    globalThis.localStorage = {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {}
    };
}

const { dashboardModule } = await import('../src/modules/dashboard.js');

test('Declarative Tile System Integrity Suite', async (t) => {
    await t.test('dashboardModule defines exactly 10 tiles with non-empty keys and ids', () => {
        assert.ok(Array.isArray(dashboardModule.tiles), 'dashboardModule.tiles must be an array');
        assert.strictEqual(dashboardModule.tiles.length, 10, 'Must have exactly 10 herd status filter tiles');

        const keys = new Set();
        const ids = new Set();
        for (const tile of dashboardModule.tiles) {
            assert.ok(tile.key, `Tile must have a key: ${JSON.stringify(tile)}`);
            assert.ok(tile.id, `Tile must have an id: ${JSON.stringify(tile)}`);
            assert.ok(!keys.has(tile.key), `Duplicate tile key found: ${tile.key}`);
            assert.ok(!ids.has(tile.id), `Duplicate tile id found: ${tile.id}`);
            keys.add(tile.key);
            ids.add(tile.id);
        }
    });

    await t.test('index.html contains declarative v-for loop over dashboard.tiles and no duplicate static buttons', () => {
        const html = fs.readFileSync(path.resolve('index.html'), 'utf8');
        assert.ok(html.includes('v-for="t in dashboard.tiles"'), 'index.html must use declarative v-for loop');
        assert.ok(!html.includes('id="tileBtnTotal"'), 'Old hardcoded button id="tileBtnTotal" must be replaced by :id="t.id"');
        assert.ok(!html.includes('id="tileBtnActive"'), 'Old hardcoded button id="tileBtnActive" must be replaced by :id="t.id"');
    });

    await t.test('getTileCount and getTilePct correctly calculate stats without throwing', () => {
        dashboardModule.stats = {
            total_cows: 100,
            in_quarantine: 5,
            herd_tiles: {
                open: 20,
                inseminated: 15,
                pregnant: 40,
                dry: 10,
                fresh: 5,
                active_herd: 90,
                culled: 10,
                heifers: 10
            }
        };

        assert.strictEqual(dashboardModule.getTileCount('ALL'), 100);
        assert.strictEqual(dashboardModule.getTilePct('ALL'), 100);

        assert.strictEqual(dashboardModule.getTileCount('Active'), 90);
        assert.strictEqual(dashboardModule.getTilePct('Active'), 90);

        assert.strictEqual(dashboardModule.getTileCount('Open'), 20);
        assert.strictEqual(dashboardModule.getTilePct('Open'), 20);

        assert.strictEqual(dashboardModule.getTileCount('Quarantine'), 5);
        assert.strictEqual(dashboardModule.getTilePct('Quarantine'), 5);
    });
});
