/* =====================================================================
   SCRIPT.JS
   Application entry point / orchestrator.
   Holds shared mutable state and wires together every module:
   common.js, api.js, duplicate.js, loader.js, analytics.js,
   report.js, search.js, approval.js
===================================================================== */

// ---- Shared application state (referenced by report.js / analytics.js) ----
let claimsData = [],
    generatedData = [],
    currentData = [],
    level = 0,
    selected = {};


/* -----------------------------------------------------------------------
   LOGIN / LOGOUT
----------------------------------------------------------------------- */

function login() {
    const u = username.value;
    const p = password.value;

    if (!USERS.find(x => x.username === u && x.password === p)) {
        Utils.showToast('Invalid username or password.', false);
        return;
    }

    document.getElementById('loginPage').style.display = 'none';
    document.getElementById('appContainer').style.display = 'block';

    loadData();
}

function logout() {
    location.reload();
}


/* -----------------------------------------------------------------------
   DATA LOADING
----------------------------------------------------------------------- */

async function loadData() {

    loaderManager.show('Fetching claims from Airtable...');
    loaderManager.setConnectionState('syncing');

    try {
        claimsData = await fetchAllRecords(
            CONFIG.CLAIMS_BASE_ID,
            CONFIG.CLAIMS_TABLE,
            CONFIG.CLAIMS_VIEW
        );

        loaderManager.show('Fetching generated coupons...');

        generatedData = await fetchAllRecords(
            CONFIG.GENERATED_BASE_ID,
            CONFIG.GENERATED_TABLE,
            CONFIG.GENERATED_VIEW
        );

        duplicateEngine.reset();
        loaderManager.setConnectionState('online');

        const lastUpdated = document.getElementById('lastUpdated');
        if (lastUpdated) lastUpdated.innerText = 'Last Updated : ' + new Date().toLocaleString('en-IN');

        Utils.showToast('Data refreshed successfully.', true);
        showPage(window.currentPage || 'summary');

    } catch (err) {
        console.error(err);
        loaderManager.setConnectionState('error');
        Utils.showToast('Failed to load data from Airtable. Check your connection.', false);
    } finally {
        loaderManager.hide();
    }
}


/* -----------------------------------------------------------------------
   DOWNLOAD MENU
   Full, unfiltered exports of the raw Airtable datasets -- every column,
   every record. Independent of whatever report table is on screen.
----------------------------------------------------------------------- */

function downloadTotalClaims() {
    if (typeof CLAIMS_COLUMN_ORDER === 'undefined' || !CLAIMS_COLUMN_ORDER.length) {
        console.error('[KCJ] CLAIMS_COLUMN_ORDER is missing or empty -- config.js did not load the column-order arrays. Reload the page (hard refresh) and confirm config.js contains the full array.');
        Utils.showToast('Column order configuration failed to load. Please reload the page and try again.', false);
        return;
    }
    Utils.exportFullDataset(claimsData, 'KCJ_Total_Claims.xlsx', CLAIMS_COLUMN_ORDER);
}

function downloadTotalCoupons() {
    if (typeof GENERATED_COLUMN_ORDER === 'undefined' || !GENERATED_COLUMN_ORDER.length) {
        console.error('[KCJ] GENERATED_COLUMN_ORDER is missing or empty -- config.js did not load the column-order arrays. Reload the page (hard refresh) and confirm config.js contains the full array.');
        Utils.showToast('Column order configuration failed to load. Please reload the page and try again.', false);
        return;
    }
    Utils.exportFullDataset(generatedData, 'KCJ_Total_Coupons_Generated.xlsx', GENERATED_COLUMN_ORDER);
}


/* -----------------------------------------------------------------------
   PAGE ROUTER
----------------------------------------------------------------------- */

const PAGE_TITLES = {
    summary: 'Dashboard Summary',
    claims: 'Coupon Claims Received',
    rsmApproved: 'RSM Approved',
    pendingRSM: 'Pending at RSM',
    hoApproved: 'HO Approved',
    pendingHO: 'Pending at HO',
    approvalAssistant: 'Approval Assistant',
    generated: 'Coupons Generated - RSM Wise',
    generatedASM: 'Coupons Generated - ASM Wise',
    generatedDSA: 'Coupons Generated - DSA Wise',
    duplicateDashboard: 'Duplicate Dashboard',
    duplicateReport: 'Duplicate Report',
    highRiskClaims: 'High Risk Claims',
    possibleDuplicateClaims: 'Possible Duplicate Claims',
    rejectedTotal: 'Total Rejected',
    rejectedRSM: 'Rejected by RSM',
    rejectedHO: 'Rejected by HO'
};

