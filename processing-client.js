const Processing = {
    jobs: new Map(),
    async runFallback(kind, files, onProgress, isCancelled) {
        if (kind === 'TR') {
            const datasets = [];
            for (const file of files) {
                if (isCancelled()) throw Object.assign(new Error('Carga cancelada.'), { name: 'AbortError' });
                onProgress(`Leyendo y detectando: ${file.name}`);
                const decoded = FileParser.decode(await file.arrayBuffer());
                onProgress(`Interpretando: ${file.name}`);
                const parsed = FileParser.parse(decoded.text, file.name);
                parsed.encoding = decoded.encoding;
                parsed.originalFile = file;
                datasets.push(parsed);
            }
            if (isCancelled()) throw Object.assign(new Error('Carga cancelada.'), { name: 'AbortError' });
            onProgress('Validando RUC y agrupando trabajadores…');
            const analysis = TRAnalysis.build(datasets);
            const table = FileParser.table(datasets[0]);
            return { datasets, analysis, table };
        } else if (kind === 'RUC') {
            const sources = [], issues = []; let rejectedSources = 0;
            for (let i = 0; i < files.length; i++) {
                if (isCancelled()) throw Object.assign(new Error('Carga cancelada.'), { name: 'AbortError' });
                const file = files[i];
                onProgress(`ZIP ${i+1} de ${files.length}: ${file.name}`);
                try {
                    if (!/\.zip$/i.test(file.name)) throw new Error('El archivo no tiene extensión ZIP.');
                    if (file.size > 20*1024*1024) throw new Error('El ZIP supera 20 MB.');
                    const zip = await JSZip.loadAsync(await file.arrayBuffer());
                    const entries = Object.values(zip.files).filter(e => !e.dir && /\.txt$/i.test(e.name));
                    if (!entries.length) throw new Error('El ZIP no contiene TXT.');
                    for (const entry of entries) {
                        try {
                            onProgress(`Extrayendo: ${entry.name}`);
                            const bytes = await entry.async('uint8array');
                            const decoded = FileParser.decode(bytes);
                            onProgress(`Interpretando: ${entry.name}`);
                            const parsed = FileParser.parse(decoded.text, entry.name);
                            parsed.encoding = decoded.encoding;
                            if (parsed.type !== 'RUC') throw new Error('El TXT no corresponde a resultados RUC.');
                            sources.push({ zipId: i, zipName: file.name, entryName: entry.name, originalFile: file, encoding: decoded.encoding, dataset: parsed });
                            parsed.diagnostics.forEach(d => issues.push(`${file.name} / ${entry.name}: fila ${d.sourceRow}, ${d.actual} columnas (encabezado: ${d.expected}). Se conservó la fila.`));
                            const invalid = parsed.records.filter(r => !/^\d{11}$/.test(r.rawCells[0].trim())).length;
                            if (invalid) issues.push(`${file.name} / ${entry.name}: ${invalid} registros sin RUC de 11 dígitos, conservados sin consolidar.`);
                        } catch(err) { rejectedSources++; issues.push(`${file.name} / ${entry.name}: ${err.message}`); }
                    }
                } catch(err) { rejectedSources++; issues.push(`${file.name}: ${err.message}`); }
            }
            onProgress('Agrupando empresas y comparando fuentes…');
            return { model: RucModel.consolidate(sources), issues, rejectedSources };
        } else {
            throw new Error('Operación no reconocida.');
        }
    },
    run(kind, files, onProgress) {
        if (this.jobs.has(kind)) return Promise.reject(new Error('Ya hay una carga en curso.'));
        return new Promise((resolve, reject) => {
            let worker;
            let cancelled = false;
            const finish = (error, result) => {
                if (worker && this.jobs.get(kind)?.worker !== worker) return;
                this.jobs.delete(kind);
                if (worker) worker.terminate();
                error ? reject(error) : resolve(result);
            };

            const cancel = () => {
                cancelled = true;
                finish(Object.assign(new Error('Carga cancelada. No se publicaron resultados parciales.'), { name: 'AbortError' }));
            };

            try {
                worker = new Worker('processing-worker.js');
                this.jobs.set(kind, { worker, cancel });
                worker.onmessage = ({ data }) => {
                    if (data.event === 'progress') onProgress(data.message);
                    else if (data.event === 'done') finish(null, data.result);
                    else if (data.event === 'error') finish(new Error(data.message));
                };
                worker.onerror = () => {
                    // Fallback to main thread if worker fails during runtime
                    this.runFallback(kind, files, onProgress, () => cancelled)
                        .then(res => finish(null, res))
                        .catch(err => finish(err));
                };
                worker.onmessageerror = () => finish(new Error('No se pudo recibir el resultado del procesamiento.'));
                try { worker.postMessage({ kind, files }); } catch(error) { finish(error); }
            } catch {
                // If Worker construction throws (e.g. file:/// sandbox)
                this.jobs.set(kind, { worker: null, cancel });
                this.runFallback(kind, files, onProgress, () => cancelled)
                    .then(res => finish(null, res))
                    .catch(err => finish(err));
            }
        });
    },
    cancel(kind) { this.jobs.get(kind)?.cancel(); }
};

