/* =====================================================================
   REPORT.JS
   All report rendering: RSM -> ASM -> DSA drill-down, grouped summary
   tables, and the generic sortable / filterable / paginated leaf table.

   Relies on shared state declared in script.js:
   claimsData, generatedData, currentData, level, selected
===================================================================== */

// Holds the currently active ReportTable instance so search.js and the
// export button can talk to it without re-querying the DOM every time.
let activeReportTable = null;


/* ---------------------------------------------------------------------
   GENERIC SORTABLE / FILTERABLE / PAGINATED TABLE
--------------------------------------------------------------------- */

class ReportTable {

    /**
     * @param {HTMLElement} container   Element to render into.
     * @param {Array}       columns     [{key,label,formatter?,sortable?}]
     * @param {Array}       rows        Array of plain row objects (already flattened).
     * @param {Object}      options     { pageSize, filename, rowActionsRenderer(row) }
     */
    constructor(container, columns, rows, options = {}) {
        this.container = container;
        this.columns = columns;
        this.allRows = rows;
        this.filteredRows = rows;
        this.pageSize = options.pageSize || 25;
        this.currentPage = 1;
        this.sortKey = options.defaultSortKey || null;
        this.sortDir = 'asc';
        this.filename = options.filename || 'Report.xlsx';
        this.rowActionsRenderer = options.rowActionsRenderer || null;
        this.columnFilters = {};
        this.globalQuery = '';
    }

    setGlobalQuery(query) {
        this.globalQuery = Utils.normalizeString(query);
        this.currentPage = 1;
        this._applyFilters();
    }

    setColumnFilter(key, value) {
        this.columnFilters[key] = Utils.normalizeString(value);
        this.currentPage = 1;
        this._applyFilters();
    }

    _applyFilters() {
        this.filteredRows = this.allRows.filter(row => {
            // Column-level filters
            for (const key in this.columnFilters) {
                const q = this.columnFilters[key];
                if (!q) continue;
                const cell = Utils.normalizeString(row[key]);
                if (!cell.includes(q)) return false;
            }

            // Global instant search across all visible columns
            if (this.globalQuery) {
                const haystack = this.columns
                    .map(c => Utils.normalizeString(row[c.key]))
                    .join(' ');
                if (!haystack.includes(this.globalQuery)) return false;
            }

            return true;
        });

        if (this.sortKey) this._applySort(false);
        this._renderBody();
        this._renderPagination();
    }

    _applySort(toggle = true) {
        if (toggle) {
            this.sortDir = (this.sortDir === 'asc') ? 'desc' : 'asc';
        }

        const key = this.sortKey;
        const dir = this.sortDir === 'asc' ? 1 : -1;

        this.filteredRows = [...this.filteredRows].sort((a, b) => {
            let va = a[key], vb = b[key];

            const na = Number(va), nb = Number(vb);
            if (!isNaN(na) && !isNaN(nb) && va !== '' && vb !== '') {
                return (na - nb) * dir;
            }

            return String(Utils.safeValue(va)).localeCompare(String(Utils.safeValue(vb))) * dir;
        });
    }

    sortBy(key) {
        this.sortKey = key;
        this._applySort(true);
        this._renderHead();
        this._renderBody();
    }

    render() {
        this.container.innerHTML = '';

        const wrapper = document.createElement('div');
        wrapper.className = 'report-table-wrapper';

        // Toolbar: export button + page size selector
        const toolbar = document.createElement('div');
        toolbar.className = 'd-flex justify-content-between align-items-center mb-2 flex-wrap gap-2';
        toolbar.innerHTML = `
            <div class="text-muted small" id="rtRowCount"></div>
            <div class="d-flex align-items-center gap-2">
                <select class="form-select form-select-sm" id="rtPageSize" style="width:auto;">
                    <option value="10">10 / page</option>
                    <option value="25" selected>25 / page</option>
                    <option value="50">50 / page</option>
                    <option value="100">100 / page</option>
                </select>
                <button class="btn btn-sm btn-primary" id="rtExportBtn">
                    <i class="fa-solid fa-file-excel"></i> Export Excel
                </button>
            </div>
        `;
        wrapper.appendChild(toolbar);

        const tableScroll = document.createElement('div');
        tableScroll.className = 'table-responsive report-table-scroll';

        const table = document.createElement('table');
        table.className = 'table table-hover table-striped align-middle mb-0 report-table';
        table.id = 'reportDataTable';

        tableScroll.appendChild(table);
        wrapper.appendChild(tableScroll);

        const paginationEl = document.createElement('div');
        paginationEl.className = 'd-flex justify-content-between align-items-center mt-2';
        paginationEl.id = 'rtPagination';
        wrapper.appendChild(paginationEl);

        this.container.appendChild(wrapper);
        this.table = table;

        this._renderHead();
        this._applyFilters();

        toolbar.querySelector('#rtExportBtn').onclick = () => Utils.exportExcel(this.table, this.filename);
        toolbar.querySelector('#rtPageSize').onchange = (e) => {
            this.pageSize = Number(e.target.value);
            this.currentPage = 1;
            this._renderBody();
            this._renderPagination();
        };

        activeReportTable = this;
    }

