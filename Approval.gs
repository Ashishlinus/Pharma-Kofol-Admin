/* =====================================================================
   APPROVAL.GS
   ---------------------------------------------------------------------
   VERSION 4 (reworked -- Airtable schema is FROZEN, shared with other
   Android/mobile applications: no new columns, no renames, no type
   changes, no deletions, no reordering, ever). Coupon generation for an
   HO approval used to be entirely client-driven: the browser called
   'createGeneratedCoupon' once per approved coupon, sequentially,
   awaiting each response (plus a 'getGeneratedCoupon' read-back after
   each one) before starting the next. For a claim approved for N
   coupons that was 1 (updateClaim) + 2N (create+get per coupon) + 1
   (logApprovalDecision) UrlFetch calls, made one at a time from the
   browser -- slow, and any failure partway through (a timeout, a closed
   tab, Airtable rate-limiting) left the claim Approved with only some of
   its coupons generated, with no record of exactly how many or how to
   safely finish the job without risking duplicates.

   approvalApproveClaimTransaction_() below replaces that whole flow
   with ONE server-owned transaction: the browser sends a single
   'approveClaimTransaction' request; this file validates it, generates
   whatever coupons are still missing in batches of up to 10, updates
   Claims and writes the ApprovalLog entry, and returns one authoritative
   result. See runApprovalTransaction_() for the full sequence.

   IDEMPOTENCY / RECOVERY -- USING ONLY THE EXISTING COUPONS_PART FIELD
   ----------------------------------------------------------------------
   An earlier draft of this file proposed two new Airtable fields
   (Coupons_Generated.CLAIM_RECORD_ID, Claim_Received.
   COUPON_GENERATION_STATE). The schema is frozen, so neither exists and
   neither is used. Instead, everything Version 4 needs is derived from
   the EXISTING COUPONS_PART column on both tables, plus the EXISTING
   generated rows themselves:

     Claim_Received.COUPONS_PART
         Rewritten on HO approval to a parseable status string -- see
         formatClaimCouponsPart_() / parseCouponsPartStatus_() below:
             "<requested> requested | <generated> generated | COMPLETE"
             "<requested> requested | <generated> generated | <remaining> pending[. Error: ...]"
         This is the ONLY place the HO-approved coupon count is ever
         recorded (NUMBER_OF_COUPONS itself correctly stays untouched,
         holding the DSA's original value -- see "WHAT THIS FILE
         DELIBERATELY DOES NOT DO" below).

     Coupons_Generated.COUPONS_PART
         The exported schema already shows existing historical rows
         following an "<i> of <N>" convention (e.g. "2 of 3"), written
         by whatever system created them before this Admin Portal
         existed. Version 4 continues that exact convention, prefixed
         with the claim reference number so it doubles as the technical
         link back to Claim_Received:
             "<claimReferenceNo> | <i> of <N>"
         getGeneratedCouponsForClaim_() (Coupons.gs) finds every row for
         a claim with a prefix match on this exact string. Because every
         row for a claim also carries that claim's own approved
         NUMBER_OF_COUPONS (an ordinary field, already written on every
         row per the pre-existing "identical field values" business
         rule), reading ANY already-existing row for a claim gives BOTH
         the live, ground-truth count of coupons generated so far (the
         row count) AND the exact target/template to use for any more
         that are still needed -- with no separate state field at all.

   AMBIGUITY GUARDS -- never guessing from COUPONS_PART text alone
   ------------------------------------------------------------------
   On a resume (HO_APPROVAL already 'Approved'), the approved target
   count can come from two places:
     1. An existing Coupons_Generated row for this claim, if at least
        one exists -- its own NUMBER_OF_COUPONS field directly. This is
        the more trustworthy source (real generated data, not a text
        field another application could in principle also touch).
     2. Claim_Received.COUPONS_PART, parsed -- the only available source
        when zero coupons have been generated yet (e.g. the very first
        batch-create attempt failed completely, so there is no row to
        read from).
   See resolveApprovedTarget_() below: if BOTH are available and
   disagree, or if NEITHER is available, this throws and reports the
   exact ambiguity rather than guessing.

   ATOMICITY: on a first attempt, Claim_Received.COUPONS_PART/HO_APPROVAL
   are committed BEFORE any coupon is created (see
   runApprovalTransaction_() below) -- not after. This is what makes
   "HO_APPROVAL is not yet 'Approved'" a reliable signal that zero
   coupons exist yet for this claim, even if this exact call is
   interrupted immediately afterwards. Committing after creation instead
   would leave a gap where coupons already exist in Airtable but
   HO_APPROVAL still reads 'Pending', which would make the very next call
   treat itself as a fresh first attempt, skip the idempotency count (a
   genuine first attempt has nothing to count), and create a duplicate
   batch.

   CONCURRENCY
   -----------
   The entire read-decide-write sequence runs inside a single
   LockService.getScriptLock() critical section (see
   approvalApproveClaimTransaction_()) so two simultaneous requests for
   the same claim (or, more cheaply than building per-claim locking, any
   two approval requests at all) can never both decide "nothing exists
   yet" and both create a full batch of coupons.

   WHAT THIS FILE DELIBERATELY DOES NOT DO
   ----------------------------------------
   - It does not add, rename, retype, delete, or reorder any Airtable
     field, on either table. Every field this file reads or writes
     already exists in the schema exported in Claim_Received.csv /
     Coupons_Generated.csv.
   - It does not touch Claim_Received's own NUMBER_OF_COUPONS or SKU
     quantity columns -- those remain exactly what the DSA originally
     submitted. HO's approved count/edited quantities only ever flow
     into the Coupons_Generated rows (see buildRowFieldsBase_()).
   - It does not send any value at all for Coupons_Generated.CERT_NO --
     that column is Airtable's own Formula field; the coupon number
     comes back already computed in the batch-create response. It is
     never copied from, confused with, or set to Claim_Received.CERT_NO
     (the claim REFERENCE number, a completely different kind of value --
     see claimReferenceNo below).
   - It does not change the reject flow. approvalUpdateClaim_() below is
     unchanged from Version 3.1 and is still the only thing
     rejectClaim() (approval.js) calls.
===================================================================== */

