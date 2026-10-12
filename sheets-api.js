const SheetsAPI = {
    getBaseUrl() {
        if (typeof window !== 'undefined' && window.SUNAFIL_DRIVE_API_URL) return window.SUNAFIL_DRIVE_API_URL;
        if (typeof localStorage !== 'undefined') {
            const stored = localStorage.getItem('sunafil_drive_api_url');
            if (stored) return stored;
        }
        return AppState.DRIVE_API_URL;
    },
    async request(payload) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        const url = this.getBaseUrl();
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
                body: JSON.stringify(payload),
                signal: controller.signal
            });
            if (!response.ok) throw new Error(`Servicio de estadísticas: HTTP ${response.status}`);
            const text = await response.text();
            try { return JSON.parse(text); }
            catch { throw new Error('El servicio no devolvió JSON. Revise el acceso del despliegue de Apps Script y la cuenta institucional.'); }
        } finally { clearTimeout(timeout); }
    },
    async event(action, metadata) {
        if (!metadata || !metadata.intendencia) return;
        const payload = {
            eventId: crypto.randomUUID(),
            intendencia: metadata.intendencia,
            modulo: metadata.modulo,
            accion: action,
            registros: metadata.registros || 0,
            archivos: metadata.archivos || 0,
            duracionMs: Math.max(0, Math.round(metadata.duracionMs || 0)),
            bytes: metadata.bytes || 0,
            version: '2.0'
        };
        try {
            const result = await this.request(payload);
            if (result.status !== 'ok') throw new Error(`Sheets rechazó el evento (${result.status}).`);
            AppState.dashboardCache = null;
            AppState.dashboardCacheTime = 0;
        } catch (error) {
            Utils.showToast('La operación local terminó, pero no se confirmó su estadística en Sheets. Revise el acceso del servicio.', 'info');
            console.warn('Estadísticas:', error.message);
        }
    }
};