    _renderHead() {
        const thead = document.createElement('thead');

        const headRow = document.createElement('tr');
        this.columns.forEach(col => {
            const th = document.createElement('th');
            th.style.cursor = 'pointer';
            th.className = 'sticky-th';

            let icon = '<i class="fa-solid fa-sort text-white-50 ms-1"></i>';
            if (this.sortKey === col.key) {
                icon = this.sortDir === 'asc'
                    ? '<i class="fa-solid fa-sort-up ms-1"></i>'
                    : '<i class="fa-solid fa-sort-down ms-1"></i>';
            }

            th.innerHTML = `${Utils.escapeHtml(col.label)} ${icon}`;
            th.onclick = () => this.sortBy(col.key);
            headRow.appendChild(th);
        });

        if (this.rowActionsRenderer) {
            const th = document.createElement('th');
            th.className = 'sticky-th';
            th.innerText = 'Actions';
            headRow.appendChild(th);
        }

        thead.appendChild(headRow);

        // Column search row
        const filterRow = document.createElement('tr');
        filterRow.className = 'report-filter-row';
        this.columns.forEach(col => {
            const th = document.createElement('th');
            th.innerHTML = `<input type="text" class="form-control form-control-sm" placeholder="Filter..." data-col="${col.key}">`;
            filterRow.appendChild(th);
        });
        if (this.rowActionsRenderer) filterRow.appendChild(document.createElement('th'));
        thead.appendChild(filterRow);

        this.table.innerHTML = '';
        this.table.appendChild(thead);
        this.table.appendChild(document.createElement('tbody'));

        thead.querySelectorAll('input[data-col]').forEach(input => {
            input.oninput = Utils.debounce((e) => {
                this.setColumnFilter(e.target.dataset.col, e.target.value);
            }, 200);
            input.onclick = (e) => e.stopPropagation();
        });
    }

    _renderBody() {
        const tbody = this.table.querySelector('tbody');
        tbody.innerHTML = '';

        const start = (this.currentPage - 1) * this.pageSize;
        const pageRows = this.filteredRows.slice(start, start + this.pageSize);

        if (pageRows.length === 0) {
            const tr = document.createElement('tr');
            tr.innerHTML = `<td colspan="${this.columns.length + (this.rowActionsRenderer ? 1 : 0)}" class="text-center text-muted py-4">No records found.</td>`;
            tbody.appendChild(tr);
        } else {
            pageRows.forEach(row => {
                const tr = document.createElement('tr');
                this.columns.forEach(col => {
                    const td = document.createElement('td');
                    const raw = row[col.key];
                    td.innerHTML = col.formatter ? col.formatter(raw, row) : Utils.escapeHtml(raw);
                    tr.appendChild(td);
                });

                if (this.rowActionsRenderer) {
                    const td = document.createElement('td');
                    td.innerHTML = this.rowActionsRenderer(row);
                    tr.appendChild(td);
                }

                tbody.appendChild(tr);
            });
        }

        const countEl = document.getElementById('rtRowCount');
        if (countEl) {
            countEl.innerText = `Showing ${pageRows.length ? start + 1 : 0}-${start + pageRows.length} of ${this.filteredRows.length} records`;
        }
    }

    _renderPagination() {
        const el = document.getElementById('rtPagination');
        if (!el) return;

        const totalPages = Math.max(1, Math.ceil(this.filteredRows.length / this.pageSize));
        if (this.currentPage > totalPages) this.currentPage = totalPages;

        el.innerHTML = `
            <div class="text-muted small">Page ${this.currentPage} of ${totalPages}</div>
            <div class="btn-group btn-group-sm">
                <button class="btn btn-outline-secondary" id="rtPrev" ${this.currentPage <= 1 ? 'disabled' : ''}>
                    <i class="fa-solid fa-angle-left"></i> Prev
                </button>
                <button class="btn btn-outline-secondary" id="rtNext" ${this.currentPage >= totalPages ? 'disabled' : ''}>
                    Next <i class="fa-solid fa-angle-right"></i>
                </button>
            </div>
        `;

        el.querySelector('#rtPrev').onclick = () => { this.currentPage--; this._renderBody(); this._renderPagination(); };
        el.querySelector('#rtNext').onclick = () => { this.currentPage++; this._renderBody(); this._renderPagination(); };
    }
}


