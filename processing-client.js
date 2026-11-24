const Processing = {
    jobs: new Map(),
    run(kind, files, onProgress) {
        const fallback = files.reduce((total, file) => total + file.size, 0) <= 2 * 1024 * 1024
            ? (signal, progress) => ProcessingEngine.run(kind, files, {
                signal,
                progress,
                pause: () => new Promise(resolve => setTimeout(resolve, 0))
            })
            : null;
        return this.start(kind, 'processing-worker.js', { kind, files }, onProgress, fallback);
    },
    start(kind, script, payload, onProgress = () => {}, fallback = null) {
        if (this.jobs.has(kind)) return Promise.reject(new Error('Ya hay una operación de ese tipo en curso.'));
        return new Promise((resolve, reject) => {
            const controller = new AbortController();
            let worker;
            let fallbackStarted = false;
            const active = () => this.jobs.get(kind) === job;
            const notify = message => { if (active()) onProgress(message); };
            const finish = (error, result) => {
                if (!active()) return;
                this.jobs.delete(kind);
                clearTimeout(timeout);
                worker?.terminate();
                if (error && !controller.signal.aborted) controller.abort(error);
                if (error) reject(error);
                else resolve(result);
            };
            const job = {
                cancel: () => finish(new DOMException('Operación cancelada.', 'AbortError'))
            };
            const timeout = setTimeout(() => finish(new Error('Se agotó el tiempo. Reduzca el tamaño de la consulta y vuelva a intentar.')), 120000);
            this.jobs.set(kind, job);
            const useFallback = () => {
                if (!active() || fallbackStarted) return;
                fallbackStarted = true;
                worker?.terminate();
                worker = null;
                if (!fallback) return finish(new Error('El procesamiento en segundo plano no está disponible para esta operación.'));
                Promise.resolve().then(() => fallback(controller.signal, notify))
                    .then(result => finish(null, result), finish);
            };

            try {
                worker = new Worker(ReaderConfig.asset(script));
                worker.onmessage = ({ data }) => {
                    if (!active() || fallbackStarted) return;
                    if (data.event === 'progress') notify(data.message);
                    else if (data.event === 'done') finish(null, data.result);
                    else if (data.event === 'error') finish(Object.assign(new Error(data.message), { code: data.code }));
                };
                worker.onerror = useFallback;
                worker.onmessageerror = () => finish(new Error('No se pudo recibir el resultado del procesamiento.'));
                worker.postMessage(payload);
            } catch {
                useFallback();
            }
        });
    },
    cancel(kind) { this.jobs.get(kind)?.cancel(); }
};
