/* =====================================================================
   APPROVAL.JS
   HO / RSM approval workflow. When a claim is opened for review, the
   Duplicate Engine is run automatically and results are displayed
   using Bootstrap cards inside a modal.

   As of this version, the modal also lets HO make the actual
   approve/reject decision from the portal (the "HO Decision" section
   at the bottom) -- see approveClaim() / rejectClaim() below. This
   replaces the Android app for HO's part of the workflow only; MR and
   RSM continue to use Android exactly as before.

   Depends on: common.js, duplicate.js, coupons.js, api.js (updateRecord/
   createRecord)
===================================================================== */

const HO_REJECT_REASONS = [
    'Duplicate Invoice',
    'Invoice Not Clear',
    'Incorrect Product',
    'Incorrect Quantity',
    'Coupon Claim Incorrect',
    'Expired Invoice',
    'Other'
];

class ApprovalWorkflow {

    constructor() {
        this.modalEl = null;
        this.modalInstance = null;
        this.bodyEl = null;
        this.titleEl = null;

        this.confirmModalEl = null;
        this.confirmModalInstance = null;

        this.currentRecordId = null;
        this._busy = false;
    }

    init() {
        this.modalEl = document.getElementById('claimReviewModal');
        this.bodyEl = document.getElementById('claimReviewModalBody');
        this.titleEl = document.getElementById('claimReviewModalTitle');

        if (this.modalEl && typeof bootstrap !== 'undefined') {
            this.modalInstance = new bootstrap.Modal(this.modalEl);
        }

        this.confirmModalEl = document.getElementById('hoConfirmModal');
        if (this.confirmModalEl && typeof bootstrap !== 'undefined') {
            this.confirmModalInstance = new bootstrap.Modal(this.confirmModalEl);
        }

        this.successModalEl = document.getElementById('hoApprovalSuccessModal');
        if (this.successModalEl && typeof bootstrap !== 'undefined') {
            this.successModalInstance = new bootstrap.Modal(this.successModalEl);
        }

        this.rejectionModalEl = document.getElementById('hoRejectionSuccessModal');
        if (this.rejectionModalEl && typeof bootstrap !== 'undefined') {
            this.rejectionModalInstance = new bootstrap.Modal(this.rejectionModalEl);
        }

        const successOkBtn = document.getElementById('hoApprovalSuccessOkBtn');
        if (successOkBtn) successOkBtn.addEventListener('click', () => this._onSummaryOk(this.successModalInstance));

        const rejectionOkBtn = document.getElementById('hoRejectionSuccessOkBtn');
        if (rejectionOkBtn) rejectionOkBtn.addEventListener('click', () => this._onSummaryOk(this.rejectionModalInstance));
    }

    // Shared OK-button handler for both summary modals (Enhancements 4 & 5):
    // close the dialog, then advance straight to the next pending claim.
    // loadNextPendingClaim() re-renders/re-shows the Claim Review modal
    // itself (or the "No Pending Claims" state) -- _refreshAppViews() was
    // already called right after the successful write, before the summary
    // was shown, so dashboard/report views are already current.
    _onSummaryOk(modalInstance) {
        if (modalInstance) modalInstance.hide();
        this.loadNextPendingClaim();
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

        this.currentRecordId = recordId;
        this._busy = false;

        const finding = duplicateEngine.analyzeRecord(record, claimsData);

        // Pure display formatting of the already-loaded record -- no
        // calculation, no extra API calls (see coupons.js).
        const couponInfo = getCouponClaimInformation(record);

        this._renderModal(record, finding, couponInfo);
        this._validateDecisionButtons();

        if (this.modalInstance) {
            this.modalInstance.show();
        } else {
            Utils.showToast('Could not open modal: Bootstrap failed to load.', false);
        }
    }

