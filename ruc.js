/* Procesamiento local de resultados RUC; no envía contenido ni eventos al backend. */
const RucModel = {
    companyFields(records) {
        const labels = [...new Set(records.flatMap(r => r.source.dataset.columns.map(c => c.label)))];
        return labels.map(label => {
            const variants = new Map();
            records.forEach(record => {
                const column = record.source.dataset.columns.find(c => c.label === label);
                const value = column ? (record.rawCells[column.index] ?? null) : null;
                if (!variants.has(value)) variants.set(value, []);
                variants.get(value).push(record);
            });
            return { label, variants, different: variants.size > 1 };
        });
    },
    companies(records) {
        const groups = new Map();
        records.forEach(r => {
            if (!/^\d{11}$/.test(r.ruc)) return;
            if (!groups.has(r.ruc)) groups.set(r.ruc, []);
            groups.get(r.ruc).push(r);
        });
        return [...groups].map(([ruc, items]) => ({ ruc, records: items, fields: this.companyFields(items) }));
    },
    consolidatedSheets(records) {
        const companies = this.companies(records);
        const labels = [...new Set(companies.flatMap(c => c.fields.map(f => f.label)))];
        const rows = [['RUC agrupado', 'Apariciones', ...labels]];
        const variants = [['RUC', 'Campo', 'Valor original', 'Presente', 'ZIP', 'TXT', 'Fila']];
        companies.forEach(company => {
            rows.push([company.ruc, company.records.length, ...labels.map(label => {
                const field = company.fields.find(f => f.label === label);
                return !field ? '' : field.different ? '[VALORES DIFERENTES: ver Variantes]' : [...field.variants.keys()][0] ?? '';
            })]);
            company.fields.filter(f => f.different).forEach(field => field.variants.forEach((items, value) => items.forEach(r => {
                variants.push([company.ruc, field.label, value ?? '', value === null ? 'No' : 'Sí', r.source.zipName, r.source.entryName, r.sourceRow]);
            })));
        });
        return [{ name: 'RUC_Unicos', rows }, { name: 'Variantes', rows: variants }];
    },
    selectionKey(record) {
        return /^\d{11}$/.test(record.ruc) ? `ruc:${record.ruc}` : `row:${record.id}`;
    },
    exportRecords(model, scope, selected, filtered, zipId, currentRuc) {
        if (scope === 'all' || scope === 'consolidated') return model.records.slice();
        if (scope === 'company') return (model.groups.get(currentRuc) || []).slice();
        if (scope === 'filtered') return filtered.slice();
        if (scope === 'selected') return model.records.filter(r => selected.has(this.selectionKey(r)));
        if (scope === 'repeated' || scope === 'differences') return model.records.filter(r => model[scope].has(r.ruc));
        if (scope === 'zip') return model.records.filter(r => String(r.source.zipId) === zipId);
        throw new Error('Alcance no reconocido.');
    },
    // El alcance de descarga depende exclusivamente de los filtros de la sección 2.
    exportForView(model, currentRows, query, mode) {
        const active = Boolean(String(query ?? '').trim()) || mode !== 'all';
        return (active ? currentRows : model.records).slice();
    },
    exportSheets(records, context) {
        const bySource = new Map();
        for (const record of records) {
            if (!bySource.has(record.source)) bySource.set(record.source, []);
            bySource.get(record.source).push(record.rawCells.slice());
        }
        const sheetNames = new Map();
        const sheets = [{ name: 'Resumen', rows: [
            ['Concepto', 'Valor'], ['Intendencia', context.intendencia], ['Alcance', context.scope],
            ['Búsqueda en la vista', context.query], ['Filtro en la vista', context.filter],
            ['Registros', records.length], ['RUC únicos', new Set(records.filter(r => /^\d{11}$/.test(r.ruc)).map(r => r.ruc)).size],
            ['Nota', 'Se conservan las columnas originales, los valores, las filas repetidas y la trazabilidad de los registros exportados.']
        ] }];
        for (const [source, sourceRows] of bySource) {
            const name = 'Original_' + (sheetNames.size + 1);
            sheetNames.set(source, name);
            sheets.push({ name, rows: [source.dataset.columns.map(column => column.rawHeader ?? column.label), ...sourceRows] });
        }
        sheets.push({ name: 'Fuentes', rows: [
            ['Hoja', 'ZIP', 'TXT', 'Codificación', 'Fila original', 'Línea original'],
            ...records.map(r => [sheetNames.get(r.source), r.source.zipName, r.source.entryName, r.source.encoding || '', r.sourceRow, r.rawLine])
        ] });
        if (context.consolidated) sheets.push(...this.consolidatedSheets(records));
        return sheets;
    },
    consolidate(sources) {
        const records = [], groups = new Map();
        sources.forEach((source, sourceIndex) => {
            source.dataset.records.forEach(record => {
                const ruc = record.rawCells[0].trim();
                const item = { ...record, id: `${sourceIndex}:${record.sourceRow}`, source, ruc };
                records.push(item);
                if (/^\d{11}$/.test(ruc)) {
                    if (!groups.has(ruc)) groups.set(ruc, []);
                    groups.get(ruc).push(item);
                }
            });
        });
        const columnsBySource = new Map(sources.map(source => [
            source,
            source.dataset.columns.slice().sort((a, b) => a.label.localeCompare(b.label))
        ]));
        const repeated = new Set(), differences = new Set();
        groups.forEach((items, ruc) => {
            if (items.length < 2) return;
            repeated.add(ruc);
            const signature = item => JSON.stringify(columnsBySource.get(item.source).map(column => [column.label, item.rawCells[column.index] ?? null]));
            const first = signature(items[0]);
            if (items.slice(1).some(item => signature(item) !== first)) differences.add(ruc);
        });
        return { sources, records, groups, repeated, differences };
    }
};
if (typeof module !== 'undefined' && module.exports) module.exports = RucModel;