/* ---------------------------------------------------------------------
   GROUPED SUMMARY TABLES (RSM_HQ / ASM_HQ / DSA_HQ counts)
--------------------------------------------------------------------- */

// Pages whose grouped drill-down (RSM -> ASM -> DSA) is built entirely
// from generatedData -- "Generated Coupons" counts. The percentage badge
// that used to sit beside the count is intentionally suppressed only for
// these pages (it wasn't useful and created concatenated values on Excel
// export). Claims Received, RSM/HO approval status pages, and Rejected
// pages are NOT in this list, so they keep showing the percentage exactly
// as before.
const GENERATED_REPORT_PAGES = ['generated', 'generatedASM', 'generatedDSA'];

function renderGroupTable(grouped, cb, heading) {
    const total = Object.values(grouped).reduce((a, b) => a + b, 0);
    const showPercentage = !GENERATED_REPORT_PAGES.includes(window.currentPage);

    let h = `
        <div class="table-responsive">
        <table class="table table-hover align-middle mb-0">
        <thead>
        <tr>
            <th class="sticky-th">${Utils.escapeHtml(heading)}</th>
            <th class="sticky-th text-end" style="width:140px;">Count</th>
        </tr>
        </thead>
        <tbody>
    `;

    Object.entries(grouped)
        .sort((a, b) => b[1] - a[1])
        .forEach(([k, v]) => {
            const pctHtml = showPercentage
                ? `<span class="text-muted small ms-2">${(total ? ((v / total) * 100).toFixed(1) : 0)}%</span>`
                : '';
            h += `
                <tr onclick="${cb}('${k.replace(/'/g, "\\'")}')" style="cursor:pointer;">
                    <td>${Utils.escapeHtml(k)}</td>
                    <td class="text-end">
                        <span class="badge bg-success">${v}</span>${pctHtml}
                    </td>
                </tr>
            `;
        });

    h += '</tbody></table></div>';
    contentArea.innerHTML = h;
}


/* ---------------------------------------------------------------------
   LEAF-LEVEL CLAIM TABLE (individual records)
--------------------------------------------------------------------- */

function renderLeafTable(data, headingContext) {
    contentArea.innerHTML = `
        <div class="d-flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
            <div class="text-muted">${Utils.escapeHtml(headingContext || '')}</div>
        </div>
        <div id="leafTableHost"></div>
    `;

    const rows = data.map(r => {
        const f = r.fields || {};
        return {
            _id: r.id,
            DATE: Utils.safeValue(f.DATE),
            CUSTOMER_NAME: Utils.safeValue(f.CUSTOMER_NAME),
            CUSTOMER_MOBILE: Utils.safeValue(f.CUSTOMER_MOBILE),
            CERT_NO: Utils.safeValue(f.CERT_NO),
            BILL_NUMBER: Utils.safeValue(f.BILL_NUMBER),
            BILL_AMOUNT: Utils.safeNumber(f.BILL_AMOUNT),
            NUMBER_OF_COUPONS: Utils.safeNumber(f.NUMBER_OF_COUPONS),
            RSM_APPROVAL: Utils.safeValue(f.RSM_APPROVAL),
            HO_APPROVAL: Utils.safeValue(f.HO_APPROVAL)
        };
    });

    const columns = [
        { key: 'DATE', label: 'Date', formatter: v => Utils.formatDate(v) },
        { key: 'CUSTOMER_NAME', label: 'Customer Name' },
        { key: 'CUSTOMER_MOBILE', label: 'Mobile' },
        { key: 'CERT_NO', label: 'Cert No.' },
        { key: 'BILL_NUMBER', label: 'Invoice No.' },
        { key: 'BILL_AMOUNT', label: 'Amount', formatter: v => Utils.formatCurrency(v) },
        { key: 'NUMBER_OF_COUPONS', label: 'Coupons' },
        {
            key: 'RSM_APPROVAL', label: 'RSM',
            formatter: v => `<span class="badge ${approvalBadgeClass(v)}">${Utils.escapeHtml(v || 'Pending')}</span>`
        },
        {
            key: 'HO_APPROVAL', label: 'HO',
            formatter: v => `<span class="badge ${approvalBadgeClass(v)}">${Utils.escapeHtml(v || 'Pending')}</span>`
        }
    ];

    const table = new ReportTable(
        document.getElementById('leafTableHost'),
        columns,
        rows,
        {
            filename: 'Coupon_Report.xlsx',
            rowActionsRenderer: (row) => `
                <button class="btn btn-sm btn-outline-primary" onclick="openClaimReview('${row._id}')">
                    <i class="fa-solid fa-magnifying-glass-chart"></i> Review
                </button>
            `
        }
    );

    table.render();
}

