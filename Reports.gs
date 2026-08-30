/* =====================================================================
   REPORTS.GS
   Download and dashboard-data actions. Duplicate detection, rejection
   reports, high-risk/possible-duplicate lists, etc. still run entirely
   in the browser (duplicate.js, analytics.js, report.js) against the
   same raw records these return -- nothing in this file calculates,
   filters, or scores anything.
===================================================================== */

function downloadClaimsReport_() {
    return downloadClaims_();
}

function downloadGeneratedCouponsReport_() {
    return downloadGeneratedCoupons_();
}

// Convenience action that returns both datasets in a single Apps
// Script round trip. Not currently called by the frontend (script.js's
// loadData() still makes two separate calls, exactly as it did before
// this migration, to avoid touching that file) -- available if a future
// change wants to collapse the dashboard's two fetches into one without
// any further backend work.
function getDashboardData_() {
    return {
        claims: getClaims_(),
        generatedCoupons: getGeneratedCoupons_()
    };
}
