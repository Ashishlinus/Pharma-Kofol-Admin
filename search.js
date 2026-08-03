/* =====================================================================
   SEARCH.JS
   Global instant search across the currently rendered report table.
   Wires up the #globalSearch input in the report toolbar.
===================================================================== */

class GlobalSearch {

    constructor() {
        this.inputEl = null;
        this.searchBtn = null;
        this.resetBtn = null;
    }

    init() {
        this.inputEl = document.getElementById('globalSearch');
        this.searchBtn = document.getElementById('globalSearchBtn');
        this.resetBtn = document.getElementById('globalResetBtn');

        if (!this.inputEl) return;

        const run = Utils.debounce(() => this.apply(), 200);

        this.inputEl.addEventListener('input', run);
        this.inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.apply();
        });

        if (this.searchBtn) this.searchBtn.addEventListener('click', () => this.apply());
        if (this.resetBtn) this.resetBtn.addEventListener('click', () => this.clear());
    }

    apply() {
        if (!activeReportTable) {
            Utils.showToast('Search is available inside a claim table. Drill down first.', false);
            return;
        }
        activeReportTable.setGlobalQuery(this.inputEl.value);
    }

    clear() {
        if (this.inputEl) this.inputEl.value = '';
        if (activeReportTable) activeReportTable.setGlobalQuery('');
    }
}

const globalSearch = new GlobalSearch();