    _renderModal(record, finding, couponInfo) {
        const f = record.fields || {};
        const risk = DuplicateEngine.riskLevel(finding.maxScore);

        this.titleEl.innerText = `Claim Review — ${f.CERT_NO || record.id}`;

        this.bodyEl.innerHTML = `
            ${this._claimInfoCard(record, finding)}
            ${this._couponClaimInfoCard(couponInfo)}
            ${this._approvalStatusCard(f)}
            ${this._duplicateRiskCard(finding, risk)}
            ${this._matchedRecordsCard(finding)}
            ${this._hoDecisionCard(record)}
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

    // ---- Coupon Claim Information card --------------------------------
    // Pure render of the object returned by getCouponClaimInformation()
    // (coupons.js). This is a display of what the DSA entered -- not a
    // calculation, not a validation, not a comparison against any rule.
    _couponClaimInfoCard(c) {
        const rows = c.productRows.map(p => `
            <tr>
                <td>${Utils.escapeHtml(p.label)}</td>
                <td class="text-end" style="max-width:130px;">
                    <input
                        type="number" min="0" step="1" inputmode="numeric"
                        class="form-control form-control-sm text-end ho-qty-input"
                        id="hoQty_${p.key}" data-key="${p.key}"
                        value="${p.qty}"
                        oninput="approvalWorkflow._sanitizeCouponInput(this);">
                </td>
            </tr>
        `).join('');

        const partHtml = c.couponsPart
            ? `<div class="mt-1">${Utils.escapeHtml(c.couponsPart).split(/\n|,/).map(s => s.trim()).filter(Boolean).map(s => `<div>${s}</div>`).join('')}</div>`
            : '<div class="text-muted">Not specified</div>';

        return `
            <div class="card mb-3 border-0 shadow-sm">
                <div class="card-header bg-white">
                    <strong><i class="fa-solid fa-ticket"></i> Coupon Claim Information</strong>
                    <div class="text-muted small">Entered by DSA. Product quantities below can be corrected by HO before approval.</div>
                </div>
                <div class="card-body">

                    <div class="row g-3 mb-3">
                        <div class="col-md-6">
                            <div class="text-muted small">Coupons Claimed</div>
                            <div class="fs-4 fw-bold">${Utils.escapeHtml(c.couponsClaimed)}</div>
                        </div>
                        <div class="col-md-6">
                            <div class="text-muted small">Coupon Part</div>
                            ${partHtml}
                        </div>
                    </div>

                    <div class="table-responsive">
                        <table class="table table-sm align-middle mb-3">
                            <thead>
                                <tr class="text-muted small">
                                    <th>Product</th>
                                    <th class="text-end">Quantity (Editable)</th>
                                </tr>
                            </thead>
                            <tbody>${rows}</tbody>
                        </table>
                    </div>

                    <div class="d-flex gap-4 border-top pt-3">
                        <div>
                            <div class="text-muted small">Products with Quantity Entered</div>
                            <div>${c.productsWithQuantity}</div>
                        </div>
                        <div>
                            <div class="text-muted small">Products with Zero Quantity</div>
                            <div>${c.productsWithZeroQuantity}</div>
                        </div>
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
    // =====================================================================
    // HO DECISION -- approve/reject a claim, and generate the Coupons
    // Generated row, directly from the portal. This is the only part of
    // the review modal that writes to Airtable.
    // =====================================================================

    // The ONLY state in which HO may decide a claim: RSM has already
    // approved it, and HO hasn't decided it yet. Every other
    // combination -- HO already Approved (would generate duplicate
    // coupons), HO already Rejected, RSM Rejected, or RSM still
    // Pending -- must be locked, whether the reviewer got here via the
    // main pending queue or via "Review" on a matched duplicate record
    // (see _matchedRecordsCard / viewInvoice call sites) -- this record
    // is re-fetched from claimsData fresh every time _renderModal runs,
    // so it always reflects that specific record's own current status,
    // not whatever record was open before it.
    _isDecidable(record) {
        const f = (record && record.fields) || {};
        return Utils.normalizeString(f.RSM_APPROVAL) === 'approved' &&
               Utils.normalizeString(f.HO_APPROVAL) === 'pending';
    }

    _hoDecisionCard(record) {
        if (!this._isDecidable(record)) {
            return this._hoDecisionLockedCard(record);
        }

        const f = record.fields || {};
        const claimed = Utils.safeNumber(f.NUMBER_OF_COUPONS, 0);

        const reasonOptions = HO_REJECT_REASONS
            .map(r => `<option value="${Utils.escapeHtml(r)}">${Utils.escapeHtml(r)}</option>`)
            .join('');

        return `
            <div class="card mb-3 border-0 shadow-sm">
                <div class="card-header bg-white"><strong><i class="fa-solid fa-user-shield"></i> HO Decision</strong></div>
                <div class="card-body">

                    <div class="row g-3 mb-3">
                        <div class="col-md-6">
                            <div class="text-muted small">Coupons Claimed by DSA</div>
                            <div class="fs-4 fw-bold">${claimed}</div>
                        </div>
                        <div class="col-md-6">
                            <label class="form-label text-muted small mb-1" for="hoApprovedCoupons">Approved Coupon Count</label>
                            <input
                                type="number" min="0" step="1" inputmode="numeric"
                                id="hoApprovedCoupons" class="form-control"
                                value="${claimed}"
                                oninput="approvalWorkflow._sanitizeCouponInput(this); approvalWorkflow._validateDecisionButtons();">
                        </div>
                    </div>

                    <div class="mb-3">
                        <label class="form-label text-muted small mb-1" for="hoRemarks">HO Remarks <span class="text-muted">(optional)</span></label>
                        <textarea id="hoRemarks" class="form-control" rows="2" placeholder="e.g. Invoice verified. Eligible products confirmed."></textarea>
                    </div>

                    <div class="mb-3">
                        <label class="form-label text-muted small mb-1" for="hoRejectReason">Reject Reason</label>
                        <select id="hoRejectReason" class="form-select" onchange="approvalWorkflow._onRejectReasonChange()">
                            <option value="">-- Select reason (required to reject) --</option>
                            ${reasonOptions}
                        </select>
                    </div>

                    <div class="mb-3" id="hoCustomReasonWrap" style="display:none;">
                        <label class="form-label text-muted small mb-1" for="hoCustomReason">Custom Reason</label>
                        <textarea id="hoCustomReason" class="form-control" rows="2" oninput="approvalWorkflow._validateDecisionButtons();"></textarea>
                    </div>

                    <div class="row g-2">
                        <div class="col-md-6">
                            <button class="btn btn-success btn-lg w-100" id="hoApproveBtn" onclick="approvalWorkflow.showApprovalDialog()">
                                <i class="fa-solid fa-check"></i> Approve Claim
                            </button>
                        </div>
                        <div class="col-md-6">
                            <button class="btn btn-danger btn-lg w-100" id="hoRejectBtn" disabled onclick="approvalWorkflow.showRejectDialog()">
                                <i class="fa-solid fa-xmark"></i> Reject Claim
                            </button>
                        </div>
                    </div>

                    <div id="hoDecisionStatus" class="mt-3"></div>

                </div>
            </div>
        `;
    }

    // Rendered instead of the interactive form whenever _isDecidable()
    // is false -- no coupon-count input, no reject reason, no Approve/
    // Reject buttons at all, so there is nothing for approveClaim() /
    // rejectClaim() to even be wired to. This is what fixes the "Review"
    // button on a matched duplicate record showing live Approve/Reject
    // buttons for a claim that was already decided.
    _hoDecisionLockedCard(record) {
        const f = record.fields || {};
        const rsm = Utils.normalizeString(f.RSM_APPROVAL);
        const ho = Utils.normalizeString(f.HO_APPROVAL);

        let reason;
        if (ho === 'approved') {
            reason = 'This claim has already been approved by HO. Approving or rejecting it again would generate duplicate coupons.';
        } else if (ho === 'rejected') {
            reason = 'This claim has already been rejected by HO.';
        } else if (rsm === 'rejected') {
            reason = 'This claim was rejected by RSM and is not eligible for an HO decision.';
        } else {
            reason = 'This claim has not yet been approved by RSM, so it is not eligible for an HO decision yet.';
        }

        return `
            <div class="card mb-3 border-0 shadow-sm">
                <div class="card-header bg-white"><strong><i class="fa-solid fa-user-shield"></i> HO Decision</strong></div>
                <div class="card-body">
                    <div class="alert alert-secondary mb-0">
                        <i class="fa-solid fa-lock"></i>
                        <strong>Decision Locked.</strong> ${Utils.escapeHtml(reason)}
                    </div>
                </div>
            </div>
        `;
    }

    // Strip anything that isn't a plain digit as the reviewer types --
    // enforces "integer only, no negative, no decimals" at the input
    // level rather than only validating after the fact.
    _sanitizeCouponInput(el) {
        const cleaned = el.value.replace(/[^0-9]/g, '');
        if (cleaned !== el.value) el.value = cleaned;
    }

    // Read the current value of every per-product quantity input (see
    // COUPON_PRODUCTS in coupons.js). Whether or not HO actually changed
    // anything, this always reflects what's on screen right now, so the
    // values used for coupon generation exactly match what HO reviewed.
    _getEditedQuantities() {
        const result = {};
        COUPON_PRODUCTS.forEach(p => {
            const el = document.getElementById(`hoQty_${p.key}`);
            result[p.key] = el ? Utils.safeNumber(el.value, 0) : 0;
        });
        return result;
    }

    _onRejectReasonChange() {
        const sel = document.getElementById('hoRejectReason');
        const wrap = document.getElementById('hoCustomReasonWrap');
        if (wrap) wrap.style.display = (sel && sel.value === 'Other') ? 'block' : 'none';
        this._validateDecisionButtons();
    }

    _isApproveValid() {
        const record = claimsData.find(r => r.id === this.currentRecordId);
        if (!record || !this._isDecidable(record)) return false;
        const el = document.getElementById('hoApprovedCoupons');
        if (!el || el.value === '' || el.value === null) return false;
        const n = Number(el.value);
        return Number.isInteger(n) && n >= 0;
    }

    _isRejectValid() {
        const record = claimsData.find(r => r.id === this.currentRecordId);
        if (!record || !this._isDecidable(record)) return false;
        const el = document.getElementById('hoRejectReason');
        if (!el || !el.value) return false;
        if (el.value === 'Other') {
            const custom = document.getElementById('hoCustomReason');
            return !!(custom && Utils.safeTrim(custom.value));
        }
        return true;
    }

    // Approve disabled while blank/invalid; Reject disabled until a
    // reason (and custom text, if "Other") is provided. Called on every
    // relevant input/change and once right after the card is rendered.
    _validateDecisionButtons() {
        if (this._busy) return;
        const approveBtn = document.getElementById('hoApproveBtn');
        const rejectBtn = document.getElementById('hoRejectBtn');
        if (approveBtn) approveBtn.disabled = !this._isApproveValid();
        if (rejectBtn) rejectBtn.disabled = !this._isRejectValid();
    }

    // Disable every decision control while an Airtable write is in
    // flight, so a double-click can never fire two updates.
    _setDecisionBusy(busy, message) {
        this._busy = busy;
        ['hoApprovedCoupons', 'hoRemarks', 'hoRejectReason', 'hoCustomReason'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.disabled = busy;
        });
        document.querySelectorAll('.ho-qty-input').forEach(el => { el.disabled = busy; });

        const approveBtn = document.getElementById('hoApproveBtn');
        const rejectBtn = document.getElementById('hoRejectBtn');
        if (approveBtn) approveBtn.disabled = busy || !this._isApproveValid();
        if (rejectBtn) rejectBtn.disabled = busy || !this._isRejectValid();

        const statusEl = document.getElementById('hoDecisionStatus');
        if (busy && statusEl) {
            statusEl.innerHTML = `
                <div class="alert alert-info d-flex align-items-center gap-2 mb-0">
                    <span class="spinner-border spinner-border-sm"></span>
                    <div>${Utils.escapeHtml(message || 'Saving...')} <span class="text-muted">Please wait...</span></div>
                </div>
            `;
        }
    }