// Unchanged from Version 3.1 -- still the only path rejectClaim() uses.
function approvalUpdateClaim_(session, recordId, fields) {
    return updateClaim_(recordId, fields);
}

// ---- Version 4 -- the single entry point for the whole approve path ---
// session: the authenticated Admin/Super Admin session (Code.gs already
//   validated it and checked the role before this is ever called).
// recordId: the Claims record being approved/resumed.
// approvedCoupons / quantities: ONLY meaningful (and required) the very
//   first time a given claim is processed. Ignored on every later call
//   for the same claim -- see the AMBIGUITY GUARDS note above. This is
//   what lets the SAME action serve both the initial "Approve Claim"
//   click and a later "Generate Remaining Coupons" recovery click with
//   no separate recovery action needed (see approval.js).
function approvalApproveClaimTransaction_(session, recordId, approvedCoupons, quantities) {
    if (!recordId) throw new Error('recordId is required.');

    // A single global script lock, held for the full duration of one
    // approval transaction. This project's approval volume does not
    // need per-claim lock keys (Apps Script's LockService doesn't
    // support arbitrary keys anyway) -- serializing ALL approval
    // requests for the few seconds each one takes is a small price for
    // an absolute guarantee that two requests (same claim or not) can
    // never simultaneously decide "nothing exists yet" and both create
    // a full batch of coupons.
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
        throw new Error('Another approval is currently being processed. Please wait a moment and try again.');
    }

    try {
        return runApprovalTransaction_(session, recordId, approvedCoupons, quantities);
    } finally {
        lock.releaseLock();
    }
}

