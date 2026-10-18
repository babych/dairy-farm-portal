// Authentication & Role-Based Authorization Guard Helpers

/**
 * Extracts and decodes user session from Bearer JWT in request headers.
 * @param {Request} request
 * @returns {{ email: string | null, role: string | null, farm_id: string | null } | null}
 */
export function getCallerUser(request) {
    const auth = request.headers.get("authorization") || "";
    if (!auth.startsWith("Bearer ")) return null;

    try {
        const tokenPart = auth.split(" ")[1];
        const payload = JSON.parse(atob(tokenPart.split(".")[1]));
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
 * Ensures caller is authenticated, optionally requiring specific roles.
 * @param {Request} request
 * @param {string[]} [allowedRoles]
 * @returns {{ email: string, role: string, farm_id: string | null }}
 * @throws {Error} with status code message on unauthorized
 */
export function requireAuth(request, allowedRoles = []) {
    const user = getCallerUser(request);
    if (!user || !user.email) {
        const err = new Error("Authentication required");
        /** @type {any} */ (err).status = 401;
        throw err;
    }

    if (allowedRoles.length > 0 && (!user.role || !allowedRoles.includes(user.role))) {
        const err = new Error("Forbidden: insufficient permissions for this operation");
        /** @type {any} */ (err).status = 403;
        throw err;
    }

    return {
        email: user.email,
        role: user.role || 'user',
        farm_id: user.farm_id
    };
}
