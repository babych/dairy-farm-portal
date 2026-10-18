// Localization Service & Helpers (i18n.js)
import { uk } from './uk.js';
import { en } from './en.js';

export const dictionaries = { uk, en };

export function getCurrentLang() {
    const urlParams = new URLSearchParams(window.location.search);
    const paramLang = urlParams.get('lang');
    if (paramLang && (paramLang.toLowerCase() === 'en' || paramLang.toLowerCase() === 'uk')) {
        return paramLang.toLowerCase();
    }
    const saved = localStorage.getItem("dairy_lang");
    if (saved) return saved;

    // Detect browser/OS language: if Ukrainian -> 'uk', otherwise default to international 'en'
    const browserLang = (navigator.languages && navigator.languages[0]) || navigator.language || 'uk';
    return browserLang.toLowerCase().startsWith('uk') ? 'uk' : 'en';
}

export function t(key, fallback = "") {
    const lang = getCurrentLang();
    const dict = dictionaries[lang] || dictionaries.uk;
    return dict[key] || fallback || key;
}

export function formatErrorMessage(err) {
    if (!err) return t('errGeneric', 'Unknown system error occurred');
    const msg = typeof err === 'string' ? err : (err.message || String(err));

    // Handle Cloudflare D1 free-tier quota exhaustion
    if (msg.includes("exceeded D1's free tier daily row read limit") || msg.includes("D1_ERROR")) {
        return t('errD1Quota');
    }

    // Handle network disconnection
    if (!navigator.onLine || msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
        return t('errNetworkOffline');
    }

    return msg;
}

export function applyLanguage(lang) {
    localStorage.setItem("dairy_lang", lang);
    document.documentElement.lang = lang;
    const canonicalTag = /** @type {HTMLLinkElement | null} */ (document.getElementById('canonicalTag'));
    if (canonicalTag) {
        canonicalTag.href = lang === 'en' ? 'https://dairy-farm-portal.pages.dev/?lang=en' : 'https://dairy-farm-portal.pages.dev/';
    }

    const ukBtn = document.getElementById('langUkBtn');
    const enBtn = document.getElementById('langEnBtn');
    if (ukBtn) ukBtn.className = lang === 'uk' ? 'px-2.5 py-1 rounded-lg bg-emerald-600 text-white transition shadow-sm' : 'px-2.5 py-1 rounded-lg text-slate-600 hover:text-slate-900 transition';
    if (enBtn) enBtn.className = lang === 'en' ? 'px-2.5 py-1 rounded-lg bg-emerald-600 text-white transition shadow-sm' : 'px-2.5 py-1 rounded-lg text-slate-600 hover:text-slate-900 transition';

    const dict = dictionaries[lang] || dictionaries.uk;
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const k = el.getAttribute('data-i18n');
        if (dict[k]) {
            if (dict[k].includes('<')) {
                el.innerHTML = dict[k];
            } else {
                el.textContent = dict[k];
            }
        }
    });
    document.querySelectorAll('[data-i18n-ph]').forEach(el => {
        const k = el.getAttribute('data-i18n-ph');
        if (dict[k]) el.setAttribute('placeholder', dict[k]);
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
        const k = el.getAttribute('data-i18n-title');
        if (dict[k]) el.setAttribute('title', dict[k]);
    });

    // Update optgroup labels if any
    const gridWindowFilter = /** @type {HTMLSelectElement | null} */ (document.getElementById('gridWindowFilter'));
    if (gridWindowFilter) {
        const optgroups = gridWindowFilter.querySelectorAll('optgroup');
        if (optgroups[0]) optgroups[0].label = dict.optGridGroupCurrent || optgroups[0].label;
        if (optgroups[1]) optgroups[1].label = dict.optGridGroupHistory || optgroups[1].label;
    }

    // Trigger reactive re-render for petite-vue by re-assigning action lists or reloading grid if loaded
    const win = /** @type {any} */ (typeof window !== 'undefined' ? window : {});
    if (win.dashboardModule && win.dashboardModule.actionLists) {
        win.dashboardModule.actionLists = { ...win.dashboardModule.actionLists };
    }
    if (win.store && win.store.eventsList) {
        win.store.eventsList = [ ...win.store.eventsList ];
    }
}
