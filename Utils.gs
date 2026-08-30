/* =====================================================================
   UTILS.GS
   Low-level Airtable REST helpers, built on UrlFetchApp -- the Apps
   Script equivalent of the browser's old fetch() calls in api.js -- plus
   the sanitizeFieldsForAirtable_() logic, ported 1:1 from the pre-3.0
   browser-side api.js. Airtable is now only ever contacted from this
   file. JSON response-envelope helpers for the Web App itself live here
   too.
===================================================================== */

function airtableHeaders_() {
    return { Authorization: 'Bearer ' + getAirtableToken_() };
}

// Mirrors the old browser-side fetchAllRecords() do/while offset loop,
// just running here instead -- one Apps Script call from the browser
// now covers what used to be several sequential Airtable calls from
// the browser itself.
//
// `view` is optional as of Version 3.1 (AdminUsers/ApprovalLog may not
// have a dedicated view configured) -- when falsy, the view query
// param is omitted entirely rather than sent as an empty string, which
// Airtable would otherwise treat as a request for a view literally
// named "".
function airtableFetchAll_(baseId, table, view) {
    let records = [];
    let offset = '';

    do {
        let url = 'https://api.airtable.com/v0/' + baseId + '/' + encodeURIComponent(table);

        const params = [];
        if (view) params.push('view=' + encodeURIComponent(view));
        if (offset) params.push('offset=' + offset);
        if (params.length) url += '?' + params.join('&');

        const resp = UrlFetchApp.fetch(url, {
            headers: airtableHeaders_(),
            muteHttpExceptions: true
        });

        const d = JSON.parse(resp.getContentText());

        if (resp.getResponseCode() >= 300) {
            throw new Error((d && d.error && d.error.message) ||
                ('Airtable fetch failed (HTTP ' + resp.getResponseCode() + ')'));
        }

        records = records.concat(d.records || []);
        offset = d.offset;
    } while (offset);

    return records;
}

// ---- Field sanitization -- ported 1:1 from the old api.js -----------
// Most fields in this Airtable schema are "Single line text" columns,
// but callers naturally produce numbers/booleans. Airtable's API
// rejects a non-string value written into a text column with an HTTP
// 422 (INVALID_VALUE_FOR_COLUMN), so every field value is passed
// through this before any create/update call, exactly as it was when
// this logic lived in the browser.
function sanitizeFieldValueForAirtable_(value) {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value;               // Multiple Select / Linked Records
    const type = typeof value;
    if (type === 'number' || type === 'boolean') return String(value);
    if (type === 'object') return value;                   // Attachment objects, etc.
    return value;                                           // already a string
}

function sanitizeFieldsForAirtable_(fields) {
    const sanitized = {};
    Object.keys(fields || {}).forEach(function (key) {
        sanitized[key] = sanitizeFieldValueForAirtable_(fields[key]);
    });
    return sanitized;
}

// PATCH -- partial update, every other field on the record is left
// untouched. Throws on failure so the action layer can surface a real
// error message back to the browser's Retry button.
function airtableUpdateRecord_(baseId, table, recordId, fields) {
    const url = 'https://api.airtable.com/v0/' + baseId + '/' + encodeURIComponent(table) + '/' + recordId;
    const resp = UrlFetchApp.fetch(url, {
        method: 'patch',
        contentType: 'application/json',
        headers: airtableHeaders_(),
        payload: JSON.stringify({ fields: sanitizeFieldsForAirtable_(fields) }),
        muteHttpExceptions: true
    });

    const d = JSON.parse(resp.getContentText());
    if (resp.getResponseCode() >= 300) {
        throw new Error((d && d.error && d.error.message) ||
            ('Airtable update failed (HTTP ' + resp.getResponseCode() + ')'));
    }
    return d;
}