// The actual sequence: retrieve -> validate -> (first attempt: build +
// commit) OR (resume: resolve target from existing data) -> idempotency
// check -> create only what's missing -> persist status -> log ->
// return. Runs entirely inside the lock acquired above.
function runApprovalTransaction_(session, recordId, approvedCoupons, quantities) {
    const claimsCfg = getClaimsConfig_();
    const claimRecord = getClaim_(recordId);
    const f = claimRecord.fields || {};

    // Claim_Received.CERT_NO is the CLAIM REFERENCE NUMBER (e.g.
    // "REF0005062") -- NOT a coupon number, and NEVER to be confused
    // with or copied into Coupons_Generated.CERT_NO (the generated
    // coupon number, a Formula field Airtable computes on its own).
    // Used here as the technical link value embedded in every generated
    // row's COUPONS_PART (see getGeneratedCouponsForClaim_(), Coupons.gs).
    const claimReferenceNo = safeTrim_(f.CERT_NO);
    if (!claimReferenceNo) {
        throw new Error('This claim has no CERT_NO (claim reference number) yet and cannot be safely processed.');
    }

    const rsmApproval = normalizeApprovalValue_(f.RSM_APPROVAL);
    const hoApproval = normalizeApprovalValue_(f.HO_APPROVAL);

    if (rsmApproval !== 'approved') {
        throw new Error('This claim has not been approved by RSM and is not eligible for HO approval.');
    }
    if (hoApproval === 'rejected') {
        throw new Error('This claim has already been rejected by HO.');
    }

    // isFirstAttempt is driven by HO_APPROVAL itself, not by anything in
    // COUPONS_PART -- see the ATOMICITY note in the file header: the
    // commit below sets HO_APPROVAL='Approved' together with a parseable
    // COUPONS_PART in one PATCH, so "HO_APPROVAL is not yet 'Approved'"
    // reliably means nothing has been generated for this claim yet.
    const isFirstAttempt = (hoApproval !== 'approved');

    let finalApprovedCount;
    let rowFieldsBase;      // fields shared by every row for this claim (everything except the per-row COUPONS_PART sequence)
    let auditOriginalCoupons;
    let skuEdited = null;
    let couponCountEdited = null;

    if (isFirstAttempt) {
        const built = buildFirstAttemptRowFields_(f, approvedCoupons, quantities, session);
        finalApprovedCount = built.approvedCount;
        rowFieldsBase = built.rowFieldsBase;
        auditOriginalCoupons = built.originalCoupons;
        skuEdited = built.skuEdited;
        couponCountEdited = built.couponCountEdited;

        // ---- ATOMICITY: commit BEFORE creating any coupons -----------
        // See the file-header ATOMICITY note for why this ordering (and
        // not committing after creation) is what keeps this safe against
        // a crash/timeout between this write and the batch-create below.
        airtableUpdateRecord_(claimsCfg.baseId, claimsCfg.table, recordId, {
            HO_APPROVAL: 'Approved',
            COUPONS_PART: formatClaimCouponsPart_(finalApprovedCount, 0, finalApprovedCount, '')
        });
    } else {
        auditOriginalCoupons = safeNumber_(f.NUMBER_OF_COUPONS, 0);
        // finalApprovedCount / rowFieldsBase resolved just below, once
        // existingRows is known (see resolveApprovedTarget_()).
    }

    // ---- Idempotency check: how many already exist, right now? --------
    // Skipped (necessarily empty) on a genuine first attempt -- the
    // commit above just now set HO_APPROVAL='Approved' for the first
    // time, which is only possible if nothing has ever created a coupon
    // for this claim before.
    const existingRows = isFirstAttempt ? [] : getGeneratedCouponsForClaim_(claimReferenceNo);
    const existingCouponNumbers = existingRows
        .map(function (r) { return r.fields && r.fields.CERT_NO; })
        .filter(Boolean);

    if (!isFirstAttempt) {
        const resolved = resolveApprovedTarget_(f, existingRows);
        finalApprovedCount = resolved.approvedCount;
        rowFieldsBase = resolved.rowFieldsBase;
    }

    const remainingToCreate = Math.max(0, finalApprovedCount - existingRows.length);

    let newlyCreatedRecords = [];
    let creationError = '';

    if (remainingToCreate > 0) {
        const rowsToCreate = [];
        for (let i = 0; i < remainingToCreate; i++) {
            const seq = existingRows.length + i + 1;
            const row = shallowCopy_(rowFieldsBase);
            row.COUPONS_PART = claimReferenceNo + ' | ' + seq + ' of ' + finalApprovedCount;
            rowsToCreate.push(row);
        }
        const batchResult = createGeneratedCouponsBatch_(rowsToCreate);
        newlyCreatedRecords = batchResult.created;
        creationError = batchResult.errorMessage || '';
    }

    const newCouponNumbers = newlyCreatedRecords
        .map(function (r) { return r.fields && r.fields.CERT_NO; })
        .filter(Boolean);
    const couponNumbers = existingCouponNumbers.concat(newCouponNumbers);
    const generatedCount = existingRows.length + newlyCreatedRecords.length;
    const remainingCount = Math.max(0, finalApprovedCount - generatedCount);

    // ---- Claim_Received.COUPONS_PART fixup (separate, smaller update) -
    // On a first attempt this always runs (the commit above optimistically
    // wrote "0 generated | N pending"; this corrects it to the real
    // outcome). On a resume it only runs when the status actually
    // changed, to avoid an unnecessary write on a pure idempotent no-op
    // (everything was already complete before this call did anything).
    const newCouponsPart = formatClaimCouponsPart_(finalApprovedCount, generatedCount, remainingCount, creationError);
    const shouldWriteCouponsPart = isFirstAttempt || newCouponsPart !== safeTrim_(f.COUPONS_PART);
    if (shouldWriteCouponsPart) {
        airtableUpdateRecord_(claimsCfg.baseId, claimsCfg.table, recordId, { COUPONS_PART: newCouponsPart });
    }

    const status = remainingCount === 0 ? 'SUCCESS' : (generatedCount === 0 ? 'FAILED' : 'PARTIAL');

    // ---- Approval log ---------------------------------------------------
    // Written on the first attempt (whatever its outcome) and on any
    // later call that actually creates at least one more coupon (a real
    // recovery). A pure no-op resume -- everything was already
    // generated, this call created nothing new -- never writes a second
    // row for the same decision (see getAdminEffortSummary_ in
    // ApprovalLog.gs, which would otherwise double-count a claim every
    // time its already-complete review page happened to be reopened).
    let auditLogged = true;
    const didRealWork = isFirstAttempt || newlyCreatedRecords.length > 0;
    if (didRealWork) {
        try {
            createApprovalLogEntry_(session, {
                claimRecordId: recordId,
                txnId: claimReferenceNo,
                customerName: f.CUSTOMER_NAME,
                dsaName: f.DSA_NAME,
                dsaHq: f.DSA_HQ,
                asmHq: f.ASM_HQ,
                rsmHq: f.RSM_HQ,
                decision: 'Approved',
                originalCoupons: auditOriginalCoupons,
                approvedCoupons: finalApprovedCount,
                couponRecordsCreated: generatedCount,
                skuEdited: !!skuEdited,
                couponCountEdited: !!couponCountEdited,
                status: status === 'SUCCESS' ? 'Completed' : (status === 'PARTIAL' ? 'Partial' : 'Failed'),
                errorMessage: creationError
            });
        } catch (logErr) {
            // Never allowed to undo the approval or the coupons already
            // created -- surfaced to the browser as auditLogged:false
            // instead (see approval.js's warning banner).
            auditLogged = false;
        }
    }

    const now = new Date();
    return {
        success: true,
        status: status,                       // 'SUCCESS' | 'PARTIAL' | 'FAILED'
        claimReferenceNo: claimReferenceNo,
        requestedCount: finalApprovedCount,
        generatedCount: generatedCount,
        remainingCount: remainingCount,
        couponNumbers: couponNumbers,
        couponsPart: newCouponsPart,
        approvalDate: now.toISOString(),
        approvalTime: now.toISOString(),
        auditLogged: auditLogged,
        error: creationError || ''
    };
}

