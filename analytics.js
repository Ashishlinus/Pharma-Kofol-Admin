/* =====================================================================
   ANALYTICS.JS
   Dashboard KPI cards, Chart.js visualizations, and the duplicate-
   detection reporting pages (Dashboard / Report / High Risk / Possible).

   Depends on: common.js, duplicate.js
===================================================================== */

class Analytics {

    constructor() {
        this.claimsChart = null;
        this.statusChart = null;
        this.riskChart = null;
    }

    /* -----------------------------------------------------------------
       KPI CARDS
    ----------------------------------------------------------------- */

    computeKPIs() {
        const total = claimsData.length;

        const pendingHO = claimsData.filter(r => {
            const f = r.fields;
            return f.HO_APPROVAL === 'Pending' &&
                Utils.normalizeString(f.RSM_APPROVAL) !== 'rejected';
        });

        const pendingRSM = claimsData.filter(r =>
            Utils.normalizeString(r.fields.RSM_APPROVAL) === 'pending' || !r.fields.RSM_APPROVAL
        );

        const approved = claimsData.filter(r =>
            Utils.normalizeString(r.fields.HO_APPROVAL) === 'approved'
        );

        // Total Rejected = Rejected by RSM + Rejected by HO, counted once
        // per record even if a claim was rejected at both stages.
        const rejected = claimsData.filter(r => Utils.isRejected(r));

        const findings = duplicateEngine.getRankedFindings(claimsData, 21);
        const highRisk = findings.filter(f => f.maxScore >= 61);

        const avgApprovalTime = this._computeAvgApprovalTime();

        return {
            totalClaims: total,
            pendingHOCount: pendingHO.length,
            pendingHOCoupons: Utils.sumField(pendingHO, 'NUMBER_OF_COUPONS'),
            pendingRSM: pendingRSM.length,
            approved: approved.length,
            rejected: rejected.length,
            couponsGenerated: generatedData.length,
            duplicateClaims: findings.length,
            highRiskClaims: highRisk.length,
            avgApprovalTime
        };
    }

    // No explicit approval-timestamp field exists in the Airtable schema,
    // so this is computed as the average gap between claim submission
    // (DATE) and today for claims still awaiting a final decision --
    // used only as an indicative processing-time metric.
    _computeAvgApprovalTime() {
        const decided = claimsData.filter(r =>
            Utils.normalizeString(r.fields.HO_APPROVAL) === 'approved' ||
            Utils.normalizeString(r.fields.HO_APPROVAL) === 'rejected'
        );

        if (decided.length === 0) return null;

        const now = Date.now();
        let totalDays = 0;
        let counted = 0;

        decided.forEach(r => {
            const d = Utils.parseDate(r.fields.DATE);
            if (!d) return;
            const days = (now - d.getTime()) / 86400000;
            if (days >= 0 && days < 3650) {
                totalDays += days;
                counted++;
            }
        });

        return counted ? (totalDays / counted) : null;
    }

    renderDashboard() {
        const k = this.computeKPIs();

        this._setText('cardTotalClaims', k.totalClaims);
        this._setText('cardPendingHO', k.pendingHOCount);
        this._setText('cardApproved', k.approved);
        this._setText('cardCoupons', k.couponsGenerated);
        this._setText('cardPendingRSM', k.pendingRSM);
        this._setText('cardRejected', k.rejected);
        this._setText('cardDuplicate', k.duplicateClaims);
        this._setText('cardHighRisk', k.highRiskClaims);
        this._setText('cardAvgApproval', k.avgApprovalTime !== null ? `${k.avgApprovalTime.toFixed(1)}d` : 'N/A');

        this.renderCharts();

        contentArea.innerHTML = `
            <div class="alert alert-success">
                <h5><i class="fa-solid fa-circle-info"></i> Welcome to KCJ Admin Portal</h5>
                <p class="mb-0">Select any menu from the left sidebar to begin.</p>
            </div>
        `;
    }