    _clearDecisionStatus() {
        const statusEl = document.getElementById('hoDecisionStatus');
        if (statusEl) statusEl.innerHTML = '';
    }

    _showDecisionResult(variant, title, subtitle) {
        const statusEl = document.getElementById('hoDecisionStatus');
        if (statusEl) {
            statusEl.innerHTML = `
                <div class="alert alert-${variant} d-flex align-items-center gap-2 mb-0">
                    <i class="fa-solid fa-circle-check"></i>
                    <div><strong>${Utils.escapeHtml(title)}</strong><div class="small">${Utils.escapeHtml(subtitle)}</div></div>
                </div>
            `;
        }
        Utils.showToast(title, variant === 'success');
    }

    _showDecisionError(title, message, retryFn) {
        const statusEl = document.getElementById('hoDecisionStatus');
        if (statusEl) {
            statusEl.innerHTML = `
                <div class="alert alert-danger d-flex justify-content-between align-items-center mb-0">
                    <div><strong>${Utils.escapeHtml(title)}</strong><div class="small">${Utils.escapeHtml(message)}</div></div>
                    <button type="button" class="btn btn-sm btn-outline-danger" id="hoRetryBtn"><i class="fa-solid fa-rotate"></i> Retry</button>
                </div>
            `;
            const retryBtn = document.getElementById('hoRetryBtn');
            if (retryBtn) retryBtn.addEventListener('click', retryFn);
        }
        Utils.showToast(title, false);
    }

