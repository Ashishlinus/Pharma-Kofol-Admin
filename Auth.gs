/* =====================================================================
   AUTH.GS
   Session issuance/validation for the KCJ Admin Portal (Version 3.1).
   Sessions are opaque tokens backed by CacheService -- no username,
   password, or password hash is ever stored in the session value
   itself beyond the display identity (ADMIN_NAME / ADMIN_EMAIL / ROLE)
   needed to stamp writes and enforce permissions.

   Version 3.1.1 correction: the session carries TWO distinct values,
   which must never be confused with each other:
     - token     -- the SECRET bearer credential. Lives only in
                     CacheService (server) and sessionStorage (browser).
                     Sent with every authenticated request. NEVER written
                     to ApprovalLog, logged, or displayed.
     - sessionId -- a separate, non-secret random id, generated once at
                     login and carried inside the session object. This
                     is the value ApprovalLog.SESSION_ID stores, for
                     audit correlation only -- it grants no access by
                     itself and is safe to log or display.
===================================================================== */

const SESSION_TTL_SECONDS_ = 1800; // 30 minutes, per spec.

// admin: { username, adminName, adminEmail, role }
// Returns { token, session }. `session.sessionId` is the non-secret
// audit id; `token` (the map key in CacheService) is the secret one.
function createSession_(admin) {
    const token = Utilities.getUuid();
    const sessionId = Utilities.getUuid();
    const now = new Date();

    const session = {
        username: admin.username,
        adminName: admin.adminName,
        adminEmail: admin.adminEmail,
        role: admin.role,
        sessionId: sessionId,
        loginTime: now.toISOString(),
        expiryTime: new Date(now.getTime() + SESSION_TTL_SECONDS_ * 1000).toISOString()
    };

    CacheService.getScriptCache().put(token, JSON.stringify(session), SESSION_TTL_SECONDS_);
    return { token: token, session: session };
}

// Returns the session object for a token, or null if missing/expired.
// CacheService itself enforces the TTL -- an expired entry simply isn't
// there anymore, so there's no separate expiry check to get wrong here.
function getSession_(token) {
    if (!token) return null;
    const raw = CacheService.getScriptCache().get(token);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch (err) {
        return null;
    }
}

// Validates the token and, since this call itself counts as
// authenticated activity, refreshes its TTL back to the full 30 minutes
// ("refresh/extend the session on authenticated activity" per spec).
// Throws a sessionError_ (not a plain Error) on failure so Code.gs can
// respond with the distinct authenticated:false shape.
function requireSession_(token) {
    const session = getSession_(token);
    if (!session) {
        throw sessionError_('Your session has expired. Please login again.');
    }
    CacheService.getScriptCache().put(token, JSON.stringify(session), SESSION_TTL_SECONDS_);
    return session;
}

// allowedRoles: e.g. ['Admin', 'Super Admin']. Throws authorizationError_
// -- deliberately NOT sessionError_ -- because this is a different
// failure kind: the session is perfectly valid, the administrator is
// just not permitted to do this. Code.gs responds to the two error
// kinds with two different shapes (authenticated:false vs
// authenticated:true/authorized:false) so the browser can tell "you
// need to log in again" apart from "you're logged in, but not allowed."
function requireRole_(session, allowedRoles) {
    if (!session || allowedRoles.indexOf(session.role) === -1) {
        throw authorizationError_('You are not authorized to perform this action.');
    }
}

// Idempotent -- always "succeeds" whether or not there was a real
// session to invalidate (see Code.gs: logout is a public action, so a
// missing/expired token here is not itself an error).
function destroySession_(token) {
    if (token) {
        CacheService.getScriptCache().remove(token);
    }
    return { loggedOut: true };
}

// Marks an Error as an AUTHENTICATION failure (missing/expired/invalid
// session) so Code.gs's catch block responds with jsonAuthError_
// ({ authenticated:false }) -- the browser should return to login.
function sessionError_(message) {
    const err = new Error(message);
    err.isSessionError = true;
    return err;
}

// Marks an Error as an AUTHORIZATION failure (valid session, wrong
// role) so Code.gs's catch block responds with jsonAuthzError_
// ({ authenticated:true, authorized:false }) instead -- the browser
// should show the message, NOT log the user out or treat it as a dead
// session.
function authorizationError_(message) {
    const err = new Error(message);
    err.isAuthorizationError = true;
    return err;
}
