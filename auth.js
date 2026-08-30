/* =====================================================================
   AUTH.JS -- Version 3.1
   Login/logout, session storage, the login effort-snapshot modal, and
   the "Logged in as" topbar identity. Replaces the old hardcoded-USERS
   check that used to live in script.js's login()/logout() -- those two
   functions were removed from script.js; this file is where login()
   and logout() are now defined.

   No credential of any kind lives in this file. sessionStorage holds
   only the opaque session token Apps Script issued, plus the
   non-sensitive display identity (adminName / adminEmail / role /
   sessionId) that came back alongside it. sessionId is a SEPARATE,
   non-secret audit-correlation id (see Auth.gs) -- it is not the
   authentication credential and is safe to keep in sessionStorage
   for potential UI/debugging use, unlike sessionToken.

   Depends on: common.js (Utils), api.js (loginRequest / logoutRequest /
   getAdminEffortSummary). script.js's loadData() is called from here,
   at the end of the login flow, exactly where script.js's old login()
   used to call it directly.
===================================================================== */

const SESSION_STORAGE_KEY = 'kcjSession';

/* -----------------------------------------------------------------------
   SESSION STORAGE
----------------------------------------------------------------------- */

// { sessionToken, adminName, adminEmail, role } or null.
function getSession() {
    try {
        const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (err) {
        return null;
    }
}

// Read by api.js's callGas() on every request -- see api.js.
function getSessionToken() {
    const session = getSession();
    return session ? session.sessionToken : null;
}

function setSession(session) {
    try {
        sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
    } catch (err) {
        console.error('[KCJ auth.js] Could not persist session:', err);
    }
}

function clearSession() {
    try {
        sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch (err) {
        // Nothing further to do -- worst case the stale entry lingers
        // until the tab closes (sessionStorage, not localStorage).
    }
}

/* -----------------------------------------------------------------------
   VIEW SWITCHING (login page <-> app container)
   Mirrors exactly what script.js's old login()/logout() used to toggle
   directly -- same two elements, same display values.
----------------------------------------------------------------------- */

function showLoginScreen() {
    const loginPage = document.getElementById('loginPage');
    const appContainer = document.getElementById('appContainer');
    if (loginPage) loginPage.style.display = 'block';
    if (appContainer) appContainer.style.display = 'none';

    const passwordEl = document.getElementById('password');
    if (passwordEl) passwordEl.value = '';
}

function showAppContainer() {
    const loginPage = document.getElementById('loginPage');
    const appContainer = document.getElementById('appContainer');
    if (loginPage) loginPage.style.display = 'none';
    if (appContainer) appContainer.style.display = 'block';
}

// Called by api.js's callGas() the moment ANY authenticated call comes
// back with { authenticated:false } -- e.g. the session expired mid-use,
// not just at login time. Global on purpose: api.js has no UI of its
// own to fall back to, and this is the one place that owns "what does
// the app look like when there's no valid session."
function handleSessionExpired(message) {
    clearSession();
    showLoginScreen();
    renderAdminIdentity();
    Utils.showToast(message || 'Your session has expired. Please login again.', false);
}

// "Logged in as: NAME" in the topbar (see index.html, #adminIdentity).
// Cleared when there's no session so a stale name never lingers after
// logout/expiry.
function renderAdminIdentity() {
    const el = document.getElementById('adminIdentity');
    if (!el) return;

    const session = getSession();
    if (!session) {
        el.innerHTML = '';
        return;
    }

    el.innerHTML = `Logged in as: <strong>${Utils.escapeHtml(session.adminName || session.username || '')}</strong>`;
}

/* -----------------------------------------------------------------------
   LOGIN
----------------------------------------------------------------------- */

async function login() {
    const usernameEl = document.getElementById('username');
    const passwordEl = document.getElementById('password');
    const u = usernameEl ? usernameEl.value : '';
    const p = passwordEl ? passwordEl.value : '';

    if (!Utils.safeTrim(u) || !Utils.safeTrim(p)) {
        Utils.showToast('Please enter both username and password.', false);
        return;
    }

    const loginBtn = document.getElementById('loginBtn');
    if (loginBtn) loginBtn.disabled = true;

    try {
        const data = await loginRequest(u, p);

        setSession({
            sessionToken: data.sessionToken,
            sessionId: data.sessionId,
            adminName: data.adminName,
            adminEmail: data.adminEmail,
            role: data.role
        });

        if (passwordEl) passwordEl.value = '';

        await showEffortSnapshotAndContinue();

    } catch (err) {
        console.error('[KCJ auth.js] login failed:', err);
        Utils.showToast(err.message || 'Invalid username or password.', false);
    } finally {
        if (loginBtn) loginBtn.disabled = false;
    }
}

/* -----------------------------------------------------------------------
   LOGIN EFFORT SNAPSHOT (Enhancement: "Your HO Approval Performance")
----------------------------------------------------------------------- */

async function showEffortSnapshotAndContinue() {
    const session = getSession();
    const modalEl = document.getElementById('effortSnapshotModal');
    const bodyEl = document.getElementById('effortSnapshotBody');
    const titleEl = document.getElementById('effortSnapshotTitle');

    // No modal markup, or Bootstrap failed to load -- don't let a
    // missing UI element block getting into the app.
    if (!modalEl || typeof bootstrap === 'undefined') {
        continueToApp();
        return;
    }

    if (titleEl) {
        titleEl.innerText = `Welcome, ${session && session.adminName ? session.adminName : ''}`;
    }

    if (bodyEl) {
        bodyEl.innerHTML = `
            <div class="text-center py-4">
                <span class="spinner-border spinner-border-sm text-success"></span>
                <div class="text-muted small mt-2">Loading your approval history...</div>
            </div>
        `;
    }

    const modal = new bootstrap.Modal(modalEl, { backdrop: 'static', keyboard: false });
    modal.show();

    try {
        const summary = await getAdminEffortSummary();
        renderEffortSnapshotBody(bodyEl, summary);
    } catch (err) {
        console.error('[KCJ auth.js] getAdminEffortSummary failed:', err);
        if (bodyEl) {
            bodyEl.innerHTML = `
                <div class="alert alert-warning mb-0">
                    Your login was successful, but your approval summary could not be loaded.
                </div>
            `;
        }
    }

    const okBtn = document.getElementById('effortSnapshotOkBtn');
    if (okBtn) {
        okBtn.onclick = () => {
            modal.hide();
            continueToApp();
        };
    }
}

// Till-date cumulative counts only -- no rate, no ranking, no date
// segmentation, per spec.
function renderEffortSnapshotBody(bodyEl, summary) {
    if (!bodyEl) return;
    const s = summary || { totalResolved: 0, approved: 0, rejected: 0, couponsGenerated: 0 };

    bodyEl.innerHTML = `
        <div class="text-center mb-3">
            <div class="text-muted small text-uppercase">Your HO Approval Performance</div>
            <div class="text-muted small">Till Date</div>
        </div>
        <div class="text-center mb-3">
            <div class="display-5 fw-bold text-success">${s.totalResolved}</div>
            <div class="text-muted small">Total Claims Resolved</div>
        </div>
        <div class="d-flex justify-content-center gap-5 mb-3">
            <div class="text-center">
                <div class="fs-4 fw-bold text-success">${s.approved}</div>
                <div class="text-muted small">Approved</div>
            </div>
            <div class="text-center">
                <div class="fs-4 fw-bold text-danger">${s.rejected}</div>
                <div class="text-muted small">Rejected</div>
            </div>
        </div>
        <div class="text-center">
            <div class="fs-4 fw-bold">${s.couponsGenerated}</div>
            <div class="text-muted small">Coupons Generated</div>
        </div>
    `;
}

function continueToApp() {
    showAppContainer();
    renderAdminIdentity();
    if (typeof loadData === 'function') loadData();
}

/* -----------------------------------------------------------------------
   LOGOUT
----------------------------------------------------------------------- */

async function logout() {
    try {
        // Best-effort -- logout is a public action server-side (see
        // Code.gs), so this always "succeeds" even against an
        // already-dead token. Still awaited so the server-side session
        // is actually invalidated before we move on, not left to expire
        // 30 minutes later on its own.
        await logoutRequest();
    } catch (err) {
        console.warn('[KCJ auth.js] logout call failed (continuing anyway):', err);
    } finally {
        clearSession();
        location.reload();
    }
}
