# 🤖 DairyERP Portal Architecture & Agent Standards (AGENTIC.md)

This repository hosts the public Edge portal and Progressive Web App (PWA) for Dairy Herd ERP.

---

## 🏛️ Architecture & Stack

- **Platform:** Cloudflare Pages + Pages Functions (V8 Edge Workers) + Cloudflare D1 (SQLite).
- **Frontend:** Single-Page App with Petite-Vue reactive modules (`src/modules/*`), central reactive store (`src/state/store.js`), declarative templates (`index.html`), Tailwind CSS, native WebCrypto API.
- **PWA:** Service Worker (`sw.js`) with build-time cache stamping (`scripts/stamp-sw.js`), `controllerchange` auto-reload, and offline IndexedDB outbox.
- **Backend Service:** Stateless Firebird parser on Google Cloud Run (`POST /api/convert/uniform`).

---

## 🧠 Karpathy Behavioral Guidelines

1. **💭 Think & Inspect First**: Always inspect target files, schemas, and existing patterns before editing. Never assume signatures.
2. **🎯 Simplicity First**: Minimum code that solves the problem. No speculative abstractions, generic wrappers, or unrequested features.
3. **🔬 Surgical Changes**: Touch only what was asked. Zero drive-by reformatting, preserve working code and docstrings.
4. **🏁 Goal-Driven Verification**: Verify every change with `npm test` and `npm run build` before declaring completion.

---

## 🔒 Engineering Invariants

### 1. 📉 D1 Consumption Guardrails (Rows Read Quota)
Cloudflare D1 free-tier allows 5M rows read/day. Unindexed full scans can exhaust this quota in minutes:
- **Mandatory Indexes**: Every new column in `WHERE`, `ORDER BY`, or `JOIN` must have an index in `schema_d1.sql` prefixed with `farm_id` (e.g. `CREATE INDEX IF NOT EXISTS idx_animals_farm_status ON animals(farm_id, current_status);`).
- **Strict Pagination**: Never issue unpaged `SELECT *` without explicit `LIMIT` / `OFFSET`.
- **Client Cache**: Rely on Service Worker `Stale-While-Revalidate` for read-only catalog queries.

### 2. 🔐 Native WebCrypto Only on Edge
Pages Functions run in a V8 isolate without Node.js native modules:
- Use only native `crypto.subtle` for PBKDF2 salt hashing and HMAC-SHA256 JWT tokens.
- Never add `bcrypt` or `jsonwebtoken` packages to Pages Functions.

### 3. 📦 32 MB Cloud Run Ingestion Ceiling
Google Cloud Run enforces a 32 MB request body limit:
- Raw Firebird `.FDB` files are compressed client-side via `fflate` into `.ZIP` before upload. Never bypass this compression.

### 4. 💾 Offline Mutations Protocol
For cattle barn operations without internet:
- All state modifications (treatments, inseminations) must route through `sendOrQueueMutation(url, method, payload)` to ensure persistence in the offline outbox until network recovery.
- Keep network and outbox states visible to the user (`#headerNetworkStatus`).

### 5. 🧬 Zootechnical Biology Invariants
- **Gestation**: Standard 280 days (`expected_calving_date = insemination_date + 280`).
- **Dry-off**: Standard 60 days before calving (Gestation day 220+).
- **Quarantine**: Active antibiotic milk withholding strictly overrides reproductive statuses.

---

## 🧪 Verification Protocol

```bash
npm run typecheck # Static TypeScript type integrity (validates module schemas, method calls, properties)
npm test          # All 67 zootech, clinical events, domain models & security tests must pass
npm run build     # Runs typecheck, stamps sw.js version and compiles Cloudflare Worker bundle
```
