// Feature Module: Dashboard Analytics, Event Grid & Veterinary Action Lists
// Flat 1-level collocation for AI vibe-coding
import { MedicationRepository } from './repositories/medicationRepo.js';
import { DashboardRepository } from './repositories/dashboardRepo.js';

export async function handleDashboard({ path, method, request, url, db, jsonResponse, getActiveFarmId }) {
    // 1. GET /api/dashboard/stats
    if (path === "/api/dashboard/stats") {
        const farmId = getActiveFarmId();
        const dashboardRepo = new DashboardRepository(db);
        const stats = await dashboardRepo.getHerdStats(farmId);
        return jsonResponse(stats, 200, {
            "Cache-Control": "public, max-age=30, s-maxage=300, stale-while-revalidate=600"
        });
    }

    // 2. GET /api/dashboard/event-grid
    if (path === "/api/dashboard/event-grid") {
        const year = url.searchParams.get("year");
        const farmId = getActiveFarmId();
        let farmCondition = farmId ? "WHERE a.farm_id = ?" : "";
        const queryParams = farmId ? [farmId, farmId, farmId] : [];

        let query = `
            SELECT r.id, a.id as animal_id, a.farm_number, a.official_tag, 
                   'REPRODUCTION' as category, r.event_type,
                   (r.event_type || ' №' || a.farm_number) as title,
                   r.event_date as start_date,
                   r.event_date as end_date,
                   'COMPLETED' as status,
                   ('Бугай/Код: ' || COALESCE(r.bull_code, '-') || ' • Результат: ' || COALESCE(r.result, '-')) as details
            FROM reproduction_events r
            JOIN animals a ON r.animal_id = a.id
            ${farmCondition}
            UNION ALL
            SELECT h.id, a.id as animal_id, a.farm_number, a.official_tag,
                   'HEALTH' as category, 'TREATMENT' as event_type,
                   h.diagnosis as title,
                   h.event_date as start_date,
                   h.milk_withholding_until as end_date,
                   'ACTIVE_WITHHOLDING' as status,
                   ('MED:' || COALESCE(h.medication_name, '-') || ' • UNTIL:' || COALESCE(h.milk_withholding_until, '-')) as details
            FROM health_events h
            JOIN animals a ON h.animal_id = a.id
            ${farmCondition}
            UNION ALL
            SELECT ('calv_' || a.id) as id, a.id as animal_id, a.farm_number, a.official_tag,
                   'CALVING_PLAN' as category, 'CALVING_PLAN' as event_type,
                   'CALVING_PLAN' as title,
                   a.expected_calving_date as start_date,
                   a.expected_calving_date as end_date,
                   'DUE_SOON' as status,
                   'PREGNANT_DUE' as details
            FROM animals a
            WHERE a.expected_calving_date IS NOT NULL AND a.expected_calving_date >= date('now')
            ${farmId ? "AND a.farm_id = ?" : ""}
        `;
        let finalQuery = `SELECT * FROM (${query}) t`;
        const params = [...queryParams];
        if (year) {
            finalQuery += " WHERE t.start_date >= ? AND t.start_date <= ?";
            params.push(`${year}-01-01`, `${year}-12-31`);
        }
        finalQuery += " ORDER BY t.start_date DESC LIMIT 300";

        const events = (await db.prepare(finalQuery).bind(...params).all()).results;
        return jsonResponse({
            today: new Date().toISOString().split("T")[0],
            total_events: events.length,
            events
        }, 200, {
            "Cache-Control": "public, max-age=60, s-maxage=600, stale-while-revalidate=1200"
        });
    }

    // 3. GET /api/dashboard/action-lists
    if (path === "/api/dashboard/action-lists") {
        const farmId = getActiveFarmId();
        const dashboardRepo = new DashboardRepository(db);
        const actionLists = await dashboardRepo.getActionLists(farmId);
        return jsonResponse(actionLists, 200, {
            "Cache-Control": "public, max-age=30, s-maxage=300, stale-while-revalidate=600"
        });
    }

    // 4. GET /api/medications
    if (path === "/api/medications" && method === "GET") {
        const meds = await MedicationRepository.getAll(db);
        return jsonResponse(meds, 200, {
            "Cache-Control": "public, max-age=300, s-maxage=1800, stale-while-revalidate=3600"
        });
    }

    // 4.1 POST /api/medications (Add medication to inventory)
    if (path === "/api/medications" && method === "POST") {
        try {
            const body = await request.json();
            const name = (body.name || "").trim();
            if (!name) {
                return jsonResponse({ detail: "Medication name is required" }, 400);
            }

            const created = await MedicationRepository.create(db, body);
            return jsonResponse({
                status: "success",
                message: `Medication '${created.name}' added successfully!`,
                id: created.id
            }, 201);
        } catch (err) {
            return jsonResponse({ detail: `Error saving medication: ${err.message}` }, 500);
        }
    }

    // 4.2 DELETE /api/medications/:id
    if (path.startsWith("/api/medications/") && method === "DELETE") {
        const medId = path.split("/")[3];
        try {
            await MedicationRepository.deleteById(db, medId);
            return jsonResponse({ status: "success", message: "Medication deleted successfully" });
        } catch (err) {
            return jsonResponse({ detail: `Error deleting medication: ${err.message}` }, 500);
        }
    }

    return null;
}
