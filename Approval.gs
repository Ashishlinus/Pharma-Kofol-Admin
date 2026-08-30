/* =====================================================================
   APPROVAL.GS
   Thin action-layer for the HO Approval workflow specifically. Nearly
   all business logic -- which fields to send on approve/reject, the
   sequential one-row-at-a-time coupon generation loop, editable
   quantities, rejection-reason formatting -- still lives entirely in
   the browser's approval.js, exactly as it did before Version 3.1.

   Version 3.1.4 correction: HO_EMAIL is now forced ONLY on the Coupons
   Generated write, not on the Claims write. The Claims table's
   HO_EMAIL column is a pre-existing field with a different purpose --
   it already stores the DESIGNATION (RSM or ASM) of whoever performed
   the earlier RSM_APPROVAL step, not the HO's identity. Overwriting it
   with the HO's email on every approve/reject was destroying that
   existing data for no benefit, since the same information (who, as
   HO, made this decision) is already recorded once, correctly, on
   every Coupons Generated row -- there's no need to duplicate it onto
   Claims, and the Claims column isn't the right place for it anyway.
   approvalUpdateClaim_() below therefore passes `fields` straight
   through unchanged, leaving Claims.HO_EMAIL exactly as it already was.

   approvalCreateGeneratedCoupon_() is unaffected by this correction: it
   still forces HO_EMAIL to the authenticated administrator's email on
   every Coupons Generated write, unconditionally -- overwriting
   whatever (if anything) the browser sent for that key. The frontend
   must never be trusted to say who is approving/rejecting a claim (see
   VERSION_3_1_SETUP.md, "CRITICAL SECURITY RULE").
===================================================================== */

function approvalUpdateClaim_(session, recordId, fields) {
    return updateClaim_(recordId, fields);
}

function approvalCreateGeneratedCoupon_(session, fields) {
    const finalFields = Object.assign({}, fields || {}, { HO_EMAIL: session.adminEmail });
    return createGeneratedCoupon_(finalFields);
}

function approvalGetGeneratedCoupon_(recordId) {
    return getGeneratedCoupon_(recordId);
}
