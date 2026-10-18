// Feature Module: System Diagnostics, Admin Metrics, Logs & Uniform Import Forwarding
// Flat 1-level collocation for AI vibe-coding
import { requireAuth, getCallerUser } from './authGuard.js';
import { getGoogleIdToken } from './gcpAuth.js';
import { determinePhysiologicalStatus } from './zootech.js';

export async function handleSystem({ path, method, request, url, env, db, jsonResponse }) {
    // 1. GET /api/system/status
    if (path === "/api/system/status") {
        try {
            const userCount = (await db.prepare("SELECT count(*) as c FROM users").first())?.c || 0;
            const cowCount = (await db.prepare("SELECT count(*) as c FROM animals").first())?.c || 0;
            return jsonResponse({
                is_configured: true,
                users_count: userCount,
                cows_count: cowCount
            });
        } catch (err) {
            return jsonResponse({
                is_configured: true,
                users_count: 1,
                cows_count: 0,
                error: err.message
            });
        }
    }

    // 2. GET /api/admin/metrics
    if (path === "/api/admin/metrics" && method === "GET") {
        try {
            requireAuth(request, ['superadmin', 'farmer', 'operator']);
        } catch (authErr) {
            return jsonResponse({ detail: authErr.message }, authErr.status || 403);
        }
        const totalVisits = (await db.prepare("SELECT count(*) as c FROM site_visits").first())?.c || 0;
        const distinctIps = (await db.prepare("SELECT count(DISTINCT ip) as c FROM site_visits").first())?.c || 0;
        const recentVisits = (await db.prepare("SELECT * FROM site_visits ORDER BY created_at DESC LIMIT 20").all()).results;

        const totalUsers = (await db.prepare("SELECT count(*) as c FROM users").first())?.c || 0;
        const superadmins = (await db.prepare("SELECT count(*) as c FROM users WHERE role = 'superadmin'").first())?.c || 0;
        const guests = (await db.prepare("SELECT count(*) as c FROM users WHERE role = 'guest'").first())?.c || 0;
        const withGoogle = (await db.prepare("SELECT count(*) as c FROM users WHERE google_sub IS NOT NULL").first())?.c || 0;

        const farms = (await db.prepare(`
            SELECT f.id, f.code, f.name, count(a.id) as cow_count, f.created_at
            FROM farms f
            LEFT JOIN animals a ON a.farm_id = f.id
            GROUP BY f.id
        `).all()).results;

        return jsonResponse({
            traffic: {
                total_visits: totalVisits,
                visits_24h: totalVisits,
                visits_7d: totalVisits,
                distinct_ips: distinctIps,
                recent_visits: recentVisits
            },
            users: {
                total: totalUsers,
                active: totalUsers,
                guests,
                superadmins,
                with_google: withGoogle
            },
            farms: {
                total_farms: farms.length,
                list: farms
            }
        });
    }

    // 3. GET/DELETE /api/system/logs
    if (path === "/api/system/logs" && method === "GET") {
        const level = url.searchParams.get("level") || "ALL";
        const cat = url.searchParams.get("category") || "ALL";
        let q = "SELECT * FROM system_logs WHERE 1=1";
        const params = [];
        if (level !== "ALL") {
            q += " AND level = ?";
            params.push(level);
        }
        if (cat !== "ALL") {
            q += " AND category = ?";
            params.push(cat);
        }
        q += " ORDER BY created_at DESC LIMIT 100";
        let logs = [];
        try {
            logs = (await db.prepare(q).bind(...params).all()).results;
        } catch (e) {
            logs = [];
        }
        return jsonResponse(logs || []);
    }

    if (path === "/api/system/logs" && method === "DELETE") {
        try {
            await db.prepare("DELETE FROM system_logs").run();
        } catch (e) {}
        return jsonResponse({ status: "success", message: "Логи успішно очищено" });
    }

    // 3.1 POST /api/system/client-logs (Stream UI errors & actions into Cloudflare Tail logs & D1)
    if (path === "/api/system/client-logs" && method === "POST") {
        try {
            const body = await request.json().catch(() => ({}));
            const level = (body.level || "ERROR").toUpperCase();
            const message = body.message || "Unknown client error";
            const details = body.details || "";
            const device = body.device || request.headers.get("user-agent") || "Unknown Device";
            const urlSource = body.url || "";
            const category = body.category || "CLIENT_UI";
            const logId = crypto.randomUUID();

            // This console.log immediately outputs to Cloudflare `wrangler pages deployment tail` stream!
            console.log(`[📱 CLIENT ${level}] [${category}] ${message} | Dev: ${device} | URL: ${urlSource} | Trace: ${details}`);

            // Also persist to system_logs table in D1
            try {
                await db.prepare(`
                    INSERT INTO system_logs (id, level, category, message, details, created_at)
                    VALUES (?, ?, ?, ?, ?, datetime('now'))
                `).bind(logId, level, category, `${message} (${device.slice(0, 80)})`, details).run();
            } catch (dbErr) {
                console.warn("[DB Log Insert Warn]", dbErr.message);
            }

            return jsonResponse({ status: "logged", id: logId });
        } catch (err) {
            console.error("[Client Log Handler Error]", err.message);
            return jsonResponse({ status: "error", message: err.message }, 400);
        }
    }

    // 4. GET /api/system/audit-logs
    if (path === "/api/system/audit-logs" && method === "GET") {
        const logs = (await db.prepare("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 100").all()).results;
        return jsonResponse(logs);
    }

    // 4.1 GET /api/system/backup (Export complete JSON snapshot of farm & animals)
    if (path === "/api/system/backup" && method === "GET") {
        const auth = request.headers.get("authorization") || "";
        let userEmail = "admin@dairy-erp.farm";
        let activeFarmId = url.searchParams.get("farm_id") || null;
        if (auth.startsWith("Bearer ")) {
            try {
                const tokenPart = auth.split(" ")[1];
                const decoded = JSON.parse(atob(tokenPart.split(".")[1]));
                if (decoded.sub) userEmail = decoded.sub;
                if (!activeFarmId && decoded.farm_id) activeFarmId = decoded.farm_id;
            } catch (e) {}
        }

        let farm = null;
        if (activeFarmId) {
            farm = await db.prepare("SELECT * FROM farms WHERE id = ?").bind(activeFarmId).first();
        }
        if (!farm) {
            farm = await db.prepare("SELECT * FROM farms ORDER BY created_at DESC LIMIT 1").first();
            if (farm) activeFarmId = farm.id;
        }

        let animals = [];
        let health = [];
        let repro = [];
        let meds = [];

        if (activeFarmId) {
            animals = (await db.prepare("SELECT * FROM animals WHERE farm_id = ?").bind(activeFarmId).all()).results || [];
            health = (await db.prepare(`
                SELECT h.* FROM health_events h
                JOIN animals a ON a.id = h.animal_id
                WHERE a.farm_id = ?
            `).bind(activeFarmId).all()).results || [];
            repro = (await db.prepare(`
                SELECT r.* FROM reproduction_events r
                JOIN animals a ON a.id = r.animal_id
                WHERE a.farm_id = ?
            `).bind(activeFarmId).all()).results || [];
        } else {
            animals = (await db.prepare("SELECT * FROM animals LIMIT 500").all()).results || [];
        }

        try {
            meds = (await db.prepare("SELECT * FROM medications").all()).results || [];
        } catch (e) {
            meds = [];
        }

        const backupPayload = {
            version: "2.5.0",
            export_date: new Date().toISOString(),
            exported_by: userEmail,
            farm_profile: {
                name: farm?.name || "Головна молочна ферма",
                farmer_name: farm?.farmer_name || null,
                address: farm?.address || null,
                city: farm?.city || null,
                phone: farm?.phone || null,
                farm_number: farm?.farm_number || null,
                prefix_animal_id: farm?.prefix_animal_id || null
            },
            counts: {
                animals: animals.length,
                health_events: health.length,
                reproduction_events: repro.length,
                medications: meds.length
            },
            animals: animals.map(a => ({
                farm_number: a.farm_number,
                official_tag: a.official_tag,
                name: a.name,
                birth_date: a.birth_date,
                gender: a.gender || 2,
                lactation_number: a.lactation_number || 0,
                current_status: a.current_status || "Active",
                last_calving_date: a.last_calving_date,
                expected_calving_date: a.expected_calving_date,
                last_insemination_date: a.last_insemination_date,
                days_pregnant: a.days_pregnant || 0,
                transponder_code: a.transponder_code,
                dam_tag: a.dam_tag,
                sire_tag: a.sire_tag,
                group_name: a.group_name || "Група 1"
            })),
            medications: meds.map(m => ({
                name: m.name,
                active_substance: m.active_substance,
                batch_number: m.batch_number,
                expiration_date: m.expiration_date,
                stock_quantity: m.stock_quantity,
                unit: m.unit || "дози",
                milk_withdrawal_days: m.default_milk_withdrawal_days,
                meat_withdrawal_days: m.default_meat_withdrawal_days
            }))
        };

        const filenameDate = new Date().toISOString().split("T")[0];
        return jsonResponse(backupPayload, 200, {
            "Content-Disposition": `attachment; filename="dairy_farm_backup_${filenameDate}.json"`
        });
    }

    // 5. POST /api/import/uniform
    if (path === "/api/import/uniform" && method === "POST") {
        const auth = request.headers.get("authorization") || "";
        let userEmail = null;
        if (auth.startsWith("Bearer ")) {
            try {
                const tokenPart = auth.split(" ")[1];
                const decoded = JSON.parse(atob(tokenPart.split(".")[1]));
                userEmail = decoded.sub || null;
            } catch (e) {}
        }

        const formData = await request.formData();
        const file = formData.get("file");
        const mode = formData.get("mode") || "create_new";
        const reqUserEmail = formData.get("user_email") || userEmail;
        const targetFarmId = formData.get("farm_id") || null;

        if (!file) {
            return jsonResponse({ detail: "Файл не передано" }, 400);
        }

        let parsed = null;
        let lastError = null;

        // Fast-path: Direct JSON backup import (instant, no external service required)
        const isJsonBackup = file.name && file.name.toLowerCase().endsWith(".json");
        if (isJsonBackup) {
            try {
                const text = await file.text();
                const jsonPayload = JSON.parse(text);
                const animalsList = Array.isArray(jsonPayload.animals) ? jsonPayload.animals : (Array.isArray(jsonPayload) ? jsonPayload : []);
                const medicationsList = Array.isArray(jsonPayload.medications) ? jsonPayload.medications : [];
                parsed = {
                    farm_info: {
                        name: jsonPayload.farm_profile?.name || jsonPayload.farm_name || `Ферма з ${file.name.replace(/\.[^/.]+$/, "")}`,
                        farmer_name: jsonPayload.farm_profile?.farmer_name || null
                    },
                    animals: animalsList,
                    medications: medicationsList
                };
            } catch (jsonErr) {
                return jsonResponse({ detail: `Помилка читання JSON файлу бекапу: ${jsonErr.message}` }, 400);
            }
        }

        if (!parsed) {
            // Send to Cloud Run parser microservice (configured via Cloudflare Secrets or defaults)
            const parserUrl = env?.PARSER_SERVICE_URL || "https://dairy-farm-parser-wg7iw37zsq-ey.a.run.app/api/convert/uniform";
            const parserSecret = env?.PARSER_SECRET_TOKEN || "dairy_secret_token_frankfurt_2026";

            if (!parserUrl) {
                return jsonResponse({
                    detail: "Служба конвертації баз не налаштована на сервері (відсутній PARSER_SERVICE_URL)."
                }, 503);
            }

            // Zero-Trust: If service account key is configured, generate Google IAM Identity Token for private Cloud Run
            const audience = parserUrl.startsWith("http") ? new URL(parserUrl).origin : parserUrl;
            const googleIdToken = await getGoogleIdToken(audience, env?.GCP_SERVICE_ACCOUNT_KEY);

            for (let attempt = 1; attempt <= 3; attempt++) {
                try {
                    const parserFormData = new FormData();
                    parserFormData.append("file", file);

                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

                    const headers = {
                        "X-Parser-Secret": parserSecret
                    };
                    if (googleIdToken) {
                        headers["Authorization"] = `Bearer ${googleIdToken}`;
                    }

                    const parseResp = await fetch(parserUrl, {
                        method: "POST",
                        headers: headers,
                        body: parserFormData,
                        signal: controller.signal
                    });
                    clearTimeout(timeoutId);

                    if (parseResp.ok) {
                        parsed = await parseResp.json();
                        break;
                    } else {
                        const errText = await parseResp.text();
                        let errMsg = errText;
                        try { errMsg = JSON.parse(errText).detail || errText; } catch(e){}
                        lastError = `Служба парсингу відповіла статусом ${parseResp.status}: ${errMsg}`;
                    }
                } catch (netErr) {
                    lastError = netErr.name === 'AbortError' ? 'Перевищено ліміт часу очікування обробки файлу (60с)' : netErr.message;
                }

                if (attempt < 3) {
                    await new Promise(r => setTimeout(r, 2000 * attempt));
                }
            }

            if (!parsed) {
                try {
                    await db.prepare(`
                        INSERT INTO system_logs (id, level, category, message, details, created_at)
                        VALUES (?, ?, ?, ?, ?, datetime('now'))
                    `).bind(
                        crypto.randomUUID(),
                        "ERROR",
                        "UNIFORM_IMPORT",
                        `Помилка конвертації файлу ${file.name || 'FDB'}`,
                        lastError
                    ).run();
                } catch (e) {}

                return jsonResponse({
                    detail: `Не вдалося виконати автоматичну конвертацію бази: ${lastError}`
                }, 502);
            }
        }

        const farmName = parsed.farm_info?.name || `Ферма з ${file.name}`;
        const farmerName = parsed.farm_info?.farmer_name || null;
        const animals = parsed.animals || [];

        let activeFarmId = targetFarmId;

        if (mode === "create_new" || !activeFarmId) {
            activeFarmId = crypto.randomUUID();
            const farmCode = `FARM_${Date.now().toString(36).toUpperCase()}`;
            await db.prepare(`
                INSERT INTO farms (id, code, name, farmer_name, owner_email, created_at, imported_at)
                VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
            `).bind(activeFarmId, farmCode, farmName, farmerName, reqUserEmail).run();
        } else {
            // Update imported_at timestamp on existing farm when new data is imported/merged
            try {
                await db.prepare("UPDATE farms SET imported_at = datetime('now') WHERE id = ?").bind(activeFarmId).run();
            } catch (e) {}
        }

        // Batch insert animals into D1
        let insertedCount = 0;
        const CHUNK_SIZE = 50;
        for (let i = 0; i < animals.length; i += CHUNK_SIZE) {
            const chunk = animals.slice(i, i + CHUNK_SIZE);
            const stmts = chunk.map(a => {
                const animalId = crypto.randomUUID();
                const computedStatus = determinePhysiologicalStatus(a);
                return db.prepare(`
                    INSERT INTO animals (
                        id, farm_id, farm_number, official_tag, name, birth_date,
                        lactation_number, current_status, last_calving_date, expected_calving_date,
                        transponder_code, dam_tag, sire_tag, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
                `).bind(
                    animalId, activeFarmId, a.farm_number || "0", a.official_tag || null, a.name || null, a.birth_date || null,
                    a.lactation_number || 0, computedStatus, a.last_calving_date || null, a.expected_calving_date || null,
                    a.transponder_code || null, a.dam_tag || null, a.sire_tag || null
                );
            });
            await db.batch(stmts);
            insertedCount += chunk.length;
        }

        // Batch insert medications if present in backup
        const medications = parsed.medications || [];
        let medsImportedCount = 0;
        if (medications.length > 0) {
            for (let i = 0; i < medications.length; i += CHUNK_SIZE) {
                const chunk = medications.slice(i, i + CHUNK_SIZE);
                const stmts = chunk.map(m => {
                    const medId = crypto.randomUUID();
                    const name = (m.name || "").trim();
                    const activeSubstance = m.active_substance || null;
                    const batchNumber = m.batch_number || null;
                    const expirationDate = m.expiration_date || null;
                    const stockQuantity = parseFloat(m.stock_quantity) || 0;
                    const unit = m.unit || "дози";
                    const milkDays = parseInt(m.milk_withdrawal_days ?? m.default_milk_withdrawal_days) || 0;
                    const meatDays = parseInt(m.meat_withdrawal_days ?? m.default_meat_withdrawal_days) || 0;
                    const instructions = m.instructions || null;

                    return db.prepare(`
                        INSERT INTO medications (
                            id, name, active_substance, batch_number, expiration_date,
                            stock_quantity, unit, default_milk_withdrawal_days, default_meat_withdrawal_days,
                            instructions, created_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
                    `).bind(
                        medId, name, activeSubstance, batchNumber, expirationDate,
                        stockQuantity, unit, milkDays, meatDays, instructions
                    );
                });
                await db.batch(stmts);
                medsImportedCount += chunk.length;
            }
        }

        return jsonResponse({
            status: "success",
            message: `Ферму '${farmName}' успішно створено та імпортовано ${insertedCount} тварин${medsImportedCount > 0 ? ` та ${medsImportedCount} медикаментів` : ""}!`,
            farm_id: activeFarmId,
            farm_name: farmName,
            cows_imported: insertedCount,
            medications_imported: medsImportedCount
        });
    }

    return null;
}
