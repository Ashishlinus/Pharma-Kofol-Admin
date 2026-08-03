/* =====================================================================
   APPROVAL.JS
   HO / RSM approval workflow. When a claim is opened for review, the
   Duplicate Engine is run automatically and results are displayed
   using Bootstrap cards inside a modal.

   Depends on: common.js, duplicate.js
===================================================================== */

class ApprovalWorkflow {

    constructor() {
        this.modalEl = null;
        this.modalInstance = null;
        this.bodyEl = null;
        this.titleEl = null;
    }

    init() {
        this.modalEl = document.getElementById('claimReviewModal');
        this.bodyEl = document.getElementById('claimReviewModalBody');
        this.titleEl = document.getElementById('claimReviewModalTitle');

        if (this.modalEl && typeof bootstrap !== 'undefined') {
            this.modalInstance = new bootstrap.Modal(this.modalEl);
        }
    }

    // Open the review modal for a given Airtable record id.
    openReview(recordId) {
        const record = claimsData.find(r => r.id === recordId);

        if (!record) {
            Utils.showToast('Claim record not found.', false);
            return;
        }

        if (!this.modalEl) {
            Utils.showToast('Review modal is not available on this page.', false);
            return;
        }

        if (!this.modalInstance && typeof bootstrap !== 'undefined') {
            this.modalInstance = new bootstrap.Modal(this.modalEl);
        }

        const finding = duplicateEngine.analyzeRecord(record, claimsData);
        this._renderModal(record, finding);

        if (this.modalInstance) {
            this.modalInstance.show();
        } else {
            Utils.showToast('Could not open modal: Bootstrap failed to load.', false);
        }
    }

    _renderModal(record, finding) {
        const f = record.fields || {};
        const risk = DuplicateEngine.riskLevel(finding.maxScore);

        this.titleEl.innerText = `Claim Review — ${f.CERT_NO || record.id}`;

        this.bodyEl.innerHTML = `
            ${this._claimInfoCard(record, finding)}
            ${this._approvalStatusCard(f)}
            ${this._duplicateRiskCard(finding, risk)}
            ${this._matchedRecordsCard(finding)}
        `;
    }

    _claimInfoCard(record, finding) {
        const f = record.fields || {};
        return `
            <div class="card mb-3 border-0 shadow-sm">
                <div class="card-header bg-white d-flex justify-content-between align-items-center">
                    <strong><i class="fa-solid fa-id-card"></i> Claim Details</strong>
                    ${Utils.invoiceButtonHtml(record, finding.maxScore)}
                </div>
                <div class="card-body">
                    <div class="row g-3">
                        <div class="col-md-4"><div class="text-muted small">Customer Name</div><div>${Utils.escapeHtml(f.CUSTOMER_NAME)}</div></div>
                        <div class="col-md-4"><div class="text-muted small">Mobile</div><div>${Utils.escapeHtml(f.CUSTOMER_MOBILE)}</div></div>
                        <div class="col-md-4"><div class="text-muted small">Email</div><div>${Utils.escapeHtml(f.CUSTOMER_EMAIL)}</div></div>
                        <div class="col-md-4"><div class="text-muted small">Invoice Number</div><div>${Utils.escapeHtml(f.BILL_NUMBER)}</div></div>
                        <div class="col-md-4"><div class="text-muted small">Bill Amount</div><div>${Utils.formatCurrency(f.BILL_AMOUNT)}</div></div>
                        <div class="col-md-4"><div class="text-muted small">Coupons</div><div>${Utils.escapeHtml(f.NUMBER_OF_COUPONS)}</div></div>
                        <div class="col-md-4"><div class="text-muted small">Stockist</div><div>${Utils.escapeHtml(f.STOCKIST_NAME)}</div></div>
                        <div class="col-md-4"><div class="text-muted small">City</div><div>${Utils.escapeHtml(f.CUSTOMER_CITY)}</div></div>
                        <div class="col-md-4"><div class="text-muted small">DSA / ASM / RSM</div><div>${Utils.escapeHtml(f.DSA_HQ)} / ${Utils.escapeHtml(f.ASM_HQ)} / ${Utils.escapeHtml(f.RSM_HQ)}</div></div>
                    </div>
                </div>
            </div>
        `;
    }

    _approvalStatusCard(f) {
        return `
            <div class="card mb-3 border-0 shadow-sm">
                <div class="card-header bg-white"><strong><i class="fa-solid fa-clipboard-check"></i> Approval Status</strong></div>
                <div class="card-body d-flex gap-4">
                    <div>
                        <div class="text-muted small">RSM Approval</div>
                        <span class="badge ${approvalBadgeClass(f.RSM_APPROVAL)} fs-6">${Utils.escapeHtml(f.RSM_APPROVAL || 'Pending')}</span>
                    </div>
                    <div>
                        <div class="text-muted small">HO Approval</div>
                        <span class="badge ${approvalBadgeClass(f.HO_APPROVAL)} fs-6">${Utils.escapeHtml(f.HO_APPROVAL || 'Pending')}</span>
                    </div>
                </div>
            </div>
        `;
    }

    _duplicateRiskCard(finding, risk) {
        return `
            <div class="card mb-3 border-0 shadow-sm">
                <div class="card-header bg-white"><strong><i class="fa-solid fa-clone"></i> Duplicate Risk</strong></div>
                <div class="card-body">
                    <div class="d-flex align-items-center gap-3 mb-3">
                        <span class="badge bg-${risk.color} fs-6">${risk.label}</span>
                        <div class="flex-grow-1">
                            <div class="progress" style="height:10px;">
                                <div class="progress-bar bg-${risk.color}" style="width:${finding.maxScore}%;"></div>
                            </div>
                        </div>
                        <strong>${finding.maxScore}%</strong>
                    </div>
                    <div class="text-muted small mb-1">Matched fields:</div>
                    <div>
                        ${finding.reasons.size
                            ? Array.from(finding.reasons).map(r => `<span class="badge bg-light text-dark border me-1 mb-1">${Utils.escapeHtml(r)}</span>`).join('')
                            : '<span class="text-muted">None</span>'}
                    </div>
                </div>
            </div>
        `;
    }

