/* =====================================================================
   COUPONS.JS
   Coupon Claim Information -- display-only helper for the Approval
   Assistant review window.

   IMPORTANT
   ---------
   NUMBER_OF_COUPONS is NOT calculated by the Android app or by this
   portal. It is a value the DSA types in manually when submitting the
   claim. COUPONS_PART is likewise a manually entered/stored string.
   There is no coupon-eligibility formula anywhere in this system --
   the HO reviewer checks the invoice and the quantities shown here and
   then makes a manual decision (see the HO Decision section in
   approval.js). Nothing in this file calculates, estimates, or
   validates a coupon count. It only reads the current Airtable record
   already in memory and reshapes it for display.

   Depends on: common.js (Utils)
===================================================================== */

// Ordered product list -- Airtable field name + display label.
// This is the exact display order requested for the product table.
const COUPON_PRODUCTS = [
    { key: 'KOFOL_CT_60',    label: 'Kofol CT 60' },
    { key: 'KOFOL_SF_100',   label: 'Kofol SF 100' },
    { key: 'KOFOL_SYP_100',  label: 'Kofol Syrup 100' },
    { key: 'KOFOL_SYP_200',  label: 'Kofol Syrup 200' },
    { key: 'KOFOL_IMMUNITY', label: 'Kofol Immunity' },
    { key: 'KOFOL_GARGLE',   label: 'Kofol Gargle' },
    { key: 'KOFOL_LOZENGES', label: 'Kofol Lozenges' },
    { key: 'KOFOL_ROLL_ON',  label: 'Kofol Roll On' },
    { key: 'KOFOL_SIP',      label: 'Kofol SIP' },
    { key: 'KOFOL_CT_90',    label: 'Kofol CT 90' }
];

// Build the display data for the Coupon Claim Information card.
// Called only when the review modal opens (approval.js) -- never during
// report/dashboard rendering. Pure formatting -- no calculation, no
// eligibility logic, no comparison against any rule.
//
// Returns:
// {
//   couponsClaimed:            NUMBER_OF_COUPONS, exactly as stored,
//   couponsPart:               COUPONS_PART, exactly as stored (raw string),
//   productRows:                [{ key, label, qty }]  qty exactly as entered, '0' if blank,
//   productsWithQuantity:       count of rows with qty > 0,
//   productsWithZeroQuantity:   count of rows with qty == 0
// }
function getCouponClaimInformation(record) {
    const f = (record && record.fields) || {};

    const productRows = COUPON_PRODUCTS.map(p => ({
        key: p.key,
        label: p.label,
        qty: Utils.safeNumber(f[p.key], 0)
    }));

    const productsWithQuantity = productRows.filter(p => p.qty > 0).length;
    const productsWithZeroQuantity = productRows.filter(p => p.qty === 0).length;

    return {
        couponsClaimed: Utils.safeValue(f.NUMBER_OF_COUPONS, 0),
        couponsPart: Utils.safeValue(f.COUPONS_PART, ''),
        productRows,
        productsWithQuantity,
        productsWithZeroQuantity
    };
}
