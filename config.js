/* =====================================================================
   CONFIG.JS -- Version 3.0
   As of Version 3.0, the browser no longer talks to Airtable directly.
   The ONLY thing this file exposes is GAS_WEBAPP_URL -- the Google Apps
   Script Web App endpoint that now does every Airtable read/write on
   the portal's behalf.

   CLAIMS_BASE_ID / CLAIMS_TABLE / CLAIMS_VIEW / GENERATED_BASE_ID /
   GENERATED_TABLE / GENERATED_VIEW below are NOT real Airtable
   identifiers anymore -- they are opaque dataset keys. api.js forwards
   whichever one it's given to Apps Script so it knows which of the two
   Airtable bases (Claims vs Coupons Generated) a call is for; nothing
   about the actual Airtable schema is derivable from them. The real
   Airtable PAT, Base IDs, Table Names, and View Names now live ONLY in
   the Apps Script project's Script Properties -- see Config.gs in the
   apps-script/ folder and MIGRATION_GUIDE.md.

   These constant NAMES were kept identical to the pre-3.0 version on
   purpose: every other file (script.js, approval.js) still reads
   CONFIG.CLAIMS_BASE_ID etc. exactly as before and required no changes.
===================================================================== */

const CONFIG = {
    GAS_WEBAPP_URL: "https://script.google.com/macros/s/AKfycbxUE0cEEee9YmgFv9WE14g17sDPE_vQLM7fBY0DCk68VLNLHy-m_RC-pN1bAM1WlF6n5Q/exec",

    CLAIMS_BASE_ID: "claims",
    CLAIMS_TABLE: "claims",
    CLAIMS_VIEW: "claims",

    GENERATED_BASE_ID: "generatedCoupons",
    GENERATED_TABLE: "generatedCoupons",
    GENERATED_VIEW: "generatedCoupons"
};

// Version 3.1: the hardcoded USERS array (admin/admin123) that used to
// live here has been removed entirely. Login credentials now live only
// in the AdminUsers Airtable table (in the separate Admin/Audit base),
// checked server-side by Apps Script -- see auth.js and
// VERSION_3_1_SETUP.md. There is no credential of any kind in this
// file, or anywhere else in the frontend.

// Build marker -- open the browser console after loading the page and
// confirm this logs. If it doesn't appear, or shows a different value,
// the browser/server is serving a stale config.js, not this file.
console.log('[KCJ config.js] build EXPORT_ORDER_FIX_v3');

/* =====================================================================
   EXPORT COLUMN ORDER
   Single source of truth for the column sequence used when exporting to
   Excel (see Utils.exportFullDataset in common.js). Sourced directly
   from the Airtable "Total Claims Received" / "Total Coupons Generated"
   exports -- this is the real field order, not a guess. Update here if
   the Airtable schema is ever reordered.

   Any field found in the fetched records that is NOT listed here is
   still exported (Utils.exportFullDataset appends it automatically, in
   the order it is first encountered in the data) so no column is ever
   silently dropped -- these arrays only control the ordering of the
   columns they name.
===================================================================== */

const CLAIMS_COLUMN_ORDER = [
    "AUTO_NO",
    "CERT_NO",
    "DIVISION",
    "ZONE",
    "DATE",
    "TIME",
    "CUSTOMER_TYPE",
    "INVOICE_LINK",
    "INVOICE_IMAGE_NAME",
    "CUSTOMER_NAME",
    "CUSTOMER_MOBILE",
    "CUSTOMER_EMAIL",
    "CUSTOMER_CITY",
    "STOCKIST_NAME",
    "STOCKIST_CITY",
    "BILL_NUMBER",
    "BILL_DATE",
    "BILL_AMOUNT",
    "NUMBER_OF_COUPONS",
    "COUPONS_PART",
    "KOFOL_CT_60",
    "KOFOL_SF_100",
    "KOFOL_IMMUNITY",
    "KOFOL_SYP_100",
    "KOFOL_SYP_200",
    "KOFOL_CT_90",
    "KOFOL_GARGLE",
    "KOFOL_LOZENGES",
    "KOFOL_ROLL_ON",
    "KOFOL_SIP",
    "DESIGNATION",
    "DSA_NAME",
    "DSA_HQ",
    "DSA_MOBILE",
    "DSA_EMAIL",
    "ASM_NAME",
    "ASM_HQ",
    "ASM_MOBILE",
    "ASM_EMAIL",
    "RSM_NAME",
    "RSM_HQ",
    "RSM_MOBILE",
    "RSM_EMAIL",
    "RSM_APPROVAL",
    "HO_APPROVAL",
    "HO_EMAIL"
];

// The Generated Coupons base shares the identical schema/column order as
// the Claims base (confirmed against the Airtable export), so it reuses
// the same field sequence. Kept as its own named constant -- rather than
// just aliasing CLAIMS_COLUMN_ORDER -- so the two can be edited
// independently if the two Airtable tables' schemas ever diverge.
const GENERATED_COLUMN_ORDER = [
    "AUTO_NO",
    "CERT_NO",
    "DIVISION",
    "ZONE",
    "DATE",
    "TIME",
    "CUSTOMER_TYPE",
    "INVOICE_LINK",
    "INVOICE_IMAGE_NAME",
    "CUSTOMER_NAME",
    "CUSTOMER_MOBILE",
    "CUSTOMER_EMAIL",
    "CUSTOMER_CITY",
    "STOCKIST_NAME",
    "STOCKIST_CITY",
    "BILL_NUMBER",
    "BILL_DATE",
    "BILL_AMOUNT",
    "NUMBER_OF_COUPONS",
    "COUPONS_PART",
    "KOFOL_CT_60",
    "KOFOL_SF_100",
    "KOFOL_IMMUNITY",
    "KOFOL_SYP_100",
    "KOFOL_SYP_200",
    "KOFOL_CT_90",
    "KOFOL_GARGLE",
    "KOFOL_LOZENGES",
    "KOFOL_ROLL_ON",
    "KOFOL_SIP",
    "DESIGNATION",
    "DSA_NAME",
    "DSA_HQ",
    "DSA_MOBILE",
    "DSA_EMAIL",
    "ASM_NAME",
    "ASM_HQ",
    "ASM_MOBILE",
    "ASM_EMAIL",
    "RSM_NAME",
    "RSM_HQ",
    "RSM_MOBILE",
    "RSM_EMAIL",
    "RSM_APPROVAL",
    "HO_APPROVAL",
    "HO_EMAIL"
];