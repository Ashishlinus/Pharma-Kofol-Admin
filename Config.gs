/* =====================================================================
   CONFIG.GS
   The Airtable PAT, Base IDs, Table Names, and View Names live ONLY
   here (as Script Properties -- see VERSION_3_1_SETUP.md for how to set
   them). Every other .gs file reads them through the getters below
   rather than touching PropertiesService directly, so there is exactly
   one place in the whole backend that ever holds real Airtable
   credentials. None of this is ever returned to the browser.

   Required Script Properties (Project Settings > Script Properties):
     AIRTABLE_TOKEN
     CLAIMS_BASE_ID
     CLAIMS_TABLE
     CLAIMS_VIEW
     GENERATED_BASE_ID
     GENERATED_TABLE
     GENERATED_VIEW
     ADMIN_BASE_ID
     ADMIN_USERS_TABLE
     APPROVAL_LOG_TABLE
     MASTER_LOGIN_BASE_ID    (Booking Status Organogram Wise only)
     MASTER_LOGIN_TABLE
     MASTER_LOGIN_VIEW

   Optional (Version 3.1 -- Admin/Audit views; safe to leave unset,
   airtableFetchAll_ tolerates a blank view and just fetches without
   one):
     ADMIN_USERS_VIEW
     APPROVAL_LOG_VIEW

   ---- Version 4 (reworked) -- SCHEMA IS FROZEN, NO NEW FIELDS ----------
   The Airtable schema is shared with other (Android/mobile) applications
   and must not be changed -- no new columns, no renames, no type
   changes, no deletions, no reordering. An earlier draft of this file
   proposed two new technical fields (Coupons_Generated.CLAIM_RECORD_ID
   and Claim_Received.COUPON_GENERATION_STATE); neither was ever created,
   and Approval.gs does not use either. Instead, the existing
   COUPONS_PART column -- already present on both tables, and already
   used by the pre-existing (pre-Admin-Portal) system for a very similar
   purpose (see below) -- carries everything Version 4 needs:

     Claim_Received.COUPONS_PART
         Rewritten by Approval.gs on HO approval (exactly as it is
         already rewritten by the existing, unchanged REJECT path with a
         reject reason -- see Approval.gs's approvalUpdateClaim_()) to a
         parseable status string:
             "<requested> requested | <generated> generated | COMPLETE"
             "<requested> requested | <generated> generated | <remaining> pending[. Error: ...]"
         `<requested>` is the HO-approved coupon count -- the one and
         only place that number is recorded once NUMBER_OF_COUPONS
         itself is (correctly) left holding the DSA's original,
         unedited value. See Approval.gs's parseCouponsPartStatus_() /
         formatCouponsPartStatus_().

     Coupons_Generated.COUPONS_PART
         The exported schema already shows this column following an
         "<i> of <N>" convention on existing historical rows (e.g. "2 of
         3") written by whatever system created them before this Admin
         Portal existed. Version 4 continues that exact convention, just
         prefixed with the claim reference number so it doubles as the
         technical link back to its Claim_Received row:
             "<claimReferenceNo> | <i> of <N>"
         e.g. "REF0005062 | 1 of 12". Approval.gs's
         getGeneratedCouponsForClaim_() (Coupons.gs) finds every row for
         a claim with an Airtable filterByFormula prefix match against
         this exact string -- claim reference numbers are guaranteed
         unique (Claim_Received.CERT_NO is itself a Formula/Autonumber-
         derived field), so this prefix match cannot collide between two
         different claims.
===================================================================== */

// Version 4 -- the exact Kofol SKU field names shared by Claim_Received
// and Coupons_Generated (confirmed against both uploaded CSV exports).
// Approval.gs uses this list to read HO's edited per-product quantities
// and copy them into the generated coupon rows. Do not invent additional
// entries here without confirming them against the real Airtable schema
// first (see coupons.js's COUPON_PRODUCTS on the frontend for the same
// list, display-ordered, with labels).
const KOFOL_SKU_FIELDS_ = [
    'KOFOL_CT_60',
    'KOFOL_SF_100',
    'KOFOL_IMMUNITY',
    'KOFOL_SYP_100',
    'KOFOL_SYP_200',
    'KOFOL_CT_90',
    'KOFOL_GARGLE',
    'KOFOL_LOZENGES',
    'KOFOL_ROLL_ON',
    'KOFOL_SIP'
];