if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => {
    const el = id => document.getElementById(id);
    let model = RucModel.consolidate([]), page = 0, busy = false;
    let consultationOffice = '';
    let filtered = [];
    let generation = 0;
    let exporting = false;
    let searchTimer;
    let filterKey;
    let filterModel;
    let labels = [];
    const normalizeSearch = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
    function showCompany(ruc) {
        const records = model.groups.get(ruc) || [];
        el('ruc-detail-title').textContent = `Empresa ${ruc} · ${records.length} apariciones`;
        const sections = new Map(['Datos generales', 'Ubicación', 'Actividad', 'Información tributaria', 'Otros campos'].map(name => [name, []]));
        RucModel.companyFields(records).forEach(field => {
            const normalized = normalizeSearch(field.label);
            const group = /departamento|provincia|distrito|direccion|telefono|fax/.test(normalized) ? 'Ubicación'
                : /ciiu|actividad|profesion/.test(normalized) ? 'Actividad'
                : /agente|contribuyente|rus|inscripcion/.test(normalized) ? 'Información tributaria'
                : /ruc|nombre|razon/.test(normalized) ? 'Datos generales' : 'Otros campos';
            const details = document.createElement('details');
            details.appendChild(cell('summary', `${field.label}${field.different ? ' — Diferencias entre fuentes' : ''}`));
            field.variants.forEach((items, value) => {
                const pre = cell('pre', value === null ? '[Campo ausente]' : value === '' ? '[Vacío]' : value);
                details.appendChild(pre);
                details.appendChild(cell('p', items.map(r => `${r.source.zipName} / ${r.source.entryName}, fila ${r.sourceRow}`).join(' · ')));
            });
            sections.get(group).push(details);
        });
        const nodes = [];
        sections.forEach((fields, name) => {
            if (!fields.length) return;
            const section = document.createElement('section'); section.appendChild(cell('h4', name));
            fields.forEach(field => section.appendChild(field)); nodes.push(section);
        });
        const originals = document.createElement('details'); originals.appendChild(cell('summary', 'Apariciones y líneas originales'));
        records.forEach(r => { originals.appendChild(cell('p', `${r.source.zipName} / ${r.source.entryName}, fila ${r.sourceRow}`)); originals.appendChild(cell('pre', r.rawLine)); });
        nodes.push(originals);
        el('ruc-detail-content').replaceChildren(...nodes);
        el('ruc-detail').classList.remove('hidden');
        el('ruc-detail-title').focus();
    }
    const status = text => { el('ruc-status').textContent = text; };
    const cell = (tag, value) => { const node = document.createElement(tag); node.textContent = value; return node; };
    function render() {
        const query = normalizeSearch(el('ruc-search').value.trim());
        const mode = el('ruc-filter').value;
        const key = JSON.stringify([query, mode]);
        if (filterModel !== model) labels = [...new Set(model.sources.flatMap(source => source.dataset.columns.map(column => column.label)))];
        if (filterModel !== model || filterKey !== key) {
            filtered = model.records.filter(record => (!query || record.rawCells.some(value => normalizeSearch(value).includes(query)))
                && (mode === 'all' || model.repeated.has(record.ruc)));
            filterModel = model;
            filterKey = key;
        }
        const uniqueView = el('ruc-view').value === 'companies';
        const visible = uniqueView ? [...new Map(filtered.filter(r => model.groups.has(r.ruc)).map(r => [r.ruc, r])).values()] : filtered;
        page = Math.max(0, Math.min(page, Math.ceil(visible.length / 50) - 1));
        const officeLabel = consultationOffice ? `${consultationOffice} · ` : '';
        el('ruc-metrics').textContent = `${officeLabel}${model.sources.length} TXT · ${model.records.length} registros originales · ${model.groups.size} RUC únicos · ${model.repeated.size} RUC repetidos · ${model.differences.size} RUC con diferencias · ${filtered.length} registros filtrados`;
        const head = document.createElement('tr');
        (uniqueView ? ['RUC', 'Razón social (valores registrados)', 'Apariciones totales', 'Campos con diferencias', 'Ficha'] : ['ZIP', 'TXT', 'Fila', ...labels, 'Original', 'Ficha']).forEach(label => head.appendChild(cell('th', label)));
        el('ruc-head').replaceChildren(head);
        const rows = visible.slice(page * 50, page * 50 + 50).map(record => {
            const row = document.createElement('tr');
            const action = document.createElement('td'), button = cell('button', 'Ver empresa');
            button.disabled = !model.groups.has(record.ruc);
            button.addEventListener('click', () => showCompany(record.ruc)); action.appendChild(button);
            if (uniqueView) {
                const items = model.groups.get(record.ruc);
                const fields = RucModel.companyFields(items);
                const name = fields.find(f => /razon|razón/i.test(f.label));
                const names = name ? [...name.variants.keys()].map(v => v === null ? '[Campo ausente]' : v === '' ? '[Vacío]' : v).join(' / ') : '';
                [record.ruc, names, items.length, fields.filter(f => f.different).length].forEach(v => row.appendChild(cell('td', v)));
                row.appendChild(action); return row;
            }
            [record.source.zipName, record.source.entryName, record.sourceRow].forEach(v => row.appendChild(cell('td', v)));
            const positions = new Map(record.source.dataset.columns.map(c => [c.label, c.index]));
            labels.forEach(label => row.appendChild(cell('td', record.rawCells[positions.get(label)] ?? '')));
            const td = document.createElement('td'), details = document.createElement('details');
            details.appendChild(cell('summary', 'Ver línea'));
            details.appendChild(cell('pre', record.rawLine)); td.appendChild(details); row.appendChild(td);
            row.appendChild(action);
            return row;
        });
        el('ruc-body').replaceChildren(...rows);
        el('ruc-page').textContent = visible.length ? `${visible.length} ${uniqueView ? 'empresas' : 'registros'} · Página ${page + 1} de ${Math.ceil(visible.length / 50)}` : 'Sin resultados';
        el('ruc-prev').disabled = page === 0;
        el('ruc-next').disabled = (page + 1) * 50 >= visible.length;
        const filterIsActive = Boolean(query) || mode !== 'all';
        const exportCount = filterIsActive ? filtered.length : model.records.length;
        const recordLabel = exportCount === 1 ? 'registro' : 'registros';
        el('ruc-export-hint').textContent = filterIsActive
            ? `Descargar resultado filtrado: ${exportCount} ${recordLabel} de la sección 2.`
            : model.records.length
                ? `Descargar archivo completo: ${exportCount} ${exportCount === 1 ? 'registro original' : 'registros originales'}.`
                : 'Cargue archivos TXT o ZIP para habilitar la descarga.';
        el('ruc-download').disabled = busy || exporting || !exportCount;
        el('ruc-export-cancel').disabled = !exporting;
        el('ruc-reset-all').disabled = busy || (!model.records.length && !model.sources.length);
    }
    el('ruc-load').addEventListener('click', async () => {
        if (!UI.requireIntendencia() || busy || exporting) return;
        const files = [...el('ruc-files').files];
        if (!files.length) return status('Seleccione uno o varios archivos (ZIP o TXT).');
        const processingStarted=performance.now(), processingOffice=AppState.intendencia;
        busy = true;
        el('ruc-load').disabled = true; el('ruc-cancel').disabled = false; el('ruc-files').disabled = true;
        const request = ++generation;
        const retained = model.records.length ? ' Se conserva la consulta anterior.' : '';
        render();
        el('ruc-issues').replaceChildren();
        try {
            const result = await Processing.run('RUC', files, message => { if (request === generation) status(message); });
            if (request !== generation) return;
            const incoming = result.model;
            const metadata = { intendencia: processingOffice, modulo: 'RUC', registros: incoming.records.length, archivos: files.length,
                bytes: files.reduce((sum, file) => sum + file.size, 0), duracionMs: performance.now() - processingStarted };
            if (result.rejectedSources) SheetsAPI.event('ERROR', metadata);
            el('ruc-issues').replaceChildren(...result.issues.map(issue => cell('li', issue)));
            const omitted = result.issueCount - result.issues.length;
            if (omitted > 0) el('ruc-issues').appendChild(cell('li', 'Observaciones adicionales: ' + omitted));
            if (!incoming.records.length) {
                const reason = incoming.sources.length ? 'No se encontraron registros después del encabezado.'
                    : 'No se procesó ningún TXT. Revise las observaciones antes de reintentar.';
                status(reason + retained);
                return;
            }
            model = incoming;
            consultationOffice = processingOffice;
            page = 0;
            el('ruc-detail').classList.add('hidden');
            el('ruc-detail-content').replaceChildren();
            el('ruc-search').value = '';
            el('ruc-filter').value = 'all';
            el('ruc-files').value = '';
            el('ruc-export-status').textContent = '';
            SheetsAPI.event('VISUALIZACIÓN', metadata);
            status('Carga finalizada: ' + model.sources.length + ' TXT procesados y ' + result.issueCount + ' observaciones.');
        } catch (error) {
            if (request !== generation) return;
            status(error.message + retained);
            if (error.name !== 'AbortError') {
                SheetsAPI.event(error.code === 'FORMAT' ? 'FORMATO_DESCONOCIDO' : 'ERROR', { intendencia: processingOffice, modulo: 'RUC' });
            }
        } finally {
            if (request === generation) {
                busy = false;
                el('ruc-load').disabled = !AppState.intendencia;
                el('ruc-cancel').disabled = true;
                el('ruc-files').disabled = false;
                render();
            }
        }
    });
    function clearWorkspace() {
        generation++;
        Processing.cancel('RUC');
        ExportFile.cancel('RUC');
        clearTimeout(searchTimer);
        busy = false;
        exporting = false;
        el('ruc-load').disabled = !AppState.intendencia;
        el('ruc-files').disabled = false;
        el('ruc-cancel').disabled = true;
        el('ruc-export-status').textContent = '';
        model = RucModel.consolidate([]);
        consultationOffice = '';
        filtered = []; page = 0;
        el('ruc-files').value = '';
        el('ruc-search').value = '';
        el('ruc-filter').value = 'all';
        el('ruc-view').value = 'records';
        el('ruc-view-records').classList.add('active');
        el('ruc-view-companies').classList.remove('active');
        el('ruc-detail').classList.add('hidden');
        el('ruc-detail-content').replaceChildren();
        el('ruc-issues').replaceChildren();
        el('ruc-head').replaceChildren();
        el('ruc-body').replaceChildren();
        render();
        status('Consulta RUC finalizada. Puede cargar nuevos archivos.');
    }
    document.addEventListener('lector:reset', clearWorkspace);
    el('ruc-reset-all').addEventListener('click', () => {
        if (busy || (!model.records.length && !model.sources.length)) return;
        if (window.confirm('¿Finalizar esta consulta RUC y limpiar los registros, filtros y fichas?')) clearWorkspace();
    });
    el('ruc-cancel').addEventListener('click', () => {
        if (!busy) return;
        Processing.cancel('RUC');
        status('Carga cancelada. No se publicaron resultados parciales.');
    });
    const setView = value => {
        el('ruc-view').value = value;
        el('ruc-view-records').classList.toggle('active', value === 'records');
        el('ruc-view-companies').classList.toggle('active', value === 'companies');
        page = 0;
        render();
    };
    el('ruc-view-records').addEventListener('click', () => setView('records'));
    el('ruc-view-companies').addEventListener('click', () => setView('companies'));
    el('ruc-detail-close').addEventListener('click', () => { el('ruc-detail').classList.add('hidden'); });
    el('ruc-search').addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => { page = 0; render(); }, 180);
    });
    el('ruc-filter').addEventListener('change', () => { page = 0; render(); });
    // Descarga inmediata con el mismo conjunto de registros mostrado en la sección 2.
    el('ruc-download').addEventListener('click', async () => {
        if (!UI.requireIntendencia() || busy || exporting) return;
        clearTimeout(searchTimer);
        render();
        const query = el('ruc-search').value.trim();
        const mode = el('ruc-filter').value;
        const records = RucModel.exportForView(model, filtered, query, mode);
        if (!records.length) return status('La búsqueda o filtro actual no contiene registros para descargar.');
        const scope = query || mode !== 'all' ? 'Resultado filtrado de la sección 2' : 'Todos los registros originales';
        const intendencia = consultationOffice;
        const request = generation;
        const feedback = el('ruc-export-status');
        const context = { intendencia, scope, query, filter: el('ruc-filter').selectedOptions[0].textContent, consolidated: false };
        exporting = true;
        el('ruc-load').disabled = true;
        feedback.textContent = 'Preparando el Excel…';
        render();
        try {
            const bytes = await ExportFile.run('RUC', { records, context }, message => { feedback.textContent = message; });
            if (request !== generation) return;
            ExportFile.save(bytes, 'RUC_' + intendencia + '.xlsx');
            SheetsAPI.event('DESCARGAR_EXCEL', {
                intendencia, modulo: 'RUC', registros: records.length,
                archivos: new Set(records.map(record => record.source.zipId)).size
            });
            feedback.textContent = 'Excel generado: ' + records.length + ' registros.';
        } catch (error) {
            if (request === generation) feedback.textContent = error.message;
        } finally {
            if (request === generation) {
                exporting = false;
                el('ruc-load').disabled = !AppState.intendencia;
                render();
            }
        }
    });
    el('ruc-export-cancel').addEventListener('click', () => ExportFile.cancel('RUC'));
    el('ruc-prev').addEventListener('click', () => { page--; render(); });
    el('ruc-next').addEventListener('click', () => { page++; render(); });
    render();
});
