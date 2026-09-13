/* =====================================================================
   COUPONS.GS
   Everything that touches the Coupons Generated Airtable base. Pure
   data access -- the sequential "one coupon row at a time" generation
   loop, and which fields to send, are decided entirely by the browser's
   approval.js exactly as before; this file only creates/fetches
   individual rows on request.
===================================================================== */

// Every Coupons Generated record, paginated internally, returned as one
// array -- same shape the browser's old fetchAllRecords() used to hand
// back.
function getGeneratedCoupons_() {
    const cfg = getGeneratedConfig_();
    const records = airtableFetchAll_(cfg.baseId, cfg.table, cfg.view);
    return { records: records };
}

// ---- Version 4 -- retained but no longer wired to any doPost action ---
// The one-row-at-a-time approve loop that used to call these (once per
// coupon, from the browser) has been removed -- see Approval.gs and
// createGeneratedCouponsBatch_() below, which is now the only path that
// ever writes to this table. Left in place, unexposed, only in case a
// future one-off/debug script needs to create or inspect a single row
// directly; the live approval flow never calls either of these.
function createGeneratedCoupon_(fields) {
    const cfg = getGeneratedConfig_();
    const record = airtableCreateRecord_(cfg.baseId, cfg.table, fields || {});
    return { record: record };
}

function getGeneratedCoupon_(recordId) {
    if (!recordId) throw new Error('recordId is required.');
    const cfg = getGeneratedConfig_();
    const record = airtableGetRecord_(cfg.baseId, cfg.table, recordId);
    return { record: record };
}

// Version 4 -- create MANY Coupons Generated rows in as few Airtable
// requests as possible (batches of up to 10 -- see
// airtableCreateRecordsBatch_() in Utils.gs). `fieldsArray` is expected
// to be N copies of the identical row-template Approval.gs built for
// this claim (one entry per coupon still requested) -- matches the
// pre-existing "one row per approved coupon, identical field values"
// business rule (see the old createCouponGeneratedRecord() comment this
// replaced), just created in batches server-side instead of one row at
// a time from the browser.
function createGeneratedCouponsBatch_(fieldsArray) {
    const cfg = getGeneratedConfig_();
    return airtableCreateRecordsBatch_(cfg.baseId, cfg.table, fieldsArray || []);
}

// Version 4 (reworked -- no new fields; schema is frozen) -- every
// Coupons Generated row already created for one specific claim, found
// via a prefix match against the EXISTING COUPONS_PART column: every row
// this system creates gets COUPONS_PART = "<claimReferenceNo> | <i> of
// <N>" (see Config.gs's Version 4 note; built inline in Approval.gs's
// runApprovalTransaction_()), so "every row whose COUPONS_PART starts
// with '<claimReferenceNo> | '" is exactly "every row generated for this
// claim" -- claim reference numbers are unique (Claim_Received.CERT_NO
// is itself Formula/Autonumber-derived), so this cannot collide between
// two different claims. This is the idempotency check: how many coupons
// already exist for this claim, right now, according to Airtable itself
// -- never trusted from anything cached in Apps Script or the browser.
// Deliberately unfiltered by view (see airtableFetchAllFiltered_()'s own
// comment in Utils.gs).
function getGeneratedCouponsForClaim_(claimReferenceNo) {
    if (!claimReferenceNo) throw new Error('claimReferenceNo is required.');
    const cfg = getGeneratedConfig_();
    // Airtable formula string literal -- escape backslashes and double
    // quotes defensively (claim reference numbers are always plain
    // "REF"+digits in practice, so this never actually fires, but a
    // shared/production field is not a place to assume that will always
    // remain true).
    const escaped = String(claimReferenceNo).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const prefix = escaped + ' | ';
    // LEN() of the prefix is computed here in JS, not with Airtable's own
    // LEN(), so there's no ambiguity about which string's length is being
    // compared.
    const formula = 'LEFT({COUPONS_PART}, ' + prefix.length + ') = "' + prefix + '"';
    return airtableFetchAllFiltered_(cfg.baseId, cfg.table, formula);
}

// Full, unfiltered Coupons Generated dataset for the "Total Coupons
// Generated" Excel export. See the note on downloadClaims_() in
// Claims.gs -- same reasoning applies here.
function downloadGeneratedCoupons_() {
    return getGeneratedCoupons_();
}
