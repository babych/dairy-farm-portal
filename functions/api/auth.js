import { signJWT } from './crypto.js';
import { requireAuth } from './authGuard.js';

export async function handleAuth({ path, method, request, env, db, jsonResponse }) {
    // 1. POST /api/system/first-run
    if (path === "/api/system/first-run" && method === "POST") {
        const body = await request.json();
        const farmName = body.farm_name || "Головна молочна ферма";
        const adminEmail = (body.admin_email || "admin@dairy-erp.farm").trim();
        const adminName = (body.admin_name || "Адміністратор Ферми").trim();

        let farm = await db.prepare("SELECT id FROM farms WHERE code = 'DEFAULT_FARM' LIMIT 1").first();
        let farmId = farm?.id;
        if (!farmId) {
            farmId = crypto.randomUUID();
            await db.prepare("INSERT INTO farms (id, code, name, created_at) VALUES (?, 'DEFAULT_FARM', ?, datetime('now'))")
                .bind(farmId, farmName)
                .run();
        }

        let user = await db.prepare("SELECT id FROM users WHERE email = ?").bind(adminEmail).first();
        let userId = user?.id;
        if (!userId) {
            userId = crypto.randomUUID();
            await db.prepare("INSERT INTO users (id, email, full_name, role, farm_id, is_active, last_login_at, login_count) VALUES (?, ?, ?, 'superadmin', ?, 1, datetime('now'), 1)")
                .bind(userId, adminEmail, adminName, farmId)
                .run();
        }

        const jwtSecret = env.JWT_SECRET_KEY || "ephemeral_local_dev_token_key_change_in_prod";
        const payload = { sub: adminEmail, role: "superadmin", farm_id: farmId, exp: Math.floor(Date.now() / 1000) + 86400 * 7 };
        const token = await signJWT(payload, jwtSecret);

        return jsonResponse({
            status: "success",
            message: "Адміністратора успішно налаштовано!",
            access_token: token,
            token_type: "bearer",
            user: {
                id: userId,
                email: adminEmail,
                full_name: adminName,
                role: "superadmin"
            }
        });
    }

    // 2. POST /api/auth/google
    if (path === "/api/auth/google" && method === "POST") {
        const body = await request.json();
        let email = "demo.farmer@dairy-erp.farm";
        let name = "Демо Фермер";
        let googleSub = "demo_google_sub";

        try {
            const claims = JSON.parse(atob(body.credential.split(".")[1]));
            email = claims.email || email;
            name = claims.name || claims.email || name;
            googleSub = claims.sub || googleSub;
        } catch (e) {}

        let user = await db.prepare("SELECT * FROM users WHERE email = ? OR google_sub = ?").bind(email, googleSub).first();
        if (!user) {
            const newId = crypto.randomUUID();
            const userFarmId = crypto.randomUUID();
            const userFarmCode = `FARM_${Date.now().toString(36).toUpperCase()}`;
            const userFarmName = `Ферма ${name}`;
            
            await db.prepare(`
                INSERT INTO farms (id, code, name, farmer_name, owner_email, created_at)
                VALUES (?, ?, ?, ?, ?, datetime('now'))
            `).bind(userFarmId, userFarmCode, userFarmName, name, email).run();

            await db.prepare("INSERT INTO users (id, email, full_name, role, farm_id, google_sub, is_active, last_login_at, login_count) VALUES (?, ?, ?, 'farmer', ?, ?, 1, datetime('now'), 1)")
                .bind(newId, email, name, userFarmId, googleSub)
                .run();
            user = await db.prepare("SELECT * FROM users WHERE id = ?").bind(newId).first();
        } else {
            await db.prepare("UPDATE users SET last_login_at = datetime('now'), login_count = COALESCE(login_count, 0) + 1 WHERE id = ?")
                .bind(user.id)
                .run();
        }

        const jwtSecret = env.JWT_SECRET_KEY || "ephemeral_local_dev_token_key_change_in_prod";
        const payload = { sub: user.email, role: user.role, farm_id: user.farm_id, exp: Math.floor(Date.now() / 1000) + 86400 * 7 };
        const token = await signJWT(payload, jwtSecret);

        return jsonResponse({
            access_token: token,
            token_type: "bearer",
            user: {
                id: user.id,
                email: user.email,
                full_name: user.full_name,
                role: user.role
            }
        });
    }

    // 3. POST /api/auth/login
    if (path === "/api/auth/login" && method === "POST") {
        const body = await request.json();
        const email = body.username || "";
        let user = await db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
        if (!user) {
            const newId = crypto.randomUUID();
            const userFarmId = crypto.randomUUID();
            const userFarmCode = `FARM_${Date.now().toString(36).toUpperCase()}`;
            const userFarmName = `Моя ферма`;

            await db.prepare(`
                INSERT INTO farms (id, code, name, farmer_name, owner_email, created_at)
                VALUES (?, ?, ?, 'Власник', ?, datetime('now'))
            `).bind(userFarmId, userFarmCode, userFarmName, email).run();

            await db.prepare("INSERT INTO users (id, email, full_name, role, farm_id, is_active, last_login_at, login_count) VALUES (?, ?, 'Адміністратор Ферми', 'farmer', ?, 1, datetime('now'), 1)")
                .bind(newId, email, userFarmId)
                .run();
            user = await db.prepare("SELECT * FROM users WHERE id = ?").bind(newId).first();
        } else {
            await db.prepare("UPDATE users SET last_login_at = datetime('now'), login_count = COALESCE(login_count, 0) + 1 WHERE id = ?")
                .bind(user.id)
                .run();
        }

        const jwtSecret = env.JWT_SECRET_KEY || "ephemeral_local_dev_token_key_change_in_prod";
        const payload = { sub: user.email, role: user.role, farm_id: user.farm_id, exp: Math.floor(Date.now() / 1000) + 86400 * 7 };
        const token = await signJWT(payload, jwtSecret);

        return jsonResponse({
            access_token: token,
            token_type: "bearer",
            user: {
                id: user.id,
                email: user.email,
                full_name: user.full_name,
                role: user.role
            }
        });
    }

    // 4. GET /api/users
    if (path === "/api/users" && method === "GET") {
        try {
            requireAuth(request, ['superadmin']);
        } catch (authErr) {
            return jsonResponse({ detail: authErr.message }, authErr.status || 403);
        }
        const users = (await db.prepare("SELECT id, email, full_name, role, google_sub, is_active, last_login_at, login_count, created_at FROM users ORDER BY created_at DESC").all()).results;
        return jsonResponse(users);
    }

    // 5. GET /api/auth/me - Validate session & return authenticated user profile
    if (path === "/api/auth/me" && method === "GET") {
        try {
            const caller = requireAuth(request);
            const user = await db.prepare("SELECT id, email, full_name, role, farm_id FROM users WHERE email = ?").bind(caller.email).first();
            if (!user) {
                return jsonResponse({ detail: "User not found" }, 401);
            }
            return jsonResponse({
                id: user.id,
                email: user.email,
                full_name: user.full_name,
                role: user.role,
                farm_id: user.farm_id
            });
        } catch (authErr) {
            return jsonResponse({ detail: authErr.message }, authErr.status || 401);
        }
    }

    return null;
}
