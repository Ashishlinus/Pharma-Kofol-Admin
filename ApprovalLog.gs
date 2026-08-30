/* =====================================================================
   APPROVALLOG.GS
   Permanent, append-only audit trail of every HO approve/reject
   decision, written to the ApprovalLog table in the separate
   Admin/Audit Airtable base (see Config.gs). The portal never exposes
   an edit/delete path for these records -- createApprovalLogEntry_()
   is the only write this file (or anything else) ever performs against
   this table.

   Version 3.1.3 correction:
     - DECISION_DATE / DECISION_TIME are Airtable Formula fields
       (confirmed) and are now never sent in the create payload at all
       -- exactly like CERT_NO/AUTO_NO in Coupons Generated. Sending any
       value for a Formula column causes Airtable to reject the entire
       create with an HTTP 422, which was silently taking down every
       ApprovalLog write.

   Version 3.1.2 correction:
     - createApprovalLogEntry_ now writes via airtableCreateRecordRaw_()
       instead of airtableCreateRecord_() -- the latter forces every
       number/boolean to a string, which is correct for the
       mostly-text Claims/Coupons Generated bases but breaks a properly
       typed Number/Checkbox column on this table with an HTTP 422. See
       Utils.gs.

   Version 3.1.1 corrections:
     - SESSION_ID now stores session.sessionId (a separate, non-secret
       audit id -- see Auth.gs) instead of the actual authentication
       token. The secret token is never written to Airtable.
     - STATUS/ERROR_MESSAGE now reflect what the caller (approval.js)
       actually observed -- 'Completed' | 'Partial' | 'Failed' -- rather
       than always being hardcoded to 'Completed'. approval.js only
       calls this after its own approve/reject sequence has already
       finished (successfully or partially), so this still never
       represents an in-progress state.

   Version 3.1.4 correction:
     - TXN_ID is now sourced from CERT_NO on the Claims record (the
       "Coupons Claimed" table) -- the Reference No. (e.g. REF0001291)
       already used elsewhere in this project for that record. approval.js
       now sends record.fields.CERT_NO as txnId in both the approve and
       reject audit-log writes, instead of always sending an empty string.

   FLAGGED ASSUMPTIONS (confirm / correct if wrong):
     - LOG_ID is assumed to be an Airtable Autonumber field, matching
       the AUTO_NO / CERT_NO pattern used elsewhere in this project, and
       is therefore never sent in the create payload.
===================================================================== */

// entry: { claimRecordId, txnId, customerName, dsaName, dsaHq, asmHq,
//          rsmHq, decision, originalCoupons, approvedCoupons,
//          couponRecordsCreated, rejectReason, hoRemarks, skuEdited,
//          couponCountEdited, status, errorMessage }
//
// ADMIN_NAME / ADMIN_EMAIL / SESSION_ID always come from the
// authenticated `session` (Code.gs already validated it before this is
// called) -- never from `entry`, even if the browser happened to
// include those keys. SESSION_ID is session.sessionId specifically --
// the non-secret audit id, NOT the secret bearer token used to
// authenticate the request.
//
// DECISION_DATE / DECISION_TIME are Airtable Formula fields -- see the
// note above the fields object below. They are never sent by this
// function at all (server or browser), and Airtable computes them
// itself once the row is created.
//
// STATUS defaults to 'Completed' only if the caller didn't specify one
// -- approval.js always specifies it explicitly now (see approval.js),
// reflecting whether the coupon-generation loop fully, partially, or
// never succeeded.
function createApprovalLogEntry_(session, entry) {
    const cfg = getApprovalLogConfig_();
    entry = entry || {};

    // DECISION_DATE / DECISION_TIME are Formula fields in Airtable
    // (confirmed) -- they are NEVER sent in the create payload, exactly
    // like CERT_NO in Coupons Generated. Airtable rejects the *entire*
    // create request with an HTTP 422 if any value at all is sent for a
    // Formula column, so the key must be completely absent, not blank.
    // Airtable computes them itself (most likely from the record's own
    // creation timestamp) once the row exists.
    const fields = {
        CLAIM_RECORD_ID: entry.claimRecordId || '',
        TXN_ID: entry.txnId || '',
        CUSTOMER_NAME: entry.customerName || '',
        DSA_NAME: entry.dsaName || '',
        DSA_HQ: entry.dsaHq || '',
        ASM_HQ: entry.asmHq || '',
        RSM_HQ: entry.rsmHq || '',
        DECISION: entry.decision || '',
        ADMIN_NAME: session.adminName,
        ADMIN_EMAIL: session.adminEmail,
        ORIGINAL_COUPONS: Number(entry.originalCoupons) || 0,
        APPROVED_COUPONS: Number(entry.approvedCoupons) || 0,
        COUPON_RECORDS_CREATED: Number(entry.couponRecordsCreated) || 0,
        REJECT_REASON: entry.rejectReason || '',
        HO_REMARKS: entry.hoRemarks || '',
        SKU_EDITED: !!entry.skuEdited,
        COUPON_COUNT_EDITED: !!entry.couponCountEdited,
        STATUS: entry.status || 'Completed',
        ERROR_MESSAGE: entry.errorMessage || '',
        SESSION_ID: session.sessionId || ''
    };

    // Deliberately airtableCreateRecordRaw_(), NOT airtableCreateRecord_() --
    // ApprovalLog has real Number/Checkbox columns (ORIGINAL_COUPONS,
    // APPROVED_COUPONS, COUPON_RECORDS_CREATED, SKU_EDITED,
    // COUPON_COUNT_EDITED), unlike the mostly-text Claims/Coupons
    // Generated bases. Running these through sanitizeFieldsForAirtable_
    // would coerce e.g. 1 -> "1" and true -> "true", which Airtable
    // rejects with an HTTP 422 for a Number/Checkbox column expecting an
    // actual number/boolean -- this was the cause of ApprovalLog writes
    // failing while every other write kept succeeding.
    const record = airtableCreateRecordRaw_(cfg.baseId, cfg.table, fields);
    return { record: record };
}

// Cumulative, till-date effort summary for ONE administrator, derived
// entirely from ApprovalLog -- never from current Coupon Claims data.
// ADMIN_EMAIL comes from the authenticated session only (Code.gs
// already validated it); the browser cannot ask for anyone else's
// numbers.
//
// Only STATUS = 'Completed' rows count as "resolved" -- a Partial or
// Failed decision (see approval.js) does not count toward these totals,
// per spec.
//
// No ranking, no percentage, no date segmentation -- just four
// cumulative counts, per spec.
function getAdminEffortSummary_(session) {
    const cfg = getApprovalLogConfig_();
    const records = airtableFetchAll_(cfg.baseId, cfg.table, cfg.view);

    let approved = 0;
    let rejected = 0;
    let couponsGenerated = 0;

    records.forEach(function (r) {
        const f = r.fields || {};
        if (f.ADMIN_EMAIL !== session.adminEmail) return;
        if (f.STATUS !== 'Completed') return;

        if (f.DECISION === 'Approved') {
            approved++;
            couponsGenerated += (typeof f.COUPON_RECORDS_CREATED === 'number') ? f.COUPON_RECORDS_CREATED : 0;
        } else if (f.DECISION === 'Rejected') {
            rejected++;
        }
    });

    return {
        totalResolved: approved + rejected,
        approved: approved,
        rejected: rejected,
        couponsGenerated: couponsGenerated
    };
}
