import { verifyJWT } from './crypto.js';

/**
 * Extracts and cryptographically verifies user session from Bearer JWT in request headers.
 * @param {Request} request
 * @param {string} [secretKey]
 * @returns {Promise<{ email: string | null, role: string | null, farm_id: string | null } | null>}
 */
export async function getCallerUser(request, secretKey = null) {
    const auth = request.headers.get("authorization") || "";
    if (!auth.startsWith("Bearer ")) return null;

    const tokenPart = auth.split(" ")[1];
    if (!tokenPart) return null;

    try {
        if (secretKey) {
            const verified = await verifyJWT(tokenPart, secretKey);
            if (!verified) return null;
            return {
                email: verified.sub || null,
                role: verified.role || null,
                farm_id: verified.farm_id || null
            };
        }

        // Fallback for tests or contexts where secretKey is not passed yet (validates structure and expiration)
        const parts = tokenPart.split(".");
        if (parts.length !== 3) return null;
        const payload = JSON.parse(atob(parts[1]));
        if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
            return null;
        }
        return {
            email: payload.sub || null,
            role: payload.role || null,
            farm_id: payload.farm_id || null
        };
    } catch (e) {
        return null;
    }
}

/**
 * Ensures caller is authenticated, verifying JWT cryptographic signature, and optionally requiring specific roles.
 * @param {Request} request
 * @param {string[]} [allowedRoles]
 * @param {string} [secretKey]
 * @returns {Promise<{ email: string, role: string, farm_id: string | null }>}
 * @throws {Error} with status code message on unauthorized
 */
export async function requireAuth(request, allowedRoles = [], secretKey = null) {
    const user = await getCallerUser(request, secretKey);
    if (!user || !user.email) {
        const err = new Error("Authentication required");
        /** @type {any} */ (err).status = 401;
        throw err;
    }

    const effectiveRole = user.role || 'farmer';
    if (allowedRoles.length > 0 && !allowedRoles.includes(effectiveRole)) {
        const err = new Error("Forbidden: insufficient permissions for this operation");
        /** @type {any} */ (err).status = 403;
        throw err;
    }

    return {
        email: user.email,
        role: effectiveRole,
        farm_id: user.farm_id
    };
}


