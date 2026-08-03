/* =====================================================================
   COMMON.JS
   Shared utility functions used across all modules.
   No dependencies on other project files.
===================================================================== */

const Utils = (() => {

    // Return a safe string value, falling back to a default.
    function safeValue(val, fallback = '') {
        if (val === undefined || val === null) return fallback;
        return val;
    }

    // Return a safe number, coercing strings and stripping non numeric chars.
    function safeNumber(val, fallback = 0) {
        if (val === undefined || val === null || val === '') return fallback;
        const n = Number(String(val).replace(/[^0-9.\-]/g, ''));
        return isNaN(n) ? fallback : n;
    }

    // Trim a value safely, tolerating null/undefined/non-strings.
    function safeTrim(val) {
        if (val === undefined || val === null) return '';
        return String(val).trim();
    }

    // Normalize a string for comparison purposes:
    // lower-case, trimmed, collapsed whitespace, punctuation stripped.
    function normalizeString(val) {
        return safeTrim(val)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim()
            .replace(/\s+/g, ' ');
    }

    // Format a number as Indian Rupee currency.
    function formatCurrency(val) {
        const n = safeNumber(val, 0);
        return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
    }

    // Format a date value (tolerates DD/MM/YYYY, D/M/YYYY, ISO strings).
    function formatDate(val) {
        if (!val) return '';
        const raw = safeTrim(val);

        let d = null;

        // Try DD/MM/YYYY or D/M/YYYY
        const parts = raw.split(/[\/\-]/);
        if (parts.length === 3) {
            let [a, b, c] = parts;
            if (c.length === 4) {
                // assume DD/MM/YYYY
                d = new Date(`${c}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`);
            }
        }

        if (!d || isNaN(d.getTime())) {
            d = new Date(raw);
        }

        if (isNaN(d.getTime())) return raw; // fallback to raw string

        return d.toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });
    }

    // Parse a date-ish value into a JS Date or null.
    function parseDate(val) {
        if (!val) return null;
        const raw = safeTrim(val);
        const parts = raw.split(/[\/\-]/);
        let d = null;

        if (parts.length === 3) {
            let [a, b, c] = parts;
            if (c.length === 4) {
                d = new Date(`${c}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`);
            }
        }

        if (!d || isNaN(d.getTime())) {
            d = new Date(raw);
        }

        return isNaN(d.getTime()) ? null : d;
    }

    // Group an array of Airtable-style records ({fields:{...}}) by a field key.
    function groupBy(data, key) {
        const obj = {};
        (data || []).forEach(r => {
            const value = safeTrim(r.fields ? r.fields[key] : r[key]) || 'Blank';
            obj[value] = (obj[value] || 0) + 1;
        });
        return obj;
    }

    // Sum a numeric field across an array of Airtable-style records.
    function sumField(data, key) {
        return (data || []).reduce((total, r) => {
            const f = r.fields ? r.fields[key] : r[key];
            return total + safeNumber(f, 0);
        }, 0);
    }

    // Export an HTML table element to an Excel file using SheetJS.
    function exportExcel(table, filename = 'Report.xlsx') {
        if (!table) {
            showToast('No table found to export.', false);
            return;
        }
        try {
            const workbook = XLSX.utils.table_to_book(table, { sheet: 'Report' });
            XLSX.writeFile(workbook, filename);
            showToast(`Exported ${filename}`, true);
        } catch (err) {
            console.error(err);
            showToast('Export failed.', false);
        }
    }

    // Show a bootstrap toast notification. Falls back to alert if markup absent.
    function showToast(message, success = true) {
        const toastEl = document.getElementById('liveToast');
        const msgEl = document.getElementById('toastMessage');

        if (!toastEl || !msgEl || typeof bootstrap === 'undefined') {
            console.log((success ? '[OK] ' : '[ERROR] ') + message);
            return;
        }

        msgEl.innerHTML = message;
        toastEl.classList.remove('text-bg-success', 'text-bg-danger');
        toastEl.classList.add(success ? 'text-bg-success' : 'text-bg-danger');

        new bootstrap.Toast(toastEl).show();
    }

    // Debounce helper for instant-search inputs.
    function debounce(fn, wait = 250) {
        let t;
        return function (...args) {
            clearTimeout(t);
            t = setTimeout(() => fn.apply(this, args), wait);
        };
    }

    // Escape a string for safe HTML injection.
    function escapeHtml(val) {
        return safeTrim(val)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // Bootstrap badge class for an RSM/HO approval status. Single shared
    // source of truth used by report.js's leaf tables, the review modal,
    // and the invoice viewer (which has no access to report.js).
    function approvalBadgeClass(status) {
        const s = normalizeString(status);
        if (s === 'approved') return 'bg-success';
        if (s === 'rejected') return 'bg-danger';
        return 'bg-secondary';
    }

    // Whether a claim record has a usable invoice image to view/download.
    function hasInvoice(record) {
        const f = (record && record.fields) || {};
        return !!safeTrim(f.INVOICE_LINK);
    }

    // Open the standalone Invoice Viewer (invoice-viewer.html) in a new
    // tab for a claim record. duplicateRisk is optional: { label, score }
    // describing the specific duplicate match this view relates to (falls
    // back to no risk badge shown when omitted).
    //
    // This is the single reusable entry point every page calls -- report
    // tables, the review modal's current claim, and its matched/rejected
    // records -- so the sessionStorage payload shape only lives here once.
    function openInvoiceViewer(record, duplicateRisk) {
        const f = (record && record.fields) || {};

        if (!hasInvoice(record)) {
            showToast('No Invoice Available for this claim.', false);
            return;
        }

        const payload = {
            CERT_NO: safeValue(f.CERT_NO),
            CUSTOMER_NAME: safeValue(f.CUSTOMER_NAME),
            CUSTOMER_MOBILE: safeValue(f.CUSTOMER_MOBILE),
            BILL_NUMBER: safeValue(f.BILL_NUMBER),
            BILL_DATE: safeValue(f.BILL_DATE),
            BILL_AMOUNT: safeValue(f.BILL_AMOUNT),
            INVOICE_LINK: safeValue(f.INVOICE_LINK),
            RSM_APPROVAL: safeValue(f.RSM_APPROVAL),
            HO_APPROVAL: safeValue(f.HO_APPROVAL),
            DUPLICATE_RISK: duplicateRisk || null
        };

        try {
            sessionStorage.setItem('selectedInvoice', JSON.stringify(payload));
        } catch (err) {
            console.error(err);
            showToast('Could not open the invoice viewer.', false);
            return;
        }

        window.open('invoice-viewer.html', '_blank');
    }

    // Internal: the actual <button> markup, shared by both public
    // wrappers below so the disabled/enabled states never drift apart.
    function _invoiceButtonMarkup(id, has, score) {
        if (!has) {
            return `<button class="btn btn-sm btn-outline-secondary" disabled title="No Invoice Available">
                        <i class="fa-solid fa-eye-slash"></i> No Invoice Available
                    </button>`;
        }

        const scoreArg = (score === undefined || score === null) ? '' : `, ${score}`;
        return `<button class="btn btn-sm btn-outline-primary" onclick="viewInvoice('${id}'${scoreArg})">
                    <i class="fa-solid fa-eye"></i> View Invoice
                </button>`;
    }

    // "View Invoice" button for a full record object (review modal call sites).
    function invoiceButtonHtml(record, score) {
        return _invoiceButtonMarkup(record && record.id, hasInvoice(record), score);
    }

    // "View Invoice" button for report-table rows, which are already
    // flattened plain objects rather than full {id, fields} records.
    function invoiceButtonHtmlById(id, has, score) {
        return _invoiceButtonMarkup(id, has, score);
    }

    // Whether an Airtable claim record has been rejected at either
    // approval stage. Single shared source of truth so the KPI cards,
    // the Rejected menu pages, and the duplicate engine never disagree.
    function isRejected(record) {
        const f = (record && record.fields) || {};
        return normalizeString(f.RSM_APPROVAL) === 'rejected' ||
               normalizeString(f.HO_APPROVAL) === 'rejected';
    }

    // Return { rejectedBy, reason } for a rejected record, or null if the
    // record has not been rejected. rejectedBy is 'RSM', 'HO', or 'RSM & HO'.
    function rejectionInfo(record) {
        const f = (record && record.fields) || {};
        const rsmRejected = normalizeString(f.RSM_APPROVAL) === 'rejected';
        const hoRejected = normalizeString(f.HO_APPROVAL) === 'rejected';

        if (!rsmRejected && !hoRejected) return null;

        let rejectedBy;
        if (rsmRejected && hoRejected) rejectedBy = 'RSM & HO';
        else if (hoRejected) rejectedBy = 'HO';
        else rejectedBy = 'RSM';

        // Schema doesn't guarantee a specific reason field name, so check
        // the common possibilities and fall back gracefully if none exist.
        const candidates = [
            f.HO_REJECTION_REASON, f.HO_REMARKS,
            f.RSM_REJECTION_REASON, f.RSM_REMARKS,
            f.REJECTION_REASON, f.REMARKS, f.COMMENTS
        ];
        const reason = candidates.map(v => safeTrim(v)).find(v => v);

        return { rejectedBy, reason: reason || null };
    }

    // Export an entire Airtable-style dataset (every field, every record)
    // to an Excel file using SheetJS, in an EXACT column order rather than
    // whatever order JS happens to iterate object keys in.
    //
    // columnOrder: the master list of field names in the order they should
    // appear (see CLAIMS_COLUMN_ORDER / GENERATED_COLUMN_ORDER in config.js).
    // Any field present in the data but missing from columnOrder is still
    // exported -- appended after it, in first-seen order -- so no column is
    // ever silently dropped even if the master list falls out of date.
    function exportFullDataset(data, filename = 'Export.xlsx', columnOrder = []) {
        console.log('[KCJ common.js] exportFullDataset EXPORT_ORDER_FIX_v3 ->', filename, 'columnOrder length:', columnOrder.length);

        if (!data || !data.length) {
            showToast('No data available to export.', false);
            return;
        }

        try {
            const orderedFields = [...columnOrder];
            const seen = new Set(columnOrder);

            data.forEach(r => {
                Object.keys(r.fields || {}).forEach(k => {
                    if (!seen.has(k)) {
                        seen.add(k);
                        orderedFields.push(k);
                    }
                });
            });

            // Record_ID is our own audit column, not an Airtable field --
            // keep it out of the way at the end so it never disturbs the
            // Airtable column sequence.
            const headerRow = [...orderedFields, 'Record_ID'];

            // Build the sheet from a plain array-of-arrays (position-based)
            // rather than json_to_sheet's key-based inference. AOA rows are
            // written in exactly the array order given -- there is no key
            // lookup step that could reorder or alphabetize columns.
            const aoa = [headerRow];

            data.forEach(r => {
                const rowValues = orderedFields.map(k => {
                    const v = r.fields ? r.fields[k] : undefined;
                    return Array.isArray(v) ? v.join(', ') : (v === undefined || v === null ? '' : v);
                });
                rowValues.push(r.id);
                aoa.push(rowValues);
            });

            const worksheet = XLSX.utils.aoa_to_sheet(aoa);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Data');
            XLSX.writeFile(workbook, filename);
            showToast(`Exported ${filename}`, true);
        } catch (err) {
            console.error(err);
            showToast('Export failed.', false);
        }
    }

    return {
        safeValue,
        safeNumber,
        safeTrim,
        normalizeString,
        formatCurrency,
        formatDate,
        parseDate,
        groupBy,
        sumField,
        exportExcel,
        exportFullDataset,
        showToast,
        debounce,
        escapeHtml,
        isRejected,
        rejectionInfo,
        approvalBadgeClass,
        hasInvoice,
        openInvoiceViewer,
        invoiceButtonHtml,
        invoiceButtonHtmlById
    };

})();

// Expose showToast globally for backward compatibility with inline handlers.
function showToast(message, success = true) {
    Utils.showToast(message, success);
}
