// Farms Management & Database Switching Module
import { reactive } from '../../lib/petite-vue.es.js';
import { store } from '../state/store.js';
import { apiRequest } from '../api/client.js';

let isSwitchingFarm = false;

export const farmsModule = reactive({
    async loadFarms() {
        try {
            const savedFarmId = localStorage.getItem("dairy_selected_farm");
            const queryParam = savedFarmId ? `?active_farm_id=${encodeURIComponent(savedFarmId)}` : "";
            const res = await apiRequest(`/api/farms${queryParam}`, { method: 'GET' });
            if (!res) return;
            store.farmsList = res;

            let currentFarm = (savedFarmId && store.farmsList.find(f => f.id === savedFarmId))
                ? store.farmsList.find(f => f.id === savedFarmId)
                : (store.farmsList.find(f => f.is_current) || store.farmsList[0]);

            // Only auto-fallback to populated farm on initial load when user has not explicitly chosen a farm
            if (!savedFarmId && currentFarm && (!currentFarm.cow_count || currentFarm.cow_count === 0)) {
                const populatedFarm = store.farmsList.find(f => (f.cow_count && f.cow_count > 0));
                if (populatedFarm) {
                    currentFarm = populatedFarm;
                }
            }

            if (currentFarm) {
                store.setSelectedFarm(currentFarm.id);
            }
            return store.farmsList;
        } catch (err) {
            console.warn("Failed to load farms", err);
        }
    },

    async switchFarm(farmId, showToastMsg = true, onSwitchedCallback = null) {
        if (!farmId || isSwitchingFarm) return;
        isSwitchingFarm = true;
        store.setSelectedFarm(farmId);

        try {
            const res = await apiRequest(`/api/farms/switch/${farmId}`, {
                method: 'POST'
            });

            if (res && res.access_token) {
                store.setToken(res.access_token);
                const win = /** @type {any} */ (typeof window !== 'undefined' ? window : {});
                if ('token' in win) {
                    win.token = res.access_token;
                }
            }
            if (showToastMsg && res && res.message) {
                store.addToast(res.message);
            }

            await this.loadFarms();

            // Refresh all dashboard, animal, alert, and event views for the new farm
            const win = /** @type {any} */ (typeof window !== 'undefined' ? window : {});
            if (win.dashboardModule && win.dashboardModule.loadStats) {
                await win.dashboardModule.loadStats();
            }
            if (win.herdModule && win.herdModule.loadAnimals) {
                win.herdModule.curOffset = 0;
                await win.herdModule.loadAnimals();
            }
            if (typeof win.loadStats === 'function') win.loadStats();
            if (typeof win.loadActionLists === 'function') win.loadActionLists();
            if (typeof win.loadEventGrid === 'function') win.loadEventGrid();

            // Sync all farm select dropdowns in DOM
            const selects = document.querySelectorAll('select#farmSelectDropdown, select#farmSelectDropdownDesktop, select.farmSelectDropdownClass');
            selects.forEach(el => {
                const s = /** @type {HTMLSelectElement} */ (el);
                if (s && s.value !== farmId) s.value = farmId;
            });

            if (onSwitchedCallback) {
                await onSwitchedCallback();
            }
        } catch (err) {
            console.error("switchFarm error:", err);
            store.addToast(err.message, "error");
        } finally {
            isSwitchingFarm = false;
        }
    },

    getCurrentFarm() {
        if (!store.farmsList || store.farmsList.length === 0) return null;
        return store.farmsList.find(f => f.id === store.currentFarmId) ||
               store.farmsList.find(f => f.is_current) ||
               store.farmsList[0];
    }
});