// POST -- create a new record. Returns the created record (including
// its new Airtable id) on success.
function airtableCreateRecord_(baseId, table, fields) {
    const url = 'https://api.airtable.com/v0/' + baseId + '/' + encodeURIComponent(table);
    const resp = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        headers: airtableHeaders_(),
        payload: JSON.stringify({ fields: sanitizeFieldsForAirtable_(fields) }),
        muteHttpExceptions: true
    });

    const d = JSON.parse(resp.getContentText());
    if (resp.getResponseCode() >= 300) {
        throw new Error((d && d.error && d.error.message) ||
            ('Airtable create failed (HTTP ' + resp.getResponseCode() + ')'));
    }
    return d;
}

// POST -- same as airtableCreateRecord_(), but deliberately skips
// sanitizeFieldsForAirtable_()'s number/boolean -> string coercion.
// That coercion exists only because the Claims/Coupons Generated bases
// are mostly Single-line-text columns; ApprovalLog is a separate,
// newer table with real typed columns (Number, Checkbox, Single
// select), which reject a string where they expect a number or
// boolean with an HTTP 422. Use this for any table where the field
// types are known to be correctly typed in Airtable, not text.
function airtableCreateRecordRaw_(baseId, table, fields) {
    const url = 'https://api.airtable.com/v0/' + baseId + '/' + encodeURIComponent(table);
    const resp = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        headers: airtableHeaders_(),
        payload: JSON.stringify({ fields: fields || {} }),
        muteHttpExceptions: true
    });

    const d = JSON.parse(resp.getContentText());
    if (resp.getResponseCode() >= 300) {
        throw new Error((d && d.error && d.error.message) ||
            ('Airtable create failed (HTTP ' + resp.getResponseCode() + ')'));
    }
    return d;
}

// GET -- fetch a single existing record by id. Used to read back
// Airtable-computed fields (CERT_NO) right after a create.
function airtableGetRecord_(baseId, table, recordId) {
    const url = 'https://api.airtable.com/v0/' + baseId + '/' + encodeURIComponent(table) + '/' + recordId;
    const resp = UrlFetchApp.fetch(url, {
        headers: airtableHeaders_(),
        muteHttpExceptions: true
    });

    const d = JSON.parse(resp.getContentText());
    if (resp.getResponseCode() >= 300) {
        throw new Error((d && d.error && d.error.message) ||
            ('Airtable get failed (HTTP ' + resp.getResponseCode() + ')'));
    }
    return d;
}

// ---- Web App JSON response envelope ----------------------------------
// Every action handler's result is wrapped in one of these four
// shapes, matching what api.js (browser) expects:
//   { success:true,  data }
//   { success:false, message }                                       -- generic error
//   { success:false, authenticated:false, message }                  -- missing/expired/
//                                                                         invalid session
//   { success:false, authenticated:true, authorized:false, message } -- valid session,
//                                                                         insufficient role
//
// The three failure shapes are deliberately distinct: an authentication
// failure means "go log in again"; an authorization failure means "you
// ARE logged in, you're just not allowed to do this" and must NOT log
// the user out or be confused with a dead session. A generic error is
// neither -- an Airtable/Script-Property/business-logic problem.
function jsonSuccess_(data) {
    return ContentService
        .createTextOutput(JSON.stringify({ success: true, data: data }))
        .setMimeType(ContentService.MimeType.JSON);
}

function jsonError_(message) {
    return ContentService
        .createTextOutput(JSON.stringify({ success: false, message: String(message) }))
        .setMimeType(ContentService.MimeType.JSON);
}

function jsonAuthError_(message) {
    return ContentService
        .createTextOutput(JSON.stringify({ success: false, authenticated: false, message: String(message) }))
        .setMimeType(ContentService.MimeType.JSON);
}

function jsonAuthzError_(message) {
    return ContentService
        .createTextOutput(JSON.stringify({ success: false, authenticated: true, authorized: false, message: String(message) }))
        .setMimeType(ContentService.MimeType.JSON);
}