// Backward-compatible global wrapper -- the actual logic now lives in
// Utils.approvalBadgeClass (common.js) so the invoice viewer, which does
// not load report.js, can use the exact same badge rules.
function approvalBadgeClass(status) {
    return Utils.approvalBadgeClass(status);
}


/* ---------------------------------------------------------------------
   RSM -> ASM -> DSA DRILL DOWN (claims / generated pages)
--------------------------------------------------------------------- */

function showRSM() {
    renderGroupTable(Utils.groupBy(currentData, 'RSM_HQ'), 'selectRSM', 'RSM HQ');
}

function selectRSM(v) {
    selected.rsm = v;
    level = 1;
    backBtn.style.display = 'inline';
    updateBreadcrumb();

    const data = currentData.filter(r => (r.fields.RSM_HQ || 'Blank') === v);
    renderGroupTable(Utils.groupBy(data, 'ASM_HQ'), 'selectASM', 'ASM HQ');
}

function selectASM(v) {
    selected.asm = v;
    level = 2;
    updateBreadcrumb();

    const data = currentData.filter(r =>
        (r.fields.RSM_HQ || 'Blank') === selected.rsm &&
        (r.fields.ASM_HQ || 'Blank') === v
    );
    renderGroupTable(Utils.groupBy(data, 'DSA_HQ'), 'selectDSA', 'DSA HQ');
}

function selectDSA(v) {
    selected.dsa = v;
    level = 3;
    updateBreadcrumb();

    const data = currentData.filter(r =>
        (r.fields.RSM_HQ || 'Blank') === selected.rsm &&
        (r.fields.ASM_HQ || 'Blank') === selected.asm &&
        (r.fields.DSA_HQ || 'Blank') === v
    );

    renderLeafTable(data, `${selected.rsm} / ${selected.asm} / ${v}`);
}

// Generated - ASM wise entry point
function showASM() {
    level = 0;
    renderGroupTable(Utils.groupBy(currentData, 'ASM_HQ'), 'selectASMFromMenu', 'ASM HQ');
}

function selectASMFromMenu(v) {
    selected.asm = v;
    level = 2;
    backBtn.style.display = 'inline';
    updateBreadcrumb();

    const data = currentData.filter(r => (r.fields.ASM_HQ || 'Blank') === v);
    renderGroupTable(Utils.groupBy(data, 'DSA_HQ'), 'selectDSAFromASMMenu', 'DSA HQ');
}

function selectDSAFromASMMenu(v) {
    selected.dsa = v;
    level = 3;
    updateBreadcrumb();

    const data = currentData.filter(r =>
        (r.fields.ASM_HQ || 'Blank') === selected.asm &&
        (r.fields.DSA_HQ || 'Blank') === v
    );

    renderLeafTable(data, `${selected.asm} / ${v}`);
}

// Generated - DSA wise entry point
function showDSA() {
    level = 0;
    renderGroupTable(Utils.groupBy(currentData, 'DSA_HQ'), 'selectDSAFromMenu', 'DSA HQ');
}

function selectDSAFromMenu(v) {
    selected.dsa = v;
    level = 3;
    backBtn.style.display = 'inline';
    updateBreadcrumb();

    const data = currentData.filter(r => (r.fields.DSA_HQ || 'Blank') === v);
    renderLeafTable(data, v);
}


/* ---------------------------------------------------------------------
   BACK BUTTON / BREADCRUMB
--------------------------------------------------------------------- */

function goBack() {
    if (level === 3) {
        if (window.currentPage === 'generatedASM') {
            selectASMFromMenu(selected.asm);
        } else if (window.currentPage === 'generatedDSA') {
            showDSA();
            backBtn.style.display = 'none';
            selected = {};
            breadcrumb.innerHTML = '';
            return;
        } else {
            selectASM(selected.asm);
        }
        level = 2;
    } else if (level === 2) {
        if (window.currentPage === 'generatedASM') {
            showASM();
            backBtn.style.display = 'none';
            selected = {};
            breadcrumb.innerHTML = '';
            return;
        }
        selectRSM(selected.rsm);
        level = 1;
    } else {
        level = 0;
        backBtn.style.display = 'none';
        selected = {};
        breadcrumb.innerHTML = '';

        if (window.currentPage === 'generatedASM') showASM();
        else if (window.currentPage === 'generatedDSA') showDSA();
        else showRSM();
    }
}

function updateBreadcrumb() {
    breadcrumb.innerText = [selected.rsm, selected.asm, selected.dsa].filter(Boolean).join(' / ');
}


/* ---------------------------------------------------------------------
   EXCEL EXPORT (backward-compatible global used by inline onclick)
--------------------------------------------------------------------- */

function downloadTableExcel(filename = 'Report.xlsx') {
    const table = activeReportTable ? activeReportTable.table : document.querySelector('#contentArea table');
    Utils.exportExcel(table, filename);
}
