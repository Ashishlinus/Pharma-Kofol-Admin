/* =====================================================================
   BOOKING-STATUS-ORGANOGRAM.JS  (new, isolated file -- Booking Status
   Organogram Wise feature, Pharma division)

   Self-contained: the only things this file touches from the rest of
   the app are read-only reuse of loaderManager (loader.js),
   Utils.showToast (common.js), and getBookingStatusOrganogramWiseData()
   (api.js) -- nothing here is called by, or modifies, any other file.

   Formatting below is a direct, verified transcription of
   Booking_Status_Organogram_Wise.xlsx's actual cell styles (header /
   RSM / ASM / DSA rows, thin borders, yellow RSM fill, bold header
   with only Name..Total centered) -- not a visual approximation.
   Freeze panes on the header row is an explicit enhancement requested
   for this report (not present in the template itself).
===================================================================== */

const BSO_COLUMNS_ = [
    { header: 'ZONE', key: 'ZONE', width: 16 },
    { header: 'RSM_HQ', key: 'RSM_HQ', width: 18 },
    { header: 'ASM_HQ', key: 'ASM_HQ', width: 22 },
    { header: 'HQ', key: 'HQ', width: 26 },
    { header: 'DESIGNATION', key: 'DESIGNATION', width: 14 },
    { header: 'Name', key: 'NAME', width: 40 },
    { header: 'Coupons Done', key: 'COUPONS_DONE', width: 14 },
    { header: 'Pending at RSM', key: 'PENDING_AT_RSM', width: 15 },
    { header: 'Pending at HO', key: 'PENDING_AT_HO', width: 14 },
    { header: 'Total', key: 'TOTAL', width: 12 }
];

const BSO_THIN_BORDER_ = {
    top: { style: 'thin' },
    left: { style: 'thin' },
    bottom: { style: 'thin' },
    right: { style: 'thin' }
};

const BSO_YELLOW_FILL_ = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFFFFF00' }
};

const BSO_UNMAPPED_FILL_ = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFD9D9D9' }
};

let bookingStatusGenerationInProgress = false;

function _bsoSetButtonState(disabled) {
    const btn = document.getElementById('bookingStatusOrganogramBtn');
    if (!btn) return;
    const icon = btn.querySelector('i');
    if (disabled) {
        btn.classList.add('disabled');
        btn.setAttribute('aria-disabled', 'true');
        btn.style.pointerEvents = 'none';
        btn.style.opacity = '0.6';
        if (icon) icon.classList.add('fa-spin');
    } else {
        btn.classList.remove('disabled');
        btn.removeAttribute('aria-disabled');
        btn.style.pointerEvents = '';
        btn.style.opacity = '';
        if (icon) icon.classList.remove('fa-spin');
    }
}

// Every loaderManager.show() call includes the mandatory
// "do not close" reminder, since this reuses the shared #pageLoader
// element rather than adding a new one. Two stable stages -- no fake
// incremental progress messages, since the org hierarchy, coupon, and
// claim retrieval all happen inside one single Apps Script call with
// no real progress to report in between.
function _bsoShowStage(title, subtitle) {
    loaderManager.show(title + ' — ' + subtitle + ' Do not refresh or close this page.');
}

function _bsoRowToArray(r) {
    return [r.ZONE, r.RSM_HQ, r.ASM_HQ, r.HQ, r.DESIGNATION, r.NAME, r.COUPONS_DONE, r.PENDING_AT_RSM, r.PENDING_AT_HO, r.TOTAL];
}

function _bsoStyleDataRow(row, designation, extraFill) {
    const isRsmRow = designation === 'RSM';
    const isAsmRow = designation === 'ASM';
    const isBold = isRsmRow || isAsmRow;

    row.eachCell(function (cell) {
        cell.font = { name: 'Calibri', size: 11, bold: isBold };
        cell.border = BSO_THIN_BORDER_;
        if (extraFill) {
            cell.fill = extraFill;
        } else if (isRsmRow) {
            cell.fill = BSO_YELLOW_FILL_;
        }
    });
}

async function _bsoBuildWorkbook(rows, unmappedRows) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Booking Status');

    worksheet.columns = BSO_COLUMNS_.map(function (c) {
        return { key: c.key, width: c.width };
    });

    // Header row -- bold, thin border all sides; Name..Total centered,
    // ZONE..DESIGNATION not (matches the template exactly).
    const headerRow = worksheet.addRow(BSO_COLUMNS_.map(function (c) { return c.header; }));
    headerRow.eachCell(function (cell, colNumber) {
        cell.font = { name: 'Calibri', size: 11, bold: true };
        cell.border = BSO_THIN_BORDER_;
        if (colNumber >= 6) cell.alignment = { horizontal: 'center' };
    });
    worksheet.views = [{ state: 'frozen', ySplit: 1 }]; // freeze header row -- explicit enhancement, not in the template itself

    rows.forEach(function (r) {
        _bsoStyleDataRow(worksheet.addRow(_bsoRowToArray(r)), r.DESIGNATION, null);
    });

    // Historical/unmapped section -- only added when it's genuinely
    // non-empty, so a normal report with no such records never shows
    // an empty section.
    if (unmappedRows && unmappedRows.length > 0) {
        const labelRow = worksheet.addRow(['Historical / Unmapped HQ Records']);
        worksheet.mergeCells(labelRow.number, 1, labelRow.number, BSO_COLUMNS_.length);
        labelRow.getCell(1).font = { name: 'Calibri', size: 11, bold: true };
        labelRow.getCell(1).alignment = { horizontal: 'center' };
        labelRow.getCell(1).fill = BSO_UNMAPPED_FILL_;

        unmappedRows.forEach(function (r) {
            _bsoStyleDataRow(worksheet.addRow(_bsoRowToArray(r)), r.DESIGNATION, BSO_UNMAPPED_FILL_);
        });
    }

    return workbook;
}

async function generateBookingStatusOrganogramWise() {
    if (bookingStatusGenerationInProgress) return;
    bookingStatusGenerationInProgress = true;

    _bsoSetButtonState(true);
    _bsoShowStage('Preparing Booking Status Organogram Wise', 'Retrieving organizational hierarchy, generated coupons, and pending claims. Please wait...');

    try {
        const data = await getBookingStatusOrganogramWiseData();
        const rows = (data && data.rows) || [];
        const unmappedRows = (data && data.unmappedRows) || [];

        _bsoShowStage('Preparing Excel Report', 'Calculating team-wise totals and formatting your report...');

        const workbook = await _bsoBuildWorkbook(rows, unmappedRows);

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'Booking_Status_Organogram_Wise.xlsx';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        Utils.showToast('✓ Booking Status Organogram Wise Ready — your Excel report has been generated successfully.', true);

    } catch (err) {
        console.error('[KCJ Booking Status] generation failed:', err);
        Utils.showToast('Unable to generate Booking Status Organogram Wise. Please try again.', false);
    } finally {
        loaderManager.hide();
        _bsoSetButtonState(false);
        bookingStatusGenerationInProgress = false;
    }
}
