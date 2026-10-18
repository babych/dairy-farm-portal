// Global Type Declarations for DairyERP Portal

export interface Animal {
    id: string;
    farm_id: string;
    farm_number: string;
    official_tag?: string | null;
    name?: string | null;
    current_status: 'Active' | 'Pregnant' | 'Dry' | 'Inseminated' | 'Fresh' | 'Quarantine' | 'Heifer' | 'Open' | 'Sick' | 'Culled';
    lactation_number?: number | null;
    birth_date?: string | null;
    last_calving_date?: string | null;
    expected_calving_date?: string | null;
    group_name?: string | null;
    milk_withholding_until?: string | null;
    meat_withholding_until?: string | null;
    dim?: number | null;
    days_pregnant?: number | null;
}

export interface Farm {
    id: string;
    name: string;
    owner_id: string;
    created_at?: string;
    imported_at?: string;
    is_current?: number | boolean;
    role?: string;
}

export interface DashboardStats {
    total_cows: number;
    in_quarantine: number;
    herd_tiles: {
        open: number;
        inseminated: number;
        pregnant: number;
        dry: number;
        fresh: number;
    };
    kpis: {
        avg_dim: number;
        conception_rate: number;
        pregnancy_rate: number;
        insemination_rate: number;
        calving_interval_days: number;
    };
}

export interface ActionLists {
    quarantine_milk: any[];
    pregnancy_check: any[];
    dry_off_candidates: any[];
}

export interface UserSession {
    id: string;
    email: string;
    role: string;
    name?: string;
}

declare global {
    interface Window {
        store: any;
        farmsModule: any;
        herdModule: any;
        dashboardModule: any;
        queueOfflineMutation: any;
        getOutboxItems: any;
        deleteOutboxItem: any;
        flushOfflineOutbox: any;
        getCachedAnimal: any;
        cacheFarmAnimals: any;
        setLanguage: any;
        t: any;
        openCow360?: (id: string) => void;
        updateTileHighlight?: (status: string) => void;
    }

    var updateTileHighlight: ((status: string) => void) | undefined;
}
