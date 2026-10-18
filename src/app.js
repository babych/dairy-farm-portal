// @ts-nocheck
        // API Base Resolver (Direct Same-Origin for Cloudflare Functions & D1)
        function getApiBase() {
            const saved = localStorage.getItem("dairy_api_base");
            if (saved) return saved;
            return window.location.origin;
        }

        let API_BASE = getApiBase();
        let token = localStorage.getItem("dairy_token");
        let currentUser = null;
        let currentCowId = null;
        let medicationsList = [];
        let curOffset = 0;
        const PAGE_LIMIT = 50;

        // 1-Click Instant Demo Mode (Only active in session, never overrides real user session)
        function startInstantDemoMode() {
            currentUser = {
                id: "demo-user-guest",
                email: "demo@dairy-erp.farm",
                full_name: "Гість (Демо-режим)",
                role: "guest"
            };
            token = "demo_mode_token";
            // Do NOT save demo token in permanent localStorage so refresh brings user to login
            sessionStorage.setItem("dairy_demo_active", "true");
            showToast("Вхід у демо-режим виконано!");
            showDashboard();
        }


        function showToast(msg, type = 'success') {
            if (window.store && typeof window.store.addToast === 'function') {
                window.store.addToast(msg, type);
                return;
            }
            const container = document.getElementById('toastContainer');
            if (!container) return;
            const el = document.createElement('div');
            const bg = type === 'success' ? 'bg-emerald-600' : 'bg-rose-600';
            let displayMsg = msg;
            if (typeof msg === 'string' && (msg.includes("exceeded D1's free tier daily row read limit") || msg.includes("D1_ERROR"))) {
                displayMsg = "⚠️ Хмарна база тимчасово перевищила безкоштовний добовий ліміт запитів Cloudflare D1. Режим читання відновиться опівночі UTC або після переходу на платний план. Ви можете продовжувати роботу в демо-режимі!";
            }
            
            if (type === 'error') {
                el.className = `${bg} text-white text-xs px-4 py-3 rounded-xl shadow-2xl flex items-start justify-between gap-3 transform transition-all duration-300 ease-out pointer-events-auto max-w-md border border-rose-400/40`;
                el.innerHTML = `
                    <div class="flex items-start gap-2.5">
                        <i class="fa-solid fa-circle-exclamation mt-0.5 text-rose-200"></i>
                        <span class="leading-relaxed select-text">${displayMsg}</span>
                    </div>
                    <button type="button" class="text-rose-200 hover:text-white transition ml-2 p-0.5 focus:outline-none" title="Закрити">
                        <i class="fa-solid fa-xmark text-sm"></i>
                    </button>
                `;
                el.querySelector('button').onclick = () => {
                    el.style.opacity = '0';
                    setTimeout(() => el.remove(), 250);
                };
                container.appendChild(el);
            } else {
                el.className = `${bg} text-white text-xs px-4 py-3 rounded-xl shadow-lg flex items-center gap-2 transform transition-all duration-300 ease-out pointer-events-auto`;
                el.innerHTML = `<i class="fa-solid fa-check"></i> <span>${displayMsg}</span>`;
                container.appendChild(el);
                setTimeout(() => {
                    el.style.opacity = '0';
                    setTimeout(() => el.remove(), 300);
                }, 4000);
            }
        }

        // Global Client Error & Telemetry Logger (Streams device errors directly into Cloudflare Tail logs)
        function sendClientLog(level, message, details = "", category = "CLIENT_UI") {
            try {
                const payload = {
                    level,
                    message,
                    details: details || "",
                    device: `${navigator.userAgent} (${window.innerWidth}x${window.innerHeight})`,
                    url: window.location.href,
                    category
                };
                if (navigator.sendBeacon) {
                    navigator.sendBeacon('/api/system/client-logs', JSON.stringify(payload));
                } else {
                    fetch('/api/system/client-logs', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                        keepalive: true
                    }).catch(() => {});
                }
            } catch (e) {}
        }

        window.addEventListener('error', (event) => {
            const msg = event.message || "Unknown Script Error";
            const file = event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : "";
            sendClientLog("ERROR", msg, `${file} | Stack: ${event.error?.stack || ''}`, "RUNTIME_ERROR");
        });

        window.addEventListener('unhandledrejection', (event) => {
            const reason = event.reason;
            const msg = reason?.message || String(reason) || "Unhandled Promise Rejection";
            sendClientLog("ERROR", `Unhandled Rejection: ${msg}`, reason?.stack || '', "PROMISE_ERROR");
        });

        // 1. Initial State Check
        async function checkAppInit() {
            const urlParams = new URLSearchParams(window.location.search);
            const isDemoPath = window.location.pathname === '/demo' || window.location.pathname === '/demo/' || window.location.pathname.endsWith('/demo');
            const wantsDemo = isDemoPath || urlParams.get('demo') === 'true' || window.location.hash === '#demo';

            // Clean up old demo tokens from previous sessions
            if (token === "demo_mode_token") {
                localStorage.removeItem("dairy_token");
                localStorage.removeItem("dairy_user");
                token = null;
                currentUser = null;
            }

            // If user explicitly visited demo URL
            if (wantsDemo) {
                startInstantDemoMode();
                return;
            }

            // Offline / Slow Connection Support: Check if we have an existing local session
            const cachedUser = JSON.parse(localStorage.getItem("dairy_user") || "null");

            try {
                // Use a short 3-second timeout for status check so slow 2G/Edge connections don't hang indefinitely
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 3500);
                const res = await fetch(`${API_BASE}/api/system/status`, { signal: controller.signal });
                clearTimeout(timeoutId);
                const data = await res.json().catch(() => ({ is_configured: true }));
                
                // If system genuinely has 0 users and is not configured
                if (data && data.is_configured === false) {
                    document.getElementById('onboardingScreen').classList.remove('hidden');
                    document.getElementById('loginScreen').classList.add('hidden');
                    document.getElementById('appDashboard').classList.add('hidden');
                    return;
                }
            } catch (netErr) {
                console.warn("[PWA Offline] Could not reach status endpoint, continuing in offline/cached mode:", netErr);
            }

            // If real token exists, validate or resume session
            if (token && token !== "demo_mode_token") {
                try {
                    // Try to fetch stats with 4-second timeout
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 4000);
                    const statsRes = await fetch(`${API_BASE}/api/dashboard/stats`, {
                        headers: { "Authorization": `Bearer ${token}` },
                        signal: controller.signal
                    });
                    clearTimeout(timeoutId);

                    if (statsRes.ok) {
                        currentUser = cachedUser || { role: 'operator', full_name: 'Користувач' };
                        showDashboard();
                        return;
                    } else if (statsRes.status === 401 || statsRes.status === 403) {
                        // Truly invalid/revoked token: clear session
                        localStorage.removeItem("dairy_token");
                        localStorage.removeItem("dairy_user");
                        token = null;
                        currentUser = null;
                    } else {
                        // 5xx server error or gateway glitch: keep offline dashboard
                        if (cachedUser) {
                            currentUser = cachedUser;
                            showDashboard();
                            return;
                        }
                    }
                } catch (e) {
                    // Network timeout or completely offline:
                    // Crucial fix: DO NOT show login screen or hang on white screen!
                    // If we have token, resume dashboard immediately using cached data!
                    console.warn("[PWA Offline] Network slow/offline, resuming dashboard with local cache", e);
                    currentUser = cachedUser || { role: 'operator', full_name: 'Користувач' };
                    showDashboard();
                    return;
                }
            }

            // Default on root page if no session: show Login Screen (with Google Auth & Demo button)
            document.getElementById('onboardingScreen').classList.add('hidden');
            document.getElementById('loginScreen').classList.remove('hidden');
            document.getElementById('appDashboard').classList.add('hidden');
            document.getElementById('headerBackupBtn')?.classList.add('hidden');
            renderGoogleSignInButton();
        }

        // 2. First Run Setup
        async function handleFirstRunSetup(e) {
            e.preventDefault();
            const payload = {
                farm_name: document.getElementById('obFarmName').value,
                admin_name: document.getElementById('obAdminName').value,
                admin_email: document.getElementById('obAdminEmail').value,
                admin_password: document.getElementById('obAdminPassword').value
            };

            try {
                const res = await fetch(`${API_BASE}/api/system/first-run`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                let data;
                const contentType = res.headers.get("content-type");
                if (contentType && contentType.includes("application/json")) {
                    data = await res.json();
                } else {
                    const text = await res.text();
                    data = { detail: text || `HTTP ${res.status}` };
                }
                if (!res.ok) throw new Error(data.detail || "Помилка налаштування");

                token = data.access_token;
                currentUser = data.user;
                localStorage.setItem("dairy_token", token);
                localStorage.setItem("dairy_user", JSON.stringify(currentUser));
                showToast("Систему успішно налаштовано!");
                showDashboard();
            } catch (err) {
                document.getElementById('obError').textContent = err.message;
                document.getElementById('obError').classList.remove('hidden');
            }
        }

        // 3. Login
        async function handleLogin(e) {
            e.preventDefault();
            const btn = document.getElementById('loginBtn');
            btn.disabled = true;
            btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Вхід...`;

            try {
                const res = await fetch(`${API_BASE}/api/auth/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: document.getElementById('usernameInput').value,
                        password: document.getElementById('passwordInput').value
                    })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.detail || "Помилка входу");

                token = data.access_token;
                currentUser = data.user;
                localStorage.setItem("dairy_token", token);
                localStorage.setItem("dairy_user", JSON.stringify(currentUser));
                showToast("Успішний вхід у систему!");
                showDashboard();
            } catch (err) {
                document.getElementById('loginError').textContent = err.message;
                document.getElementById('loginError').classList.remove('hidden');
            } finally {
                btn.disabled = false;
                btn.innerHTML = `<i class="fa-solid fa-right-to-bracket"></i> Увійти за паролем`;
            }
        }

        // 4. Google Sign-In Handler
        async function handleGoogleCredentialResponse(response) {
            try {
                const res = await fetch(`${API_BASE}/api/auth/google`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ credential: response.credential })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.detail || "Помилка Google авторизації");

                token = data.access_token;
                currentUser = data.user;
                localStorage.setItem("dairy_token", token);
                localStorage.setItem("dairy_user", JSON.stringify(currentUser));
                showToast(`Вітаємо, ${currentUser.full_name}!`);
                closeModal('importAuthRequiredModal');
                showDashboard();

                if (pendingImportAfterAuth) {
                    pendingImportAfterAuth = false;
                    setTimeout(() => openImportModal(), 300);
                }
            } catch (err) {
                showToast(err.message, "error");
                document.getElementById('loginError').textContent = err.message;
                document.getElementById('loginError').classList.remove('hidden');
            }
        }

        function openLoginModal() {
            document.getElementById('importAuthRequiredModal').classList.remove('hidden');
            renderGoogleSignInButton();
        }

        function renderGoogleSignInButton() {
            try {
                if (window.google?.accounts?.id) {
                    window.google.accounts.id.initialize({
                        client_id: "733707845450-vui70uu318k17qvfjicu4tb5q2dsdrdg.apps.googleusercontent.com",
                        callback: handleGoogleCredentialResponse,
                        auto_prompt: false
                    });
                    const containers = document.querySelectorAll('.g_id_signin');
                    containers.forEach(container => {
                        window.google.accounts.id.renderButton(
                            container,
                            { type: 'standard', size: 'large', theme: 'outline', text: 'sign_in_with', shape: 'pill', width: 280 }
                        );
                    });
                }
            } catch (gErr) {
                console.warn("[Google Auth] Error re-rendering Google Sign-In button:", gErr);
            }
        }

        function logout() {
            localStorage.removeItem("dairy_token");
            localStorage.removeItem("dairy_user");
            sessionStorage.removeItem("dairy_demo_active");
            token = null;
            currentUser = null;
            document.getElementById('appDashboard').classList.add('hidden');
            document.getElementById('headerLoginBtn')?.classList.add('hidden');
            document.getElementById('headerUserChip')?.classList.add('hidden');
            document.getElementById('headerBackupBtn')?.classList.add('hidden');
            document.getElementById('loginScreen').classList.remove('hidden');

            renderGoogleSignInButton();
        }

        function navigateToHome(e) {
            if (e) e.preventDefault();
            // If user is actively logged in (either real account or demo mode), stay on dashboard!
            if (token) {
                showDashboard();
                switchTab('animals');
                return;
            }
            // Only if unauthenticated, show login screen without reloading page
            document.getElementById('appDashboard').classList.add('hidden');
            document.getElementById('onboardingScreen').classList.add('hidden');
            document.getElementById('loginScreen').classList.remove('hidden');
            renderGoogleSignInButton();
        }

        // 5. Dashboard View
        function showDashboard() {
            document.getElementById('loginScreen').classList.add('hidden');
            document.getElementById('onboardingScreen').classList.add('hidden');
            document.getElementById('appDashboard').classList.remove('hidden');

            const isGuest = currentUser?.role === 'guest' || currentUser?.id === 'demo-user-guest' || token === 'demo_mode_token';

            // Top Header Auth Indicator
            const headerLoginBtn = document.getElementById('headerLoginBtn');
            const headerUserChip = document.getElementById('headerUserChip');
            const headerEmailSpan = document.getElementById('headerUserEmail');

            if (isGuest) {
                headerLoginBtn?.classList.remove('hidden');
                headerUserChip?.classList.add('hidden');
                document.getElementById('headerBackupBtn')?.classList.add('hidden');
            } else {
                headerLoginBtn?.classList.add('hidden');
                if (headerUserChip && headerEmailSpan) {
                    headerEmailSpan.textContent = currentUser?.email || currentUser?.full_name || 'Акаунт';
                    headerUserChip.classList.remove('hidden');
                    headerUserChip.classList.add('flex');
                }
                document.getElementById('headerBackupBtn')?.classList.remove('hidden');
                document.getElementById('headerBackupBtn')?.classList.add('flex');
            }

            document.getElementById('userNameDisplay').textContent = currentUser?.full_name || "Користувач";
            document.getElementById('userRoleBadge').textContent = isGuest ? "Гість (Демо)" : (currentUser?.role || "operator");

            if (currentUser?.role !== 'superadmin') {
                document.getElementById('usersTabBtn')?.classList.add('hidden');
                document.getElementById('metricsTabBtn')?.classList.add('hidden');
                document.getElementById('logsTabBtn')?.classList.add('hidden');
            } else {
                document.getElementById('usersTabBtn')?.classList.remove('hidden');
                document.getElementById('metricsTabBtn')?.classList.remove('hidden');
                document.getElementById('logsTabBtn')?.classList.remove('hidden');
            }

            updateTileHighlight('Active');
            refreshDashboardData(false);
        }

        let isRefreshingData = false;
        let lastAutoRefreshTime = Date.now();

        async function refreshDashboardData(showFeedback = true) {
            if (isRefreshingData) return;
            isRefreshingData = true;
            lastAutoRefreshTime = Date.now();

            const refreshIcon = document.getElementById('headerRefreshIcon');
            if (refreshIcon) refreshIcon.classList.add('fa-spin');

            try {
                await Promise.allSettled([
                    loadFarms(),
                    loadStats(),
                    loadAnimals(),
                    loadActionLists(),
                    loadMedications()
                ]);

                if (currentUser?.role === 'superadmin') {
                    loadUsers();
                    loadAdminMetrics();
                }
            } catch (err) {
                console.warn("[Refresh] Data update failed:", err);
            } finally {
                if (refreshIcon) refreshIcon.classList.remove('fa-spin');
                isRefreshingData = false;
            }
        }

        // Tabs
        function switchTab(tabId) {
            document.querySelectorAll('.nav-tab-btn').forEach(b => {
                b.classList.remove('active', 'bg-emerald-600', 'text-white', 'shadow-sm');
                b.classList.add('bg-slate-100', 'text-slate-700');
            });
            document.querySelectorAll('.tab-pane').forEach(p => p.classList.add('hidden'));

            const tabBtnMap = {
                'animals': 'navTabAnimalsBtn',
                'actions': 'navTabActionsBtn',
                'users': 'navTabUsersBtn',
                'metrics': 'navTabMetricsBtn',
                'logs': 'navTabLogsBtn',
                'grid': 'navTabGridBtn',
                'meds': 'navTabMedsBtn'
            };

            const targetBtn = document.getElementById(tabBtnMap[tabId]);
            if (targetBtn) {
                targetBtn.classList.add('active', 'bg-emerald-600', 'text-white', 'shadow-sm');
                targetBtn.classList.remove('bg-slate-100', 'text-slate-700');
            }

            if (tabId === 'animals') {
                document.getElementById('tabContentAnimals')?.classList.remove('hidden');
            } else if (tabId === 'actions') {
                document.getElementById('tabContentActions')?.classList.remove('hidden');
                loadActionLists();
            } else if (tabId === 'users') {
                document.getElementById('tabContentUsers')?.classList.remove('hidden');
                loadUsers();
            } else if (tabId === 'metrics') {
                document.getElementById('tabContentMetrics')?.classList.remove('hidden');
                loadAdminMetrics();
            } else if (tabId === 'logs') {
                document.getElementById('tabContentLogs')?.classList.remove('hidden');
                loadSystemLogs();
            } else if (tabId === 'grid') {
                document.getElementById('tabContentGrid')?.classList.remove('hidden');
                loadEventGrid();
            } else if (tabId === 'meds') {
                document.getElementById('tabContentMeds')?.classList.remove('hidden');
                loadMedsCatalog();
            }
        }

        // Subtab toggle for logs (System vs Audit)
        let curLogMode = 'system';
        function switchLogMode(mode) {
            curLogMode = mode;
            if (mode === 'system') {
                document.getElementById('viewSystemLogs').classList.remove('hidden');
                document.getElementById('viewAuditLogs').classList.add('hidden');
                document.getElementById('btnLogModeSystem').className = "px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 text-white shadow-sm transition";
                document.getElementById('btnLogModeAudit').className = "px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 transition";
                loadSystemLogs();
            } else {
                document.getElementById('viewSystemLogs').classList.add('hidden');
                document.getElementById('viewAuditLogs').classList.remove('hidden');
                document.getElementById('btnLogModeAudit').className = "px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 text-white shadow-sm transition";
                document.getElementById('btnLogModeSystem').className = "px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 transition";
                loadAuditLogs();
            }
        }

        // System Logs Fetcher
        async function loadSystemLogs() {
            const tbody = document.getElementById('logsTableBody');
            tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-slate-400">Завантаження системних логів...</td></tr>`;
            try {
                const level = document.getElementById('logLevelFilter')?.value || 'ALL';
                const cat = document.getElementById('logCategoryFilter')?.value || 'ALL';
                const res = await fetch(`${API_BASE}/api/system/logs?level=${level}&category=${cat}&limit=100`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!res.ok) throw new Error("Помилка завантаження системних логів");
                const logs = await res.json();
                if (!logs || logs.length === 0) {
                    tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-slate-400 font-sans">Системних логів не знайдено.</td></tr>`;
                    return;
                }

                const levelBadges = {
                    'ERROR': '<span class="bg-rose-100 text-rose-700 font-bold px-2 py-0.5 rounded text-[10px]">ERROR</span>',
                    'WARNING': '<span class="bg-amber-100 text-amber-700 font-bold px-2 py-0.5 rounded text-[10px]">WARNING</span>',
                    'SUCCESS': '<span class="bg-emerald-100 text-emerald-700 font-bold px-2 py-0.5 rounded text-[10px]">SUCCESS</span>',
                    'INFO': '<span class="bg-blue-100 text-blue-700 font-bold px-2 py-0.5 rounded text-[10px]">INFO</span>'
                };

                tbody.innerHTML = logs.map(l => {
                    const badge = levelBadges[l.level] || l.level;
                    return `
                        <tr class="hover:bg-slate-50/80">
                            <td class="p-3 text-slate-500 whitespace-nowrap">${l.created_at}</td>
                            <td class="p-3">${badge}</td>
                            <td class="p-3 font-semibold text-slate-700">${l.category}</td>
                            <td class="p-3 text-slate-900 font-medium">${l.message}</td>
                            <td class="p-3 text-slate-500 font-mono text-[10px] break-all">${l.details || '-'}</td>
                        </tr>
                    `;
                }).join('');
            } catch (e) {
                tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-rose-500">Не вдалося завантажити логи: ${e.message}</td></tr>`;
            }
        }

        // Manual User Audit Logs Fetcher
        async function loadAuditLogs() {
            const tbody = document.getElementById('auditTableBody');
            tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-slate-400">Завантаження журналу дій...</td></tr>`;
            try {
                const entity = document.getElementById('auditEntityFilter')?.value || 'ALL';
                const action = document.getElementById('auditActionFilter')?.value || 'ALL';
                const res = await fetch(`${API_BASE}/api/system/audit-logs?entity_type=${entity}&action=${action}&limit=100`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!res.ok) throw new Error("Помилка завантаження журналу дій");
                const logs = await res.json();
                if (!logs || logs.length === 0) {
                    tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-slate-400 font-sans">Журнал ручних дій порожній. Всі внесені оператором зміни та оновлення карток фіксуються тут.</td></tr>`;
                    return;
                }

                const actionBadges = {
                    'CREATE': '<span class="bg-emerald-100 text-emerald-700 font-bold px-2 py-0.5 rounded text-[10px]">CREATE</span>',
                    'UPDATE': '<span class="bg-blue-100 text-blue-700 font-bold px-2 py-0.5 rounded text-[10px]">UPDATE</span>',
                    'DELETE': '<span class="bg-rose-100 text-rose-700 font-bold px-2 py-0.5 rounded text-[10px]">DELETE</span>',
                    'SWITCH': '<span class="bg-purple-100 text-purple-700 font-bold px-2 py-0.5 rounded text-[10px]">SWITCH</span>',
                    'MERGE': '<span class="bg-amber-100 text-amber-700 font-bold px-2 py-0.5 rounded text-[10px]">MERGE</span>'
                };

                tbody.innerHTML = logs.map(l => {
                    const badge = actionBadges[l.action] || l.action;
                    let diffDisplay = '-';
                    if (l.diff_data) {
                        try {
                            const parsed = JSON.parse(l.diff_data);
                            diffDisplay = `<details class="cursor-pointer text-slate-500 hover:text-slate-800"><summary class="text-[11px] text-indigo-600 hover:underline">Зміни (${Object.keys(parsed).length} пол.)</summary><pre class="p-2 mt-1 bg-slate-50 border border-slate-200 rounded text-[10px] overflow-x-auto whitespace-pre-wrap">${JSON.stringify(parsed, null, 2)}</pre></details>`;
                        } catch (err) {
                            diffDisplay = `<span class="text-[10px] font-mono">${l.diff_data}</span>`;
                        }
                    }
                    return `
                        <tr class="hover:bg-slate-50/80">
                            <td class="p-3 text-slate-500 whitespace-nowrap">${l.created_at}</td>
                            <td class="p-3 font-semibold text-slate-800">${l.user_name || l.user_email || 'Оператор'}</td>
                            <td class="p-3">${badge}</td>
                            <td class="p-3 font-semibold text-slate-700">${l.entity_type}</td>
                            <td class="p-3 text-slate-900 font-medium">${l.summary}</td>
                            <td class="p-3">${diffDisplay}</td>
                        </tr>
                    `;
                }).join('');
            } catch (e) {
                tbody.innerHTML = `<tr><td colspan="6" class="p-8 text-center text-rose-500">Не вдалося завантажити журнал дій: ${e.message}</td></tr>`;
            }
        }

        // Farms Switcher & Management
        let farmsList = [];
        let isSwitchingFarm = false;
        async function loadFarms() {
            try {
                const savedFarmId = localStorage.getItem("dairy_selected_farm");
                const queryParam = savedFarmId ? `?active_farm_id=${encodeURIComponent(savedFarmId)}` : "";
                const res = await fetch(`${API_BASE}/api/farms${queryParam}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!res.ok) return;
                farmsList = await res.json();
                const sel = document.getElementById('farmSelectDropdown');
                if (!sel) return;

                const currentFarm = (savedFarmId && farmsList.find(f => f.id === savedFarmId)) 
                    ? farmsList.find(f => f.id === savedFarmId) 
                    : (farmsList.find(f => f.is_current) || farmsList[0]);

                if (currentFarm && (!savedFarmId || savedFarmId !== currentFarm.id)) {
                    localStorage.setItem("dairy_selected_farm", currentFarm.id);
                }

                sel.innerHTML = farmsList.map(f => {
                    const farmName = (f.name || "Моя ферма").trim();
                    return `
                        <option value="${f.id}" title="${farmName}" ${(currentFarm && f.id === currentFarm.id) ? 'selected' : ''}>
                            ${farmName} (${f.cow_count || 0})
                        </option>
                    `;
                }).join('');
            } catch (err) { console.warn("Failed to load farms", err); }
        }

        async function onFarmDropdownChange(farmId, showToastMsg = true) {
            if (!farmId || isSwitchingFarm) return;
            isSwitchingFarm = true;
            localStorage.setItem("dairy_selected_farm", farmId);
            try {
                const res = await fetch(`${API_BASE}/api/farms/switch/${farmId}`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const d = await res.json();
                if (!res.ok) throw new Error(d.detail || "Помилка перемикання бази");
                
                if (d.access_token) {
                    token = d.access_token;
                    localStorage.setItem("dairy_token", token);
                }
                if (showToastMsg) showToast(d.message);
                await loadFarms();
                loadStats();
                loadAnimals();
                loadActionLists();
                loadEventGrid();
            } catch (err) { 
                showToast(err.message, "error"); 
            } finally {
                isSwitchingFarm = false;
            }
        }

        function openFarmPassportModal() {
            const delBtn = document.getElementById('btnDeleteFarmPassport');
            const currentFarm = (farmsList && farmsList.length > 0) ? (farmsList.find(f => f.is_current) || farmsList[0]) : null;

            if (!currentFarm) {
                document.getElementById('passFarmNameInput').value = "Моя ферма";
                document.getElementById('passFarmerNameInput').value = "";
                document.getElementById('passCityInput').value = "";
                document.getElementById('passAddressInput').value = "";
                document.getElementById('passPhoneInput').value = "";
                document.getElementById('passCowCount').textContent = "0 голів";
                if (delBtn) delBtn.classList.add('hidden');
                document.getElementById('farmPassportModal').classList.remove('hidden');
                return;
            }

            if (delBtn) delBtn.classList.remove('hidden');
            document.getElementById('passFarmNameInput').value = currentFarm.name || "";
            document.getElementById('passFarmerNameInput').value = currentFarm.farmer_name || "";
            document.getElementById('passCityInput').value = currentFarm.city || "";
            document.getElementById('passAddressInput').value = currentFarm.address || "";
            document.getElementById('passPhoneInput').value = currentFarm.phone || "";
            document.getElementById('passCowCount').textContent = `${currentFarm.cow_count || 0} голів`;

            // Format dates
            const formatDt = (dtStr) => {
                if (!dtStr) return "Не зафіксовано";
                try {
                    const d = new Date(dtStr);
                    if (isNaN(d.getTime())) return dtStr;
                    return d.toLocaleDateString("uk-UA", { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' +
                           d.toLocaleTimeString("uk-UA", { hour: '2-digit', minute: '2-digit' });
                } catch(e) { return dtStr; }
            };

            const createdEl = document.getElementById('passCreatedAt');
            if (createdEl) createdEl.textContent = formatDt(currentFarm.created_at);

            const importedEl = document.getElementById('passImportedAt');
            if (importedEl) {
                if (currentFarm.imported_at) {
                    importedEl.textContent = formatDt(currentFarm.imported_at);
                } else if (currentFarm.created_at && (currentFarm.cow_count > 0)) {
                    importedEl.textContent = `${formatDt(currentFarm.created_at)} (Первинний імпорт)`;
                } else {
                    importedEl.textContent = "Ручне введення / База не імпортувалась";
                }
            }

            document.getElementById('farmPassportModal').classList.remove('hidden');
        }

        async function handleSaveFarmPassport(e) {
            e.preventDefault();
            const currentFarm = (farmsList && farmsList.length > 0) ? (farmsList.find(f => f.is_current) || farmsList[0]) : null;
            if (!currentFarm) {
                showToast("Немає активної ферми для оновлення", "error");
                return;
            }

            const payload = {
                name: document.getElementById('passFarmNameInput').value.trim(),
                farmer_name: document.getElementById('passFarmerNameInput').value.trim(),
                city: document.getElementById('passCityInput').value.trim(),
                address: document.getElementById('passAddressInput').value.trim(),
                phone: document.getElementById('passPhoneInput').value.trim()
            };

            const saveBtn = document.getElementById('btnSavePassport');
            const originalText = saveBtn.innerHTML;
            saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Збереження...';
            saveBtn.disabled = true;

            try {
                const res = await fetch(`${API_BASE}/api/farms/${currentFarm.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify(payload)
                });
                const d = await res.json();
                if (!res.ok) throw new Error(d.detail || "Помилка збереження паспорта");
                showToast(d.message);
                closeModal('farmPassportModal');
                await loadFarms();
            } catch (err) {
                showToast(err.message, "error");
            } finally {
                saveBtn.innerHTML = originalText;
                saveBtn.disabled = false;
            }
        }

        function openNewFarmModal() {
            document.getElementById('createFarmName').value = '';
            document.getElementById('createFarmCode').value = '';
            document.getElementById('newFarmModal').classList.remove('hidden');
        }

        async function handleCreateFarm(e) {
            e.preventDefault();
            const name = document.getElementById('createFarmName').value.trim();
            const code = document.getElementById('createFarmCode').value.trim() || null;
            try {
                const res = await fetch(`${API_BASE}/api/farms`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ name, code })
                });
                const d = await res.json();
                if (!res.ok) throw new Error(d.detail || "Помилка створення ферми");
                showToast(d.message);
                closeModal('newFarmModal');
                // Switch to this new farm
                if (d.farm_id) onFarmDropdownChange(d.farm_id);
            } catch (err) { showToast(err.message, "error"); }
        }

        async function confirmDeleteFromPassport() {
            closeModal('farmPassportModal');
            await confirmDeleteCurrentFarm();
        }

        async function confirmDeleteCurrentFarm() {
            const currentFarm = (farmsList && farmsList.length > 0) ? (farmsList.find(f => f.is_current) || farmsList[0]) : null;
            if (!currentFarm) {
                showToast("Немає активної ферми для видалення", "error");
                return;
            }
            if (!confirm(`УВАГА! Ви дійсно бажаєте безповоротно видалити базу ферми '${currentFarm.name}' (${currentFarm.cow_count || 0} голів)?`)) return;

            try {
                const res = await fetch(`${API_BASE}/api/farms/${currentFarm.id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const d = await res.json();
                if (!res.ok) throw new Error(d.detail || "Помилка видалення бази");
                showToast(d.message);
                
                if (d.access_token) {
                    token = d.access_token;
                    localStorage.setItem("dairy_token", token);
                }

                // If deleted farm was saved in localStorage, clear it
                const savedFarmId = localStorage.getItem("dairy_selected_farm");
                if (savedFarmId === currentFarm.id) {
                    if (d.next_farm_id) {
                        localStorage.setItem("dairy_selected_farm", d.next_farm_id);
                    } else {
                        localStorage.removeItem("dairy_selected_farm");
                    }
                }

                // Reload farms and dashboard
                await loadFarms();
                if (d.next_farm_id) {
                    onFarmDropdownChange(d.next_farm_id, false);
                } else if (farmsList.length > 0) {
                    onFarmDropdownChange(farmsList[0].id, false);
                } else {
                    loadStats();
                    loadAnimals();
                    loadActionLists();
                    loadEventGrid();
                }
            } catch (err) { showToast(err.message, "error"); }
        }


        async function clearSystemLogs() {
            if (!confirm("Ви впевнені, що бажаєте очистити всі системні логи?")) return;
            try {
                const res = await fetch(`${API_BASE}/api/system/logs`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.ok) {
                    showToast("Логи успішно очищено");
                    loadSystemLogs();
                } else {
                    showToast("Помилка очищення", "error");
                }
            } catch (e) {
                showToast(e.message, "error");
            }
        }

        // 6. Data Fetchers
        async function loadStats() {
            try {
                const res = await fetch(`${API_BASE}/api/dashboard/stats`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const d = await res.json();
                document.getElementById('statQuarantine').textContent = d.in_quarantine.toLocaleString();

                // Herd Tiles
                if (d.herd_tiles) {
                    document.getElementById('tileOpen').textContent = d.herd_tiles.open.toLocaleString();
                    document.getElementById('tileIns').textContent = d.herd_tiles.inseminated.toLocaleString();
                    document.getElementById('tilePreg').textContent = d.herd_tiles.pregnant.toLocaleString();
                    document.getElementById('tileDry').textContent = d.herd_tiles.dry.toLocaleString();
                    document.getElementById('tileFresh').textContent = d.herd_tiles.fresh.toLocaleString();
                }

                // KPIs
                if (d.kpis) {
                    document.getElementById('kpiAvgDim').textContent = `${d.kpis.avg_dim} дн.`;
                    document.getElementById('kpiCR').textContent = `${d.kpis.conception_rate}%`;
                    document.getElementById('kpiPR').textContent = `${d.kpis.pregnancy_rate}%`;
                    document.getElementById('kpiIR').textContent = `${d.kpis.insemination_rate}%`;
                    document.getElementById('kpiECI').textContent = `${d.kpis.calving_interval_days} дн.`;
                }

                // Dynamic Herd Reproduction Structure Chart
                const total = d.total_cows || 0;
                const preg = d.herd_tiles?.pregnant || 0;
                const ins = d.herd_tiles?.inseminated || 0;
                const open = d.herd_tiles?.open || 0;
                const dry = d.herd_tiles?.dry || 0;
                const fresh = d.herd_tiles?.fresh || 0;
                const quar = d.in_quarantine || 0;

                const calcPct = val => total > 0 ? Math.round((val / total) * 100) : 0;
                const pctPreg = calcPct(preg);
                const pctIns = calcPct(ins);
                const pctOpen = calcPct(open);
                const pctDry = calcPct(dry);
                const pctFresh = calcPct(fresh);
                const pctQuar = calcPct(quar);

                // Update Badges on Top Herd Tiles
                const bOpen = document.getElementById('tileOpenPct');
                if (bOpen) bOpen.textContent = `${pctOpen}%`;
                const bIns = document.getElementById('tileInsPct');
                if (bIns) bIns.textContent = `${pctIns}%`;
                const bPreg = document.getElementById('tilePregPct');
                if (bPreg) bPreg.textContent = `${pctPreg}%`;
                const bDry = document.getElementById('tileDryPct');
                if (bDry) bDry.textContent = `${pctDry}%`;
                const bFresh = document.getElementById('tileFreshPct');
                if (bFresh) bFresh.textContent = `${pctFresh}%`;
                const bQuar = document.getElementById('tileQuarPct');
                if (bQuar) bQuar.textContent = `${pctQuar}%`;

                const totalBadge = document.getElementById('chartReproTotalBadge');
                if (totalBadge) totalBadge.textContent = `${total.toLocaleString()} голів`;

                const barPreg = document.getElementById('chartBarPreg');
                if (barPreg) barPreg.style.width = `${pctPreg}%`;
                const barIns = document.getElementById('chartBarIns');
                if (barIns) barIns.style.width = `${pctIns}%`;
                const barOpen = document.getElementById('chartBarOpen');
                if (barOpen) barOpen.style.width = `${pctOpen}%`;
                const barDry = document.getElementById('chartBarDry');
                if (barDry) barDry.style.width = `${pctDry}%`;
                const barQuar = document.getElementById('chartBarQuar');
                if (barQuar) barQuar.style.width = `${pctQuar}%`;

                const legPreg = document.getElementById('chartLegendPreg');
                if (legPreg) legPreg.textContent = `${preg} (${pctPreg}%)`;
                const legIns = document.getElementById('chartLegendIns');
                if (legIns) legIns.textContent = `${ins} (${pctIns}%)`;
                const legOpen = document.getElementById('chartLegendOpen');
                if (legOpen) legOpen.textContent = `${open} (${pctOpen}%)`;
                const legDry = document.getElementById('chartLegendDry');
                if (legDry) legDry.textContent = `${dry} (${pctDry}%)`;
                const legQuar = document.getElementById('chartLegendQuar');
                if (legQuar) legQuar.textContent = `${quar} (${pctQuar}%)`;
            } catch (e) { console.error(e); }
        }

        function updateTileHighlight(currentFilter) {
            const tileMap = {
                'Active': 'tileBtnOpen',
                'Inseminated': 'tileBtnIns',
                'Pregnant': 'tileBtnPreg',
                'Dry': 'tileBtnDry',
                'Fresh': 'tileBtnFresh',
                'Quarantine': 'tileBtnQuar'
            };

            document.querySelectorAll('.herd-tile-btn').forEach(b => {
                b.classList.remove('active-filter', 'ring-2', 'ring-indigo-600', 'ring-offset-2', 'bg-emerald-600', 'text-white', 'shadow-md');
            });

            if (currentFilter && currentFilter !== 'ALL' && tileMap[currentFilter]) {
                const targetBtn = document.getElementById(tileMap[currentFilter]);
                if (targetBtn) {
                    targetBtn.classList.add('active-filter');
                }
            }
        }

        function onStatusFilterDropdownChange() {
            const filterEl = document.getElementById('statusFilter');
            if (filterEl) updateTileHighlight(filterEl.value);
            curOffset = 0;
            loadAnimals();
        }

        function filterByHerdStatus(statusKey) {
            // 1. Ensure Animals tab is active
            switchTab('animals');

            const filterEl = document.getElementById('statusFilter');
            if (!filterEl) return;

            // Toggle filter: if already selected, reset to ALL, otherwise set status
            if (filterEl.value === statusKey) {
                filterEl.value = 'ALL';
            } else {
                filterEl.value = statusKey;
            }

            updateTileHighlight(filterEl.value);
            curOffset = 0;
            loadAnimals();
            if (document.activeElement && typeof document.activeElement.blur === 'function') {
                document.activeElement.blur();
            }
        }

        function openFertilityModal() {
            document.getElementById('fertilityModal').classList.remove('hidden');
        }

        async function openVetChecklistModal() {
            try {
                const res = await fetch(`${API_BASE}/api/dashboard/action-lists`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const d = await res.json();
                
                const quarList = d.quarantine_milk || d.milk_quarantine || [];
                const pregList = d.pregnancy_check || d.pregnancy_check_due || [];
                const dryList = d.dry_off_candidates || [];

                document.getElementById('vetChecklistSubtitle').textContent = `Формування на ${new Date().toLocaleDateString('uk-UA')} • Всього завдань: ${quarList.length + pregList.length + dryList.length}`;

                // 1. Quarantine
                document.getElementById('vcQuarCount').textContent = quarList.length;
                const qTbody = document.getElementById('vcQuarTable');
                if (quarList.length > 0) {
                    qTbody.innerHTML = quarList.map(c => `
                        <tr class="hover:bg-slate-50 border-b border-slate-100">
                            <td class="p-2.5 font-bold text-slate-900">№ ${c.farm_number}</td>
                            <td class="p-2.5 font-mono text-slate-500">${c.official_tag || '-'}</td>
                            <td class="p-2.5 font-semibold text-rose-700">${c.diagnosis || 'Терапія'}</td>
                            <td class="p-2.5 text-slate-700">${c.medication || c.medication_name || '-'}</td>
                            <td class="p-2.5 text-rose-600 font-bold">${c.withholding_until || '-'} (${c.days_left || 0} дн.)</td>
                            <td class="p-2.5 text-right font-mono text-slate-300">____________</td>
                        </tr>
                    `).join('');
                } else {
                    qTbody.innerHTML = `<tr><td colspan="6" class="p-3 text-center text-slate-400">Корів під каренцією немає</td></tr>`;
                }

                // 2. Pregnancy Check
                document.getElementById('vcPregCount').textContent = pregList.length;
                const pTbody = document.getElementById('vcPregTable');
                if (pregList.length > 0) {
                    pTbody.innerHTML = pregList.map(c => `
                        <tr class="hover:bg-slate-50 border-b border-slate-100">
                            <td class="p-2.5 font-bold text-slate-900">№ ${c.farm_number}</td>
                            <td class="p-2.5 font-mono text-slate-500">${c.official_tag || '-'}</td>
                            <td class="p-2.5 text-slate-700">${c.insemination_date || '-'}</td>
                            <td class="p-2.5 font-bold text-amber-700">${c.days_since_ins || '-'} дн.</td>
                            <td class="p-2.5 text-slate-400 font-mono">[ ] Тільна &nbsp; [ ] Холоста</td>
                            <td class="p-2.5 text-right">
                                <button onclick="openCow360('${c.animal_id}')" class="text-emerald-600 hover:underline font-bold">Оглянути</button>
                            </td>
                        </tr>
                    `).join('');
                } else {
                    pTbody.innerHTML = `<tr><td colspan="6" class="p-3 text-center text-slate-400">Корів на планову перевірку немає</td></tr>`;
                }

                // 3. Dry-off
                document.getElementById('vcDryCount').textContent = dryList.length;
                const dTbody = document.getElementById('vcDryTable');
                if (dryList.length > 0) {
                    dTbody.innerHTML = dryList.map(c => `
                        <tr class="hover:bg-slate-50 border-b border-slate-100">
                            <td class="p-2.5 font-bold text-slate-900">№ ${c.farm_number}</td>
                            <td class="p-2.5 font-mono text-slate-500">${c.official_tag || '-'}</td>
                            <td class="p-2.5 font-bold text-emerald-700">${c.days_pregnant || 220} дн.</td>
                            <td class="p-2.5 text-slate-800 font-semibold">${c.expected_calving || c.expected_calving_date || '-'}</td>
                            <td class="p-2.5 font-mono text-slate-400">[ ] Введено консервант</td>
                            <td class="p-2.5 text-right font-mono text-slate-300">____________</td>
                        </tr>
                    `).join('');
                } else {
                    dTbody.innerHTML = `<tr><td colspan="6" class="p-3 text-center text-slate-400">Кандидатів на запуск немає</td></tr>`;
                }

                document.getElementById('vetChecklistModal').classList.remove('hidden');
            } catch (e) {
                showToast(e.message, "error");
            }
        }

        function toggleDashboardAnalyticsCharts() {
            const card = document.getElementById('dashboardAnalyticsChartsCard');
            const btn = document.getElementById('toggleChartsBtn');
            if (!card) return;
            const isHidden = card.classList.contains('hidden');
            if (isHidden) {
                switchTab('animals');
                card.classList.remove('hidden');
                if (btn) btn.className = "bg-indigo-600 text-white border border-indigo-700 px-3 py-1.5 rounded-xl font-semibold flex items-center gap-1.5 transition shadow-sm";
                setTimeout(() => {
                    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }, 50);
            } else {
                card.classList.add('hidden');
                if (btn) btn.className = "bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 px-3 py-1.5 rounded-xl font-semibold flex items-center gap-1.5 transition";
            }
        }

        let searchTimeout = null;
        function debounceSearch() {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                curOffset = 0;
                loadAnimals();
            }, 300);
        }

        async function loadAnimals() {
            const q = document.getElementById('cowSearchInput').value;
            const status = document.getElementById('statusFilter').value;
            const tb = document.getElementById('animalsTableBody');
            tb.innerHTML = `<tr><td colspan="9" class="p-8 text-center text-slate-400"><i class="fa-solid fa-spinner fa-spin"></i> Завантаження...</td></tr>`;

            try {
                let url = `${API_BASE}/api/animals?limit=${PAGE_LIMIT}&offset=${curOffset}`;
                if (q) url += `&q=${encodeURIComponent(q)}`;
                if (status && status !== 'ALL') url += `&status=${encodeURIComponent(status)}`;

                const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
                const data = await res.json();
                
                if (!data.items || data.items.length === 0) {
                    tb.innerHTML = `<tr><td colspan="9" class="p-8 text-center text-slate-400">Корів не знайдено</td></tr>`;
                    document.getElementById('animalsCountLabel').textContent = `Показано 0 із ${data.total}`;
                    return;
                }

                const formatDateCell = (d) => {
                    if (!d || d === 'null' || d === 'undefined') return '';
                    return d;
                };

                tb.innerHTML = data.items.map(a => `
                    <tr class="hover:bg-slate-50 transition border-b border-slate-100">
                        <td class="p-3 font-bold text-slate-900">${a.farm_number}</td>
                        <td class="p-3 font-mono text-slate-500">${a.official_tag || '-'}</td>
                        <td class="p-3 font-medium text-slate-800">${a.name || '-'}</td>
                        <td class="p-3 font-semibold text-slate-700">${a.lactation_number || 0}</td>
                        <td class="p-3">
                            <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold ${getStatusBadgeClass(a.current_status)}">
                                ${a.current_status}
                            </span>
                        </td>
                        <td class="p-3 text-slate-600 font-mono text-xs">${formatDateCell(a.last_calving_date)}</td>
                        <td class="p-3 text-slate-600 font-mono text-xs">${formatDateCell(a.expected_calving_date)}</td>
                        <td class="p-3 text-slate-500">${a.group_name || 'Група 1'}</td>
                        <td class="p-3 text-right">
                            <button onclick="openCow360('${a.id}')" class="bg-slate-100 hover:bg-emerald-50 hover:text-emerald-700 text-slate-700 px-2.5 py-1.5 rounded-lg font-semibold transition">
                                <i class="fa-regular fa-folder-open"></i> Картка 360°
                            </button>
                        </td>
                    </tr>
                `).join('');

                const fromNum = data.total > 0 ? (curOffset + 1) : 0;
                const toNum = Math.min(curOffset + data.items.length, data.total);
                const currentPage = Math.floor(curOffset / PAGE_LIMIT) + 1;
                const totalPages = Math.max(1, Math.ceil(data.total / PAGE_LIMIT));

                document.getElementById('animalsCountLabel').textContent = `Сторінка ${currentPage} з ${totalPages}`;
                const badgeEl = document.getElementById('animalsRangeBadge');
                if (badgeEl) {
                    badgeEl.textContent = `${fromNum}–${toNum} із ${data.total}`;
                }

                document.getElementById('prevPageBtn').disabled = curOffset === 0;
                document.getElementById('nextPageBtn').disabled = curOffset + PAGE_LIMIT >= data.total;

                // Render numbered page buttons (e.g. 1, 2, 3 ... or near current page)
                renderPageButtons(currentPage, totalPages);

            } catch (err) {
                console.error(err);
                tb.innerHTML = `<tr><td colspan="9" class="p-8 text-center text-rose-500">Помилка завантаження даних</td></tr>`;
            }
        }

        function renderPageButtons(current, total) {
            const container = document.getElementById('paginationPagesList');
            if (!container) return;
            if (total <= 1) {
                container.innerHTML = '';
                return;
            }

            const pages = [];
            if (total <= 6) {
                for (let i = 1; i <= total; i++) pages.push(i);
            } else {
                pages.push(1);
                if (current > 3) pages.push('...');
                const start = Math.max(2, current - 1);
                const end = Math.min(total - 1, current + 1);
                for (let i = start; i <= end; i++) {
                    if (!pages.includes(i)) pages.push(i);
                }
                if (current < total - 2) pages.push('...');
                if (!pages.includes(total)) pages.push(total);
            }

            container.innerHTML = pages.map(p => {
                if (p === '...') {
                    return `<span class="px-1 text-slate-400 text-xs">…</span>`;
                }
                const isActive = p === current;
                return `
                    <button onclick="goToPage(${p})" class="w-7 h-7 rounded-lg text-xs font-semibold transition flex items-center justify-center ${isActive ? 'bg-emerald-600 text-white shadow-sm' : 'border border-slate-200 text-slate-700 hover:bg-slate-100'}">
                        ${p}
                    </button>
                `;
            }).join('');
        }

        function goToPage(pageNum) {
            curOffset = (pageNum - 1) * PAGE_LIMIT;
            loadAnimals();
        }

        function prevPage() {
            if (curOffset >= PAGE_LIMIT) {
                curOffset -= PAGE_LIMIT;
                loadAnimals();
            }
        }

        function nextPage() {
            curOffset += PAGE_LIMIT;
            loadAnimals();
        }

        function getStatusBadgeClass(status) {
            switch(status) {
                case 'Active': return 'bg-emerald-50 text-emerald-700 border border-emerald-200';
                case 'Pregnant': return 'bg-indigo-50 text-indigo-700 border border-indigo-200';
                case 'Dry': return 'bg-amber-50 text-amber-700 border border-amber-200';
                case 'Inseminated': return 'bg-purple-50 text-purple-700 border border-purple-200';
                case 'Culled': return 'bg-slate-100 text-slate-500 border border-slate-200';
                default: return 'bg-slate-50 text-slate-600';
            }
        }

        // 7. Smart Action Lists
        async function loadActionLists() {
            try {
                const res = await fetch(`${API_BASE}/api/dashboard/action-lists`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const d = await res.json();

                // 1. Quarantine
                document.getElementById('badgeQuarantine').textContent = d.quarantine_milk.length;
                document.getElementById('listQuarantine').innerHTML = d.quarantine_milk.length ? d.quarantine_milk.map(q => `
                    <div class="flex justify-between items-center p-2.5 bg-rose-50 rounded-xl border border-rose-100">
                        <div>
                            <span class="font-bold text-slate-900">№ ${q.farm_number}</span> 
                            <span class="text-slate-500">(${q.official_tag || ''})</span>
                            <div class="text-[11px] text-rose-700 mt-0.5">Лікування: ${q.diagnosis} • ${q.medication || ''}</div>
                        </div>
                        <div class="text-right">
                            <span class="font-bold text-rose-700">до ${q.withholding_until}</span>
                            <div class="text-[10px] text-slate-400">залишилось ${q.days_left} дн.</div>
                        </div>
                    </div>
                `).join('') : `<p class="p-4 text-center text-slate-400">Немає корів під каренцією</p>`;

                // 2. Pregnancy Check
                document.getElementById('badgePregnancy').textContent = d.pregnancy_check.length;
                document.getElementById('listPregnancy').innerHTML = d.pregnancy_check.length ? d.pregnancy_check.map(p => `
                    <div class="flex justify-between items-center p-2.5 bg-amber-50 rounded-xl border border-amber-100">
                        <div>
                            <span class="font-bold text-slate-900">№ ${p.farm_number}</span>
                            <div class="text-[11px] text-amber-800 mt-0.5">Осіменена: ${p.insemination_date} (${p.days_since_ins} дн. тому)</div>
                        </div>
                        <button onclick="openCow360('${p.animal_id}')" class="bg-amber-600 text-white px-2 py-1 rounded-lg text-[10px] font-bold">
                            Оглянути
                        </button>
                    </div>
                `).join('') : `<p class="p-4 text-center text-slate-400">Немає корів на перевірку</p>`;

                // 3. Dry-Off
                document.getElementById('badgeDryOff').textContent = d.dry_off_candidates.length;
                document.getElementById('listDryOff').innerHTML = d.dry_off_candidates.length ? d.dry_off_candidates.map(c => `
                    <div class="flex justify-between items-center p-2.5 bg-emerald-50 rounded-xl border border-emerald-100">
                        <div>
                            <span class="font-bold text-slate-900">№ ${c.farm_number}</span> (лактація ${c.lactation})
                            <div class="text-[11px] text-emerald-800 mt-0.5">Очікуваний отел: ${c.expected_calving}</div>
                        </div>
                        <span class="font-bold text-emerald-700 text-xs">${c.days_to_calving} дн.</span>
                    </div>
                `).join('') : `<p class="p-4 text-center text-slate-400">Немає кандидатів на запуск</p>`;

                // 4. Calving Watch
                document.getElementById('badgeCalvingWatch').textContent = d.calving_watch.length;
                document.getElementById('listCalvingWatch').innerHTML = d.calving_watch.length ? d.calving_watch.map(c => `
                    <div class="flex justify-between items-center p-2.5 bg-blue-50 rounded-xl border border-blue-100">
                        <div>
                            <span class="font-bold text-slate-900">№ ${c.farm_number}</span>
                            <div class="text-[11px] text-blue-800 mt-0.5">Плановий отел: ${c.expected_calving}</div>
                        </div>
                        <span class="font-bold text-blue-700 text-xs">${c.days_left} дн.</span>
                    </div>
                `).join('') : `<p class="p-4 text-center text-slate-400">Немає близьких отелів</p>`;

            } catch (e) { console.error(e); }
        }

        // 8. Cow 360° Profile Logic
        async function openCow360(id) {
            currentCowId = id;
            try {
                let a = null;
                if (!navigator.onLine && window.getCachedAnimal) {
                    a = await window.getCachedAnimal(id);
                }
                if (!a) {
                    try {
                        const res = await fetch(`${API_BASE}/api/animals/${id}`, {
                            headers: { 'Authorization': `Bearer ${token}` }
                        });
                        if (res.ok) {
                            a = await res.json();
                        }
                    } catch (netErr) {
                        if (window.getCachedAnimal) {
                            a = await window.getCachedAnimal(id);
                        }
                        if (!a) throw netErr;
                    }
                }
                if (!a) throw new Error("Тварину не знайдено в мережі або кеші");

                document.getElementById('mCowTitle').textContent = `Картка корови № ${a.farm_number} ${a.name ? '«' + a.name + '»' : ''}`;
                document.getElementById('mCowSubtitle').textContent = `${a.official_tag || 'Без бирки'} • ${a.group_name || 'Група 1'}`;

                document.getElementById('mEditNumber').value = a.farm_number;
                document.getElementById('mEditTag').value = a.official_tag || '';
                document.getElementById('mEditName').value = a.name || '';
                document.getElementById('mEditStatus').value = a.current_status || 'Active';
                document.getElementById('mEditLactation').value = a.lactation_number || 0;
                document.getElementById('mEditBirth').value = a.birth_date || '';
                document.getElementById('mEditLastCalv').value = a.last_calving_date || '';
                document.getElementById('mEditExpCalv').value = a.expected_calving_date || '';

                // Repro timeline
                const reproList = a.reproduction_history || a.repro_history || [];
                document.getElementById('mReproTimeline').innerHTML = reproList.length ? reproList.map(r => `
                    <div class="p-3 bg-amber-50/60 rounded-xl border border-amber-200/60 flex justify-between items-center">
                        <div>
                            <span class="font-bold text-amber-900">${r.event_type}</span> • <span class="text-slate-500">${r.event_date}</span>
                            <div class="text-slate-600 mt-0.5">${r.bull_code ? 'Бугай: ' + r.bull_code : ''} ${r.result ? ' | Результат: ' + r.result : ''}</div>
                        </div>
                        <span class="text-slate-400 text-[10px]">${r.operator_name || ''}</span>
                    </div>
                `).join('') : `<p class="text-slate-400 p-2">Подій відтворення не зареєстровано</p>`;

                // Health timeline
                const healthList = a.health_history || [];
                document.getElementById('mHealthTimeline').innerHTML = healthList.length ? healthList.map(h => `
                    <div class="p-3 bg-rose-50/60 rounded-xl border border-rose-200/60 flex justify-between items-center">
                        <div>
                            <span class="font-bold text-rose-900">${h.diagnosis || 'Терапія'}</span> • <span class="text-slate-500">${h.event_date}</span>
                            <div class="text-slate-600 mt-0.5">${h.medication_name ? 'Ліки: ' + h.medication_name : ''} (Каренція молока до: <b class="text-rose-600">${h.milk_withholding_until || '-'}</b>)</div>
                        </div>
                        <span class="text-slate-400 text-[10px]">${h.veterinarian_name || ''}</span>
                    </div>
                `).join('') : `<p class="text-slate-400 p-2">Записів лікування не знайдено</p>`;

                document.getElementById('cowModal').classList.remove('hidden');

            } catch (err) {
                console.error("Cow 360 error:", err);
                showToast("Помилка завантаження картки: " + err.message, "error");
            }
        }

        async function saveCowEdits() {
            if (!currentCowId) return;
            const payload = {
                farm_number: document.getElementById('mEditNumber').value,
                official_tag: document.getElementById('mEditTag').value,
                name: document.getElementById('mEditName').value,
                current_status: document.getElementById('mEditStatus').value,
                lactation_number: parseInt(document.getElementById('mEditLactation').value) || 0,
                birth_date: document.getElementById('mEditBirth').value || null,
                last_calving_date: document.getElementById('mEditLastCalv').value || null,
                expected_calving_date: document.getElementById('mEditExpCalv').value || null
            };

            try {
                const res = await fetch(`${API_BASE}/api/animals/${currentCowId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify(payload)
                });
                if (!res.ok) throw new Error("Помилка збереження");
                showToast("Зміни картки успішно збережено!");
                loadAnimals();
            } catch (e) {
                showToast(e.message, "error");
            }
        }

        function closeCowModal() {
            document.getElementById('cowModal').classList.add('hidden');
        }

        // 9. Repro & Health Modals
        function openAddReproModal() {
            document.getElementById('reproDate').value = new Date().toISOString().split('T')[0];
            document.getElementById('reproModal').classList.remove('hidden');
        }

        async function submitReproEvent(e) {
            e.preventDefault();
            const payload = {
                event_type: document.getElementById('reproType').value,
                event_date: document.getElementById('reproDate').value,
                bull_code: document.getElementById('reproBull').value || null,
                result: document.getElementById('reproResult').value || null,
                notes: document.getElementById('reproNotes').value || null
            };

            try {
                const res = await fetch(`${API_BASE}/api/animals/${currentCowId}/repro`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify(payload)
                });
                if (!res.ok) throw new Error("Помилка фіксації події");
                showToast("Подію відтворення збережено!");
                closeModal('reproModal');
                openCow360(currentCowId);
                loadStats();
                loadAnimals();
            } catch (err) { showToast(err.message, "error"); }
        }

        function openAddHealthModal() {
            document.getElementById('healthDate').value = new Date().toISOString().split('T')[0];
            document.getElementById('healthModal').classList.remove('hidden');
        }

        async function loadMedications() {
            try {
                const res = await fetch(`${API_BASE}/api/medications`);
                medicationsList = await res.json();
                const sel = document.getElementById('healthMedSelect');
                sel.innerHTML = `<option value="">Оберіть зі списку...</option>` + medicationsList.map(m => `
                    <option value="${m.id}">${m.name} (${m.milk_days} дн. каренція молока)</option>
                `).join('');
            } catch (e) {}
        }

        function autoFillWithholding() {
            const id = document.getElementById('healthMedSelect').value;
            const m = medicationsList.find(x => x.id === id);
            if (m) {
                document.getElementById('healthMedName').value = m.name;
                document.getElementById('healthMilkDays').value = m.milk_days;
                document.getElementById('healthMeatDays').value = m.meat_days;
            }
        }

        async function submitHealthEvent(e) {
            e.preventDefault();
            const payload = {
                event_date: document.getElementById('healthDate').value,
                diagnosis: document.getElementById('healthDiagnosis').value,
                medication_name: document.getElementById('healthMedName').value,
                milk_withholding_days: parseInt(document.getElementById('healthMilkDays').value) || 0,
                meat_withholding_days: parseInt(document.getElementById('healthMeatDays').value) || 0,
                notes: document.getElementById('healthNotes').value || null
            };

            try {
                const res = await fetch(`${API_BASE}/api/animals/${currentCowId}/health`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify(payload)
                });
                if (!res.ok) throw new Error("Помилка запису лікування");
                showToast("Лікування та каренцію додано!");
                closeModal('healthModal');
                openCow360(currentCowId);
                loadStats();
            } catch (err) { showToast(err.message, "error"); }
        }

        // 10. Add New Cow Modal
        function openAddCowModal() {
            document.getElementById('addCowModal').classList.remove('hidden');
        }

        async function submitNewCow(e) {
            e.preventDefault();
            const payload = {
                farm_number: document.getElementById('newCowNumber').value,
                official_tag: document.getElementById('newCowTag').value || null,
                name: document.getElementById('newCowName').value || null,
                current_status: document.getElementById('newCowStatus').value,
                lactation_number: parseInt(document.getElementById('newCowLactation').value) || 0
            };

            try {
                if (!navigator.onLine && window.queueOfflineMutation) {
                    await window.queueOfflineMutation('/api/animals', 'POST', payload);
                    closeModal('addCowModal');
                    showToast("Збережено в чергу офлайн!", "info");
                    return;
                }

                const res = await fetch(`${API_BASE}/api/animals`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify(payload)
                });
                if (!res.ok) throw new Error("Помилка створення");
                showToast("Корову додано в базу!");
                closeModal('addCowModal');
                loadStats();
                loadAnimals();
            } catch (e) {
                if (!navigator.onLine && window.queueOfflineMutation) {
                    await window.queueOfflineMutation('/api/animals', 'POST', payload);
                    closeModal('addCowModal');
                    showToast("Збережено в чергу офлайн!", "info");
                } else {
                    showToast(e.message, "error");
                }
            }
        }

        // 11. User Management
        async function loadUsers() {
            const tb = document.getElementById('usersTableBody');
            tb.innerHTML = `<tr><td colspan="9" class="p-6 text-center text-slate-400">Завантаження...</td></tr>`;

            try {
                const res = await fetch(`${API_BASE}/api/users`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const users = await res.json();

                tb.innerHTML = users.map(u => `
                    <tr class="hover:bg-slate-50 transition border-b border-slate-100">
                        <td class="p-3 font-bold text-slate-900">${u.full_name}</td>
                        <td class="p-3 text-slate-600 font-mono text-[11px]">${u.email}</td>
                        <td class="p-3"><span class="px-2 py-0.5 rounded-full text-[10px] font-semibold ${u.role === 'superadmin' ? 'bg-purple-100 text-purple-700' : (u.role === 'guest' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700')}">${u.role}</span></td>
                        <td class="p-3 text-slate-700 text-xs">${u.last_login_at ? `<span class="text-emerald-700 font-semibold"><i class="fa-regular fa-clock text-[10px] mr-1"></i>${u.last_login_at}</span>` : '<span class="text-slate-400">Не заходив</span>'}</td>
                        <td class="p-3 font-bold text-slate-800">${u.login_count || 0}</td>
                        <td class="p-3 text-slate-600">${u.google_sub ? '<i class="fa-brands fa-google text-emerald-600 mr-1"></i> Так' : '<span class="text-slate-400">Ні</span>'}</td>
                        <td class="p-3">${u.is_active ? '<span class="text-emerald-600 font-semibold">Активний</span>' : '<span class="text-rose-600 font-semibold">Деактивовано</span>'}</td>
                        <td class="p-3 text-slate-400">${u.created_at || '-'}</td>
                        <td class="p-3 text-right">
                            <button onclick="deleteUser('${u.id}')" class="text-rose-500 hover:text-rose-700 px-2 py-1"><i class="fa-regular fa-trash-can"></i></button>
                        </td>
                    </tr>
                `).join('');
            } catch (e) { console.error(e); }
        }

        // 11.1 Superadmin Platform Metrics & Traffic
        async function loadAdminMetrics() {
            try {
                const res = await fetch(`${API_BASE}/api/admin/metrics`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!res.ok) return;
                const m = await res.json();

                // High-level tiles
                document.getElementById('metricTotalVisits').textContent = (m.traffic?.total_visits || 0).toLocaleString();
                document.getElementById('metricVisits24h').textContent = (m.traffic?.visits_24h || 0).toLocaleString();
                document.getElementById('metricUniqueIps').textContent = (m.traffic?.distinct_ips || 0).toLocaleString();
                document.getElementById('metricTotalFarms').textContent = (m.farms?.total_farms || 0).toLocaleString();

                // Users breakdown
                document.getElementById('metricTotalUsersBadge').textContent = `${m.users?.total || 0} юзерів`;
                document.getElementById('metricSuperadmins').textContent = m.users?.superadmins || 0;
                document.getElementById('metricGuests').textContent = m.users?.guests || 0;
                document.getElementById('metricGoogleUsers').textContent = m.users?.with_google || 0;

                // Farms list
                const farmsEl = document.getElementById('metricsFarmsList');
                if (m.farms?.list) {
                    farmsEl.innerHTML = m.farms.list.map(f => `
                        <div class="flex justify-between items-center p-2 rounded-xl bg-slate-50 border border-slate-100">
                            <div>
                                <span class="font-bold text-slate-800">${f.name}</span>
                                <span class="text-[10px] text-slate-400 block font-mono">Код: ${f.code}</span>
                            </div>
                            <div class="text-right">
                                <span class="font-black text-emerald-600 text-xs">${f.cow_count} голів</span>
                                <span class="text-[10px] text-slate-400 block">${f.created_at}</span>
                            </div>
                        </div>
                    `).join('');
                }

                // Recent Visits
                const tbody = document.getElementById('metricsVisitsTableBody');
                if (m.traffic?.recent_visits && m.traffic.recent_visits.length > 0) {
                    tbody.innerHTML = m.traffic.recent_visits.map(v => `
                        <tr class="hover:bg-slate-50 border-b border-slate-100">
                            <td class="p-2.5 text-slate-500 whitespace-nowrap">${v.created_at}</td>
                            <td class="p-2.5 font-bold text-slate-800">${v.ip}</td>
                            <td class="p-2.5 text-slate-700">${v.user_email}</td>
                            <td class="p-2.5 text-indigo-600 font-semibold">${v.path}</td>
                            <td class="p-2.5 text-slate-500 text-[10px] truncate max-w-xs" title="${v.user_agent}">${v.user_agent}</td>
                        </tr>
                    `).join('');
                } else {
                    tbody.innerHTML = `<tr><td colspan="5" class="p-6 text-center text-slate-400">Візитів поки не зафіксовано</td></tr>`;
                }
            } catch (err) {
                console.warn("Failed to load admin metrics", err);
            }
        }

        function openAddUserModal() {
            document.getElementById('addUserModal').classList.remove('hidden');
        }

        async function submitNewUser(e) {
            e.preventDefault();
            const payload = {
                full_name: document.getElementById('newUserName').value,
                email: document.getElementById('newUserEmail').value,
                password: document.getElementById('newUserPassword').value || null,
                role: document.getElementById('newUserRole').value,
                google_sub: document.getElementById('newUserGoogleSub').value || null
            };

            try {
                const res = await fetch(`${API_BASE}/api/users`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify(payload)
                });
                if (!res.ok) throw new Error("Помилка створення користувача");
                showToast("Користувача додано!");
                closeModal('addUserModal');
                loadUsers();
            } catch (e) { showToast(e.message, "error"); }
        }

        async function deleteUser(id) {
            if (!confirm("Видалити цього користувача?")) return;
            try {
                const res = await fetch(`${API_BASE}/api/users/${id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!res.ok) throw new Error("Помилка видалення");
                showToast("Користувача видалено");
                loadUsers();
            } catch (e) { showToast(e.message, "error"); }
        }

        // 12. Uniform-Agri Import Flow
        let selectedFile = null;
        let pendingImportAfterAuth = false;

        function openImportModal() {
            // Data privacy guard: If user is in guest/demo mode, prompt Google Sign-In first
            const isGuest = !currentUser || currentUser.role === 'guest' || currentUser.id === 'demo-user-guest' || !token || token === 'demo_mode_token';
            if (isGuest) {
                pendingImportAfterAuth = true;
                document.getElementById('importAuthRequiredModal').classList.remove('hidden');
                return;
            }

            // Reset modal state
            document.getElementById('importModalErrorBox').classList.add('hidden');
            document.getElementById('importProgress').classList.add('hidden');
            document.getElementById('execImportBtn').disabled = false;
            document.getElementById('importModal').classList.remove('hidden');
        }

        function onImportModeChanged() {
            const mode = document.getElementById('importModeSelect')?.value || 'create_new';
            const diffBtn = document.getElementById('execDiffBtn');
            const importBtn = document.getElementById('execImportBtn');
            if (mode === 'create_new') {
                diffBtn?.classList.add('hidden');
                if (importBtn) importBtn.textContent = 'Імпортувати ферму';
            } else {
                diffBtn?.classList.remove('hidden');
                if (importBtn) importBtn.textContent = 'Оновити базу';
            }
        }

        function onFileSelected(input) {
            if (input.files && input.files[0]) {
                selectedFile = input.files[0];
                document.getElementById('fileChooseLabel').textContent = `Обрано: ${selectedFile.name} (${(selectedFile.size / 1024 / 1024).toFixed(2)} MB)`;
                document.getElementById('importModalErrorBox').classList.add('hidden');
            }
        }

        async function executeImportDiffPreview() {
            if (!selectedFile) {
                showImportModalError("Будь ласка, оберіть файл .FDB або .ZIP");
                return;
            }

            const btn = document.getElementById('execDiffBtn');
            const progress = document.getElementById('importProgress');
            btn.disabled = true;
            progress.classList.remove('hidden');
            document.getElementById('importModalErrorBox').classList.add('hidden');
            let uploadFile = selectedFile;
            if (uploadFile.name.toUpperCase().endsWith(".FDB") && typeof JSZip !== "undefined") {
                try {
                    const zip = new JSZip();
                    zip.file(uploadFile.name, uploadFile);
                    const zippedBlob = await zip.generateAsync({
                        type: "blob",
                        compression: "DEFLATE",
                        compressionOptions: { level: 6 }
                    });
                    const zipName = uploadFile.name.replace(/\.[^/.]+$/, "") + ".zip";
                    uploadFile = new File([zippedBlob], zipName, { type: "application/zip" });
                } catch (e) {}
            }

            const currentFarm = farmsList.find(f => f.is_current);
            const formData = new FormData();
            formData.append("file", uploadFile);
            if (currentFarm) formData.append("farm_id", currentFarm.id);
            formData.append("mode", "diff_check");

            try {
                const res = await fetch(`${API_BASE}/api/import/uniform`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` },
                    body: formData
                });
                const d = await res.json();
                if (!res.ok) throw new Error(d.detail || "Помилка аналізу файлу");

                const diff = d.diff;
                document.getElementById('diffAddedCount').textContent = `+${diff.added_count || 0}`;
                document.getElementById('diffModifiedCount').textContent = `Δ ${diff.modified_count || 0}`;
                document.getElementById('diffUnchangedCount').textContent = `= ${diff.unchanged_count || 0}`;
                document.getElementById('diffSubtitle').textContent = `Ферма: ${d.farm_name} • Файл: ${selectedFile.name} (Всього у файлі: ${diff.total_in_backup})`;

                const tb = document.getElementById('diffModifiedTableBody');
                if (!diff.sample_modified || diff.sample_modified.length === 0) {
                    tb.innerHTML = `<tr><td colspan="4" class="p-6 text-center text-slate-400 font-sans">Жодних конфліктів або розбіжностей не виявлено. Нові тварини додадуться автоматично.</td></tr>`;
                } else {
                    tb.innerHTML = diff.sample_modified.flatMap(m => {
                        return Object.entries(m.changes).map(([field, ch]) => `
                            <tr class="hover:bg-slate-50 border-b border-slate-100">
                                <td class="p-2.5 font-bold text-slate-900">${m.farm_number}</td>
                                <td class="p-2.5 font-semibold text-slate-700">${field}</td>
                                <td class="p-2.5 text-rose-600 font-medium">${ch.old || '-'}</td>
                                <td class="p-2.5 text-emerald-600 font-medium">${ch.new || '-'}</td>
                            </tr>
                        `);
                    }).join('');
                }

                document.getElementById('diffPreviewModal').classList.remove('hidden');

            } catch (err) {
                showImportModalError(err.message);
            } finally {
                btn.disabled = false;
                progress.classList.add('hidden');
                document.getElementById('importStatusText').textContent = "Обробка файлу...";
            }
        }

        function showImportModalError(msg) {
            const errBox = document.getElementById('importModalErrorBox');
            const errMsg = document.getElementById('importModalErrorMsg');
            if (errBox && errMsg) {
                errMsg.textContent = msg;
                errBox.classList.remove('hidden');
            } else {
                showToast(msg, "error");
            }
        }

        async function confirmMergeFromDiff() {
            closeModal('diffPreviewModal');
            executeImport('merge');
        }

        async function executeImport(forceMode = null) {
            if (!selectedFile) {
                showImportModalError("Будь ласка, спочатку оберіть файл .FDB або .ZIP для імпорту");
                return;
            }

            const btn = document.getElementById('execImportBtn');
            const progress = document.getElementById('importProgress');
            const statusText = document.getElementById('importStatusText');
            const percentText = document.getElementById('importPercentText');
            const progressBar = document.getElementById('importProgressBar');
            const stageText = document.getElementById('importStageDetailText');

            btn.disabled = true;
            progress.classList.remove('hidden');
            document.getElementById('importModalErrorBox').classList.add('hidden');

            const setStage = (mainTitle, detail) => {
                if (statusText) statusText.textContent = mainTitle;
                if (stageText) stageText.textContent = detail;
            };

            if (percentText) percentText.textContent = "";
            if (progressBar) {
                progressBar.style.width = "100%";
                progressBar.classList.add("animate-pulse");
            }

            let uploadFile = selectedFile;
            if (uploadFile.name.toUpperCase().endsWith(".FDB")) {
                setStage("Стиснення бази...", `Оптимізація файлу (${(uploadFile.size / 1024 / 1024).toFixed(1)} MB)...`);
                try {
                    let zippedBlob = null;
                    const zipName = uploadFile.name.replace(/\.[^/.]+$/, "") + ".zip";

                    // Engine 1: High-speed multithreaded fflate
                    if (typeof fflate !== "undefined" && fflate.zip) {
                        const arrayBuffer = await uploadFile.arrayBuffer();
                        const uint8 = new Uint8Array(arrayBuffer);
                        const zipData = {};
                        zipData[uploadFile.name] = uint8;
                        
                        const result = await new Promise((resolve, reject) => {
                            fflate.zip(zipData, { level: 6 }, (err, out) => {
                                if (err) reject(err);
                                else resolve(out);
                            });
                        });
                        zippedBlob = new Blob([result], { type: "application/zip" });
                    } 
                    // Engine 2: JSZip fallback
                    else if (typeof JSZip !== "undefined") {
                        const zip = new JSZip();
                        zip.file(uploadFile.name, uploadFile);
                        zippedBlob = await zip.generateAsync({
                            type: "blob",
                            compression: "DEFLATE",
                            compressionOptions: { level: 6 }
                        });
                    }

                    if (zippedBlob) {
                        uploadFile = new File([zippedBlob], zipName, { type: "application/zip" });
                        console.log(`[Client Compress] Успішно стиснуто: ${(selectedFile.size/1024/1024).toFixed(1)}MB -> ${(uploadFile.size/1024/1024).toFixed(1)}MB`);
                    }
                } catch (zipErr) {
                    console.error("[Client Compress Error]", zipErr);
                    // Do not fail silently - inform user if compression failed
                    showImportModalError(`Помилка стиснення файлу в браузері: ${zipErr.message}. Спробуйте завантажити архів .ZIP.`);
                    btn.disabled = false;
                    return;
                }
            }

            setStage("Обробка файлу...", "Відправка та аналіз бази на сервері парсингу...");

            const mode = forceMode || document.getElementById('importModeSelect')?.value || 'create_new';
            const currentFarm = farmsList.find(f => f.is_current);

            const formData = new FormData();
            formData.append("file", uploadFile);
            formData.append("mode", mode);
            if (currentUser?.email) formData.append("user_email", currentUser.email);
            if (currentFarm && mode === 'merge') formData.append("farm_id", currentFarm.id);

            try {
                const res = await fetch(`${API_BASE}/api/import/uniform`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` },
                    body: formData
                });

                let d;
                const contentType = res.headers.get("content-type");
                if (contentType && contentType.includes("application/json")) {
                    d = await res.json();
                } else {
                    const text = await res.text();
                    d = { detail: text || `HTTP ${res.status}` };
                }

                if (!res.ok) {
                    throw new Error(d.detail || d.message || `Помилка сервера (HTTP ${res.status})`);
                }

                setStage("Успішно завершено!", "Дані ферми збережено та верифіковано.");
                showToast(d.message || "Базу успішно імпортовано!");
                setTimeout(() => closeModal('importModal'), 600);
                
                await loadFarms();
                if (d.farm_id) onFarmDropdownChange(d.farm_id);
            } catch (err) {
                showImportModalError(err.message);
            } finally {
                btn.disabled = false;
                progress.classList.add('hidden');
                if (progressBar) progressBar.classList.remove("animate-pulse");
                if (statusText) statusText.textContent = "Обробка файлу...";
            }
        }


        // Universal Modal Closer & Helpers
        function closeModal(modalId) {
            const m = document.getElementById(modalId);
            if (m) m.classList.add('hidden');
        }

        // Close modals on Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                document.querySelectorAll('.fixed:not(.hidden)').forEach(modal => {
                    modal.classList.add('hidden');
                });
            }
        });

        // 13. Herd Event Grid & Matrix Loader
        async function loadEventGrid() {
            const tbody = document.getElementById('gridTableBody');
            tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-slate-400">Завантаження гріда подій...</td></tr>`;
            try {
                const filterVal = document.getElementById('gridWindowFilter')?.value || '14';
                const cat = document.getElementById('gridCatFilter')?.value || 'ALL';
                
                let url = `${API_BASE}/api/dashboard/event-grid?filter_type=${cat}&limit=300`;
                if (filterVal.startsWith('year-')) {
                    const yr = filterVal.split('-')[1];
                    url += `&year=${yr}`;
                } else if (filterVal === 'all') {
                    url += `&days=0&limit=500`;
                } else {
                    url += `&days=${filterVal}`;
                }

                const res = await fetch(url, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                const d = await res.json();
                let events = d.events || [];
                if (cat !== 'ALL') {
                    events = events.filter(e => e.category === cat);
                }

                if (events.length === 0) {
                    tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-slate-400">У обраному фільтрі подій не знайдено. Спробуйте обрати «Вся історія стада» або інший часовий інтервал.</td></tr>`;
                    return;
                }


                tbody.innerHTML = events.map(e => {
                    let catBadge = '';
                    if (e.category === 'CALVING_PLAN') catBadge = '<span class="bg-amber-100 text-amber-800 font-semibold px-2 py-0.5 rounded text-[10px]">Плановий отел</span>';
                    else if (e.category === 'HEALTH') catBadge = '<span class="bg-rose-100 text-rose-800 font-semibold px-2 py-0.5 rounded text-[10px]">Каренція / Лікування</span>';
                    else if (e.category === 'REPRODUCTION') catBadge = '<span class="bg-indigo-100 text-indigo-800 font-semibold px-2 py-0.5 rounded text-[10px]">Відтворення</span>';
                    
                    let statusBadge = '';
                    if (e.status === 'ACTIVE_WITHHOLDING') statusBadge = '<span class="bg-rose-50 text-rose-700 border border-rose-200 font-bold px-2 py-0.5 rounded text-[10px] animate-pulse">БРАКЕРАЖ МОЛОКА</span>';
                    else if (e.status === 'DUE_SOON') statusBadge = '<span class="bg-amber-50 text-amber-700 border border-amber-200 font-bold px-2 py-0.5 rounded text-[10px]">Очікується отел</span>';
                    else if (e.status === 'OVERDUE') statusBadge = '<span class="bg-red-50 text-red-700 border border-red-200 font-bold px-2 py-0.5 rounded text-[10px]">Прострочено</span>';
                    else statusBadge = '<span class="bg-slate-100 text-slate-600 font-medium px-2 py-0.5 rounded text-[10px]">Виконано</span>';

                    const dateDisplay = e.start_date || e.event_date || '-';
                    const titleDisplay = e.title || e.event_title || e.event_type || 'Подія';
                    const detailsDisplay = e.details || e.event_status || '-';

                    return `
                        <tr class="hover:bg-slate-50/80 transition">
                            <td class="p-3 font-bold text-slate-900">${dateDisplay}</td>
                            <td class="p-3 font-extrabold text-emerald-700">${e.farm_number || '-'}</td>
                            <td class="p-3 text-slate-500 font-mono">${e.official_tag || '-'}</td>
                            <td class="p-3">${catBadge}</td>
                            <td class="p-3">
                                <div class="font-bold text-slate-900">${titleDisplay}</div>
                                <div class="text-[11px] text-slate-500">${detailsDisplay}</div>
                            </td>
                            <td class="p-3">${statusBadge}</td>
                            <td class="p-3 text-right">
                                <button onclick="openCow360('${e.animal_id}')" class="text-emerald-600 hover:text-emerald-800 font-semibold text-xs bg-emerald-50 hover:bg-emerald-100 px-2 py-1 rounded-lg">360°</button>
                            </td>
                        </tr>
                    `;
                }).join('');
            } catch (err) {
                tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-rose-500">Помилка завантаження гріда: ${err.message}</td></tr>`;
            }
        }

        // 14. Medications Catalog Loader
        async function loadMedsCatalog() {
            const tbody = document.getElementById('medsCatalogTableBody');
            tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-slate-400">Завантаження медикаментів...</td></tr>`;
            try {
                const res = await fetch(`${API_BASE}/api/medications`);
                const meds = await res.json();
                if (meds.length === 0) {
                    tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-slate-400">Аптечка порожня. Додайте перший препарат.</td></tr>`;
                    return;
                }

                tbody.innerHTML = meds.map(m => {
                    let expiryBadge = '<span class="text-slate-500">Не вказано</span>';
                    if (m.expiration_date) {
                        if (m.status_expiry === 'EXPIRED') {
                            expiryBadge = `<span class="bg-rose-100 text-rose-800 font-bold px-2 py-0.5 rounded text-[10px]">ПРОСТРОЧЕНО (${m.expiration_date})</span>`;
                        } else if (m.status_expiry === 'EXPIRING_SOON') {
                            expiryBadge = `<span class="bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded text-[10px]">Спливає (${m.days_to_expire} дн. / ${m.expiration_date})</span>`;
                        } else {
                            expiryBadge = `<span class="text-emerald-700 font-medium">${m.expiration_date}</span>`;
                        }
                    }

                    return `
                        <tr class="hover:bg-slate-50 transition border-b border-slate-100">
                            <td class="p-3">
                                <span class="font-bold text-slate-900">${m.name}</span>
                                ${m.instructions ? `<p class="text-[10px] text-slate-400 mt-0.5">${m.instructions}</p>` : ''}
                            </td>
                            <td class="p-3 text-slate-600">
                                <div>${m.active_substance || '-'}</div>
                                <div class="text-[10px] text-slate-400 font-mono">Партія: ${m.batch_number || '-'}</div>
                            </td>
                            <td class="p-3">${expiryBadge}</td>
                            <td class="p-3 font-bold text-slate-800">${m.stock_quantity} ${m.unit}</td>
                            <td class="p-3 text-rose-600 font-bold">${(m.milk_days != null && !isNaN(m.milk_days)) ? (m.milk_days > 0 ? m.milk_days + ' дн.' : '0 дн. (вільно)') : 'Не вказано'}</td>
                            <td class="p-3 text-slate-600 font-medium">${(m.meat_days != null && !isNaN(m.meat_days)) ? (m.meat_days > 0 ? m.meat_days + ' дн.' : '0 дн. (вільно)') : 'Не вказано'}</td>
                            <td class="p-3 text-right">
                                <button onclick="deleteMedication('${m.id}')" class="text-rose-500 hover:text-rose-700 px-2 py-1"><i class="fa-regular fa-trash-can"></i></button>
                            </td>
                        </tr>
                    `;
                }).join('');
            } catch (err) {
                tbody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-rose-500">Помилка завантаження: ${err.message}</td></tr>`;
            }
        }

        function openAddMedModal() {
            document.getElementById('addMedModal').classList.remove('hidden');
        }

        async function submitNewMedication(e) {
            e.preventDefault();
            const payload = {
                name: document.getElementById('newMedName').value,
                active_substance: document.getElementById('newMedSubstance').value || null,
                batch_number: document.getElementById('newMedBatch').value || null,
                expiration_date: document.getElementById('newMedExp').value || null,
                stock_quantity: parseFloat(document.getElementById('newMedStock').value) || 0,
                unit: document.getElementById('newMedUnit').value || "дози",
                default_milk_withdrawal_days: parseInt(document.getElementById('newMedMilk').value) || 0,
                default_meat_withdrawal_days: parseInt(document.getElementById('newMedMeat').value) || 0,
                instructions: document.getElementById('newMedInstructions').value || null
            };

            try {
                const res = await fetch(`${API_BASE}/api/medications`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify(payload)
                });
                if (!res.ok) throw new Error("Помилка додавання препарату");
                showToast("Препарат додано в аптечку!");
                closeModal('addMedModal');
                loadMedsCatalog();
                loadMedications();
            } catch (err) { showToast(err.message, "error"); }
        }

        async function deleteMedication(id) {
            if (!confirm("Видалити цей препарат з аптечки?")) return;
            try {
                const res = await fetch(`${API_BASE}/api/medications/${id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!res.ok) throw new Error("Помилка видалення");
                showToast("Препарат видалено");
                loadMedsCatalog();
                loadMedications();
            } catch (err) { showToast(err.message, "error"); }
        }

        // 15. Backup Downloader (Cross-Platform iOS Safari, Android & Desktop)
        async function downloadBackup() {
            try {
                showToast("Генерується резервна копія бази...");
                const farmId = (window.store && window.store.currentFarmId) || localStorage.getItem("dairy_farm_id") || "";
                const query = farmId ? `?farm_id=${encodeURIComponent(farmId)}` : "";
                const res = await fetch(`${API_BASE}/api/system/backup${query}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (!res.ok) throw new Error("Помилка вивантаження бекапу");
                const blob = await res.blob();
                const filename = `dairy_farm_backup_${new Date().toISOString().split('T')[0]}.json`;

                // Mobile iOS / Android: Native Share Sheet (Save to Files, Telegram, AirDrop)
                if (typeof navigator !== 'undefined' && navigator.canShare) {
                    try {
                        const file = new File([blob], filename, { type: 'application/json' });
                        if (navigator.canShare({ files: [file] })) {
                            await navigator.share({
                                files: [file],
                                title: 'Резервна копія DairyERP',
                                text: `Резервна копія бази даних ферми (${new Date().toLocaleDateString()})`
                            });
                            showToast("Резервну копію збережено!");
                            return;
                        }
                    } catch (shareErr) {
                        if (shareErr.name === 'AbortError') return; // User simply closed the share sheet
                        console.warn("[Backup Share Fallback]", shareErr);
                    }
                }

                // Desktop / Browser Standard Download
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                    a.remove();
                    window.URL.revokeObjectURL(url);
                }, 1000);
                showToast("Резервну копію успішно завантажено!");
            } catch (err) {
                showToast(err.message, "error");
            }
        }

        // 16. Modular Localization (src/locales/i18n.js)
        function setLanguage(lang) {
            if (window.setLanguage) {
                window.setLanguage(lang);
            }
        }

        // Bootstrap
        document.addEventListener('DOMContentLoaded', () => {
            const urlParams = new URLSearchParams(window.location.search);
            const paramLang = urlParams.get('lang');
            if (paramLang && (paramLang.toLowerCase() === 'en' || paramLang.toLowerCase() === 'uk')) {
                setLanguage(paramLang.toLowerCase());
            } else {
                const savedLang = localStorage.getItem("dairy_lang");
                if (savedLang) {
                    setLanguage(savedLang);
                } else {
                    const browserLang = (navigator.languages && navigator.languages[0]) || navigator.language || 'uk';
                    const autoLang = browserLang.toLowerCase().startsWith('uk') ? 'uk' : 'en';
                    setLanguage(autoLang);
                }
            }

            // Enable demo view if ?demo=1 or ?mode=demo is passed in URL
            if (urlParams.get('demo') === '1' || urlParams.get('mode') === 'demo') {
                if (!localStorage.getItem("dairy_token")) {
                    token = "demo_mode_token";
                    localStorage.setItem("dairy_token", token);
                }
            }

            // Register PWA Service Worker (with automatic update check)
            if ('serviceWorker' in navigator) {
                window.addEventListener('load', () => {
                    navigator.serviceWorker.register('/sw.js').then((registration) => {
                        console.log('[PWA] Service Worker registered successfully:', registration.scope);
                        // Trigger immediate check for new version on server
                        registration.update();
                    }).catch((error) => {
                        console.warn('[PWA] Service Worker registration failed:', error);
                    });
                });
            }

            // Hide Install App button if already running as installed standalone PWA
            const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
            if (isStandalone) {
                const headerInstall = document.getElementById('headerInstallBtn');
                if (headerInstall) headerInstall.classList.add('hidden');
            }

            // Capture install prompt for PWA installation button
            window.addEventListener('beforeinstallprompt', (e) => {
                e.preventDefault();
                window.deferredPrompt = e;
                const installBtn = document.getElementById('modalInstallActionBtn');
                if (installBtn) installBtn.classList.remove('hidden');
            });

            // Initialize Network and Offline Outbox listeners
            setupNetworkSyncListeners();

            checkAppInit();
        });

        // --- Offline Outbox & Network Sync Architecture ---
        function getOfflineQueue() {
            try {
                return JSON.parse(localStorage.getItem('dairy_offline_queue') || '[]');
            } catch (e) {
                return [];
            }
        }

        function saveOfflineQueue(queue) {
            localStorage.setItem('dairy_offline_queue', JSON.stringify(queue));
            updateNetworkStatusUI();
        }

        function updateNetworkStatusUI() {
            const statusPill = document.getElementById('headerNetworkStatus');
            const dot = document.getElementById('networkStatusDot');
            const txt = document.getElementById('networkStatusText');
            const badge = document.getElementById('offlineOutboxBadge');
            const queue = getOfflineQueue();
            const isOnline = navigator.onLine;

            if (!statusPill) return;

            if (isOnline) {
                if (queue.length > 0) {
                    statusPill.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 transition cursor-pointer';
                    dot.className = 'w-2 h-2 rounded-full bg-amber-500 animate-pulse';
                    txt.textContent = 'Синхронізація';
                    badge.classList.remove('hidden');
                    badge.textContent = queue.length;
                    statusPill.title = `Є ${queue.length} невідправлених записів. Натисніть для примусової відправки`;
                    statusPill.onclick = flushOfflineQueue;
                } else {
                    // Fully connected & idle - hide pill to keep header completely quiet and eliminate visual noise
                    statusPill.className = 'hidden items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold transition';
                    badge.classList.add('hidden');
                    statusPill.onclick = null;
                }
            } else {
                statusPill.className = 'flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold bg-amber-100 text-amber-900 border border-amber-300 transition';
                dot.className = 'w-2 h-2 rounded-full bg-amber-600';
                txt.textContent = 'Офлайн (Корівник)';
                if (queue.length > 0) {
                    badge.classList.remove('hidden');
                    badge.textContent = queue.length;
                } else {
                    badge.classList.add('hidden');
                }
                statusPill.title = 'Немає зв’язку. Дані надійно зберігаються на пристрої';
                statusPill.onclick = null;
            }
        }

        function setupNetworkSyncListeners() {
            window.addEventListener('online', () => {
                showToast('Зв’язок відновлено! Перевірка черги синхронізації...', 'info');
                updateNetworkStatusUI();
                flushOfflineQueue();
            });

            window.addEventListener('offline', () => {
                showToast('Зв’язок відсутній. Увімкнено офлайн-режим збереження 💾', 'warning');
                updateNetworkStatusUI();
            });

            updateNetworkStatusUI();
        }

        async function flushOfflineQueue() {
            const queue = getOfflineQueue();
            if (queue.length === 0 || !navigator.onLine) return;

            let sentCount = 0;
            const remaining = [];

            for (const item of queue) {
                try {
                    const res = await fetch(item.url, {
                        method: item.method || 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify(item.payload)
                    });
                    if (res.ok) {
                        sentCount++;
                    } else if (res.status >= 400 && res.status < 500) {
                        // Client error (e.g. invalid cow ID) - log and do not loop endlessly
                        console.warn('[Offline Queue] Discarding invalid request:', item, res.status);
                    } else {
                        // Server temporary error (500/503), retain in queue
                        remaining.push(item);
                    }
                } catch (err) {
                    remaining.push(item);
                }
            }

            saveOfflineQueue(remaining);

            if (sentCount > 0) {
                showToast(`Синхронізовано з хмарою: ${sentCount} записів! 🚀`, 'success');
                // Refresh current tab data
                if (typeof loadAnimals === 'function' && currentTab === 'animals') loadAnimals();
                if (typeof loadStats === 'function') loadStats();
            }
        }

        // Wrapper function for mutations: executes immediately or enqueues if offline
        async function sendOrQueueMutation(url, method, payload, successMessage) {
            if (!navigator.onLine) {
                const queue = getOfflineQueue();
                queue.push({
                    id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
                    url,
                    method,
                    payload,
                    timestamp: new Date().toISOString()
                });
                saveOfflineQueue(queue);
                showToast(`Збережено на телефоні 💾 (буде передано автоматично при появі зв'язку)`, 'warning');
                return { success: true, offline: true };
            }

            try {
                const res = await fetch(url, {
                    method: method || 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(payload)
                });
                const data = await res.json().catch(() => ({}));
                if (res.ok) {
                    showToast(successMessage || 'Дію успішно збережено в хмарі ✓', 'success');
                    return { success: true, data };
                } else {
                    showToast(data.detail || data.error || 'Помилка збереження даних', 'error');
                    return { success: false, data };
                }
            } catch (err) {
                // Network dropped mid-request: save to offline queue
                const queue = getOfflineQueue();
                queue.push({
                    id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
                    url,
                    method,
                    payload,
                    timestamp: new Date().toISOString()
                });
                saveOfflineQueue(queue);
                showToast(`Зв'язок перервано. Запис збережено на телефоні 💾`, 'warning');
                return { success: true, offline: true };
            }
        }

        async function openOutboxModal() {
            if (window.getOutboxItems) {
                store.outboxItems = await window.getOutboxItems();
            }
            document.getElementById('outboxModal')?.classList.remove('hidden');
        }

        async function triggerOutboxSyncNow() {
            if (window.flushOfflineOutbox) {
                await window.flushOfflineOutbox();
                if (window.getOutboxItems) {
                    store.outboxItems = await window.getOutboxItems();
                }
            }
        }

        function openProfileModal() {
            if (currentUser) {
                const nameEl = document.getElementById('profileUserName');
                const roleEl = document.getElementById('profileUserRole');
                const emailEl = document.getElementById('profileUserEmail');
                const emailSubEl = document.getElementById('profileUserEmailSubtitle');

                if (nameEl) nameEl.textContent = currentUser.full_name || 'Оператор ферми';
                if (roleEl) roleEl.textContent = currentUser.role || 'farmer';
                if (emailEl) emailEl.textContent = currentUser.email || '—';
                if (emailSubEl) emailSubEl.textContent = currentUser.email || '';
            }
            document.getElementById('profileModal')?.classList.remove('hidden');
        }

        function openInstallModal() {
            const currentUrl = window.location.origin || window.location.href;
            const qrImg = document.getElementById('installModalQrImg');
            const urlText = document.getElementById('installModalUrlText');
            if (qrImg) {
                // QR code generator using standard high-speed SVG/PNG API
                qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(currentUrl)}`;
            }
            if (urlText) {
                urlText.textContent = currentUrl.replace(/^https?:\/\//, '');
            }
            document.getElementById('installModal').classList.remove('hidden');
        }

        async function triggerPwaInstall() {
            if (window.deferredPrompt) {
                window.deferredPrompt.prompt();
                const choice = await window.deferredPrompt.userChoice;
                if (choice.outcome === 'accepted') {
                    showToast('Додаток успішно встановлено!', 'success');
                }
                window.deferredPrompt = null;
                const installBtn = document.getElementById('modalInstallActionBtn');
                if (installBtn) installBtn.classList.add('hidden');
                closeModal('installModal');
            } else {
                showToast('Дотримуйтесь інструкцій для вашого браузера нижче', 'info');
            }
        }
        // SMART AUTO-REFRESH & MOBILE PULL-TO-REFRESH
        (function initAutoRefreshAndPullToRefresh() {
            // 1. Smart Focus Revalidate (коли повертаються у вкладку або розблоковують телефон)
            const REVALIDATE_INTERVAL_MS = 60 * 1000; // 60 секунд
            function handleWindowFocusOrVisible() {
                if (document.visibilityState === 'visible' && token) {
                    const elapsed = Date.now() - lastAutoRefreshTime;
                    if (elapsed >= REVALIDATE_INTERVAL_MS) {
                        refreshDashboardData(false);
                    }
                }
            }
            window.addEventListener('focus', handleWindowFocusOrVisible);
            document.addEventListener('visibilitychange', handleWindowFocusOrVisible);

            // 2. Mobile Touch Pull-to-Refresh Implementation
            let touchStartY = 0;
            let touchCurrentY = 0;
            let isPulling = false;
            const PULL_THRESHOLD = 75; // px

            const ptrIndicator = document.getElementById('pullToRefreshIndicator');
            const ptrIcon = document.getElementById('ptrIcon');
            const ptrText = document.getElementById('ptrText');

            window.addEventListener('touchstart', (e) => {
                // Тільки якщо ми на самому верху сторінки і немає відкритих модалок
                const hasOpenModal = document.querySelector('.fixed.inset-0:not(.hidden)');
                if (window.scrollY <= 2 && !hasOpenModal && e.touches.length === 1) {
                    touchStartY = e.touches[0].clientY;
                    isPulling = false;
                } else {
                    touchStartY = 0;
                }
            }, { passive: true });

            window.addEventListener('touchmove', (e) => {
                if (!touchStartY || e.touches.length !== 1) return;
                touchCurrentY = e.touches[0].clientY;
                const pullDistance = touchCurrentY - touchStartY;

                if (pullDistance > 10 && window.scrollY <= 2) {
                    isPulling = true;
                    if (ptrIndicator) {
                        const progress = Math.min(pullDistance / PULL_THRESHOLD, 1.5);
                        const translateY = Math.min(pullDistance * 0.45, 45);
                        ptrIndicator.style.transform = `translate(-50%, ${translateY}px)`;
                        ptrIndicator.style.opacity = `${Math.min(progress, 1)}`;

                        if (pullDistance >= PULL_THRESHOLD) {
                            if (ptrIcon) ptrIcon.style.transform = 'rotate(180deg)';
                            if (ptrText) ptrText.textContent = 'Відпустіть для оновлення';
                        } else {
                            if (ptrIcon) ptrIcon.style.transform = `rotate(${pullDistance * 2}deg)`;
                            if (ptrText) ptrText.textContent = 'Потягніть для оновлення...';
                        }
                    }
                }
            }, { passive: true });

            window.addEventListener('touchend', async () => {
                if (!isPulling || !touchStartY) {
                    touchStartY = 0;
                    return;
                }
                const pullDistance = touchCurrentY - touchStartY;
                touchStartY = 0;
                isPulling = false;

                if (pullDistance >= PULL_THRESHOLD) {
                    if (ptrIndicator) {
                        ptrIndicator.style.transform = 'translate(-50%, 25px)';
                        ptrIndicator.style.opacity = '1';
                    }
                    if (ptrIcon) {
                        ptrIcon.classList.add('fa-spin');
                        ptrIcon.style.transform = '';
                    }
                    if (ptrText) ptrText.textContent = 'Оновлення даних ферми...';

                    await refreshDashboardData(true);

                    setTimeout(() => {
                        if (ptrIndicator) {
                            ptrIndicator.style.transform = 'translate(-50%, -64px)';
                            ptrIndicator.style.opacity = '0';
                        }
                        if (ptrIcon) ptrIcon.classList.remove('fa-spin');
                    }, 400);
                } else {
                    // Скасування жесту
                    if (ptrIndicator) {
                        ptrIndicator.style.transform = 'translate(-50%, -64px)';
                        ptrIndicator.style.opacity = '0';
                    }
                }
            }, { passive: true });
        })();
