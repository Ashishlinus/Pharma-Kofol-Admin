/* =====================================================================
   API.JS -- Version 3.0 / 3.1
   Prior to Version 3.0, this file called the Airtable REST API directly
   from the browser (fetch("https://api.airtable.com/...") with the PAT
   in an Authorization header). As of Version 3.0, the browser no longer
   holds any Airtable credentials at all -- every one of those calls now
   goes to a single Google Apps Script Web App (CONFIG.GAS_WEBAPP_URL),
   which holds the real Airtable PAT/Base IDs/Table/View names and talks
   to Airtable on the portal's behalf.

   As of Version 3.1, every request also carries an opaque session
   token (see auth.js) -- callGas() attaches it automatically so no
   individual call site (including this file's own functions, and
   approval.js) has to remember to. If Apps Script ever responds with
   { success:false, authenticated:false }, the session has died (expired
   or was never valid) and callGas() hands off to auth.js's
   handleSessionExpired() to return the user to the login screen; no
   other file needs to check for that shape itself.

   IMPORTANT -- every function below keeps the EXACT name and parameter
   list it always had (fetchAllRecords, updateRecord, createRecord,
   getRecord). script.js and approval.js call them exactly as before and
   needed zero changes for the Version 3.0 migration; only what happens
   *inside* these functions changed. The `baseId` / `table` / `view`
   parameters callers pass in are no longer real Airtable identifiers --
   they're the opaque dataset keys from config.js ("claims" /
   "generatedCoupons") used only to tell Apps Script which of the two
   Airtable bases a call is for.
===================================================================== */

// Strips known-sensitive keys before a payload ever reaches
// console.error -- e.g. `password` on a failed login, or `fields`
// (which can carry customer PII on a failed Claims/Coupon write).
// sessionToken itself is never part of `payload` (see below), but is
// included here too as a defensive measure against a future call site
// accidentally passing it through.
function _redactForLogging(payload) {
    if (!payload || typeof payload !== 'object') return payload;
    const SENSITIVE_KEYS = ['password', 'sessionToken', 'fields'];
    const safe = {};
    Object.keys(payload).forEach(key => {
        safe[key] = SENSITIVE_KEYS.indexOf(key) !== -1 ? '[redacted]' : payload[key];
    });
    return safe;
}

// Single low-level entry point to the Apps Script Web App. Every action
// is POSTed as `{ action, sessionToken, ...payload }`; Apps Script
// always responds with one of:
//   { success:true, data }
//   { success:false, message }
//   { success:false, authenticated:false, message }
//   { success:false, authenticated:true, authorized:false, message }
//
// Content-Type is deliberately "text/plain" rather than
// "application/json" -- Apps Script Web Apps don't support the
// preflighted application/json CORS request from a browser, so JSON is
// sent as a plain-text body and parsed manually on the Apps Script side
// (see Code.gs doPost). This is a transport detail only; the JSON
// payload itself is unchanged. Version 3.1 deliberately keeps this
// mechanism as-is -- only the payload (sessionToken added) and the
// response handling (authenticated:false / authorized:false) changed.
async function callGas(action, payload) {
    if (!CONFIG.GAS_WEBAPP_URL || CONFIG.GAS_WEBAPP_URL.indexOf('REPLACE_WITH_YOUR_DEPLOYMENT_ID') !== -1) {
        throw new Error('GAS_WEBAPP_URL is not configured. Set it in config.js -- see MIGRATION_GUIDE.md.');
    }

    // getSessionToken() is defined in auth.js. Guarded with typeof so
    // api.js never hard-depends on auth.js's load order or presence.
    // sessionToken lives ONLY in this request body -- never in
    // `payload` itself, so it never ends up in the redacted logs below
    // either.
    const sessionToken = (typeof getSessionToken === 'function') ? getSessionToken() : null;

    const r = await fetch(CONFIG.GAS_WEBAPP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ action, sessionToken }, payload || {}))
    });

    let d;
    try {
        d = await r.json();
    } catch (parseErr) {
        console.error('[KCJ api.js] Apps Script returned non-JSON:', { action, httpStatus: r.status });
        throw new Error(`Apps Script request failed (HTTP ${r.status}).`);
    }

    // Authentication failure -- session missing/expired/invalid. Distinct
    // from every other failure shape below. Hand off to auth.js (if
    // loaded) to clear the dead session and show the login screen; still
    // throw so the calling code's own try/catch stops where it is
    // instead of continuing with no data.
    if (d && d.success === false && d.authenticated === false) {
        console.warn('[KCJ api.js] Session expired/invalid:', { action, message: d.message });
        if (typeof handleSessionExpired === 'function') handleSessionExpired(d.message);
        throw new Error(d.message || 'Your session has expired. Please login again.');
    }

    // Authorization failure -- the session is perfectly valid, the role
    // just isn't permitted to do this (see Code.gs / Auth.gs
    // requireRole_). Deliberately NOT treated as a dead session: no
    // handleSessionExpired(), no logout, no login-screen redirect --
    // just an error the caller's own catch block shows via toast, same
    // as any other business-rule failure.
    if (d && d.success === false && d.authorized === false) {
        console.warn('[KCJ api.js] Not authorized:', { action, message: d.message });
        throw new Error(d.message || 'You are not authorized to perform this action.');
    }

    if (!r.ok || !d || d.success !== true) {
        console.error('[KCJ api.js] Apps Script call failed:', {
            action,
            payload: _redactForLogging(payload),
            httpStatus: r.status,
            response: d
        });
        const msg = (d && d.message) || `Apps Script request failed (action: ${action}).`;
        throw new Error(msg);
    }

    return d.data;
}