    _matchedRecordsCard(finding) {
        return `
            ${this._activeMatchesCard(finding)}
            ${this._rejectedMatchesCard(finding)}
        `;
    }

    _activeMatchesCard(finding) {
        if (finding.matches.length === 0) {
            return `
                <div class="card mb-3 border-0 shadow-sm">
                    <div class="card-header bg-white"><strong><i class="fa-solid fa-list-check"></i> Duplicate Records Found</strong></div>
                    <div class="card-body text-muted">No matching claims found.</div>
                </div>
            `;
        }

        const cards = finding.matches.map(m => this._matchCompareCard(m)).join('');

        return `
            <div class="card mb-3 border-0 shadow-sm">
                <div class="card-header bg-white"><strong><i class="fa-solid fa-list-check"></i> Duplicate Records Found (${finding.matches.length})</strong></div>
                <div class="card-body">
                    <div class="row g-3">${cards}</div>
                </div>
            </div>
        `;
    }

    // One comparison card per active duplicate match -- Cert No. is the
    // most prominent field so a reviewer can tell claims apart at a glance.
    _matchCompareCard(m) {
        const risk = DuplicateEngine.riskLevel(m.score);
        const f = (m.record && m.record.fields) || {};

        return `
            <div class="col-md-6">
                <div class="card h-100 border">
                    <div class="card-body">
                        <span class="badge bg-dark fs-6 mb-2">${Utils.escapeHtml(m.certNo)}</span>

                        <div class="text-muted small mt-2">Invoice Number</div>
                        <div class="mb-2">${Utils.escapeHtml(f.BILL_NUMBER)}</div>

                        <div class="text-muted small">Customer</div>
                        <div class="mb-2">${Utils.escapeHtml(f.CUSTOMER_NAME)}</div>

                        <div class="text-muted small">Risk</div>
                        <div class="mb-3"><span class="badge bg-${risk.color}">${risk.label} (${m.score}%)</span></div>

                        <div class="d-flex justify-content-between align-items-center">
                            ${Utils.invoiceButtonHtml(m.record, m.score)}
                            <button class="btn btn-sm btn-outline-secondary" onclick="openClaimReview('${m.id}')">Review</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // Matching claims that are already rejected. Shown for audit purposes
    // only -- these never contribute to the duplicate score or count above.
    _rejectedMatchesCard(finding) {
        const rejected = finding.rejectedMatches || [];
        if (rejected.length === 0) return '';

        const cards = rejected.map(m => this._rejectedCompareCard(m)).join('');

        return `
            <div class="card border-0 shadow-sm">
                <div class="card-header bg-white"><strong><i class="fa-solid fa-ban"></i> Previously Rejected Claims (${rejected.length})</strong></div>
                <div class="card-body">
                    <div class="row g-3">${cards}</div>
                    <div class="text-muted small mt-2">Shown for audit purposes only — excluded from the duplicate risk score.</div>
                </div>
            </div>
        `;
    }

    _rejectedCompareCard(m) {
        const f = (m.record && m.record.fields) || {};

        return `
            <div class="col-md-6">
                <div class="card h-100 border">
                    <div class="card-body">
                        <span class="badge bg-dark fs-6 mb-2">${Utils.escapeHtml(m.certNo)}</span>

                        <div class="text-muted small mt-2">Invoice Number</div>
                        <div class="mb-2">${Utils.escapeHtml(f.BILL_NUMBER)}</div>

                        <div class="text-muted small">Customer</div>
                        <div class="mb-2">${Utils.escapeHtml(f.CUSTOMER_NAME)}</div>

                        <div class="text-muted small">Status</div>
                        <div class="mb-2"><span class="badge bg-secondary">Rejected By ${Utils.escapeHtml(m.rejectedBy)}</span></div>

                        <div class="text-muted small">Matched On</div>
                        <div class="mb-2">${m.reasons.map(r => Utils.escapeHtml(r)).join(', ')}</div>

                        <div class="text-muted small">Reason</div>
                        <div class="mb-3">${Utils.escapeHtml(m.reason || 'Not specified')}</div>

                        <div class="d-flex justify-content-between align-items-center">
                            ${Utils.invoiceButtonHtml(m.record)}
                            <button class="btn btn-sm btn-outline-secondary" onclick="openClaimReview('${m.id}')">Review</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }
}

const approvalWorkflow = new ApprovalWorkflow();

// Global entry point used by inline onclick handlers throughout report tables.
function openClaimReview(recordId) {
    approvalWorkflow.openReview(recordId);
}

// Global entry point for every "View Invoice" button in the app (report
// tables, review modal current claim, matched records, rejected matches).
// Looks the record up from the in-memory claimsData the same way
// openClaimReview does, then hands off to the one shared Utils helper.
function viewInvoice(recordId, score) {
    const record = claimsData.find(r => r.id === recordId);

    if (!record) {
        Utils.showToast('Claim record not found.', false);
        return;
    }

    const duplicateRisk = (score === undefined || score === null)
        ? null
        : { label: DuplicateEngine.riskLevel(score).label, score };

    Utils.openInvoiceViewer(record, duplicateRisk);
}