function showPage(p) {

    const dashboardSection = document.getElementById('dashboardSection');
    const reportToolbar = document.getElementById('reportToolbar');

    if (p === 'summary') {
        dashboardSection.style.display = 'block';
        reportToolbar.style.display = 'none';
    } else {
        dashboardSection.style.display = 'none';
        reportToolbar.style.display = 'block';
    }

    window.currentPage = p;
    level = 0;
    selected = {};
    activeReportTable = null;

    document.getElementById('backBtn').style.display = 'none';
    document.getElementById('breadcrumb').innerHTML = '';

    const searchInput = document.getElementById('globalSearch');
    if (searchInput) searchInput.value = '';

    pageTitle.innerText = PAGE_TITLES[p] || '';

    // Highlight active sidebar link
    document.querySelectorAll('.sidebar a[data-page]').forEach(a => {
        a.classList.toggle('active', a.dataset.page === p);
    });

    if (p === 'summary') {
        analytics.renderDashboard();
        return;
    }

    // --- Duplicate detection pages ---
    if (p === 'duplicateDashboard') { analytics.renderDuplicateDashboardPage(); return; }
    if (p === 'duplicateReport') { analytics.renderDuplicateReportPage(); return; }
    if (p === 'highRiskClaims') { analytics.renderHighRiskClaimsPage(); return; }
    if (p === 'possibleDuplicateClaims') { analytics.renderPossibleDuplicateClaimsPage(); return; }

    // --- Approval Assistant (investigation/decision support only -- no
    //     approve/reject actions live in the Admin Portal) ---
    if (p === 'approvalAssistant') { analytics.renderApprovalAssistantPage(); return; }

    // --- Claims-based pages ---
    if (p === 'claims') {
        currentData = claimsData;
    } else if (p === 'rsmApproved') {
        currentData = claimsData.filter(r => r.fields.RSM_APPROVAL === 'Approved');
    } else if (p === 'pendingRSM') {
        currentData = claimsData.filter(r => r.fields.RSM_APPROVAL === 'Pending');
    } else if (p === 'hoApproved') {
        currentData = claimsData.filter(r => r.fields.HO_APPROVAL === 'Approved');
    } else if (p === 'pendingHO') {
        currentData = claimsData.filter(r => {
            const f = r.fields;
            return f.HO_APPROVAL === 'Pending' && f.RSM_APPROVAL !== 'Rejected';
        });
    } else if (p === 'rejectedTotal') {
        currentData = claimsData.filter(r => Utils.isRejected(r));
    } else if (p === 'rejectedRSM') {
        currentData = claimsData.filter(r => Utils.normalizeString(r.fields.RSM_APPROVAL) === 'rejected');
    } else if (p === 'rejectedHO') {
        currentData = claimsData.filter(r => Utils.normalizeString(r.fields.HO_APPROVAL) === 'rejected');
    } else {
        currentData = generatedData;
    }

    if (p === 'generatedASM') { showASM(); return; }
    if (p === 'generatedDSA') { showDSA(); return; }

    showRSM();
}


/* -----------------------------------------------------------------------
   INITIALIZATION
----------------------------------------------------------------------- */

document.addEventListener('DOMContentLoaded', function () {

    const startupLoader = document.getElementById('loader');
    if (startupLoader) startupLoader.style.display = 'none';

    const toolbar = document.getElementById('reportToolbar');
    if (toolbar) toolbar.style.display = 'none';

    const dashboard = document.getElementById('dashboardSection');
    if (dashboard) dashboard.style.display = 'block';

    loaderManager.init();
    approvalWorkflow.init();
    globalSearch.init();

    const toggleButton = document.getElementById('toggleSidebar');
    if (toggleButton) {
        toggleButton.addEventListener('click', function () {
            document.getElementById('sidebar').classList.toggle('collapsed');
        });
    }
});
