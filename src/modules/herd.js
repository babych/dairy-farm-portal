import { reactive } from '../../lib/petite-vue.es.js';
import { store } from '../state/store.js';
import { apiRequest, cacheFarmAnimals } from '../api/client.js';

export const herdModule = reactive({
    animals: [],
    currentCow: null,
    totalCount: 0,
    searchQuery: '',
    statusFilter: 'ALL',
    curOffset: 0,
    pageLimit: 50,
    isLoading: false,

    async loadAnimals() {
        this.isLoading = true;
        try {
            let url = `/api/animals?limit=${this.pageLimit}&offset=${this.curOffset}`;
            if (store.currentFarmId) {
                url += `&farm_id=${encodeURIComponent(store.currentFarmId)}`;
            }
            if (this.searchQuery) {
                url += `&q=${encodeURIComponent(this.searchQuery)}`;
            }
            if (this.statusFilter && this.statusFilter !== 'ALL') {
                url += `&status=${encodeURIComponent(this.statusFilter)}`;
            }

            const data = await apiRequest(url, { method: 'GET' });
            if (data) {
                this.animals = data.items || [];
                this.totalCount = data.total || 0;
                // Automatically cache animals in IndexedDB for 100% offline access
                if (this.animals.length > 0) {
                    cacheFarmAnimals(this.animals);
                }
            }
        } catch (err) {
            console.error("Load animals error", err);
            store.addToast("Не вдалося завантажити список тварин", "error");
        } finally {
            this.isLoading = false;
        }
    },

    debounceTimer: null,
    onSearchInput(val) {
        this.searchQuery = val;
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => {
            this.curOffset = 0;
            this.loadAnimals();
        }, 300);
    },

    setStatusFilter(status) {
        this.statusFilter = status;
        this.curOffset = 0;
        this.loadAnimals();
    },

    get currentPage() {
        return Math.floor(this.curOffset / this.pageLimit) + 1;
    },

    get totalPages() {
        return Math.max(1, Math.ceil(this.totalCount / this.pageLimit));
    },

    get fromNum() {
        return this.totalCount > 0 ? (this.curOffset + 1) : 0;
    },

    get toNum() {
        return Math.min(this.curOffset + this.animals.length, this.totalCount);
    },

    get pagesList() {
        const current = this.currentPage;
        const total = this.totalPages;
        if (total <= 1) return [];
        const pages = [];
        if (total <= 6) {
            for (let i = 1; i <= total; i++) pages.push(i);
        } else {
            pages.push(1);
            if (current > 3) pages.push('...');
            const start = Math.max(2, current - 1);
            const end = Math.min(total - 1, current + 1);
            for (let i = start; i <= end; i++) {
                if (!pages.includes(i)) pages.push(i);
            }
            if (current < total - 2) pages.push('...');
            if (!pages.includes(total)) pages.push(total);
        }
        return pages;
    },

    preservePaginationScroll() {
        const controls = document.getElementById('paginationControlsContainer');
        if (controls) {
            // Smoothly keep the pagination buttons in view rather than jumping to page top
            controls.scrollIntoView({ block: 'nearest', behavior: 'instant' });
        }
    },

    goToPage(p) {
        if (p === '...' || p === this.currentPage) return;
        const targetPage = Number(p);
        if (targetPage >= 1 && targetPage <= this.totalPages) {
            this.curOffset = (targetPage - 1) * this.pageLimit;
            this.loadAnimals().then(() => this.preservePaginationScroll());
        }
    },

    prevPage() {
        if (this.curOffset >= this.pageLimit) {
            this.curOffset -= this.pageLimit;
            this.loadAnimals().then(() => this.preservePaginationScroll());
        }
    },

    nextPage() {
        if (this.curOffset + this.pageLimit < this.totalCount) {
            this.curOffset += this.pageLimit;
            this.loadAnimals().then(() => this.preservePaginationScroll());
        }
    },

    formatDateCell(d) {
        if (!d || d === 'null' || d === 'undefined') return '';
        return d;
    },

    openCow360(id) {
        if (typeof window.openCow360 === 'function') {
            window.openCow360(id);
        }
    },

    async loadCow360(id) {
        store.currentCowId = id;
        try {
            let a = null;
            if (!navigator.onLine && window.getCachedAnimal) {
                a = await window.getCachedAnimal(id);
            }
            if (!a) {
                a = await apiRequest(`/api/animals/${id}`, { method: 'GET' });
            }
            if (!a) throw new Error("Тварину не знайдено");
            this.currentCow = a;
            store.currentCow = a;
            return a;
        } catch (err) {
            console.error("Load cow 360 error:", err);
            store.addToast("Помилка завантаження картки: " + err.message, "error");
            return null;
        }
    },

    async saveCurrentCow() {
        if (!this.currentCow || !this.currentCow.id) return;
        const payload = {
            farm_number: this.currentCow.farm_number,
            official_tag: this.currentCow.official_tag || '',
            name: this.currentCow.name || '',
            current_status: this.currentCow.current_status || 'Active',
            lactation_number: parseInt(this.currentCow.lactation_number) || 0,
            birth_date: this.currentCow.birth_date || null,
            last_calving_date: this.currentCow.last_calving_date || null,
            expected_calving_date: this.currentCow.expected_calving_date || null
        };
        try {
            await apiRequest(`/api/animals/${this.currentCow.id}`, {
                method: 'PUT',
                body: JSON.stringify(payload)
            });
            store.addToast("Зміни картки успішно збережено!");
            this.loadAnimals();
        } catch (err) {
            store.addToast(err.message, "error");
        }
    },

    getStatusBadgeClass(status) {
        switch(status) {
            case 'Active': return 'bg-emerald-50 text-emerald-700 border border-emerald-200';
            case 'Heifer': return 'bg-teal-50 text-teal-700 border border-teal-200';
            case 'Open': return 'bg-blue-50 text-blue-700 border border-blue-200';
            case 'Inseminated': return 'bg-purple-50 text-purple-700 border border-purple-200';
            case 'Pregnant': return 'bg-indigo-50 text-indigo-700 border border-indigo-200';
            case 'Dry': return 'bg-amber-50 text-amber-700 border border-amber-200';
            case 'Fresh': return 'bg-cyan-50 text-cyan-700 border border-cyan-200';
            case 'Sick': return 'bg-red-50 text-red-700 border border-red-200';
            case 'Quarantine': return 'bg-rose-50 text-rose-700 border border-rose-200';
            case 'Culled': return 'bg-slate-100 text-slate-500 border border-slate-200';
            default: return 'bg-slate-50 text-slate-600 border border-slate-200';
        }
    }
});


