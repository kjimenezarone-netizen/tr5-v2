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
    exportSheets(records, context) {
        const sources = [...new Set(records.map(r => r.source))];
        const sheets = [{ name: 'Resumen', rows: [
            ['Concepto', 'Valor'], ['Intendencia', context.intendencia], ['Alcance', context.scope],
            ['Búsqueda en la vista', context.query], ['Filtro en la vista', context.filter],
            ['Registros', records.length], ['RUC únicos', new Set(records.filter(r => /^\d{11}$/.test(r.ruc)).map(r => r.ruc)).size],
            ['Nota', 'Solo el alcance Resultado filtrado aplica la búsqueda y el filtro. Seleccionados incluye todas las apariciones de cada empresa seleccionada.']
        ] }];
        sources.forEach((source, i) => {
            sheets.push({ name: `Original_${i + 1}`, rows: [
                source.dataset.columns.map(c => c.rawHeader ?? c.label),
                ...records.filter(r => r.source === source).map(r => r.rawCells.slice())
            ] });
        });
        sheets.push({ name: 'Fuentes', rows: [
            ['Hoja', 'ZIP', 'TXT', 'Codificación', 'Fila original', 'Línea original'],
            ...records.map(r => [`Original_${sources.indexOf(r.source) + 1}`, r.source.zipName, r.source.entryName, r.source.encoding || '', r.sourceRow, r.rawLine])
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
        const repeated = new Set(), differences = new Set();
        groups.forEach((items, ruc) => {
            if (items.length < 2) return;
            repeated.add(ruc);
            const signatures = items.map(item => JSON.stringify(item.source.dataset.columns.map(c => [c.label, item.rawCells[c.index] ?? null]).sort((a,b) => a[0].localeCompare(b[0]))));
            if (new Set(signatures).size > 1) differences.add(ruc);
        });
        return { sources, records, groups, repeated, differences };
    }
};
if (typeof module !== 'undefined' && module.exports) module.exports = RucModel;

if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => {
    const el = id => document.getElementById(id);
    let model = RucModel.consolidate([]), page = 0, busy = false, cancelled = false;
    let rejectedSources = 0;
    const selected = new Set();
    let filtered = [], preview = null, currentRuc = null;
    function showCompany(ruc) {
        currentRuc = ruc;
        invalidatePreview();
        const records = model.groups.get(ruc) || [];
        el('ruc-detail-title').textContent = `Empresa ${ruc} · ${records.length} apariciones`;
        const sections = new Map(['Datos generales', 'Ubicación', 'Actividad', 'Información tributaria', 'Otros campos'].map(name => [name, []]));
        RucModel.companyFields(records).forEach(field => {
            const normalized = field.label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
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
    function invalidatePreview() {
        preview = null;
        el('ruc-export-preview').classList.add('hidden');
        el('ruc-download').disabled = true;
    }
    const status = text => { el('ruc-status').textContent = text; };
    const cell = (tag, value) => { const node = document.createElement(tag); node.textContent = value; return node; };
    function render() {
        const query = el('ruc-search').value.trim().toLocaleLowerCase();
        const mode = el('ruc-filter').value;
        filtered = model.records.filter(r => (!query || r.rawCells.some(v => v.toLocaleLowerCase().includes(query)))
            && (mode === 'all' || (mode === 'selected' ? selected.has(RucModel.selectionKey(r)) : (mode === 'repeated' ? model.repeated : model.differences).has(r.ruc))));
        const uniqueView = el('ruc-view').value === 'companies';
        const visible = uniqueView ? [...new Map(filtered.filter(r => model.groups.has(r.ruc)).map(r => [r.ruc, r])).values()] : filtered;
        page = Math.max(0, Math.min(page, Math.ceil(visible.length / 50) - 1));
        el('ruc-metrics').textContent = `${model.sources.length} TXT · ${model.records.length} registros originales · ${model.groups.size} RUC únicos · ${model.repeated.size} RUC repetidos · ${model.differences.size} RUC con diferencias · ${filtered.length} registros filtrados`;
        const allLabels = [...new Set(model.sources.flatMap(s => s.dataset.columns.map(c => c.label)))];
        const labels = ColumnChooser.visible('ruc-records', allLabels);
        ColumnChooser.mount('ruc-column-options', 'ruc-records', allLabels, render);
        el('ruc-column-control').classList.toggle('hidden', uniqueView);
        const head = document.createElement('tr');
        (uniqueView ? ['Seleccionar empresa', 'RUC', 'Razón social (valores registrados)', 'Apariciones totales', 'Campos con diferencias', 'Ficha'] : ['Seleccionar empresa', 'ZIP', 'TXT', 'Fila', ...labels, 'Original', 'Ficha']).forEach(label => head.appendChild(cell('th', label)));
        el('ruc-head').replaceChildren(head);
        const rows = visible.slice(page * 50, page * 50 + 50).map(record => {
            const row = document.createElement('tr');
            const selectCell = document.createElement('td'), checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            const selectionKey = RucModel.selectionKey(record);
            checkbox.checked = selected.has(selectionKey);
            checkbox.setAttribute('aria-label', `Seleccionar ${record.ruc || 'registro sin RUC'}, fila ${record.sourceRow}`);
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) selected.add(selectionKey); else selected.delete(selectionKey);
                invalidatePreview(); render();
            });
            selectCell.appendChild(checkbox); row.appendChild(selectCell);
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
        el('ruc-selection-count').textContent = `${[...selected].filter(k => k.startsWith('ruc:')).length} empresas seleccionadas · ${[...selected].filter(k => k.startsWith('row:')).length} registros sin RUC seleccionados · ${RucModel.exportRecords(model, 'selected', selected, filtered).length} registros incluidos`;
        el('ruc-preview-button').disabled = busy || !model.records.length;
    }
    el('ruc-load').addEventListener('click', async () => {
        if (!UI.requireIntendencia() || busy) return;
        const files = [...el('ruc-files').files];
        if (!files.length) return status('Seleccione uno o varios archivos (ZIP o TXT).');
        if (files.some(f => /\.zip$/i.test(f.name)) && typeof JSZip === 'undefined') return status('No se pudo cargar el lector ZIP. Recargue la página.');
        const processingStarted=performance.now(), processingOffice=AppState.intendencia;
        busy = true; cancelled = false;
        rejectedSources = 0; el('ruc-diagnostic-preview').replaceChildren();
        el('ruc-load').disabled = true; el('ruc-cancel').disabled = false; el('ruc-files').disabled = true;
        const sources = [], issues = [];
        model = RucModel.consolidate([]); selected.clear(); invalidatePreview();
        ColumnChooser.reset('ruc-records');
        currentRuc = null; el('ruc-detail').classList.add('hidden');
        el('ruc-export-zip').replaceChildren();
        page = 0; render(); el('ruc-issues').replaceChildren();
        try {
            const result = await Processing.run('RUC', files, status);
            model = result.model;
            if (model.sources.length) SheetsAPI.event('VISUALIZACIÓN',{intendencia:processingOffice,modulo:'RUC',registros:model.records.length,archivos:files.length,bytes:files.reduce((n,f)=>n+f.size,0),duracionMs:performance.now()-processingStarted});
            sources.push(...model.sources); issues.push(...result.issues); rejectedSources = result.rejectedSources;
            const zipNames = new Map(sources.map(s => [s.zipId, s.zipName]));
            zipNames.forEach((name, id) => {
                const option = cell('option', `${id + 1}. ${name}`); option.value = String(id); el('ruc-export-zip').appendChild(option);
            });
            render();
            el('ruc-issues').replaceChildren(...issues.map(issue => cell('li', issue)));
            status(`Carga finalizada: ${sources.length} TXT procesados y ${issues.length} observaciones. Los datos se mantienen en este navegador.`);
        } catch (error) { status(error.name === 'AbortError' ? error.message : `No se pudo completar la carga: ${error.message}`); }
        finally { busy = false; el('ruc-load').disabled = !AppState.intendencia; el('ruc-cancel').disabled = true; el('ruc-files').disabled = false; render(); }
    });
    el('ruc-cancel').addEventListener('click', () => { cancelled = true; status('Cancelando carga…'); });
    el('ruc-diagnostic-prepare').addEventListener('click', () => {
        if (!UI.requireIntendencia() || busy) return;
        if (cancelled || (!model.sources.length && !rejectedSources)) return status('Complete una carga para preparar su diagnóstico.');
        const datasets = model.sources.map(s => ({...s.dataset,encoding:s.encoding}));
        Diagnostics.preview('ruc-diagnostic-preview',Diagnostics.build(datasets,'RUC',rejectedSources));
    });
    el('ruc-view').addEventListener('change', () => { page = 0; invalidatePreview(); render(); });
    el('ruc-detail-close').addEventListener('click', () => { el('ruc-detail').classList.add('hidden'); });
    el('ruc-detail-export').addEventListener('click', () => { el('ruc-export-scope').value = 'company'; el('ruc-preview-button').click(); el('ruc-export-preview').scrollIntoView({ block: 'nearest' }); });
    el('ruc-search').addEventListener('input', () => { invalidatePreview(); page = 0; render(); });
    el('ruc-filter').addEventListener('change', () => { invalidatePreview(); page = 0; render(); });
    el('ruc-select-filtered').addEventListener('click', () => { filtered.forEach(r => selected.add(RucModel.selectionKey(r))); invalidatePreview(); render(); });
    el('ruc-clear-selection').addEventListener('click', () => { selected.clear(); invalidatePreview(); render(); });
    ['ruc-export-scope', 'ruc-export-zip', 'intendencia'].forEach(id => el(id).addEventListener('change', invalidatePreview));
    el('ruc-preview-button').addEventListener('click', () => {
        if (!UI.requireIntendencia() || busy) return;
        invalidatePreview();
        const scope = el('ruc-export-scope');
        const records = RucModel.exportRecords(model, scope.value, selected, filtered, el('ruc-export-zip').value, currentRuc);
        if (!records.length) return status('El alcance elegido no contiene registros.');
        const sheets = RucModel.exportSheets(records, { intendencia: AppState.intendencia, scope: scope.selectedOptions[0].textContent, query: el('ruc-search').value, filter: el('ruc-filter').selectedOptions[0].textContent, consolidated: ['consolidated', 'company'].includes(scope.value) });
        if (sheets.some(s => s.rows.length > 1048576 || s.rows.some(row => row.length > 16384 || row.some(v => typeof v === 'string' && v.length > 32767)))) return status('Los datos exceden los límites de Excel. Reduzca el alcance para evitar pérdida de información.');
        preview = { sheets, intendencia: AppState.intendencia, metadata:{intendencia:AppState.intendencia,modulo:'RUC',registros:records.length,archivos:new Set(records.map(r=>r.source.zipId)).size} };
        el('ruc-export-summary').textContent = `${scope.selectedOptions[0].textContent}: ${records.length} registros, ${new Set(records.filter(r => /^\d{11}$/.test(r.ruc)).map(r => r.ruc)).size} RUC únicos. Se conservarán todas las columnas de cada fuente.`;
        el('ruc-export-sheets').replaceChildren(...sheets.map(s => cell('li', `${s.name}: ${s.rows.length - 1} filas · ${s.rows[0].length} columnas`)));
        const sample = document.createElement('tbody');
        records.slice(0, 5).forEach(r => { const row = document.createElement('tr'); [r.source.zipName, r.source.entryName, r.sourceRow, ...r.rawCells].forEach(v => row.appendChild(cell('td', v))); sample.appendChild(row); });
        el('ruc-export-sample').replaceChildren(sample);
        el('ruc-export-preview').classList.remove('hidden'); el('ruc-download').disabled = false;
    });
    el('ruc-download').addEventListener('click', () => {
        if (!UI.requireIntendencia() || !preview || busy) return;
        if (preview.intendencia !== AppState.intendencia) return invalidatePreview();
        try {
            const workbook = XLSX.utils.book_new();
            preview.sheets.forEach(s => {
                const rawSheet = XLSX.utils.aoa_to_sheet(s.rows);
                const ws = (typeof TRExport !== 'undefined' && TRExport.formatWorksheet) ? TRExport.formatWorksheet(rawSheet, s.name) : rawSheet;
                XLSX.utils.book_append_sheet(workbook, ws, s.name);
            });
            XLSX.writeFile(workbook, `RUC_${preview.intendencia}.xlsx`);
            SheetsAPI.event('DESCARGAR_EXCEL',preview.metadata);
            status('Excel generado con el alcance previsualizado.');
        } catch (error) { status(`No se pudo generar el Excel: ${error.message}`); }
    });
    el('ruc-prev').addEventListener('click', () => { page--; render(); });
    el('ruc-next').addEventListener('click', () => { page++; render(); });
    render();
});