    // ---- Confirmation dialogs ------------------------------------------

    showApprovalDialog() {
        if (!this._isApproveValid()) return;
        const record = claimsData.find(r => r.id === this.currentRecordId);
        if (!record) return;

        const f = record.fields || {};
        const approvedCoupons = parseInt(document.getElementById('hoApprovedCoupons').value, 10);

        document.getElementById('hoConfirmHeader').className = 'modal-header bg-success text-white';
        document.getElementById('hoConfirmTitle').innerText = 'Approve Claim?';
        document.getElementById('hoConfirmBody').innerHTML = `
            <div class="mb-2"><div class="text-muted small">Reference Number</div><div class="fw-bold">${Utils.escapeHtml(f.CERT_NO || record.id)}</div></div>
            <div class="mb-2"><div class="text-muted small">Approved Coupons</div><div class="fw-bold">${approvedCoupons}</div></div>
            <div>Proceed?</div>
        `;

        const actionBtn = document.getElementById('hoConfirmActionBtn');
        actionBtn.className = 'btn btn-success';
        actionBtn.innerText = 'Approve';
        actionBtn.onclick = () => this.approveClaim();

        this._showConfirmModal();
    }

    showRejectDialog() {
        if (!this._isRejectValid()) return;
        const record = claimsData.find(r => r.id === this.currentRecordId);
        if (!record) return;

        const f = record.fields || {};
        const reason = this._resolveRejectReason();

        document.getElementById('hoConfirmHeader').className = 'modal-header bg-danger text-white';
        document.getElementById('hoConfirmTitle').innerText = 'Reject Claim?';
        document.getElementById('hoConfirmBody').innerHTML = `
            <div class="mb-2"><div class="text-muted small">Reference Number</div><div class="fw-bold">${Utils.escapeHtml(f.CERT_NO || record.id)}</div></div>
            <div class="mb-2"><div class="text-muted small">Reason</div><div class="fw-bold">${Utils.escapeHtml(reason)}</div></div>
        `;

        const actionBtn = document.getElementById('hoConfirmActionBtn');
        actionBtn.className = 'btn btn-danger';
        actionBtn.innerText = 'Reject';
        actionBtn.onclick = () => this.rejectClaim();

        this._showConfirmModal();
    }

    _resolveRejectReason() {
        const sel = document.getElementById('hoRejectReason');
        if (!sel) return '';
        if (sel.value === 'Other') {
            return Utils.safeTrim(document.getElementById('hoCustomReason').value) || 'Other';
        }
        return sel.value;
    }

    // ---- Post-decision summary modals (Enhancements 4 & 5) -------------

    // Reference Number / Customer Name / DSA HQ / ASM HQ / RSM HQ are read
    // straight from the Claims record (unchanged by approval). Coupon
    // Numbers come from the freshly read-back Generated rows (see
    // createCouponGeneratedRecord) -- CERT_NO is a Formula field, so a row
    // that somehow couldn't be re-read shows "Pending" rather than a blank.
    //
    // opts (Version 3.1.1): { partial, requestedCount, successCount, auditLogged }
    // -- when partial is true, or auditLogged is false, a warning banner
    // is shown at the top of the modal. The title/header stays "Claim
    // Approved Successfully" either way -- the approval itself DID
    // succeed (HO_APPROVAL is already 'Approved' in Airtable by the time
    // this is called); these banners communicate a secondary issue
    // (fewer coupons than requested, or the audit log write failing)
    // without implying the approval was rejected or lost.
    _showApprovalSuccessSummary(record, approvedCoupons, rows, opts) {
        const f = record.fields || {};
        const now = new Date();
        opts = opts || {};

        const couponNumbers = (rows || []).map(r => Utils.safeTrim((r && r.fields && r.fields.CERT_NO) || ''));

        const couponRowsHtml = couponNumbers.map(num => `
            <tr>
                <td>${num ? Utils.escapeHtml(num) : '<span class="text-muted">Pending</span>'}</td>
                <td>${num ? '<span class="text-success">&#9989; Generated</span>' : '<span class="text-warning">Pending</span>'}</td>
            </tr>
        `).join('');

        const scrollable = couponNumbers.length > 10;

        let warningsHtml = '';
        if (opts.partial) {
            warningsHtml += `
                <div class="alert alert-warning mb-3">
                    <strong>Partial Completion.</strong>
                    Requested ${opts.requestedCount} coupon${opts.requestedCount === 1 ? '' : 's'},
                    but only ${opts.successCount} were successfully generated.
                    The claim itself is still approved -- please review and generate
                    the remaining coupons for this claim separately; no automatic
                    retry was attempted, to avoid creating duplicates.
                </div>
            `;
        }
        if (opts.auditLogged === false) {
            warningsHtml += `
                <div class="alert alert-warning mb-3">
                    <strong>Audit Log Warning.</strong>
                    The claim was approved and the coupons above were generated
                    successfully, but this decision could not be recorded in the
                    approval audit log. Please notify an administrator.
                </div>
            `;
        }

        const bodyEl = document.getElementById('hoApprovalSuccessBody');
        if (bodyEl) {
            bodyEl.innerHTML = `
                ${warningsHtml}
                <div class="row g-3 mb-3">
                    <div class="col-md-6"><div class="text-muted small">Reference Number</div><div class="fw-bold">${Utils.escapeHtml(f.CERT_NO || record.id)}</div></div>
                    <div class="col-md-6"><div class="text-muted small">Customer Name</div><div class="fw-bold">${Utils.escapeHtml(f.CUSTOMER_NAME)}</div></div>
                    <div class="col-md-4"><div class="text-muted small">DSA HQ</div><div>${Utils.escapeHtml(f.DSA_HQ)}</div></div>
                    <div class="col-md-4"><div class="text-muted small">ASM HQ</div><div>${Utils.escapeHtml(f.ASM_HQ)}</div></div>
                    <div class="col-md-4"><div class="text-muted small">RSM HQ</div><div>${Utils.escapeHtml(f.RSM_HQ)}</div></div>
                    <div class="col-md-4"><div class="text-muted small">Approved Coupon Count</div><div class="fw-bold">${approvedCoupons}</div></div>
                    <div class="col-md-4"><div class="text-muted small">Approval Date</div><div>${now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div></div>
                    <div class="col-md-4"><div class="text-muted small">Approval Time</div><div>${now.toLocaleTimeString('en-IN')}</div></div>
                </div>
                <hr>
                <div class="text-muted small mb-2">
                    Generated Coupon Numbers
                    ${opts.partial ? `<span class="text-muted">(${opts.successCount} of ${opts.requestedCount})</span>` : ''}
                </div>
                <div style="${scrollable ? 'max-height:280px;overflow:auto;' : ''}">
                    <table class="table table-sm table-bordered mb-0">
                        <thead><tr><th>Coupon No.</th><th>Status</th></tr></thead>
                        <tbody>${couponRowsHtml}</tbody>
                    </table>
                </div>
            `;
        }

        if (!this.successModalInstance) {
            this.successModalEl = document.getElementById('hoApprovalSuccessModal');
            if (this.successModalEl && typeof bootstrap !== 'undefined') {
                this.successModalInstance = new bootstrap.Modal(this.successModalEl);
            }
        }
        if (this.successModalInstance) this.successModalInstance.show();
    }

