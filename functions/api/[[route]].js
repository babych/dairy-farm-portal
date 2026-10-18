// Cloudflare Pages Functions - Unified API Router for DairyERP on Cloudflare D1
// Modular feature dispatcher (Feature Collocation for AI Vibe-Coding)

import { handleFarms } from './farms.js';
import { handleAnimals } from './animals.js';
import { handleDashboard } from './dashboard.js';
import { handleAuth } from './auth.js';
import { handleSystem } from './system.js';
import { jsonResponse, jsonOk, jsonError } from './response.js';

export { jsonResponse, jsonOk, jsonError };

export async function onRequestOptions() {
    return new Response(null, {
        status: 204,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization"
        }
    });
}

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === "OPTIONS") return onRequestOptions();

    const db = env.DB;
    if (!db) {
        return jsonResponse({ error: "Cloudflare D1 Database binding 'DB' not configured" }, 500);
    }

    // Background track visit (Only track major user actions, skip micro-polling to conserve D1 write limits)
    if (path === "/api/auth/me" || path === "/api/auth/login" || path.startsWith("/api/import")) {
        context.waitUntil((async () => {
            try {
                const clientIp = request.headers.get("CF-Connecting-IP") || request.headers.get("x-forwarded-for") || "unknown";
                const ua = request.headers.get("user-agent") || "";
                const auth = request.headers.get("authorization") || "";
                let userEmail = null;
                if (auth.startsWith("Bearer ")) {
                    try {
                        const tokenPart = auth.split(" ")[1];
                        const decoded = JSON.parse(atob(tokenPart.split(".")[1]));
                        userEmail = decoded.sub || null;
                    } catch (e) {}
                }
                await db.prepare("INSERT INTO site_visits (id, path, ip, user_agent, user_email, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))")
                    .bind(crypto.randomUUID(), path, clientIp, ua.substring(0, 300), userEmail)
                    .run();
            } catch (e) {}
        })());
    }

    // Helper to get active farm_id from request params or bearer token
    const getActiveFarmId = () => {
        const qFarmId = url.searchParams.get("farm_id");
        if (qFarmId) return qFarmId;
        const auth = request.headers.get("authorization") || "";
        if (auth.startsWith("Bearer ")) {
            try {
                const tokenPart = auth.split(" ")[1];
                const decoded = JSON.parse(atob(tokenPart.split(".")[1]));
                if (decoded.farm_id) return decoded.farm_id;
            } catch (e) {}
        }
        return null;
    };

    try {
        const params = { path, method, request, url, env, db, jsonResponse, getActiveFarmId };

        // 1. Farms feature
        const farmRes = await handleFarms(params);
        if (farmRes) return farmRes;

        // 2. Animals feature
        const animalRes = await handleAnimals(params);
        if (animalRes) return animalRes;

        // 3. Dashboard & Veterinary feature
        const dashRes = await handleDashboard(params);
        if (dashRes) return dashRes;

        // 4. Auth & Users feature
        const authRes = await handleAuth(params);
        if (authRes) return authRes;

        // 5. System, Metrics, Logs & Uniform Import
        const sysRes = await handleSystem(params);
        if (sysRes) return sysRes;

        return jsonResponse({ detail: `Route ${method} ${path} not found on Cloudflare Functions` }, 404);

    } catch (err) {
        try {
            await db.prepare(`
                INSERT INTO system_logs (id, level, category, message, details, created_at)
                VALUES (?, ?, ?, ?, ?, datetime('now'))
            `).bind(
                crypto.randomUUID(),
                "ERROR",
                "BACKEND_API",
                `${method} ${path}: ${err.message}`,
                err.stack || String(err)
            ).run();
        } catch (logErr) {}
        return jsonResponse({ detail: `Cloudflare D1 Error: ${err.message}` }, 500);
    }
}
