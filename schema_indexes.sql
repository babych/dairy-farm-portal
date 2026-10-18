-- Complete Master Schema & Indexes for DairyERP (Cloudflare D1 / SQLite)

CREATE TABLE IF NOT EXISTS farms (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    farmer_name TEXT,
    owner_email TEXT,
    phone TEXT,
    address TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    imported_at TEXT
);

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    farm_id TEXT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    full_name TEXT,
    role TEXT NOT NULL DEFAULT 'farmer',
    google_sub TEXT,
    is_active INTEGER DEFAULT 1,
    login_count INTEGER DEFAULT 0,
    last_login_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(farm_id) REFERENCES farms(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS animals (
    id TEXT PRIMARY KEY,
    farm_id TEXT NOT NULL,
    farm_number TEXT NOT NULL,
    official_tag TEXT,
    name TEXT,
    birth_date TEXT,
    lactation_number INTEGER DEFAULT 0,
    current_status TEXT NOT NULL DEFAULT 'Active',
    last_calving_date TEXT,
    expected_calving_date TEXT,
    last_insemination_date TEXT,
    days_pregnant INTEGER DEFAULT 0,
    transponder_code TEXT,
    dam_tag TEXT,
    sire_tag TEXT,
    group_name TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(farm_id) REFERENCES farms(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS health_events (
    id TEXT PRIMARY KEY,
    animal_id TEXT NOT NULL,
    event_date TEXT NOT NULL,
    diagnosis TEXT NOT NULL,
    medication_name TEXT,
    dosage TEXT,
    milk_withholding_until TEXT,
    meat_withholding_until TEXT,
    is_active_withholding INTEGER DEFAULT 0,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(animal_id) REFERENCES animals(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reproduction_events (
    id TEXT PRIMARY KEY,
    animal_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    event_date TEXT NOT NULL,
    bull_code TEXT,
    result TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(animal_id) REFERENCES animals(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS medications (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    active_substance TEXT,
    batch_number TEXT,
    expiration_date TEXT,
    stock_quantity REAL DEFAULT 0,
    unit TEXT DEFAULT 'дози',
    default_milk_withdrawal_days INTEGER DEFAULT 0,
    default_meat_withdrawal_days INTEGER DEFAULT 0,
    instructions TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS site_visits (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT,
    user_email TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS system_logs (
    id TEXT PRIMARY KEY,
    level TEXT NOT NULL,
    category TEXT NOT NULL,
    message TEXT NOT NULL,
    details TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    farm_id TEXT,
    user_email TEXT,
    action TEXT NOT NULL,
    entity TEXT,
    entity_id TEXT,
    details TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- ====================================================================
-- PERFORMANCE INDEXES (Protected Against SCAN TABLE / Full DB Scans)
-- ====================================================================

-- 1. Animals Queries
CREATE INDEX IF NOT EXISTS idx_animals_farm_status ON animals(farm_id, current_status);
CREATE INDEX IF NOT EXISTS idx_animals_farm_number ON animals(farm_id, farm_number);
CREATE INDEX IF NOT EXISTS idx_animals_official_tag ON animals(official_tag);
CREATE INDEX IF NOT EXISTS idx_animals_calving_dates ON animals(farm_id, last_calving_date, expected_calving_date);
CREATE INDEX IF NOT EXISTS idx_animals_calving_watch ON animals(farm_id, expected_calving_date, days_pregnant);

-- 2. Health & Quarantine
CREATE INDEX IF NOT EXISTS idx_health_quarantine_active ON health_events(is_active_withholding);
CREATE INDEX IF NOT EXISTS idx_health_quarantine_until ON health_events(milk_withholding_until);
CREATE INDEX IF NOT EXISTS idx_health_animal ON health_events(animal_id, event_date);
CREATE INDEX IF NOT EXISTS idx_health_date ON health_events(event_date);

-- 3. Reproduction & Calving
CREATE INDEX IF NOT EXISTS idx_repro_animal ON reproduction_events(animal_id, event_date);
CREATE INDEX IF NOT EXISTS idx_repro_type_date ON reproduction_events(event_type, event_date);
CREATE INDEX IF NOT EXISTS idx_repro_date ON reproduction_events(event_date);

-- 4. Tenancy, Auth & Audit
CREATE INDEX IF NOT EXISTS idx_farms_owner ON farms(owner_email);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_farm ON users(farm_id);
CREATE INDEX IF NOT EXISTS idx_audit_farm ON audit_logs(farm_id, created_at);
