/* =====================================================================
   INVOICE-VIEWER.JS
   Standalone page opened via Utils.openInvoiceViewer() (common.js).
   Reads the claim + invoice payload out of sessionStorage (set by the
   opener tab right before window.open), renders it, and lets the
   reviewer download or open the original Cloudinary image.

   Depends on: common.js (Utils) only -- no other project file is
   required so this page can be opened standalone in its own tab.
===================================================================== */

let currentInvoice = null;

document.addEventListener('DOMContentLoaded', function () {

    const raw = sessionStorage.getItem('selectedInvoice');

    if (!raw) {
        showEmptyState();
        return;
    }

    try {
        currentInvoice = JSON.parse(raw);
    } catch (err) {
        console.error(err);
        showEmptyState();
        return;
    }

    if (!currentInvoice || !Utils.safeTrim(currentInvoice.INVOICE_LINK)) {
        showEmptyState();
        return;
    }

    renderInvoice(currentInvoice);
    wireButtons();
});

function showEmptyState() {
    document.getElementById('ivContent').style.display = 'none';
    document.getElementById('ivEmptyState').style.display = 'block';
    document.title = 'Invoice Viewer';

    // Still let the reviewer close the tab even with nothing to show.
    const closeBtn = document.getElementById('btnClose');
    if (closeBtn) closeBtn.addEventListener('click', () => window.close());

    const downloadBtn = document.getElementById('btnDownload');
    const originalBtn = document.getElementById('btnOriginal');
    if (downloadBtn) downloadBtn.disabled = true;
    if (originalBtn) originalBtn.disabled = true;
}

function renderInvoice(data) {
    document.getElementById('ivContent').style.display = 'block';

    // The tab title carries the Certificate Number so a reviewer with
    // several invoices open at once can tell them apart at a glance.
    const certNo = Utils.safeValue(data.CERT_NO, 'Unknown');
    document.title = `Invoice - ${certNo}`;

    document.getElementById('ivCertNo').innerText = certNo;
    document.getElementById('ivCustomerName').innerText = Utils.safeValue(data.CUSTOMER_NAME, '—');
    document.getElementById('ivBillNumber').innerText = Utils.safeValue(data.BILL_NUMBER, '—');
    document.getElementById('ivBillDate').innerText = data.BILL_DATE ? Utils.formatDate(data.BILL_DATE) : '—';
    document.getElementById('ivBillAmount').innerText = data.BILL_AMOUNT !== '' ? Utils.formatCurrency(data.BILL_AMOUNT) : '—';
    document.getElementById('ivMobile').innerText = Utils.safeValue(data.CUSTOMER_MOBILE, '—');

    document.getElementById('ivRsmApproval').innerHTML =
        `<span class="badge ${Utils.approvalBadgeClass(data.RSM_APPROVAL)}">${Utils.escapeHtml(data.RSM_APPROVAL || 'Pending')}</span>`;

    document.getElementById('ivHoApproval').innerHTML =
        `<span class="badge ${Utils.approvalBadgeClass(data.HO_APPROVAL)}">${Utils.escapeHtml(data.HO_APPROVAL || 'Pending')}</span>`;

    const riskEl = document.getElementById('ivDuplicateRisk');
    if (data.DUPLICATE_RISK && data.DUPLICATE_RISK.label) {
        const scoreText = (data.DUPLICATE_RISK.score !== undefined && data.DUPLICATE_RISK.score !== null)
            ? ` (${data.DUPLICATE_RISK.score}%)`
            : '';
        riskEl.innerHTML = `<span class="badge bg-danger">${Utils.escapeHtml(data.DUPLICATE_RISK.label)}${scoreText}</span>`;
    } else {
        riskEl.innerText = '—';
    }

    const img = document.getElementById('ivImage');
    const imgError = document.getElementById('ivImageError');
    img.src = data.INVOICE_LINK;
    img.onerror = function () {
        img.style.display = 'none';
        imgError.style.display = 'block';
    };
}

function wireButtons() {
    document.getElementById('btnClose').addEventListener('click', () => {
        window.close();
        // window.close() is silently ignored by some browsers for tabs
        // not opened purely by script navigation -- tell the reviewer
        // what to do if the tab is still here a moment later.
        setTimeout(() => {
            Utils.showToast('You can close this tab now.', true);
        }, 300);
    });

    document.getElementById('btnOriginal').addEventListener('click', () => {
        window.open(currentInvoice.INVOICE_LINK, '_blank');
    });

    document.getElementById('btnDownload').addEventListener('click', downloadInvoice);
}

async function downloadInvoice() {
    const url = currentInvoice && currentInvoice.INVOICE_LINK;
    if (!url) return;

    const filename = `Invoice_${Utils.safeValue(currentInvoice.CERT_NO, 'Unknown')}`;

    try {
        const response = await fetch(url, { mode: 'cors' });
        if (!response.ok) throw new Error('Fetch failed: ' + response.status);

        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(blobUrl);
    } catch (err) {
        console.error(err);
        // Cloudinary may not send CORS headers for every asset, which
        // blocks the fetch-and-save-as-blob approach above. Fall back to
        // opening the raw image so the reviewer can right-click Save As.
        window.open(url, '_blank');
        Utils.showToast('Could not auto-download this image. Opened it in a new tab instead -- right-click it and choose "Save Image As".', false);
    }
}