// Builds everything a FIRST attempt needs: validates approvedCoupons,
// resolves HO's final per-SKU quantities, and builds the field object
// shared by every generated row for this claim (everything except the
// per-row COUPONS_PART sequence suffix, added by the caller per row).
function buildFirstAttemptRowFields_(claimFields, approvedCoupons, quantities, session) {
    const finalApprovedCoupons = safeNumber_(approvedCoupons, NaN);
    if (isNaN(finalApprovedCoupons) || finalApprovedCoupons < 0 || Math.floor(finalApprovedCoupons) !== finalApprovedCoupons) {
        throw new Error('approvedCoupons must be a non-negative whole number.');
    }

    const originalCoupons = safeNumber_(claimFields.NUMBER_OF_COUPONS, 0);

    // HO's final, on-screen quantities -- falls back to the claim's own
    // original value for any SKU key the browser didn't send, exactly
    // like the old client-side _buildCouponGeneratedFields() did.
    const finalQuantities = {};
    KOFOL_SKU_FIELDS_.forEach(function (key) {
        const hasEdit = quantities && Object.prototype.hasOwnProperty.call(quantities, key);
        finalQuantities[key] = safeNumber_(hasEdit ? quantities[key] : claimFields[key], 0);
    });

    const couponCountEdited = finalApprovedCoupons !== originalCoupons;
    const skuEdited = KOFOL_SKU_FIELDS_.some(function (key) {
        return finalQuantities[key] !== safeNumber_(claimFields[key], 0);
    });

    return {
        approvedCount: finalApprovedCoupons,
        originalCoupons: originalCoupons,
        skuEdited: skuEdited,
        couponCountEdited: couponCountEdited,
        rowFieldsBase: buildRowFieldsBase_(claimFields, finalQuantities, finalApprovedCoupons, session.adminEmail)
    };
}

