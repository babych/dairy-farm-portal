// Dashboard, KPIs & Veterinary Action Lists Module
import { store } from '../state/store.js';
import { apiRequest } from '../api/client.js';

export const dashboardModule = {
    stats: {
        total_cows: 0,
        in_quarantine: 0,
        herd_tiles: { open: 0, inseminated: 0, pregnant: 0, dry: 0, fresh: 0 },
        kpis: { avg_dim: 0, conception_rate: 0, pregnancy_rate: 0, insemination_rate: 0, calving_interval_days: 0 }
    },
    actionLists: {
        quarantine_milk: [],
        pregnancy_check: [],
        dry_off_candidates: []
    },

    async loadStats() {
        try {
            const query = store.currentFarmId ? `?farm_id=${encodeURIComponent(store.currentFarmId)}` : '';
            const data = await apiRequest(`/api/dashboard/stats${query}`, { method: 'GET' });
            if (data) {
                this.stats = {
                    total_cows: data.total_cows || 0,
                    in_quarantine: data.in_quarantine || 0,
                    herd_tiles: data.herd_tiles || { open: 0, inseminated: 0, pregnant: 0, dry: 0, fresh: 0 },
                    kpis: data.kpis || { avg_dim: 0, conception_rate: 0, pregnancy_rate: 0, insemination_rate: 0, calving_interval_days: 0 }
                };
            }
        } catch (e) {
            console.error("Load stats error", e);
        }
    },

    async loadActionLists() {
        try {
            const query = store.currentFarmId ? `?farm_id=${encodeURIComponent(store.currentFarmId)}` : '';
            const data = await apiRequest(`/api/dashboard/action-lists${query}`, { method: 'GET' });
            if (data) {
                this.actionLists = {
                    quarantine_milk: data.quarantine_milk || data.milk_quarantine || [],
                    pregnancy_check: data.pregnancy_check || data.pregnancy_check_due || [],
                    dry_off_candidates: data.dry_off_candidates || []
                };
            }
        } catch (e) {
            console.error("Load action lists error", e);
        }
    },

    getPct(val) {
        const total = this.stats.total_cows || 0;
        return total > 0 ? Math.round((val / total) * 100) : 0;
    },

    get pctTotal() {
        return 100;
    },

    get pctActive() {
        return this.getPct(this.stats.herd_tiles?.active_herd || 0);
    },

    get pctCulled() {
        return this.getPct(this.stats.herd_tiles?.culled || 0);
    },

    get pctHeifers() {
        return this.getPct(this.stats.herd_tiles?.heifers || 0);
    },

    get pctOpen() {
        return this.getPct(this.stats.herd_tiles?.open || 0);
    },

    get pctIns() {
        return this.getPct(this.stats.herd_tiles?.inseminated || 0);
    },

    get pctPreg() {
        return this.getPct(this.stats.herd_tiles?.pregnant || 0);
    },

    get pctDry() {
        return this.getPct(this.stats.herd_tiles?.dry || 0);
    },

    get pctFresh() {
        return this.getPct(this.stats.herd_tiles?.fresh || 0);
    },

    get pctQuar() {
        return this.getPct(this.stats.in_quarantine || 0);
    },

    formatTileMain(count, pct) {
        return (count || 0).toLocaleString();
    },

    formatTileSub(count, pct) {
        if (store.metricMode === 'heads') {
            return (count || 0).toLocaleString() + ' гол';
        }
        return pct + '%';
    }
};
