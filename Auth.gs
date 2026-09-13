/* =====================================================================
   AUTH.GS
   Session issuance/validation for the KCJ Admin Portal.

   VERSION 4 (session-persistence rework): sessions no longer expire
   automatically after 30 minutes of inactivity, or after any fixed
   duration at all. Per the current requirement, once an Admin/Super
   Admin logs in, the session stays valid all day -- through inactivity,
   through page refreshes, indefinitely -- and becomes invalid ONLY when
   the user explicitly logs out (destroySession_) or a session is
   explicitly revoked. No other file needed to change for this: every
   caller (Code.gs, AdminUsers.gs) only ever calls createSession_() /
   requireSession_() / requireRole_() / destroySession_() by name, and
   all four keep the exact same signature and behavior contract they had
   before -- only what backs them, below, changed.

   WHAT CHANGED AND WHY (see the Version 4 session report for the full
   "CURRENT SESSION ANALYSIS" writeup)
   ------------------------------------------------------------------
   The previous implementation stored each session in
   CacheService.getScriptCache() with an explicit 30-minute TTL
   (SESSION_TTL_SECONDS_ = 1800), refreshed back to a full 30 minutes on
   every authenticated request in the old requireSession_(). Two things
   about that made it impossible to satisfy "stay logged in all day,
   including through more than 30 minutes of inactivity" just by
   changing the TTL number:
     1. CacheService silently evicts an entry once its TTL elapses with
        NO further activity -- exactly the "more than 30 minutes of
        inactivity" case this now must survive. A larger TTL only makes
        that window longer, it doesn't remove it.
     2. CacheService's own TTL is capped at 6 hours (21600 seconds) by
        the Apps Script platform itself, regardless of what value is
        requested -- it is architecturally incapable of "the rest of the
        working day" as an unattended cap, and is the wrong kind of
        store for "valid until explicit logout" semantics regardless of
        the number used.
   Sessions are now stored in PropertiesService.getScriptProperties()
   instead -- a durable, quota-based key/value store (already used
   elsewhere in this project for Airtable base/table/token configuration
   -- see Config.gs) that keeps a value until something explicitly
   deletes it. There is no TTL to expire and nothing to silently evict a
   session on inactivity; a session is removed ONLY by destroySession_()
   (Logout), which happens ONLY for that one token -- see below.

   Sessions are opaque tokens -- no username, password, or password hash
   is ever stored in the session value itself beyond the display
   identity (adminName / adminEmail / role) needed to stamp writes and
   enforce permissions. The session carries TWO distinct values, which
   must never be confused with each other:
     - token     -- the SECRET bearer credential. Lives only in
                     PropertiesService (server) and sessionStorage
                     (browser). Sent with every authenticated request.
                     NEVER written to ApprovalLog, logged, or displayed.
     - sessionId -- a separate, non-secret random id, generated once at
                     login and carried inside the session object. This
                     is the value ApprovalLog.SESSION_ID stores, for
                     audit correlation only -- it grants no access by
                     itself and is safe to log or display.

   SECURITY NOTE (unchanged elsewhere, worth stating explicitly here):
   removing the automatic timeout does not weaken authentication or
   authorization -- username/password verification (AdminUsers.gs),
   the requirement of a valid, unguessable session token for every
   protected action (requireSession_ below), and role enforcement
   (requireRole_ below) are all untouched. What changed is purely how
   long a successfully-authenticated session is willing to remain valid
   without the user taking any further action -- previously capped at
   30 minutes of inactivity, now uncapped until explicit logout, exactly
   as specified. Because sessions no longer expire on their own, a
   token that is never explicitly logged out remains valid indefinitely;
   this is an intentional trade-off matching the "only becomes invalid on
   explicit logout/revocation" requirement, not an oversight -- see the
   Version 4 session report for this called out as a trade-off worth
   being aware of.

   Property keys are prefixed with SESSION_PROPERTY_PREFIX_ so a session
   token can never collide with one of the plain, fixed-name Airtable
   config keys (CLAIMS_BASE_ID, AIRTABLE_TOKEN, etc.) already stored in
   the same Script Properties store by Config.gs.
===================================================================== */

const SESSION_PROPERTY_PREFIX_ = 'session_';

function sessionPropertyKey_(token) {
    return SESSION_PROPERTY_PREFIX_ + token;
}

// admin: { username, adminName, adminEmail, role }
// Returns { token, session }. `session.sessionId` is the non-secret
// audit id; `token` (the Script Properties key, prefixed) is the secret
// one.
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
        loginTime: now.toISOString()
        // No expiryTime -- this session does not expire on its own; see
        // the file-header note. Removed rather than left in place and
        // simply unused, so nothing here implies a timeout that no
        // longer exists.
    };

    PropertiesService.getScriptProperties().setProperty(sessionPropertyKey_(token), JSON.stringify(session));
    return { token: token, session: session };
}

// Returns the session object for a token, or null if missing (never
// logged in, already logged out, or otherwise revoked). There is no TTL
// to check here anymore -- a session that exists in Script Properties at
// all is valid, by construction (see destroySession_ for the only way
// an entry stops existing).
function getSession_(token) {
    if (!token) return null;
    const raw = PropertiesService.getScriptProperties().getProperty(sessionPropertyKey_(token));
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch (err) {
        return null;
    }
}

// Validates the token. Unlike the previous CacheService-backed version,
// this no longer needs to write anything back on a successful check --
// there is no TTL to refresh, so a valid session is simply read and
// returned as-is. Throws a sessionError_ (not a plain Error) on failure
// so Code.gs can respond with the distinct authenticated:false shape.
function requireSession_(token) {
    const session = getSession_(token);
    if (!session) {
        throw sessionError_('Your session has expired. Please login again.');
    }
    return session;
}

// allowedRoles: e.g. ['Admin', 'Super Admin']. Unchanged from before --
// throws authorizationError_ -- deliberately NOT sessionError_ --
// because this is a different failure kind: the session is perfectly
// valid, the administrator is just not permitted to do this. Code.gs
// responds to the two error kinds with two different shapes
// (authenticated:false vs authenticated:true/authorized:false) so the
// browser can tell "you need to log in again" apart from "you're logged
// in, but not allowed."
function requireRole_(session, allowedRoles) {
    if (!session || allowedRoles.indexOf(session.role) === -1) {
        throw authorizationError_('You are not authorized to perform this action.');
    }
}

// Idempotent -- always "succeeds" whether or not there was a real
// session to invalidate (see Code.gs: logout is a public action, so a
// missing/already-logged-out token here is not itself an error).
// Removes ONLY the entry for this exact token -- every other
// administrator's session lives under its own, entirely separate token/
// property key, so one administrator logging out can never affect
// another's session.
function destroySession_(token) {
    if (token) {
        PropertiesService.getScriptProperties().deleteProperty(sessionPropertyKey_(token));
    }
    return { loggedOut: true };
}

// Marks an Error as an AUTHENTICATION failure (missing/invalid/revoked
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
