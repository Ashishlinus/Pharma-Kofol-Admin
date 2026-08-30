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
===================================================================== */

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