    // opts (Version 3.1.1): { auditLogged } -- see _showApprovalSuccessSummary
    // for why this is a banner, not a "Rejection Failed" state.
    _showRejectionSuccessSummary(record, reason, remarks, opts) {
        const f = record.fields || {};
        const now = new Date();
        opts = opts || {};

        const warningHtml = (opts.auditLogged === false) ? `
            <div class="alert alert-warning mb-3">
                <strong>Audit Log Warning.</strong>
                The claim was rejected successfully, but this decision could not be
                recorded in the approval audit log. Please notify an administrator.
            </div>
        ` : '';

        const bodyEl = document.getElementById('hoRejectionSuccessBody');
        if (bodyEl) {
            bodyEl.innerHTML = `
                ${warningHtml}
                <div class="row g-3">
                    <div class="col-md-6"><div class="text-muted small">Reference Number</div><div class="fw-bold">${Utils.escapeHtml(f.CERT_NO || record.id)}</div></div>
                    <div class="col-md-6"><div class="text-muted small">Customer Name</div><div class="fw-bold">${Utils.escapeHtml(f.CUSTOMER_NAME)}</div></div>
                    <div class="col-md-4"><div class="text-muted small">DSA HQ</div><div>${Utils.escapeHtml(f.DSA_HQ)}</div></div>
                    <div class="col-md-4"><div class="text-muted small">ASM HQ</div><div>${Utils.escapeHtml(f.ASM_HQ)}</div></div>
                    <div class="col-md-4"><div class="text-muted small">RSM HQ</div><div>${Utils.escapeHtml(f.RSM_HQ)}</div></div>
                    <div class="col-md-6"><div class="text-muted small">Reject Reason</div><div class="fw-bold">${Utils.escapeHtml(reason)}</div></div>
                    <div class="col-md-6"><div class="text-muted small">HO Remarks</div><div>${remarks ? Utils.escapeHtml(remarks) : '<span class="text-muted">None</span>'}</div></div>
                    <div class="col-md-6"><div class="text-muted small">Rejected Date</div><div>${now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</div></div>
                    <div class="col-md-6"><div class="text-muted small">Rejected Time</div><div>${now.toLocaleTimeString('en-IN')}</div></div>
                </div>
            `;
        }

        if (!this.rejectionModalInstance) {
            this.rejectionModalEl = document.getElementById('hoRejectionSuccessModal');
            if (this.rejectionModalEl && typeof bootstrap !== 'undefined') {
                this.rejectionModalInstance = new bootstrap.Modal(this.rejectionModalEl);
            }
        }
        if (this.rejectionModalInstance) this.rejectionModalInstance.show();
    }

    _showConfirmModal() {
        if (!this.confirmModalInstance) {
            this.confirmModalEl = document.getElementById('hoConfirmModal');
            if (this.confirmModalEl && typeof bootstrap !== 'undefined') {
                this.confirmModalInstance = new bootstrap.Modal(this.confirmModalEl);
            }
        }
        if (this.confirmModalInstance) this.confirmModalInstance.show();
    }

    _hideConfirmModal() {
        if (this.confirmModalInstance) this.confirmModalInstance.hide();
    }

