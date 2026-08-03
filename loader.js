/* =====================================================================
   LOADER.JS
   Page loader, table loader, refresh button animation, and the
   Airtable connection status indicator.
===================================================================== */

class LoaderManager {

    constructor() {
        this.pageLoaderEl = null;
        this.connectionEl = null;
    }

    init() {
        this.pageLoaderEl = document.getElementById('pageLoader');
        this.connectionEl = document.getElementById('connectionIndicator');
    }

    // Full-screen loader shown while fetching from Airtable.
    show(message = 'Loading data...') {
        if (!this.pageLoaderEl) return;
        const label = this.pageLoaderEl.querySelector('.loader-label');
        if (label) label.innerText = message;
        this.pageLoaderEl.style.display = 'block';
    }

    hide() {
        if (!this.pageLoaderEl) return;
        this.pageLoaderEl.style.display = 'none';
    }

    // Spin any button containing an <i> icon while an async task runs.
    async withButtonSpinner(button, task) {
        if (!button) return task();

        const icon = button.querySelector('i');
        button.disabled = true;
        if (icon) icon.classList.add('fa-spin');

        try {
            return await task();
        } finally {
            button.disabled = false;
            if (icon) icon.classList.remove('fa-spin');
        }
    }

    // Update the small connection status pill (online / syncing / error).
    setConnectionState(state, text) {
        if (!this.connectionEl) return;

        const map = {
            online: { cls: 'text-bg-success', label: 'Connected' },
            syncing: { cls: 'text-bg-warning', label: 'Syncing...' },
            error: { cls: 'text-bg-danger', label: 'Connection Error' }
        };

        const cfg = map[state] || map.online;
        this.connectionEl.className = 'badge ' + cfg.cls;
        this.connectionEl.innerText = text || cfg.label;
    }
}

const loaderManager = new LoaderManager();
