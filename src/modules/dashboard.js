// Dashboard, KPIs & Veterinary Action Lists Module
import { reactive } from '../../lib/petite-vue.es.js';
import { store } from '../state/store.js';
import { apiRequest } from '../api/client.js';

export const dashboardModule = reactive({
    stats: {
        total_cows: 0,
        in_quarantine: 0,
        herd_tiles: { open: 0, inseminated: 0, pregnant: 0, dry: 0, fresh: 0, active_herd: 0, culled: 0, heifers: 0 },
        kpis: { avg_dim: 0, conception_rate: 0, pregnancy_rate: 0, insemination_rate: 0, calving_interval_days: 0 }
    },
    actionLists: {
        quarantine_milk: [],
        pregnancy_check: [],
        dry_off_candidates: [],
        calving_watch: []
    },

    async loadStats() {
        try {
            const query = store.currentFarmId ? `?farm_id=${encodeURIComponent(store.currentFarmId)}` : '';
            const data = await apiRequest(`/api/dashboard/stats${query}`, { method: 'GET' });
            if (data) {
                this.stats = {
                    total_cows: data.total_cows || 0,
                    in_quarantine: data.in_quarantine || 0,
                    herd_tiles: data.herd_tiles || { open: 0, inseminated: 0, pregnant: 0, dry: 0, fresh: 0, active_herd: 0, culled: 0, heifers: 0 },
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
                    dry_off_candidates: data.dry_off_candidates || [],
                    calving_watch: data.calving_watch || data.expected_calving || []
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
    },

    getTileCount(statusKey) {
        if (statusKey === 'ALL') return this.stats.total_cows || 0;
        if (statusKey === 'Quarantine') return this.stats.in_quarantine || 0;
        if (statusKey === 'Active') return this.stats.herd_tiles?.active_herd || 0;
        if (statusKey === 'Culled') return this.stats.herd_tiles?.culled || 0;
        if (statusKey === 'Open') return this.stats.herd_tiles?.open || 0;
        if (statusKey === 'Inseminated') return this.stats.herd_tiles?.inseminated || 0;
        if (statusKey === 'Pregnant') return this.stats.herd_tiles?.pregnant || 0;
        if (statusKey === 'Dry') return this.stats.herd_tiles?.dry || 0;
        if (statusKey === 'Fresh') return this.stats.herd_tiles?.fresh || 0;
        if (statusKey === 'Heifer') return this.stats.herd_tiles?.heifers || 0;
        return 0;
    },

    getTilePct(statusKey) {
        if (statusKey === 'ALL') return 100;
        const count = this.getTileCount(statusKey);
        return this.getPct(count);
    },

    tiles: [
        { key: 'ALL', id: 'tileBtnTotal', titleKey: 'tileTotalTitle', subKey: 'tileTotalSub', bg: 'bg-slate-100/90 hover:bg-slate-200/90 border-slate-300 text-slate-800' },
        { key: 'Active', id: 'tileBtnActive', titleKey: 'tileActiveTitle', subKey: 'tileActiveSub', bg: 'bg-emerald-50/80 hover:bg-emerald-100/80 border-emerald-300 text-emerald-800' },
        { key: 'Culled', id: 'tileBtnCulled', titleKey: 'tileCulledTitle', subKey: 'tileCulledSub', bg: 'bg-zinc-100/90 hover:bg-zinc-200/90 border-zinc-300 text-zinc-700' },
        { key: 'Open', id: 'tileBtnOpen', titleKey: 'tileOpenTitle', subKey: 'tileOpenSub', bg: 'bg-blue-50/70 hover:bg-blue-100/70 border-blue-200 text-blue-700' },
        { key: 'Inseminated', id: 'tileBtnIns', titleKey: 'tileInsTitle', subKey: 'tileInsSub', bg: 'bg-amber-50/70 hover:bg-amber-100/70 border-amber-200 text-amber-700' },
        { key: 'Pregnant', id: 'tileBtnPreg', titleKey: 'tilePregTitle', subKey: 'tilePregSub', bg: 'bg-emerald-50/70 hover:bg-emerald-100/70 border-emerald-200 text-emerald-700' },
        { key: 'Dry', id: 'tileBtnDry', titleKey: 'tileDryTitle', subKey: 'tileDrySub', bg: 'bg-orange-50/70 hover:bg-orange-100/70 border-orange-200 text-orange-700' },
        { key: 'Fresh', id: 'tileBtnFresh', titleKey: 'tileFreshTitle', subKey: 'tileFreshSub', bg: 'bg-cyan-50/70 hover:bg-cyan-100/70 border-cyan-200 text-cyan-700' },
        { key: 'Heifer', id: 'tileBtnHeifers', titleKey: 'tileHeifersTitle', subKey: 'tileHeifersSub', bg: 'bg-purple-50/70 hover:bg-purple-100/70 border-purple-200 text-purple-700' },
        { key: 'Quarantine', id: 'tileBtnQuar', titleKey: 'tileQuarTitle', subKey: 'tileQuarSub', bg: 'bg-rose-50/70 hover:bg-rose-100/70 border-rose-200 text-rose-700' }
    ]
});