    // ---- Refresh already-rendered views after a successful write -------
    // Reuses the app's own page router (script.js) rather than
    // duplicating any dashboard/report rendering logic here -- this
    // covers "refresh dashboard / refresh reports / refresh approval
    // page" generically, whichever one is currently on screen, without
    // this file needing to know how any of them actually render.
    _refreshAppViews() {
        if (typeof showPage === 'function' && window.currentPage) {
            showPage(window.currentPage);
        }
    }

    // Console-only audit trail, per spec -- no dedicated Airtable/logging
    // table exists for this.
    _logAudit(action, record) {
        console.log('[KCJ Audit]', {
            action,
            certNo: record.fields && record.fields.CERT_NO,
            recordId: record.id,
            timestamp: new Date().toISOString(),
            browser: navigator.userAgent,
            portalVersion: 'KCJ Admin Portal V2'
        });
    }

    // ---- Actions ---------------------------------------------------------

    // Approve the current claim: one Airtable update (Claims table) +
    // N Airtable creates (Coupons Generated table, one per approved
    // coupon). Reuses the record already in claimsData -- no re-fetch.
    //
    // The Claims table PATCH updates ONLY HO_APPROVAL. HO_REMARKS,
    // HO_APPROVAL_DATE, HO_APPROVAL_TIME, and HO_REJECTION_REASON do not
    // exist as columns in this Airtable base and must never be sent --
    // sending them is what was causing the update to fail.
    async approveClaim() {
        const record = claimsData.find(r => r.id === this.currentRecordId);
        if (!record || !this._isApproveValid()) return;

        const approvedCoupons = parseInt(document.getElementById('hoApprovedCoupons').value, 10);
        const editedQuantities = this._getEditedQuantities();

        this._hideConfirmModal();
        this._setDecisionBusy(true, 'Saving Approval...');

        const claimUpdate = {
            HO_APPROVAL: 'Approved'
        };

        try {
            await updateRecord(CONFIG.CLAIMS_BASE_ID, CONFIG.CLAIMS_TABLE, record.id, claimUpdate);

            // Reflect the write locally -- see PERFORMANCE note (no re-fetch).
            // Note: the Claims record itself is NEVER updated with the
            // edited product quantities or a recalculated coupon count --
            // per spec, only HO_APPROVAL (and, on reject, COUPONS_PART)
            // are ever written back to the Claims table. Edited quantities
            // only flow into the Coupons Generated rows below.
            //
            // From this line on, the approval itself has been accepted --
            // HO_APPROVAL is already 'Approved' in Airtable. Nothing
            // below, including a partial/failed coupon-generation run or
            // a failed audit-log write, is ever reported to the reviewer
            // as "Approval Failed" -- that phrase is reserved for the
            // updateRecord() call above failing, before anything at all
            // was written (see the catch block).
            Object.assign(record.fields, claimUpdate);
            this._logAudit('APPROVE', record);

            // STEP 3/4: only generate coupons after the Claims update is
            // confirmed successful. createCouponGeneratedRecord() never
            // throws for a per-row creation failure (see its own
            // comments) -- it stops and reports honestly instead, so a
            // partial run here can never look like a thrown exception
            // that lands in the catch block below.
            this._updateBusyMessage('Generating Coupons...');
            const genResult = await this.createCouponGeneratedRecord(record, approvedCoupons, editedQuantities);
            console.log(`[KCJ Approval] Created ${genResult.successCount} of ${genResult.requestedCount} Coupons Generated row(s) for`, record.fields.CERT_NO);

            this._setDecisionBusy(false);
            this._clearDecisionStatus();
            this._refreshAppViews();

            // STATUS reflects what actually happened -- never reported as
            // fully successful when it wasn't:
            //   'Completed' -- every requested coupon was created
            //   'Partial'   -- some, but not all, were created
            //   'Failed'    -- none were created despite requesting >= 1
            const originalCoupons = Utils.safeNumber(record.fields.NUMBER_OF_COUPONS, 0);
            const couponCountEdited = approvedCoupons !== originalCoupons;
            const skuEdited = COUPON_PRODUCTS.some(p =>
                editedQuantities[p.key] !== Utils.safeNumber(record.fields[p.key], 0)
            );

            let status;
            if (genResult.successCount === genResult.requestedCount) {
                status = 'Completed';
            } else if (genResult.successCount === 0) {
                status = 'Failed';
            } else {
                status = 'Partial';
            }

            // Version 3.1: write one permanent ApprovalLog row for this
            // decision -- only after the sequence above has fully
            // finished (successfully, partially, or not at all). Never
            // allowed to undo the approval or the coupons already
            // created: a failure here is surfaced to the reviewer as a
            // visible warning banner in the summary modal below (never
            // silently swallowed to console-only), but is still never
            // treated as an approval failure -- the claim was already
            // approved and whatever coupons were created already exist
            // regardless of whether this particular write succeeds.
            let auditLogged = true;
            try {
                await logApprovalDecision({
                    claimRecordId: record.id,
                    txnId: record.fields.CERT_NO || '', // Reference No. from the Claims record (Coupons Claimed table)
                    customerName: record.fields.CUSTOMER_NAME,
                    dsaName: record.fields.DSA_NAME,
                    dsaHq: record.fields.DSA_HQ,
                    asmHq: record.fields.ASM_HQ,
                    rsmHq: record.fields.RSM_HQ,
                    decision: 'Approved',
                    originalCoupons: originalCoupons,
                    approvedCoupons: approvedCoupons,
                    couponRecordsCreated: genResult.successCount,
                    skuEdited: skuEdited,
                    couponCountEdited: couponCountEdited,
                    status: status,
                    errorMessage: genResult.errorMessage || ''
                });
            } catch (logErr) {
                console.error('[KCJ Approval] logApprovalDecision failed (approval itself already succeeded):', logErr);
                auditLogged = false;
            }

            this._showApprovalSuccessSummary(record, approvedCoupons, genResult.rows, {
                partial: status !== 'Completed',
                requestedCount: genResult.requestedCount,
                successCount: genResult.successCount,
                auditLogged: auditLogged
            });

        } catch (err) {
            console.error('[KCJ Approval] approveClaim failed:', err);
            this._setDecisionBusy(false);
            this._showDecisionError('Approval Failed', 'Unable to update Airtable.', () => this.approveClaim());
        }
    }