    _setText(id, val) {
        const el = document.getElementById(id);
        if (el) el.innerText = val;
    }

    /* -----------------------------------------------------------------
       CHARTS  (Chart.js instances destroyed before recreation)
    ----------------------------------------------------------------- */

    renderCharts() {
        this._renderClaimsTrendChart();
        this._renderStatusChart();
    }

    _renderClaimsTrendChart() {
        const canvas = document.getElementById('claimsChart');
        if (!canvas || typeof Chart === 'undefined') return;

        const byDate = {};
        claimsData.forEach(r => {
            const d = Utils.parseDate(r.fields.DATE);
            if (!d) return;
            const key = d.toISOString().slice(0, 10);
            byDate[key] = (byDate[key] || 0) + 1;
        });

        const labels = Object.keys(byDate).sort();
        const values = labels.map(l => byDate[l]);
        const displayLabels = labels.map(l => Utils.formatDate(l));

        if (this.claimsChart) this.claimsChart.destroy();

        this.claimsChart = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: {
                labels: displayLabels,
                datasets: [{
                    label: 'Claims Submitted',
                    data: values,
                    borderColor: '#0F8B4C',
                    backgroundColor: 'rgba(15,139,76,0.15)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: 2
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
            }
        });
    }

    _renderStatusChart() {
        const canvas = document.getElementById('statusChart');
        if (!canvas || typeof Chart === 'undefined') return;

        const grouped = { Approved: 0, Pending: 0, Rejected: 0 };
        claimsData.forEach(r => {
            const s = Utils.normalizeString(r.fields.HO_APPROVAL) || 'pending';
            if (s === 'approved') grouped.Approved++;
            else if (s === 'rejected') grouped.Rejected++;
            else grouped.Pending++;
        });

        if (this.statusChart) this.statusChart.destroy();

        this.statusChart = new Chart(canvas.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: Object.keys(grouped),
                datasets: [{
                    data: Object.values(grouped),
                    backgroundColor: ['#0F8B4C', '#f0ad4e', '#dc3545']
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { position: 'bottom' } }
            }
        });
    }

    /* -----------------------------------------------------------------
       DUPLICATE DASHBOARD PAGE
    ----------------------------------------------------------------- */

    renderDuplicateDashboardPage() {
        const findings = duplicateEngine.getRankedFindings(claimsData, 21);

        const tiers = { exact: 0, high: 0, medium: 0, possible: 0 };
        findings.forEach(f => {
            const tier = DuplicateEngine.riskLevel(f.maxScore).tier;
            if (tiers[tier] !== undefined) tiers[tier]++;
        });

        const canvasId = 'riskDistributionChart';

        contentArea.innerHTML = `
            <div class="row g-3 mb-4">
                ${this._dupKpiCard('Exact Duplicate', tiers.exact, 'danger', 'fa-triangle-exclamation')}
                ${this._dupKpiCard('High Risk', tiers.high, 'danger', 'fa-circle-exclamation')}
                ${this._dupKpiCard('Medium Risk', tiers.medium, 'warning', 'fa-circle-half-stroke')}
                ${this._dupKpiCard('Possible Duplicate', tiers.possible, 'info', 'fa-circle-question')}
            </div>
            <div class="row g-3">
                <div class="col-lg-5">
                    <div class="card shadow-sm border-0">
                        <div class="card-header bg-white"><h5 class="mb-0">Risk Distribution</h5></div>
                        <div class="card-body"><canvas id="${canvasId}"></canvas></div>
                    </div>
                </div>
                <div class="col-lg-7">
                    <div class="card shadow-sm border-0">
                        <div class="card-header bg-white"><h5 class="mb-0">Top Duplicate Findings</h5></div>
                        <div class="card-body p-0" id="topDupList"></div>
                    </div>
                </div>
            </div>
        `;

        const canvas = document.getElementById(canvasId);
        if (this.riskChart) this.riskChart.destroy();
        if (canvas && typeof Chart !== 'undefined') {
            this.riskChart = new Chart(canvas.getContext('2d'), {
                type: 'bar',
                data: {
                    labels: ['Exact', 'High', 'Medium', 'Possible'],
                    datasets: [{
                        data: [tiers.exact, tiers.high, tiers.medium, tiers.possible],
                        backgroundColor: ['#dc3545', '#e8590c', '#f0ad4e', '#0dcaf0']
                    }]
                },
                options: {
                    responsive: true,
                    plugins: { legend: { display: false } },
                    scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
                }
            });
        }

        const listHost = document.getElementById('topDupList');
        const top = findings.slice(0, 10);

        if (top.length === 0) {
            listHost.innerHTML = '<div class="text-muted p-3">No duplicate claims detected.</div>';
        } else {
            listHost.innerHTML = `<div class="list-group list-group-flush">${
                top.map(f => this._dupListItem(f)).join('')
            }</div>`;
        }
    }

    _dupKpiCard(label, value, color, icon) {
        return `
            <div class="col-xl-3 col-lg-6">
                <div class="card dashboard-card shadow-sm border-0">
                    <div class="card-body d-flex justify-content-between align-items-center">
                        <div>
                            <h6 class="text-muted mb-1">${label}</h6>
                            <h2 class="mb-0">${value}</h2>
                        </div>
                        <div class="card-icon bg-${color}"><i class="fa-solid ${icon} text-white fa-lg"></i></div>
                    </div>
                </div>
            </div>
        `;
    }

    _dupListItem(finding) {
        const risk = DuplicateEngine.riskLevel(finding.maxScore);
        const f = finding.record.fields || {};
        return `
            <a href="#" class="list-group-item list-group-item-action" onclick="openClaimReview('${finding.record.id}');return false;">
                <div class="d-flex justify-content-between align-items-start">
                    <div>
                        <strong>${Utils.escapeHtml(f.CERT_NO || finding.record.id)}</strong>
                        <span class="text-muted ms-2">${Utils.escapeHtml(f.CUSTOMER_NAME || '')}</span>
                        <div class="small text-muted">${Array.from(finding.reasons).join(', ')}</div>
                    </div>
                    <span class="badge bg-${risk.color}">${risk.label} (${finding.maxScore}%)</span>
                </div>
            </a>
        `;
    }

    /* -----------------------------------------------------------------
       DUPLICATE REPORT / HIGH RISK / POSSIBLE DUPLICATE LIST PAGES
    ----------------------------------------------------------------- */

    renderFindingsTable(findings, emptyMessage) {
        contentArea.innerHTML = `<div id="dupTableHost"></div>`;

        if (findings.length === 0) {
            document.getElementById('dupTableHost').innerHTML =
                `<div class="alert alert-info">${emptyMessage}</div>`;
            return;
        }

        const rows = findings.map(f => {
            const rec = f.record.fields || {};
            const risk = DuplicateEngine.riskLevel(f.maxScore);
            return {
                _id: f.record.id,
                _hasInvoice: Utils.hasInvoice(f.record),
                CERT_NO: Utils.safeValue(rec.CERT_NO),
                CUSTOMER_NAME: Utils.safeValue(rec.CUSTOMER_NAME),
                CUSTOMER_MOBILE: Utils.safeValue(rec.CUSTOMER_MOBILE),
                BILL_NUMBER: Utils.safeValue(rec.BILL_NUMBER),
                score: f.maxScore,
                riskLabel: risk.label,
                riskColor: risk.color,
                reasons: Array.from(f.reasons).join(', '),
                matchCount: f.matches.length
            };
        });

        const columns = [
            { key: 'CERT_NO', label: 'Cert No.' },
            { key: 'CUSTOMER_NAME', label: 'Customer' },
            { key: 'CUSTOMER_MOBILE', label: 'Mobile' },
            { key: 'BILL_NUMBER', label: 'Invoice No.' },
            { key: 'matchCount', label: 'Matches' },
            { key: 'reasons', label: 'Matched On' },
            {
                key: 'score', label: 'Risk',
                formatter: (v, row) => `<span class="badge bg-${row.riskColor}">${row.riskLabel} (${v}%)</span>`
            }
        ];

        const table = new ReportTable(
            document.getElementById('dupTableHost'),
            columns,
            rows,
            {
                filename: 'Duplicate_Report.xlsx',
                defaultSortKey: 'score',
                rowActionsRenderer: (row) => `
                    <button class="btn btn-sm btn-outline-primary" onclick="openClaimReview('${row._id}')">
                        <i class="fa-solid fa-magnifying-glass-chart"></i> Review
                    </button>
                    ${Utils.invoiceButtonHtmlById(row._id, row._hasInvoice, row.score)}
                `
            }
        );
        table.render();
        table.sortBy('score');
    }

    renderDuplicateReportPage() {
        this.renderFindingsTable(
            duplicateEngine.getRankedFindings(claimsData, 21),
            'No duplicate claims detected in the current dataset.'
        );
    }

    renderHighRiskClaimsPage() {
        this.renderFindingsTable(
            duplicateEngine.getRankedFindings(claimsData, 61),
            'No high-risk or exact-duplicate claims detected.'
        );
    }

    renderPossibleDuplicateClaimsPage() {
        const findings = duplicateEngine.getRankedFindings(claimsData, 21)
            .filter(f => f.maxScore < 61);
        this.renderFindingsTable(findings, 'No possible or medium-risk duplicate claims detected.');
    }

    /* -----------------------------------------------------------------
       APPROVAL ASSISTANT
       Investigation/decision-support view for the HO reviewer: exactly
       the claims RSM has approved and HO hasn't decided on yet, ranked
       so the highest-risk duplicates surface first. The Admin Portal
       never approves/rejects here -- that still only happens in the
       Android app; this page only helps the reviewer decide.
    ----------------------------------------------------------------- */

    renderApprovalAssistantPage() {
        // Exactly: RSM_APPROVAL = Approved AND HO_APPROVAL = Pending.
        const waiting = claimsData.filter(r =>
            r.fields.RSM_APPROVAL === 'Approved' && r.fields.HO_APPROVAL === 'Pending'
        );

        // Reuse the already-cached duplicate findings -- never re-run the
        // O(n^2) engine here. analyzeAll() only recomputes when claimsData
        // has actually changed (see duplicateEngine.reset() in loadData()).
        const findingsMap = duplicateEngine.analyzeAll(claimsData);

        const rows = waiting.map(r => {
            const f = r.fields || {};
            const finding = findingsMap.get(r.id);
            const score = finding ? finding.maxScore : 0;
            const risk = DuplicateEngine.riskLevel(score);
            const dateObj = Utils.parseDate(f.DATE);

            return {
                _id: r.id,
                _hasInvoice: Utils.hasInvoice(r),
                _dateSort: dateObj ? dateObj.getTime() : Number.MAX_SAFE_INTEGER,
                CERT_NO: Utils.safeValue(f.CERT_NO),
                DATE: Utils.safeValue(f.DATE),
                CUSTOMER_NAME: Utils.safeValue(f.CUSTOMER_NAME),
                CUSTOMER_MOBILE: Utils.safeValue(f.CUSTOMER_MOBILE),
                BILL_NUMBER: Utils.safeValue(f.BILL_NUMBER),
                BILL_AMOUNT: Utils.safeNumber(f.BILL_AMOUNT),
                NUMBER_OF_COUPONS: Utils.safeNumber(f.NUMBER_OF_COUPONS),
                STOCKIST_NAME: Utils.safeValue(f.STOCKIST_NAME),
                CUSTOMER_CITY: Utils.safeValue(f.CUSTOMER_CITY),
                score,
                riskLabel: risk.label,
                riskColor: risk.color,
                riskTier: risk.tier
            };
        });

        // Intelligent priority sort: Exact > High > Medium > Possible > None
        // falls straight out of sorting by score descending, since each
        // tier is a contiguous score range. Within equal scores, oldest
        // claim date first so the longest-waiting claims aren't buried.
        rows.sort((a, b) => (b.score !== a.score) ? (b.score - a.score) : (a._dateSort - b._dateSort));

        const kpis = {
            waiting: waiting.length,
            pendingCoupons: Utils.sumField(waiting, 'NUMBER_OF_COUPONS'),
            exact: rows.filter(r => r.riskTier === 'exact').length,
            high: rows.filter(r => r.riskTier === 'high').length
        };

        contentArea.innerHTML = `
            <h4 class="mb-1">Approval Assistant</h4>
            <p class="text-muted">This page helps the HO reviewer identify duplicate claims before taking approval action in the Android application.</p>

            <div class="row g-3 mb-4">
                ${this._dupKpiCard('Claims Waiting', kpis.waiting, 'primary', 'fa-hourglass-half')}
                ${this._dupKpiCard('Pending Coupons', kpis.pendingCoupons, 'warning', 'fa-ticket')}
                ${this._dupKpiCard('Exact Duplicate', kpis.exact, 'danger', 'fa-triangle-exclamation')}
                ${this._dupKpiCard('High Risk Claims', kpis.high, 'danger', 'fa-circle-exclamation')}
            </div>

            <div class="btn-group mb-3 flex-wrap" id="aaFilterGroup" role="group">
                <button type="button" class="btn btn-outline-secondary active" data-tier="">All</button>
                <button type="button" class="btn btn-outline-danger" data-tier="exact">Exact Duplicate</button>
                <button type="button" class="btn btn-outline-danger" data-tier="high">High Risk</button>
                <button type="button" class="btn btn-outline-warning" data-tier="medium">Medium Risk</button>
                <button type="button" class="btn btn-outline-info" data-tier="possible">Possible Duplicate</button>
                <button type="button" class="btn btn-outline-success" data-tier="none">No Duplicate</button>
            </div>

            <div id="approvalAssistantTableHost"></div>
        `;

        const columns = [
            { key: 'CERT_NO', label: 'Certificate Number' },
            { key: 'DATE', label: 'Claim Date', formatter: v => Utils.formatDate(v) },
            { key: 'CUSTOMER_NAME', label: 'Customer Name' },
            { key: 'CUSTOMER_MOBILE', label: 'Customer Mobile' },
            { key: 'BILL_NUMBER', label: 'Invoice Number' },
            { key: 'BILL_AMOUNT', label: 'Bill Amount', formatter: v => Utils.formatCurrency(v) },
            { key: 'NUMBER_OF_COUPONS', label: 'Coupons' },
            { key: 'STOCKIST_NAME', label: 'Stockist' },
            { key: 'CUSTOMER_CITY', label: 'City' },
            {
                key: 'score', label: 'Duplicate Risk',
                formatter: (v, row) => `<span class="badge bg-${row.riskColor}">${row.riskLabel} (${v}%)</span>`
            },
            {
                key: '_hasInvoice', label: 'Invoice',
                formatter: (v, row) => Utils.invoiceButtonHtmlById(row._id, v, row.score)
            }
        ];

        const table = new ReportTable(
            document.getElementById('approvalAssistantTableHost'),
            columns,
            rows,
            {
                filename: 'Approval_Assistant.xlsx',
                rowActionsRenderer: (row) => `
                    <button class="btn btn-sm btn-outline-primary" onclick="openClaimReview('${row._id}')">
                        <i class="fa-solid fa-magnifying-glass-chart"></i> Review
                    </button>
                `
            }
        );
        table.render();

        // Quick risk-tier filters -- just drive the ReportTable's existing
        // column-filter mechanism against the (unrendered) riskTier field.
        document.querySelectorAll('#aaFilterGroup button').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#aaFilterGroup button').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                table.setColumnFilter('riskTier', btn.dataset.tier);
            });
        });
    }
}

const analytics = new Analytics();
