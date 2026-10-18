// Centralized API Client with Offline Outbox & JWT Bearer injection
import { store } from '../state/store.js';

export async function apiRequest(endpoint, options = {}) {
    const url = endpoint.startsWith('http') ? endpoint : `${store.apiBase}${endpoint}`;
    const headers = {
        'Content-Type': 'application/json',
        ...(options.headers || {})
    };

    if (store.token) {
        headers['Authorization'] = `Bearer ${store.token}`;
    }

    try {
        const res = await fetch(url, {
            ...options,
            headers
        });

        const data = await res.json().catch(() => null);

        if (!res.ok) {
            const errorMsg = data?.detail || data?.error || `Помилка сервера (${res.status})`;
            throw new Error(errorMsg);
        }

        return data;
    } catch (err) {
        // If network offline and mutation request, queue in offline outbox
        if (!navigator.onLine && options.method && options.method !== 'GET') {
            await queueOfflineMutation(endpoint, options.method, options.body ? JSON.parse(options.body) : null);
            store.addToast("Збережено офлайн. Синхронізація відбудеться при відновленні зв'язку.", "info");
            return { offline_queued: true };
        }
        throw err;
    }
}

// IndexedDB Offline Outbox Queue & Animals Database Cache
const DB_NAME = "DairyErpOfflineDB";
const STORE_NAME = "mutations_outbox";
const CACHE_STORE = "animals_cache";

function openOutboxDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 2);
        req.onupgradeneeded = (e) => {
            const db = /** @type {IDBOpenDBRequest} */ (e.target).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
            }
            if (!db.objectStoreNames.contains(CACHE_STORE)) {
                db.createObjectStore(CACHE_STORE, { keyPath: "id" });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/**
 * Cache full farm animals list in IndexedDB for 100% offline access
 * @param {Array<any>} animals
 */
export async function cacheFarmAnimals(animals) {
    if (!Array.isArray(animals) || animals.length === 0) return;
    try {
        const db = await openOutboxDB();
        const tx = db.transaction(CACHE_STORE, "readwrite");
        const storeObj = tx.objectStore(CACHE_STORE);
        for (const a of animals) {
            if (a && a.id) {
                // Ensure plain cloneable object without reactive proxies or functions
                const clean = {
                    id: String(a.id),
                    farm_id: a.farm_id ? String(a.farm_id) : null,
                    farm_number: a.farm_number || "",
                    official_tag: a.official_tag || "",
                    name: a.name || "",
                    current_status: a.current_status || "",
                    lactation_number: Number(a.lactation_number) || 0,
                    birth_date: a.birth_date || null,
                    last_calving_date: a.last_calving_date || null,
                    expected_calving_date: a.expected_calving_date || null,
                    group_name: a.group_name || ""
                };
                storeObj.put(clean);
            }
        }
    } catch (e) {
        console.warn("Failed to cache farm animals in IndexedDB", e);
    }
}

/**
 * Retrieve cached cow card from IndexedDB when offline
 * @param {string|number} id
 */
export async function getCachedAnimal(id) {
    try {
        const db = await openOutboxDB();
        const tx = db.transaction(CACHE_STORE, "readonly");
        const storeObj = tx.objectStore(CACHE_STORE);
        return new Promise((resolve) => {
            const req = storeObj.get(id);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });
    } catch (e) {
        return null;
    }
}


export async function queueOfflineMutation(endpoint, method, payload) {
    try {
        const db = await openOutboxDB();
        const tx = db.transaction(STORE_NAME, "readwrite");
        const storeObj = tx.objectStore(STORE_NAME);
        storeObj.add({
            endpoint,
            method,
            payload,
            timestamp: Date.now()
        });
        updateOutboxCount();
    } catch (e) {
        console.warn("Failed to queue offline mutation", e);
    }
}

export async function updateOutboxCount() {
    try {
        const db = await openOutboxDB();
        const tx = db.transaction(STORE_NAME, "readonly");
        const storeObj = tx.objectStore(STORE_NAME);
        const countReq = storeObj.count();
        countReq.onsuccess = () => {
            store.outboxCount = countReq.result;
        };
    } catch (e) {
        store.outboxCount = 0;
    }
}

export async function getOutboxItems() {
    try {
        const db = await openOutboxDB();
        const tx = db.transaction(STORE_NAME, "readonly");
        const storeObj = tx.objectStore(STORE_NAME);
        return new Promise((resolve) => {
            const req = storeObj.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        });
    } catch (e) {
        return [];
    }
}

export async function deleteOutboxItem(id) {
    try {
        const db = await openOutboxDB();
        const tx = db.transaction(STORE_NAME, "readwrite");
        const storeObj = tx.objectStore(STORE_NAME);
        storeObj.delete(id);
        await updateOutboxCount();
        store.addToast("Запис видалено з черги офлайн", "info");
        return true;
    } catch (e) {
        console.warn("Failed to delete outbox item", e);
        return false;
    }
}


export async function flushOfflineOutbox() {
    if (!navigator.onLine) return;
    try {
        const db = await openOutboxDB();
        const tx = db.transaction(STORE_NAME, "readwrite");
        const storeObj = tx.objectStore(STORE_NAME);
        const getAllReq = storeObj.getAll();

        getAllReq.onsuccess = async () => {
            const items = getAllReq.result || [];
            if (items.length === 0) return;

            for (const item of items) {
                try {
                    await apiRequest(item.endpoint, {
                        method: item.method,
                        body: item.payload ? JSON.stringify(item.payload) : undefined
                    });
                    // Delete item on success
                    const delTx = db.transaction(STORE_NAME, "readwrite");
                    delTx.objectStore(STORE_NAME).delete(item.id);
                } catch (err) {
                    console.error("Failed to sync offline mutation item", item, err);
                }
            }
            updateOutboxCount();
            store.addToast(`Синхронізовано офлайн-записи (${items.length})`, "success");
        };
    } catch (e) {
        console.warn("Outbox flush failed", e);
    }
}

window.addEventListener('online', () => {
    store.isOnline = true;
    flushOfflineOutbox();
});

window.addEventListener('offline', () => {
    store.isOnline = false;
});
