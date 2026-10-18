import { store } from '../state/store.js';
import { apiRequest, cacheFarmAnimals } from '../api/client.js';
import { getStatusBadgeClass, ANIMAL_STATUSES } from '../../functions/api/models/animalStatuses.js';

export const herdModule = {
    animals: [],
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

    getStatusBadgeClass(status) {
        return getStatusBadgeClass(status);
    },

    getAvailableStatuses() {
        return Object.values(ANIMAL_STATUSES);
    }
};