// Every field on the Claims record, copied 1:1 -- matches the old
// GENERATED_COLUMN_ORDER-driven _buildCouponGeneratedFields() in
// approval.js -- except:
//   - AUTO_NO / CERT_NO are skipped: Autonumber/Formula fields in the
//     Coupons Generated base. The key must be entirely absent from the
//     create payload, not "", null, or undefined, or Airtable rejects
//     the write. Claim_Received.CERT_NO (the claim REFERENCE number) is
//     never copied into Coupons_Generated.CERT_NO under any
//     circumstance -- see the file-header note.
//   - COUPONS_PART is skipped here -- built per-row by the caller
//     (runApprovalTransaction_), since every row needs its own
//     "<claimReferenceNo> | <i> of <N>" sequence value, not one shared
//     value.
//   - NUMBER_OF_COUPONS uses the HO-approved value, not the DSA's
//     original claimed value, and is identical on every one of the N
//     rows (never decremented per row) -- this is also how a resume
//     later recovers the approved target directly from any
//     already-created row, with no separate state field (see
//     resolveApprovedTarget_()).
//   - HO_APPROVAL is written as 'Approved' on every generated row.
//   - HO_EMAIL is forced to the approving administrator's email,
//     unconditionally (the browser is never trusted for this).
//   - Every KOFOL_SKU_FIELDS_ key uses HO's final on-screen quantity.
// Used both to build a FIRST attempt's template (from the Claim_Received
// record) and, in the exact same shape, to rebuild the template from an
// EXISTING Coupons_Generated row's own fields on a resume (see
// resolveApprovedTarget_(), which calls this with just the existing
// row's fields and no overrides) -- an existing row already has all of
// the above baked in from the first attempt, so stripping just
// AUTO_NO/CERT_NO/COUPONS_PART off it reproduces the identical template
// with no separate lookup needed.
function buildRowFieldsBase_(sourceFields, overrideQuantities, approvedCount, adminEmail) {
    const rowFieldsBase = {};
    Object.keys(sourceFields).forEach(function (key) {
        if (key === 'AUTO_NO' || key === 'CERT_NO' || key === 'COUPONS_PART') return;
        rowFieldsBase[key] = sourceFields[key];
    });
    if (overrideQuantities) {
        KOFOL_SKU_FIELDS_.forEach(function (key) { rowFieldsBase[key] = overrideQuantities[key]; });
    }
    if (approvedCount !== undefined) rowFieldsBase.NUMBER_OF_COUPONS = approvedCount;
    rowFieldsBase.HO_APPROVAL = 'Approved';
    if (adminEmail) rowFieldsBase.HO_EMAIL = adminEmail;
    return rowFieldsBase;
}