function getAirtableToken_() {
    const token = PropertiesService.getScriptProperties().getProperty('AIRTABLE_TOKEN');
    if (!token) throw new Error('Script Property AIRTABLE_TOKEN is not set.');
    return token;
}

// { baseId, table, view } for the Coupon Claims Received base.
function getClaimsConfig_() {
    const p = PropertiesService.getScriptProperties();
    const cfg = {
        baseId: p.getProperty('CLAIMS_BASE_ID'),
        table: p.getProperty('CLAIMS_TABLE'),
        view: p.getProperty('CLAIMS_VIEW')
    };
    if (!cfg.baseId || !cfg.table || !cfg.view) {
        throw new Error('CLAIMS_BASE_ID / CLAIMS_TABLE / CLAIMS_VIEW Script Properties are not fully set.');
    }
    return cfg;
}

// { baseId, table, view } for the Coupons Generated base.
function getGeneratedConfig_() {
    const p = PropertiesService.getScriptProperties();
    const cfg = {
        baseId: p.getProperty('GENERATED_BASE_ID'),
        table: p.getProperty('GENERATED_TABLE'),
        view: p.getProperty('GENERATED_VIEW')
    };
    if (!cfg.baseId || !cfg.table || !cfg.view) {
        throw new Error('GENERATED_BASE_ID / GENERATED_TABLE / GENERATED_VIEW Script Properties are not fully set.');
    }
    return cfg;
}

// { baseId, table, view } for the AdminUsers table, in the separate
// Admin/Audit Airtable base. `view` is optional -- see the note above.
function getAdminUsersConfig_() {
    const p = PropertiesService.getScriptProperties();
    const cfg = {
        baseId: p.getProperty('ADMIN_BASE_ID'),
        table: p.getProperty('ADMIN_USERS_TABLE'),
        view: p.getProperty('ADMIN_USERS_VIEW') || ''
    };
    if (!cfg.baseId || !cfg.table) {
        throw new Error('ADMIN_BASE_ID / ADMIN_USERS_TABLE Script Properties are not fully set.');
    }
    return cfg;
}

// { baseId, table, view } for the ApprovalLog table, in the same
// Admin/Audit Airtable base as AdminUsers. `view` is optional.
function getApprovalLogConfig_() {
    const p = PropertiesService.getScriptProperties();
    const cfg = {
        baseId: p.getProperty('ADMIN_BASE_ID'),
        table: p.getProperty('APPROVAL_LOG_TABLE'),
        view: p.getProperty('APPROVAL_LOG_VIEW') || ''
    };
    if (!cfg.baseId || !cfg.table) {
        throw new Error('ADMIN_BASE_ID / APPROVAL_LOG_TABLE Script Properties are not fully set.');
    }
    return cfg;
}

// { baseId, table, view } for the Master/Login (RegisterUser) base --
// a separate Airtable base from everything above, used only by the
// read-only Booking Status Organogram Wise report (see
// BookingStatusOrganogram.gs). This is the same table the field-force
// login app itself reads from; the Admin Portal never writes to it.
function getMasterLoginConfig_() {
    const p = PropertiesService.getScriptProperties();
    const cfg = {
        baseId: p.getProperty('MASTER_LOGIN_BASE_ID'),
        table: p.getProperty('MASTER_LOGIN_TABLE'),
        view: p.getProperty('MASTER_LOGIN_VIEW')
    };
    if (!cfg.baseId || !cfg.table || !cfg.view) {
        throw new Error('MASTER_LOGIN_BASE_ID / MASTER_LOGIN_TABLE / MASTER_LOGIN_VIEW Script Properties are not fully set.');
    }
    return cfg;
}
