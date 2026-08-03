const CONFIG={TOKEN:"patiRHIu3SPQWkNEz.cbbf3e838072ab370187f21eb5a419d181d5c777a602f637b419dc939bad904a",CLAIMS_BASE_ID:"appeNJfuYLRQPQYQ3",CLAIMS_TABLE:"Data",CLAIMS_VIEW:"Grid view",GENERATED_BASE_ID:"appbm4t71RAvLqE0M",GENERATED_TABLE:"Data",GENERATED_VIEW:"Grid view"};const USERS=[{username:"admin",password:"admin123"}];

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