// ---- AMBIGUITY GUARD ---------------------------------------------------
// Determines the approved target count AND the row field template for a
// RESUME call (HO_APPROVAL already 'Approved'), using only existing
// data -- never the browser's input for this call, never a guess.
//
//   - If at least one Coupons_Generated row already exists for this
//     claim: its own NUMBER_OF_COUPONS is the target, directly, and its
//     other fields (minus AUTO_NO/CERT_NO/COUPONS_PART) are the
//     template. If Claim_Received.COUPONS_PART is ALSO parseable and
//     disagrees with that row's NUMBER_OF_COUPONS, this throws rather
//     than silently trusting one over the other.
//   - If zero rows exist yet (e.g. the very first batch-create attempt
//     for this claim failed completely): the only remaining source is
//     Claim_Received.COUPONS_PART. If it isn't parseable either, this
//     throws -- there is nowhere else this system could have recorded
//     the approved count, given the frozen schema, so a claim in this
//     state must be a pre-Version-4 approval with no recoverable data,
//     and it is refused rather than guessed at.
function resolveApprovedTarget_(claimFields, existingRows) {
    const parsedStatus = parseCouponsPartStatus_(claimFields.COUPONS_PART);

    if (existingRows.length === 0) {
        if (!parsedStatus) {
            throw new Error('This claim was approved before this recovery format was in place (Claim_Received.COUPONS_PART does not contain a recognizable "requested | generated | ..." status, and no generated coupons exist yet for it), so it cannot be safely reprocessed here.');
        }
        return { approvedCount: parsedStatus.requestedCount, rowFieldsBase: null };
    }

    const rawCount = existingRows[0].fields ? existingRows[0].fields.NUMBER_OF_COUPONS : undefined;
    if (rawCount === undefined || rawCount === null) {
        throw new Error('An existing generated coupon for this claim is missing its NUMBER_OF_COUPONS value, so the approved target count cannot be safely confirmed. Please contact an administrator.');
    }
    const fromRow = safeNumber_(rawCount, NaN);
    if (isNaN(fromRow)) {
        throw new Error('An existing generated coupon for this claim has a non-numeric NUMBER_OF_COUPONS value, so the approved target count cannot be safely confirmed. Please contact an administrator.');
    }
    if (parsedStatus && parsedStatus.requestedCount !== fromRow) {
        throw new Error('Claim_Received.COUPONS_PART reports ' + parsedStatus.requestedCount + ' requested, but existing generated coupons for this claim show ' +
            fromRow + ' -- these must agree before this claim can be safely reprocessed. Please contact an administrator.');
    }

    return {
        approvedCount: fromRow,
        rowFieldsBase: buildRowFieldsBase_(existingRows[0].fields || {})
    };
}

// 'Approved' / 'Rejected' / 'Pending' (or blank) -> 'approved' /
// 'rejected' / 'pending' -- same normalization common.js's
// Utils.normalizeString does client-side, ported here so
// runApprovalTransaction_() never has to worry about case/whitespace
// coming back from Airtable's text columns.
function normalizeApprovalValue_(value) {
    return String(value || '').trim().toLowerCase();
}

// Builds the exact Claim_Received.COUPONS_PART status string -- see the
// file header for the two possible shapes. Always states
// requested - generated = remaining accurately; never left saying
// something misleading.
function formatClaimCouponsPart_(requested, generated, remaining, errorMessage) {
    let text = requested + ' requested | ' + generated + ' generated | ';
    text += (remaining === 0) ? 'COMPLETE' : (remaining + ' pending');
    if (errorMessage) text += '. Error: ' + errorMessage;
    return text;
}

// Parses Claim_Received.COUPONS_PART back out -- returns
// { requestedCount, generatedCount } if it matches the
// "<N> requested | <M> generated | ..." format this system writes, or
// null if it doesn't (blank, a pre-Version-4 value, or anything else).
function parseCouponsPartStatus_(raw) {
    const m = /^(\d+)\s+requested\s*\|\s*(\d+)\s+generated\s*\|/i.exec(safeTrim_(raw));
    if (!m) return null;
    return { requestedCount: parseInt(m[1], 10), generatedCount: parseInt(m[2], 10) };
}

// Small local helper -- common.js's Utils.safeTrim isn't available in
// this runtime (that file only loads in the browser), so this ports the
// same "coerce to string, trim, treat null/undefined as ''" behaviour
// for Apps Script.
function safeTrim_(value) {
    return String(value === undefined || value === null ? '' : value).trim();
}

function shallowCopy_(obj) {
    const copy = {};
    Object.keys(obj || {}).forEach(function (key) { copy[key] = obj[key]; });
    return copy;
}
