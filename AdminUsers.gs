/* =====================================================================
   ADMINUSERS.GS
   Administrator authentication against the AdminUsers Airtable table
   (in the separate Admin/Audit base -- see Config.gs). Handles password
   verification and the LAST_LOGIN / LOGIN_COUNT bookkeeping. No
   password or password hash is ever returned to the browser, logged,
   or written anywhere but PASSWORD_HASH itself.

   PASSWORD_HASH FORMAT
   ---------------------
   AdminUsers has no dedicated salt column, and Apps Script has no
   built-in bcrypt/scrypt, so each PASSWORD_HASH value is a single
   self-contained string:

       "<saltHex>$<sha256Hex>"     where sha256Hex = SHA-256(saltHex + plaintextPassword)

   generateAdminPasswordHash_() below builds this string. Run it
   manually from the Apps Script editor (select the function, then Run)
   whenever you need a hash to paste into a new or updated AdminUsers
   row -- see VERSION_3_1_SETUP.md for the exact steps.
===================================================================== */

function airtableAdminUsersAll_() {
    const cfg = getAdminUsersConfig_();
    return airtableFetchAll_(cfg.baseId, cfg.table, cfg.view);
}

// Case-sensitive exact match on USERNAME. The table is expected to stay
// small (a handful of administrators), so this fetches every row and
// filters here rather than building an Airtable filterByFormula query.
function findAdminByUsername_(username) {
    if (!username) return null;
    const records = airtableAdminUsersAll_();
    return records.find(function (r) {
        return r.fields && r.fields.USERNAME === username;
    }) || null;
}

function sha256Hex_(text) {
    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
    return bytes.map(function (b) {
        const v = (b < 0 ? b + 256 : b).toString(16);
        return v.length === 1 ? '0' + v : v;
    }).join('');
}

function verifyPassword_(plaintext, storedHash) {
    if (!storedHash || storedHash.indexOf('$') === -1) return false;
    const parts = storedHash.split('$');
    const salt = parts[0];
    const expectedHash = parts[1];
    return sha256Hex_(salt + plaintext) === expectedHash;
}

// Run this manually from the Apps Script editor to generate a
// PASSWORD_HASH value for a new or updated administrator:
//   1. Edit the plaintextPassword line below.
//   2. Select "generateAdminPasswordHash_" in the function dropdown, click Run.
//   3. View > Logs (or the Execution log) for the resulting hash string.
//   4. Copy that string into the administrator's PASSWORD_HASH cell in Airtable.
//   5. Revert the plaintextPassword line back to 'CHANGE_ME' (it is never
//      committed with a real password in it, and never logged as typed).
function generateAdminPasswordHash_() {
    const plaintextPassword = 'CHANGE_ME';
    const salt = Utilities.getUuid().replace(/-/g, '');
    const hash = salt + '$' + sha256Hex_(salt + plaintextPassword);
    Logger.log('PASSWORD_HASH value (copy this into Airtable): ' + hash);
    return hash;
}

// Server-side only -- LAST_LOGIN / LOGIN_COUNT are never sent by, or
// returned to, the browser.
function updateAdminLoginStats_(recordId, currentLoginCount) {
    const cfg = getAdminUsersConfig_();
    const nextCount = (typeof currentLoginCount === 'number' ? currentLoginCount : 0) + 1;
    airtableUpdateRecord_(cfg.baseId, cfg.table, recordId, {
        LAST_LOGIN: new Date().toISOString(),
        LOGIN_COUNT: nextCount
    });
}

// Full login flow: lookup -> password check -> ACTIVE check -> stats
// update -> session creation.
//
// Throws a PLAIN Error (never sessionError_) on any failure -- these
// are login failures ("wrong password", "inactive account"), not
// "your session expired" failures, so Code.gs must respond with a
// generic jsonError_, not the authenticated:false shape.
function loginAdmin_(username, password) {
    const record = findAdminByUsername_(username);

    // Deliberately the same message whether the username doesn't exist
    // or the password is wrong -- never reveal which one it was.
    const invalidMessage = 'Invalid username or password.';

    if (!record) throw new Error(invalidMessage);

    const f = record.fields || {};

    if (!verifyPassword_(password, f.PASSWORD_HASH)) {
        throw new Error(invalidMessage);
    }

    // Airtable Checkbox fields omit the key entirely when unchecked, so
    // "not present" and "explicitly false" both correctly mean inactive
    // here. Also tolerates a Single-select/text "true"/"false" or a
    // Number 1/0 in case ACTIVE isn't a Checkbox field.
    const isActive = f.ACTIVE === true || f.ACTIVE === 'true' || f.ACTIVE === 1;
    if (!isActive) {
        throw new Error('Your account is inactive. Please contact the administrator.');
    }

    updateAdminLoginStats_(record.id, f.LOGIN_COUNT);

    const admin = {
        username: f.USERNAME,
        adminName: f.ADMIN_NAME,
        adminEmail: f.ADMIN_EMAIL,
        role: f.ROLE
    };

    const created = createSession_(admin);

    return {
        sessionToken: created.token,
        sessionId: created.session.sessionId,
        adminName: admin.adminName,
        adminEmail: admin.adminEmail,
        role: admin.role
    };
}
