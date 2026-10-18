/**
 * Canonical Animal Physiological & Herd Management Statuses
 * Single source of truth for DairyERP across Backend & Frontend.
 */

export const ANIMAL_STATUSES = Object.freeze({
    ACTIVE: {
        id: 'Active',
        i18nKey: 'optActive',
        badgeClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
        tileClass: 'bg-blue-50/70 hover:bg-blue-100/70 border-blue-200 text-blue-700',
        isProductive: true
    },
    INSEMINATED: {
        id: 'Inseminated',
        i18nKey: 'optInseminated',
        badgeClass: 'bg-purple-50 text-purple-700 border border-purple-200',
        tileClass: 'bg-amber-50/70 hover:bg-amber-100/70 border-amber-200 text-amber-700',
        isProductive: true
    },
    PREGNANT: {
        id: 'Pregnant',
        i18nKey: 'optPregnant',
        badgeClass: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
        tileClass: 'bg-emerald-50/70 hover:bg-emerald-100/70 border-emerald-200 text-emerald-700',
        isProductive: true
    },
    DRY: {
        id: 'Dry',
        i18nKey: 'optDry',
        badgeClass: 'bg-amber-50 text-amber-700 border border-amber-200',
        tileClass: 'bg-orange-50/70 hover:bg-orange-100/70 border-orange-200 text-orange-700',
        isProductive: false
    },
    FRESH: {
        id: 'Fresh',
        i18nKey: 'optFresh',
        badgeClass: 'bg-cyan-50 text-cyan-700 border border-cyan-200',
        tileClass: 'bg-cyan-50/70 hover:bg-cyan-100/70 border-cyan-200 text-cyan-700',
        isProductive: true
    },
    QUARANTINE: {
        id: 'Quarantine',
        i18nKey: 'optQuarantine',
        badgeClass: 'bg-rose-50 text-rose-700 border border-rose-200',
        tileClass: 'bg-rose-50/70 hover:bg-rose-100/70 border-rose-200 text-rose-700',
        isProductive: false
    },
    HEIFER: {
        id: 'Heifer',
        i18nKey: 'optHeifer',
        badgeClass: 'bg-teal-50 text-teal-700 border border-teal-200',
        tileClass: 'bg-teal-50/70 hover:bg-teal-100/70 border-teal-200 text-teal-700',
        isProductive: false
    },
    OPEN: {
        id: 'Open',
        i18nKey: 'optOpen',
        badgeClass: 'bg-blue-50 text-blue-700 border border-blue-200',
        tileClass: 'bg-blue-50/70 hover:bg-blue-100/70 border-blue-200 text-blue-700',
        isProductive: true
    },
    SICK: {
        id: 'Sick',
        i18nKey: 'optSick',
        badgeClass: 'bg-red-50 text-red-700 border border-red-200',
        tileClass: 'bg-red-50/70 hover:bg-red-100/70 border-red-200 text-red-700',
        isProductive: false
    },
    CULLED: {
        id: 'Culled',
        i18nKey: 'optCulled',
        badgeClass: 'bg-slate-100 text-slate-500 border border-slate-200',
        tileClass: 'bg-slate-100 border-slate-200 text-slate-500',
        isProductive: false
    }
});

export const VALID_STATUS_IDS = Object.freeze(
    Object.values(ANIMAL_STATUSES).map(s => s.id)
);

export function getStatusBadgeClass(status) {
    const found = Object.values(ANIMAL_STATUSES).find(s => s.id === status);
    return found ? found.badgeClass : 'bg-slate-50 text-slate-600 border border-slate-200';
}
