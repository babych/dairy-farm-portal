// Main Application Entry Point with Petite-Vue Initialization
import { createApp, reactive } from '../lib/petite-vue.es.js';
import { store } from './state/store.js';
import { farmsModule } from './modules/farms.js';
import { herdModule } from './modules/herd.js';
import { dashboardModule } from './modules/dashboard.js';
import { flushOfflineOutbox, queueOfflineMutation, getOutboxItems, deleteOutboxItem, getCachedAnimal, cacheFarmAnimals } from './api/client.js';
import { applyLanguage, getCurrentLang, t } from './locales/i18n.js';

// Expose on window for easy interoperability with existing modal handlers and onclick scripts
window.store = store;
window.farmsModule = farmsModule;
window.herdModule = herdModule;
window.dashboardModule = dashboardModule;
window.queueOfflineMutation = queueOfflineMutation;
window.getOutboxItems = getOutboxItems;
window.deleteOutboxItem = deleteOutboxItem;
window.flushOfflineOutbox = flushOfflineOutbox;
window.getCachedAnimal = getCachedAnimal;
window.cacheFarmAnimals = cacheFarmAnimals;
window.setLanguage = applyLanguage;
window.t = t;
export function toggleTechMenu(e) {
    if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
    store.toggleTechMenu(e);
}

export function closeTechMenu() {
    store.closeTechMenu();
}

/** @type {any} */ (window).closeTechMenu = closeTechMenu;
/** @type {any} */ (window).toggleTechMenu = toggleTechMenu;

// Close tech menu when clicking outside or pressing Escape
if (typeof document !== 'undefined') {
    document.addEventListener('click', (event) => {
        if (!store.techMenuOpen) return;
        const target = /** @type {HTMLElement | null} */ (event.target);
        if (target && target.closest('.techMenuContainerClass')) {
            return;
        }
        closeTechMenu();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && store.techMenuOpen) {
            closeTechMenu();
        }
    });
}

/** @type {any} */ (window).switchFarmDirect = async (farmId) => {
    if (!farmId) return;
    if (farmsModule && typeof farmsModule.switchFarm === 'function') {
        await farmsModule.switchFarm(farmId);
    }
};

export function initApp() {
    createApp({
        store,
        farms: farmsModule,
        herd: herdModule,
        dashboard: dashboardModule,

        // Top Navigation
        switchTab(tabName) {
            store.currentTab = tabName;
            const win = /** @type {any} */ (window);
            if (typeof win.switchTab === 'function') {
                win.switchTab(tabName);
            }
        },

        // Fast Status Filter
        filterByStatus(statusKey) {
            this.switchTab('animals');
            if (herdModule.statusFilter === statusKey) {
                herdModule.setStatusFilter('ALL');
                store.activeSubFilter = 'ALL';
            } else {
                herdModule.setStatusFilter(statusKey);
                store.activeSubFilter = statusKey;
            }
            const filterEl = /** @type {HTMLSelectElement | null} */ (document.getElementById('statusFilter'));
            if (filterEl) filterEl.value = herdModule.statusFilter;
            if (typeof updateTileHighlight === 'function') {
                updateTileHighlight(herdModule.statusFilter);
            }
            const win = /** @type {any} */ (window);
            if (typeof win.loadAnimals === 'function') {
                win.curOffset = 0;
                win.loadAnimals();
            }
            const active = /** @type {HTMLElement | null} */ (document.activeElement);
            if (active && typeof active.blur === 'function') {
                active.blur();
            }
        },

        async deleteQueueItem(id) {
            await deleteOutboxItem(id);
            store.outboxItems = await getOutboxItems();
        },


        async mounted() {
            closeTechMenu();
            applyLanguage(getCurrentLang());
            flushOfflineOutbox();

            // Dynamically show DEV badge on dev/preview/local environments
            const isDevHost = window.location.hostname === 'localhost' ||
                              window.location.hostname === '127.0.0.1' ||
                              window.location.hostname.includes('dev.');
            if (isDevHost) {
                const badge = document.getElementById('headerDevBadge');
                if (badge) badge.classList.remove('hidden');
                if (!document.title.startsWith('[DEV]')) {
                    document.title = `[DEV] ${document.title}`;
                }
            }

            // Auto-load data (farms, stats, animals) for both authenticated users and guests
            try {
                await farmsModule.loadFarms();
                const win = /** @type {any} */ (typeof window !== 'undefined' ? window : {});
                const medPromise = typeof win.loadMedsCatalog === 'function' ? win.loadMedsCatalog() : Promise.resolve();
                await Promise.allSettled([
                    dashboardModule.loadStats(),
                    herdModule.loadAnimals(),
                    dashboardModule.loadActionLists(),
                    medPromise
                ]);
            } catch (e) {
                console.warn("[Petite-Vue] Initial load error:", e);
            } finally {
                herdModule.isLoading = false;
            }
        }
    }).mount('#petiteAppRoot');
}
