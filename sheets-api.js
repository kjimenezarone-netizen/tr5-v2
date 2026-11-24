const SheetsAPI = {
    eventSession: null,
    pendingSession: null,
    generation: 0,
    async request(payload) {
        if (!ReaderConfig.apiUrl) throw new Error('El servicio de estadísticas no está configurado.');
        const response = await fetch(ReaderConfig.apiUrl, {
            method: 'POST',
            credentials: ReaderConfig.withCredentials ? 'include' : 'same-origin',
            headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(20000)
        });
        if (!response.ok) throw new Error('El servicio de estadísticas no respondió correctamente.');
        try { return await response.json(); }
        catch { throw new Error('No se confirmó el acceso al servicio de estadísticas.'); }
    },
    async telemetryToken() {
        if (this.eventSession?.expires > Date.now() + 5000) return this.eventSession.token;
        if (!this.pendingSession) {
            const generation = this.generation;
            const pending = this.request({ accion: 'TELEMETRY_SESSION' }).then(data => {
                if (generation !== this.generation || data.status !== 'ok' || !data.token) {
                    throw new Error('La cuenta institucional no tiene acceso al registro de estadísticas.');
                }
                this.eventSession = data;
                return data.token;
            }).finally(() => { if (this.pendingSession === pending) this.pendingSession = null; });
            this.pendingSession = pending;
        }
        return this.pendingSession;
    },
    reset() {
        this.generation++;
        this.eventSession = null;
        this.pendingSession = null;
    },
    async event(action, metadata) {
        if (!ReaderConfig.apiUrl || ReaderConfig.telemetryMode === 'OFF' || !metadata?.intendencia) return;
        const generation = this.generation;
        const payload = {
            eventId: crypto.randomUUID(),
            intendencia: metadata.intendencia,
            modulo: metadata.modulo,
            accion: action,
            registros: metadata.registros ?? 0,
            archivos: metadata.archivos ?? 0,
            duracionMs: Math.max(0, Math.round(metadata.duracionMs ?? 0)),
            bytes: metadata.bytes ?? 0,
            version: ReaderConfig.version
        };
        try {
            if (ReaderConfig.telemetryMode === 'INSTITUTIONAL') payload.token = await this.telemetryToken();
            if (generation !== this.generation) return;
            const result = await this.request(payload);
            if (result.status === 'unauthorized') this.eventSession = null;
            if (result.status !== 'ok') throw new Error('El evento no se registró.');
        } catch {
            if (generation === this.generation) Utils.showToast('No se confirmó el registro de la estadística.', 'info');
        }
    }
};
