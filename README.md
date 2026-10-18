# 🥛 DairyERP Cloud — Modern Herd Management Platform

Public portal & overview of the Next-Generation Dairy Herd Management & Telemetry System.

## 🌐 Live Production Access
- 👉 **Live Portal:** [https://dairy-farm-portal.pages.dev](https://dairy-farm-portal.pages.dev)
- **Edge Runtime:** Cloudflare Pages + Cloudflare D1 Global Edge (EEUR/Frankfurt)
- **Converter Microservice:** Google Cloud Run (`europe-west3`, Frankfurt am Main)
- **Primary Maintainer:** `memory1024@gmail.com`

---

## 🌟 Key Capabilities
- ⚡ **Zero-Friction Ingestion:** Automated binary converter for legacy Uniform-Agri backups (`.zip` / `.fdb`) via Cloud Run stateless microservice in **~1.5 seconds**.
- 📈 **Veterinary & Reproductive KPIs:** Real-time Calving Interval trends, ECI conception curves, Days in Milk (DIM), and automated heat detection alerts.
- 💊 **Antibiotic Withholding Watch (Каренція):** Automatic biological countdown timers for milk and slaughter quarantine periods.
- 🏢 **Multi-Tenant Herd Scoping:** Complete tenant isolation per user/farm, dynamic passport editing, and instantaneous farm context switching.
- 🔒 **Zero-Trust Security & WebCrypto:** Cryptographic password salting with **PBKDF2 (SHA-256)** and session signing via **HMAC-SHA256**. Zero plaintext credentials or hardcoded keys in repository.

---

## 🏗️ Architecture & Feature Collocation
Structured with clean feature collocation, reactive Petite-Vue state, and PWA offline support:

```
├── functions/api/            # Cloudflare Pages Functions (V8 Edge Workers)
│   ├── [[route]].js          # Lean Edge router & context dispatcher
│   ├── animals.js            # Herd inventory, filtering, card view & clinical events
│   ├── farms.js              # Multi-farm switching, CRUD, and farm passport updates
│   ├── dashboard.js          # Statistics, event journal, medication actions & alerts
│   ├── auth.js               # Google One-Tap OAuth, first-run setup & session issuance
│   ├── system.js             # System health, backup/restore & parser forwarder
│   ├── zootech.js            # Pure mathematical engine (DIM, gestation, dry-off, quarantine)
│   ├── crypto.js             # Native WebCrypto implementation (PBKDF2 & HMAC-SHA256)
│   ├── validation.js         # Input sanitization and zootechnical rules validation
│   ├── models/               # Domain models (Animal, Farm, animalStatuses)
│   └── repositories/         # D1 Database queries (AnimalRepo, FarmRepo, DashboardRepo...)
├── src/                      # Modular Frontend ES Modules
│   ├── main.js               # App entry point & Petite-Vue initialization
│   ├── app.js                # Core UI events, modal controllers & navigation
│   ├── state/store.js        # Reactive central state (auth, tabs, toasts, filters)
│   ├── api/client.js         # HTTP client & IndexedDB offline outbox/cache
│   ├── modules/              # Reactive feature modules (dashboard, herd, farms)
│   └── locales/              # i18n translation bundles (uk.js, en.js)
├── index.html                # Reactive SPA shell with declarative v-for templates
├── views/partials/           # Extracted partials (dashboard, header, modals)
├── sw.js                     # Service Worker (PWA offline caching, controllerchange reload)
├── manifest.json             # Mobile Web App Manifest
├── schema_d1.sql             # Cloudflare D1 SQLite relational schema
└── AGENTIC.md                # AI Agentic engineering rules & guardrails
```

---

## 🧪 Testing & CI/CD Pipeline
Continuous integration runs on **Node.js 24 native test runner (`node:test`)**:

1. **Unit & Integration Suite (67 tests, 13 suites):**
   ```bash
   npm test
   ```
   Covers zootechnical biology, clinical events (insemination, pregnancy check, calving, milk quarantine), WebCrypto security, repository access scopes, full backup/restore, and declarative tile system integrity in **~180ms**.

2. **Static Type Checking:**
   ```bash
   npm run typecheck
   ```
   Validates TypeScript declarations (`types/index.d.ts`, `types/cloudflare.d.ts`).

3. **PWA & Edge Bundle Build:**
   ```bash
   npm run build
   ```
   Stamps automated Service Worker cache version (`scripts/stamp-sw.js`), runs typecheck, and compiles Pages Functions.

4. **Cloudflare Deployment:**
   - **Production:** `npm run deploy` (deploys to `dairy-farm-portal.pages.dev`).
   - **Preview/Dev:** `npx wrangler pages deploy . --project-name dairy-farm-portal --branch dev` (deploys to `dev.dairy-farm-portal.pages.dev`).

---

## 📄 License
Proprietary & Confidential. All rights reserved.