    // Reject the current claim: one Airtable update, no coupon rows.
    //
    // Per current schema, the rejection reason has nowhere else to go --
    // HO_REJECTION_REASON is not a real column -- so the selected reason
    // is written into COUPONS_PART instead, exactly as specified. This
    // does overwrite whatever COUPONS_PART held before (the DSA's
    // original entry, shown in the Coupon Claim Information card) for
    // any claim rejected through the portal.
    async rejectClaim() {
        const record = claimsData.find(r => r.id === this.currentRecordId);
        if (!record || !this._isRejectValid()) return;

        const reason = this._resolveRejectReason();
        const remarksEl = document.getElementById('hoRemarks');
        const remarks = Utils.safeTrim(remarksEl ? remarksEl.value : '');

        // Store both the selected reason and the optional HO remarks in
        // COUPONS_PART -- "Reason - Remarks", or just "Reason" when no
        // remarks were entered (never leave a trailing " - ").
        const couponsPart = remarks ? `${reason} - ${remarks}` : reason;

        this._hideConfirmModal();
        this._setDecisionBusy(true, 'Saving Rejection...');

        const claimUpdate = {
            HO_APPROVAL: 'Rejected',
            COUPONS_PART: couponsPart
        };

        try {
            await updateRecord(CONFIG.CLAIMS_BASE_ID, CONFIG.CLAIMS_TABLE, record.id, claimUpdate);

            Object.assign(record.fields, claimUpdate);
            this._logAudit('REJECT', record);

            this._setDecisionBusy(false);
            this._clearDecisionStatus();
            this._refreshAppViews();

            // Version 3.1: same ApprovalLog write as approveClaim() --
            // only after the rejection has already succeeded, and never
            // allowed to undo it. A failure here is surfaced as a
            // visible warning banner in the summary modal (never
            // silently swallowed to console-only).
            let auditLogged = true;
            try {
                await logApprovalDecision({
                    claimRecordId: record.id,
                    txnId: record.fields.CERT_NO || '', // Reference No. from the Claims record (Coupons Claimed table)
                    customerName: record.fields.CUSTOMER_NAME,
                    dsaName: record.fields.DSA_NAME,
                    dsaHq: record.fields.DSA_HQ,
                    asmHq: record.fields.ASM_HQ,
                    rsmHq: record.fields.RSM_HQ,
                    decision: 'Rejected',
                    originalCoupons: Utils.safeNumber(record.fields.NUMBER_OF_COUPONS, 0),
                    approvedCoupons: 0,
                    couponRecordsCreated: 0,
                    rejectReason: reason,
                    hoRemarks: remarks,
                    skuEdited: false,
                    couponCountEdited: false,
                    status: 'Completed',
                    errorMessage: ''
                });
            } catch (logErr) {
                console.error('[KCJ Approval] logApprovalDecision failed (rejection itself already succeeded):', logErr);
                auditLogged = false;
            }

            this._showRejectionSuccessSummary(record, reason, remarks, { auditLogged: auditLogged });

        } catch (err) {
            console.error('[KCJ Approval] rejectClaim failed:', err);
            this._setDecisionBusy(false);
            this._showDecisionError('Rejection Failed', 'Unable to update Airtable.', () => this.rejectClaim());
        }
    }

    // Create the Coupons Generated rows -- ONE ROW PER APPROVED COUPON,
    // not a single row carrying a count.
    //
    // The reference Android blocks make this unambiguous: Clock5 fires
    // once, sets a counter to the approved coupon count, and calls
    // Spreadsheet.CreateRow. Spreadsheet.RowCreated then checks the
    // counter -- if still > 1, it decrements and re-triggers Clock3,
    // which calls CreateRow again with the exact same field values.
    // This repeats until the counter reaches 1. So an approved count of
    // 3 produces 3 separate rows in the Coupons Generated table, each
    // with identical claim data -- it does NOT write NUMBER_OF_COUPONS=3
    // once. (An earlier version of this file got this wrong -- it wrote
    // a single row with NUMBER_OF_COUPONS set to the approved count.)
    //
    // Rows are created sequentially (matching Android's one-at-a-time
    // timer loop) rather than in parallel, so we don't burst past
    // Airtable's rate limit.
    //
    // Version 3.1.1: if a create fails partway through (e.g. row 4 of
    // 5), this NEVER throws out to the caller -- doing so used to make
    // the whole approval look "Failed" even though HO_APPROVAL had
    // already been written and rows 1-3 already existed. Instead, the
    // loop stops (no blind continuation, no automatic retry -- either
    // of which risks duplicate coupons) and the honest
    // requested-vs-created counts are returned for the caller
    // (approveClaim) to report accurately.
    async createCouponGeneratedRecord(record, approvedCoupons, editedQuantities) {
        const fields = this._buildCouponGeneratedFields(record, approvedCoupons, editedQuantities);
        const created = [];
        let creationError = null;

        for (let i = 0; i < approvedCoupons; i++) {
            this._updateBusyMessage(`Generating Coupons... (${i + 1} of ${approvedCoupons})`);

            try {
                const row = await createRecord(CONFIG.GENERATED_BASE_ID, CONFIG.GENERATED_TABLE, fields);
                created.push(row);

                // Keep the in-memory generatedData list consistent so the
                // Generated reports reflect the new rows without an extra fetch.
                if (typeof generatedData !== 'undefined' && row) generatedData.push(row);
            } catch (err) {
                console.error(`[KCJ Approval] Coupon creation failed at row ${i + 1} of ${approvedCoupons}:`, err);
                creationError = err;
                break; // stop -- do not blindly continue, do not retry.
            }
        }

        // CERT_NO is a Formula field in the Coupons Generated base,
        // derived from AUTO_NO. Rather than trust that the create
        // response above already carries the computed value, read every
        // successfully created row back so the approval summary can show
        // the real Coupon Numbers. Rows that failed to create are never
        // attempted here -- there is nothing to read back.
        this._updateBusyMessage('Retrieving Generated Coupon Numbers...');
        const refreshed = [];
        for (const row of created) {
            try {
                const full = await getRecord(CONFIG.GENERATED_BASE_ID, CONFIG.GENERATED_TABLE, row.id);
                refreshed.push(full);

                if (typeof generatedData !== 'undefined') {
                    const idx = generatedData.findIndex(r => r.id === row.id);
                    if (idx !== -1) generatedData[idx] = full;
                }
            } catch (err) {
                console.error('[KCJ Approval] Could not read back generated record', row.id, err);
                refreshed.push(row); // fall back to the create response
            }
        }

        return {
            rows: refreshed,
            requestedCount: approvedCoupons,
            successCount: refreshed.length,
            failed: !!creationError,
            errorMessage: creationError ? (creationError.message || String(creationError)) : ''
        };
    }

