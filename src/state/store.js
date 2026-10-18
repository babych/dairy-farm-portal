// Central Reactive State Store for DairyERP Portal
import { reactive } from '../../lib/petite-vue.es.js';
import { formatErrorMessage } from '../locales/i18n.js';

export function getApiBase() {
    const saved = localStorage.getItem("dairy_api_base");
    if (saved) return saved;
    return window.location.origin;
}

export const store = reactive({
    apiBase: getApiBase(),
    token: localStorage.getItem("dairy_token") || null,
    currentUser: (() => {
        try {
            return JSON.parse(localStorage.getItem("dairy_user") || "null");
        } catch (e) {
            return null;
        }
    })(),
    currentFarmId: localStorage.getItem("dairy_selected_farm") || null,
    farmsList: [],
    usersList: [],
    medsList: [],
    eventsList: [],
    currentCowId: null,
    
    // UI Navigation State
    currentTab: 'animals', // 'animals', 'actions', 'grid', 'meds', 'users', 'metrics', 'logs'
    activeSubFilter: 'Active', // for stats filter
    isLoading: false,
    isOnline: navigator.onLine,
    outboxCount: 0,
    outboxItems: [],

    // Metric display mode: 'heads' (Голови) vs 'percent' (%)
    metricMode: localStorage.getItem("dairy_metric_mode") || "heads",

    toggleMetricMode() {
        this.metricMode = this.metricMode === "heads" ? "percent" : "heads";
        localStorage.setItem("dairy_metric_mode", this.metricMode);
    },

    // Technical Settings & Tools dropdown menu state
    techMenuOpen: false,
    toggleTechMenu() {
        this.techMenuOpen = !this.techMenuOpen;
    },
    closeTechMenu() {
        this.techMenuOpen = false;
    },

    // Toasts
    toasts: [],

    // Helpers
    setToken(newToken) {
        this.token = newToken;
        if (newToken && newToken !== "demo_mode_token") {
            localStorage.setItem("dairy_token", newToken);
        } else if (!newToken) {
            localStorage.removeItem("dairy_token");
        }
    },

    setCurrentUser(user) {
        this.currentUser = user;
        if (user && user.role !== "guest") {
            localStorage.setItem("dairy_user", JSON.stringify(user));
        } else if (!user) {
            localStorage.removeItem("dairy_user");
        }
    },

    setSelectedFarm(farmId) {
        this.currentFarmId = farmId;
        if (farmId) {
            localStorage.setItem("dairy_selected_farm", farmId);
        }
    },

    addToast(msg, type = 'success') {
        const displayMsg = type === 'error' ? formatErrorMessage(msg) : msg;
        const id = Date.now() + Math.random().toString(36).substring(2, 6);
        const toast = { id, message: displayMsg, type };
        this.toasts.push(toast);

        if (type !== 'error') {
            setTimeout(() => {
                this.removeToast(id);
            }, 4000);
        }
    },

    removeToast(id) {
        this.toasts = this.toasts.filter(t => t.id !== id);
    }
});
