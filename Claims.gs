/* =====================================================================
   CLAIMS.GS
   Everything that touches the Coupon Claims Received Airtable base.
   Pure data access -- no business logic. Duplicate detection, approval
   rules, etc. all still run in the browser exactly as before; this file
   only fetches/writes the raw records.
===================================================================== */

// Every Claims record, paginated internally, returned as one array --
// same shape the browser's old fetchAllRecords() used to hand back.
function getClaims_() {
    const cfg = getClaimsConfig_();
    const records = airtableFetchAll_(cfg.baseId, cfg.table, cfg.view);
    return { records: records };
}

// Partial update of one Claims record (HO_APPROVAL / COUPONS_PART --
// the only two fields the Approval Assistant ever writes here).
function updateClaim_(recordId, fields) {
    if (!recordId) throw new Error('recordId is required.');
    const cfg = getClaimsConfig_();
    const record = airtableUpdateRecord_(cfg.baseId, cfg.table, recordId, fields || {});
    return { record: record };
}

// Full, unfiltered Claims dataset for the "Total Claims Received"
// Excel export. Currently identical to getClaims_() -- kept as its own
// function so a future "always fetch fresh" download flow (bypassing
// whatever's cached in the browser) has somewhere to diverge without
// touching the dashboard's own fetch.
function downloadClaims_() {
    return getClaims_();
}