    // Update just the status message during a busy operation, without
    // re-disabling/re-validating every control each time (used to show
    // per-row progress while createCouponGeneratedRecord loops).
    _updateBusyMessage(message) {
        const statusEl = document.getElementById('hoDecisionStatus');
        if (!statusEl) return;
        statusEl.innerHTML = `
            <div class="alert alert-info d-flex align-items-center gap-2 mb-0">
                <span class="spinner-border spinner-border-sm"></span>
                <div>${Utils.escapeHtml(message)} <span class="text-muted">Please wait...</span></div>
            </div>
        `;
    }

    // Every GENERATED_COLUMN_ORDER field, copied 1:1 from the Claims
    // record -- exactly what Android already copies -- except:
    //   - AUTO_NO is skipped: it is an Airtable autonumber field in the
    //     Generated base and cannot be set manually; Airtable assigns it.
    //   - CERT_NO is skipped: it is a Formula field in the Generated base,
    //     computed by Airtable from AUTO_NO (e.g. AUTO_NO 4512 ->
    //     "KCJ004512"). The key must be entirely absent from the create
    //     payload -- not "", not null, not undefined -- or Airtable
    //     rejects the write. Claims-table behaviour is unaffected; this
    //     only applies to rows created in the Generated base.
    //   - NUMBER_OF_COUPONS uses the HO-approved value, not the DSA value.
    //     (Copied unchanged into every one of the N rows -- the reference
    //     blocks pass the identical field list to every CreateRow call in
    //     the loop, so this is not decremented per row.)
    //   - HO_APPROVAL is written as 'Approved' (this row only ever gets
    //     created on approval).
    //   - Any Kofol product column present in editedQuantities uses HO's
    //     on-screen value instead of the DSA's original entry (Enhancement
    //     3) -- the Claims record itself is left untouched either way.
    // No other field is renamed, transformed, or omitted.
    _buildCouponGeneratedFields(record, approvedCoupons, editedQuantities) {
        const f = record.fields || {};
        const fields = {};

        GENERATED_COLUMN_ORDER.forEach(col => {
            if (col === 'AUTO_NO') return;
            if (col === 'CERT_NO') return;
            if (col === 'NUMBER_OF_COUPONS') { fields[col] = approvedCoupons; return; }
            if (col === 'HO_APPROVAL') { fields[col] = 'Approved'; return; }
            if (editedQuantities && Object.prototype.hasOwnProperty.call(editedQuantities, col)) {
                fields[col] = editedQuantities[col];
                return;
            }
            if (f[col] !== undefined) fields[col] = f[col];
        });

        return fields;
    }

    // Find the next RSM-Approved / HO-Pending claim already in memory
    // (oldest first) and open it. If none remain, show the completion
    // state instead. (View refreshing now happens right after a
    // successful approve/reject -- see _refreshAppViews() -- so this
    // only needs to handle advancing to the next claim.)
    loadNextPendingClaim() {
        const pending = claimsData
            .filter(r => r.fields.RSM_APPROVAL === 'Approved' && r.fields.HO_APPROVAL === 'Pending')
            .sort((a, b) => {
                const da = Utils.parseDate(a.fields.DATE);
                const db = Utils.parseDate(b.fields.DATE);
                const ta = da ? da.getTime() : Number.MAX_SAFE_INTEGER;
                const tb = db ? db.getTime() : Number.MAX_SAFE_INTEGER;
                return ta - tb;
            });

        if (pending.length === 0) {
            this._renderNoMoreClaims();
            return;
        }

        this.openReview(pending[0].id);
    }

    _renderNoMoreClaims() {
        this.currentRecordId = null;
        this.titleEl.innerText = 'Approval Assistant';
        this.bodyEl.innerHTML = `
            <div class="text-center py-5">
                <i class="fa-solid fa-circle-check fa-4x text-success mb-3"></i>
                <h4>No Pending Claims</h4>
                <p class="text-muted mb-0">Great! All pending approvals completed.</p>
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
