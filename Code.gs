/* =====================================================================
   CODE.GS
   Single Web App entry point for the whole KCJ Admin Portal backend.
   The browser POSTs a JSON body: { "action": "...", "sessionToken":
   "...", ...params }. Every response is one of:
     { success: true,  data: {...} }
     { success: false, message: "..." }
     { success: false, authenticated: false, message: "..." }
     { success: false, authenticated: true, authorized: false, message: "..." }

   The last two are deliberately distinct failure kinds (see Auth.gs):
     - authenticated:false            -- session missing/expired/invalid.
                                          The browser should return to login.
     - authenticated:true,
       authorized:false               -- session is fine, role isn't
                                          permitted. The browser should show
                                          the message but must NOT log the
                                          user out or treat this as a dead
                                          session.

   This file only routes actions to the right function and enforces the
   session/role gate below -- it holds no Airtable credentials and no
   approval business logic itself (see Config.gs, Utils.gs, Auth.gs,
   AdminUsers.gs, ApprovalLog.gs, Claims.gs, Coupons.gs, Approval.gs,
   Reports.gs).

   ---- Action tiers (Version 4) -----------------------------------------
   PUBLIC_ACTIONS_: no session required at all.
     - login   (there is no session yet)
     - logout  (must always "succeed" even against a dead/missing
                token -- see destroySession_)

   ADMIN_ONLY_ACTIONS_: valid session AND role in ('Admin','Super Admin').
     Enforced here, server-side, independent of anything the browser's
     UI hides or disables -- a Viewer manually crafting a POST to any of
     these gets a clean authorized:false response, not a data mutation.
     - approveClaimTransaction -- Version 4. The entire HO approve +
       server-side batch coupon-generation + recovery path, all in one
       action (see Approval.gs). Also what a "Generate Remaining
       Coupons" recovery click calls -- same action, same idempotency
       guarantees, just resuming a claim that's already Approved.
     - updateClaim -- still used by the (unchanged) reject path only, as
       of Version 4. No longer used by approve.
     - logApprovalDecision -- still used by the (unchanged) reject path
       only, as of Version 4. The approve path now writes its
       ApprovalLog entry directly, server-side, inside
       approveClaimTransaction (see Approval.gs) -- never via a separate
       browser round trip.
     Viewer accounts are authenticated but never reach any of these.

   REMOVED in Version 4: createGeneratedCoupon / getGeneratedCoupon --
   the old one-row-at-a-time browser-driven coupon loop these existed
   for has been removed from approval.js entirely (see Approval.gs's
   file header). There is now exactly one path that can ever write to
   Coupons Generated: approveClaimTransaction, server-side, in batches.
   The underlying single-record Coupons.gs functions these used to call
   still exist (unexposed, for potential debugging use only) -- see the
   Version 4 note at the top of Coupons.gs.

   Everything else reaching the switch requires a valid session of any
   role (Admin, Super Admin, or Viewer) -- the read-only dashboard/report
   actions.
===================================================================== */

const PUBLIC_ACTIONS_ = ['login', 'logout'];
const ADMIN_ONLY_ACTIONS_ = ['updateClaim', 'approveClaimTransaction', 'logApprovalDecision'];

function doPost(e) {
    let body;

    try {
        body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    } catch (parseErr) {
        return jsonError_('Request body was not valid JSON.');
    }

    const action = body.action;
    let session = null;

    try {
        if (PUBLIC_ACTIONS_.indexOf(action) === -1) {
            session = requireSession_(body.sessionToken);
            if (ADMIN_ONLY_ACTIONS_.indexOf(action) !== -1) {
                requireRole_(session, ['Admin', 'Super Admin']);
            }
        }

        switch (action) {

            // ---- Auth ---------------------------------------------------
            case 'login':
                return jsonSuccess_(loginAdmin_(body.username, body.password));

            case 'logout':
                return jsonSuccess_(destroySession_(body.sessionToken));

            case 'getAdminEffortSummary':
                return jsonSuccess_(getAdminEffortSummary_(session));

            // ---- Claims -----------------------------------------------
            case 'getClaims':
                return jsonSuccess_(getClaims_());

            case 'updateClaim':
                return jsonSuccess_(approvalUpdateClaim_(session, body.recordId, body.fields));

            // Version 4 -- the entire HO approve + server-side batch
            // coupon-generation + recovery path in one request/response.
            // body.approvedCoupons / body.quantities only matter (and are
            // required) the first time a given claim is approved; a later
            // "Generate Remaining Coupons" recovery call can omit them
            // entirely -- see Approval.gs's runApprovalTransaction_().
            case 'approveClaimTransaction':
                return jsonSuccess_(approvalApproveClaimTransaction_(session, body.recordId, body.approvedCoupons, body.quantities));

            case 'downloadClaims':
                return jsonSuccess_(downloadClaimsReport_());

            // ---- Coupons Generated -------------------------------------
            case 'getGeneratedCoupons':
                return jsonSuccess_(getGeneratedCoupons_());

            case 'downloadGeneratedCoupons':
                return jsonSuccess_(downloadGeneratedCouponsReport_());

            // ---- Dashboard (combined convenience action) ---------------
            case 'getDashboardData':
                return jsonSuccess_(getDashboardData_());

            // ---- Approval audit log (Version 3.1) -----------------------
            case 'logApprovalDecision':
                return jsonSuccess_(createApprovalLogEntry_(session, body));

            // ---- Booking Status Organogram Wise (new, isolated, read-only) ---
            case 'getBookingStatusOrganogramWise':
                return jsonSuccess_(getBookingStatusOrganogramWise_(session));

            default:
                return jsonError_('Unknown action: ' + action);
        }
    } catch (err) {
        // Two distinct failure kinds get two distinct response shapes:
        //   - sessionError_ (missing/expired/invalid session) -> jsonAuthError_
        //     ({ authenticated:false }) -- the browser should return to login.
        //   - authorizationError_ (valid session, insufficient role) -> jsonAuthzError_
        //     ({ authenticated:true, authorized:false }) -- the browser should show
        //     the message WITHOUT logging the user out or treating it as a dead
        //     session (see Auth.gs requireRole_).
        // Everything else (Airtable errors, missing Script Properties, bad
        // params, etc.) keeps using the generic error shape, so the existing
        // Bootstrap-toast error handling in api.js / approval.js continues to
        // work unchanged.
        if (err && err.isSessionError) {
            return jsonAuthError_(err.message);
        }
        if (err && err.isAuthorizationError) {
            return jsonAuthzError_(err.message);
        }
        return jsonError_(err && err.message ? err.message : String(err));
    }
}

// The portal itself only ever calls doPost -- doGet exists purely so
// hitting the deployment URL directly in a browser (e.g. while testing
// the deployment) returns a clear message instead of an Apps Script
// error page.
function doGet(e) {
    return jsonError_('This endpoint only accepts POST requests.');
}
