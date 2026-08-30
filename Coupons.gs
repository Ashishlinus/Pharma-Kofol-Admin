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

// Create ONE Coupons Generated row. approval.js calls this once per
// approved coupon (sequentially, awaiting each response before starting
// the next) -- that looping behaviour is unchanged; only the
// destination of each individual create moved from Airtable directly to
// here.
function createGeneratedCoupon_(fields) {
    const cfg = getGeneratedConfig_();
    const record = airtableCreateRecord_(cfg.baseId, cfg.table, fields || {});
    return { record: record };
}

// Read back a single Coupons Generated row by id -- used right after
// creation so the browser can display the real, Airtable-computed
// CERT_NO (a Formula field derived from AUTO_NO) in the approval
// summary.
function getGeneratedCoupon_(recordId) {
    if (!recordId) throw new Error('recordId is required.');
    const cfg = getGeneratedConfig_();
    const record = airtableGetRecord_(cfg.baseId, cfg.table, recordId);
    return { record: record };
}

// Full, unfiltered Coupons Generated dataset for the "Total Coupons
// Generated" Excel export. See the note on downloadClaims_() in
// Claims.gs -- same reasoning applies here.
function downloadGeneratedCoupons_() {
    return getGeneratedCoupons_();
}
