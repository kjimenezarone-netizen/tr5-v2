const ProcessingEngine = (() => {
    const MiB = 1024 * 1024;
    const limits = Object.freeze({
        trFiles: 2,
        trFileBytes: 15 * MiB,
        rucFiles: 20,
        rucFileBytes: 20 * MiB,
        rucInputBytes: 40 * MiB,
        entryBytes: 20 * MiB,
        expandedBytes: 40 * MiB,
        entries: 250,
        sources: 100,
        rows: 60000,
        columns: 128,
        rucViewColumns: 256,
        cells: 1200000,
        lineLength: 32767,
        shownIssues: 100
    });

    function failure(message, code = 'LIMIT') {
        return Object.assign(new Error(message), { code });
    }

    async function readEntry(entry, signal, budget, caps) {
        signal.throwIfAborted();
        return new Promise((resolve, reject) => {
            const stream = entry.internalStream('uint8array');
            const chunks = [];
            let size = 0;
            let settled = false;
            const finish = (err, bytes) => {
                if (settled) return;
                settled = true;
                signal.removeEventListener('abort', abort);
                if (err) {
                    stream.pause();
                    reject(err);
                } else {
                    resolve(bytes);
                }
            };
            const abort = () => finish(signal.reason);
            signal.addEventListener('abort', abort, { once: true });
            stream.on('data', chunk => {
                if (settled) return;
                size += chunk.length;
                budget.expanded += chunk.length;
                if (budget.expanded > caps.expandedBytes) {
                    finish(failure('El lote supera el límite total de datos descomprimidos.', 'BATCH_LIMIT'));
                } else if (size > caps.entryBytes) {
                    finish(failure('El TXT del ZIP supera el límite por archivo.'));
                } else {
                    chunks.push(chunk);
                }
            }).on('error', error => finish(error)).on('end', () => {
                if (settled) return;
                const bytes = new Uint8Array(size);
                let offset = 0;
                for (const chunk of chunks) {
                    bytes.set(chunk, offset);
                    offset += chunk.length;
                }
                finish(null, bytes);
            }).resume();
        });
    }

    async function run(kind, files, { signal, progress = () => {}, caps = limits, pause = async () => {} } = {}) {
        signal ??= new AbortController().signal;
        const checkpoint = async () => {
            signal.throwIfAborted();
            await pause();
            signal.throwIfAborted();
        };
        const budget = { rows: 0, cells: 0, entries: 0, expanded: 0, sources: 0, columns: new Set() };
        const parse = (bytes, name, expected) => {
            signal.throwIfAborted();
            const decoded = FileParser.decode(bytes);
            const dataset = FileParser.parse(decoded.text, name, {
                maxRows: caps.rows,
                maxColumns: caps.columns,
                maxCells: caps.cells,
                maxLineLength: caps.lineLength
            });
            if (!expected.includes(dataset.type)) throw failure('El archivo no corresponde al módulo seleccionado.', 'FORMAT');
            const tableCells = dataset.records.length * dataset.columns.length;
            if (budget.rows + dataset.records.length > caps.rows || budget.cells + tableCells > caps.cells) {
                throw failure('El lote supera el límite total de filas o celdas. Divídalo en consultas más pequeñas.', 'BATCH_LIMIT');
            }
            budget.rows += dataset.records.length;
            budget.cells += tableCells;
            dataset.encoding = decoded.encoding;
            return dataset;
        };

        if (!files.length) throw failure('Seleccione al menos un archivo.', 'FORMAT');
        if (kind === 'TR') {
            if (files.length > caps.trFiles) throw failure('Seleccione como máximo un TR5 y un TR6.');
            const datasets = [];
            for (const file of files) {
                await checkpoint();
                if (file.size > caps.trFileBytes) throw failure('Cada TXT de TR5/TR6 admite hasta 15 MiB.');
                progress('Leyendo: ' + file.name);
                datasets.push(parse(await file.arrayBuffer(), file.name, ['TR5', 'TR6']));
            }
            if (datasets.every(dataset => !dataset.records.length)) throw failure('No se encontraron filas después de los encabezados.', 'FORMAT');
            await checkpoint();
            progress('Validando RUC y agrupando trabajadores…');
            return { datasets, analysis: TRAnalysis.build(datasets), table: FileParser.table(datasets[0]) };
        }
        if (kind !== 'RUC') throw failure('Operación no reconocida.', 'FORMAT');
        if (files.length > caps.rucFiles || files.reduce((sum, file) => sum + file.size, 0) > caps.rucInputBytes) {
            throw failure('El lote RUC supera el límite de archivos o de tamaño total.');
        }

        const sources = [];
        const issues = [];
        let issueCount = 0;
        let rejectedSources = 0;
        const note = message => {
            issueCount++;
            if (issues.length < caps.shownIssues) issues.push(message);
        };
        const rejectSource = (label, error) => {
            if (signal.aborted || error.code === 'BATCH_LIMIT') throw error;
            rejectedSources++;
            note(label + ': ' + error.message);
        };
        function addSource(dataset, zipId, zipName, entryName) {
            for (const column of dataset.columns) budget.columns.add(column.label);
            if (budget.columns.size > caps.rucViewColumns) throw failure('El lote reúne demasiadas columnas distintas. Separe los formatos en consultas diferentes.', 'BATCH_LIMIT');
            sources.push({ zipId, zipName, entryName, encoding: dataset.encoding, dataset });
            const label = zipName === entryName ? zipName : zipName + ' / ' + entryName;
            for (const diagnostic of dataset.diagnostics) {
                note(label + ': fila ' + diagnostic.sourceRow + ', ' + diagnostic.actual + ' columnas (esperadas: ' + diagnostic.expected + '). Se conservó la fila.');
            }
            const invalid = dataset.records.filter(record => !/^\d{11}$/.test(record.rawCells[0].trim())).length;
            if (invalid) note(label + ': ' + invalid + ' registros sin RUC de 11 dígitos conservados como originales.');
        }
        function countSource() {
            budget.sources++;
            if (budget.sources > caps.sources) throw failure('El lote supera el límite total de TXT.', 'BATCH_LIMIT');
        }
        for (const [index, file] of files.entries()) {
            await checkpoint();
            progress('Archivo ' + (index + 1) + ' de ' + files.length + ': ' + file.name);
            try {
                if (file.size > caps.rucFileBytes) throw failure('Cada TXT o ZIP de RUC admite hasta 20 MiB.');
                if (/\.txt$/i.test(file.name)) {
                    countSource();
                    addSource(parse(await file.arrayBuffer(), file.name, ['RUC']), index, file.name, file.name);
                    continue;
                }
                if (!/\.zip$/i.test(file.name)) throw failure('Formato no compatible. Seleccione TXT o ZIP.', 'FORMAT');
                const zip = await JSZip.loadAsync(await file.arrayBuffer());
                budget.entries += Object.keys(zip.files).length;
                if (budget.entries > caps.entries) throw failure('El lote supera el límite total de entradas ZIP.', 'BATCH_LIMIT');
                const entries = Object.values(zip.files).filter(entry => !entry.dir && /\.txt$/i.test(entry.name));
                if (!entries.length) throw failure('El ZIP no contiene TXT.', 'FORMAT');
                for (const entry of entries) {
                    await checkpoint();
                    countSource();
                    try {
                        progress('Extrayendo: ' + entry.name);
                        const bytes = await readEntry(entry, signal, budget, caps);
                        addSource(parse(bytes, entry.name, ['RUC']), index, file.name, entry.name);
                    } catch (error) {
                        rejectSource(file.name + ' / ' + entry.name, error);
                    }
                }
            } catch (error) {
                rejectSource(file.name, error);
            }
        }
        await checkpoint();
        progress('Agrupando empresas y comparando fuentes…');
        return { model: RucModel.consolidate(sources), issues, issueCount, rejectedSources };
    }

    return { run, limits };
})();