// Which dataset (Claims vs Coupons Generated) is this baseId referring
// to? Both fetchAllRecords() call sites in script.js pass one of
// CONFIG.CLAIMS_BASE_ID / CONFIG.GENERATED_BASE_ID exactly as before --
// this just maps that opaque key to the right Apps Script action.
function _resolveDataset(baseId) {
    return baseId === CONFIG.GENERATED_BASE_ID ? 'generated' : 'claims';
}

// Fetch every record from either dataset. Airtable's own offset-based
// pagination loop now runs inside Apps Script (getClaims / 
// getGeneratedCoupons in Claims.gs / Coupons.gs) -- this returns the
// complete, already-merged array in a single Apps Script round trip,
// exactly like the old client-side do/while loop used to.
async function fetchAllRecords(baseId, table, view) {
    const action = _resolveDataset(baseId) === 'generated' ? 'getGeneratedCoupons' : 'getClaims';
    const data = await callGas(action, {});
    return (data && data.records) || [];
}

// Update an existing record's fields (PATCH -- partial update). Only
// ever called against the Claims table in this app (see approval.js),
// so this always routes to the 'updateClaim' action. Field-value
// sanitization for Airtable's column types now happens inside Apps
// Script (Utils.gs, sanitizeFieldsForAirtable_) -- callers here are
// unaffected and keep sending plain numbers/booleans/strings exactly as
// before.
async function updateRecord(baseId, table, recordId, fields) {
    const data = await callGas('updateClaim', { recordId, fields });
    return data && data.record;
}

// Create a new record. Only ever called against the Coupons Generated
// table in this app (see approval.js's createCouponGeneratedRecord),
// so this always routes to the 'createGeneratedCoupon' action.
async function createRecord(baseId, table, fields) {
    const data = await callGas('createGeneratedCoupon', { fields });
    return data && data.record;
}

// Fetch a single existing record by id. Only ever called against the
// Coupons Generated table (to read back the Formula-computed CERT_NO
// after a create -- see approval.js), so this always routes to the
// 'getGeneratedCoupon' action.
async function getRecord(baseId, table, recordId) {
    const data = await callGas('getGeneratedCoupon', { recordId });
    return data && data.record;
}

/* =====================================================================
   VERSION 3.1 -- AUTH / AUDIT ACTIONS
   Thin wrappers, same convention as everything above: this file is the
   only place a literal Apps Script action string ever appears.
   auth.js calls the first three; approval.js calls the last one.
===================================================================== */

// { username, password } -> { sessionToken, adminName, adminEmail, role }
// Throws (with a user-facing message) on invalid credentials or an
// inactive account.
async function loginRequest(username, password) {
    return callGas('login', { username, password });
}

// Best-effort server-side session invalidation. Always safe to call
// even if the token is already missing/expired (see destroySession_ in
// Auth.gs) -- logout must never get "stuck" because of this call.
async function logoutRequest() {
    return callGas('logout', {});
}

// -> { totalResolved, approved, rejected, couponsGenerated } for the
// CURRENTLY authenticated administrator only -- the email comes from
// the session token, never from anything this function sends.
async function getAdminEffortSummary() {
    return callGas('getAdminEffortSummary', {});
}

// Writes one ApprovalLog row for a just-completed approve/reject
// decision (see approval.js's approveClaim() / rejectClaim()). Never
// throws into the caller's main success path -- approval.js wraps this
// in its own try/catch so a logging hiccup can't undo or block an
// approval/rejection that already succeeded.
async function logApprovalDecision(entry) {
    return callGas('logApprovalDecision', entry || {});
}

// -> { rows: [...], unmappedRows: [...] } -- the fully aggregated
// Booking Status Organogram Wise dataset (see
// BookingStatusOrganogram.gs). Read-only; used only by
// booking-status-organogram.js.
async function getBookingStatusOrganogramWiseData() {
    return callGas('getBookingStatusOrganogramWise', {});
}
