const TRSchema = typeof module !== 'undefined' && module.exports ? require('./report-schema.js') : ReportSchema;

const TRAnalysis = {
    scope(analysis, scope, selected, filtered, current) {
        if (scope === 'all') return analysis.people.slice();
        if (scope === 'filtered') return filtered.slice();
        if (scope === 'selected') return analysis.people.filter(p => selected.has(p.id));
        if (scope === 'individual') return analysis.people.filter(p => p.id === current);
        throw new Error('Alcance desconocido.');
    },
    workerHeader: ['Tipo documento', 'Número', 'Nombres registrados', 'TR5', 'TR6', 'Multiplicidad', 'Presencia', 'Diferencias de identidad'],
    workerRow(p) {
        const tr5 = p.TR5.length, tr6 = p.TR6.length;
        let multi = 'Registro único';
        if (tr5 > 1 && tr6 > 1) {
            multi = `Aparece varias veces en el documento (${tr5} en TR5, ${tr6} en TR6)`;
        } else if (tr5 > 1) {
            multi = `Aparece varias veces en el documento (${tr5} en TR5)`;
        } else if (tr6 > 1) {
            multi = `Aparece varias veces en el documento (${tr6} en TR6)`;
        }
        return [p.type, p.number, [...p.names].join(' / '), tr5, tr6, multi, p.status, p.identityDifference ? 'Sí' : 'No'];
    },
    describeExport(analysis, people) {
        const rows = { TR5: 0, TR6: 0 };
        for (const person of people) {
            rows.TR5 += person.TR5.length;
            rows.TR6 += person.TR6.length;
        }
        const records = rows.TR5 + rows.TR6;
        return { records, sheets: [
            { name: 'Resumen', rows: 9 + (analysis.schemaIssues?.length ?? 0), columns: 2 },
            { name: 'Trabajadores', rows: people.length, columns: this.workerHeader.length },
            { name: 'Historico laboral', rows: rows.TR5, columns: 9 },
            ...analysis.datasets.map(dataset => ({ name: dataset.type + ' Original', rows: rows[dataset.type], columns: dataset.columns.length })),
            { name: 'Fuentes', rows: records, columns: 4 }
        ] };
    },
    sheets(analysis, people, context) {
        const items = people.flatMap(p => [...p.TR5, ...p.TR6]);
        const sources = analysis.datasets;
        const sheets = [
            { name: 'Resumen', rows: [
                ['Concepto','Valor'],
                ['Intendencia',context.intendencia],
                ['Razón Social', analysis.company ?? ''],
                ['RUC',analysis.ruc ?? ''],
                ['Alcance',context.scope],
                ['Búsqueda de trabajadores',context.query],
                ['Filtro de trabajadores',context.filter],
                ['Trabajadores',people.length],
                ['Registros',items.length],
                ['Nota','Los filtros del cruce seleccionan trabajadores; se exportan todas sus filas TR5/TR6 sin eliminar columnas. La búsqueda de registros originales es independiente y no afecta este Excel.'],
                ...(analysis.schemaIssues ?? []).map(issue => ['Observación de esquema', issue.message])
            ] },
            { name: 'Trabajadores', rows: [
                this.workerHeader,
                ...people.map(person => this.workerRow(person))
            ] },
            { name: 'Historico laboral', rows: [['Tipo documento','Número','Ingreso original','Ingreso interpretado','Establecimiento original','Contrato original','Diagnóstico','Archivo','Fila'], ...people.flatMap(p => this.history(p).rows.map(r => [p.type,p.number,r.start ?? '',r.iso ?? '',r.establishment ?? '',r.contract ?? '',[r.diagnostic,r.establishmentStatus,r.contractStatus].filter(Boolean).join(' / '),r.dataset.sourceFile,r.record.sourceRow]))] }
        ];
        const included = new Set(items.map(item => item.record));
        sources.forEach(dataset => {
            sheets.push({name:`${dataset.type} Original`,rows:[dataset.columns.map(c=>c.rawHeader ?? c.label),...dataset.records.filter(r=>included.has(r)).map(r=>r.rawCells.slice())]});
        });
        sheets.push({name:'Fuentes',rows:[['Reporte','Archivo','Fila','Línea original'],...items.map(i=>[i.dataset.type,i.dataset.sourceFile,i.record.sourceRow,i.record.rawLine])]});
        return sheets;
    },
    key: TRSchema.key,
    schemas: new WeakMap(),
    schema(dataset) {
        if (!this.schemas.has(dataset)) this.schemas.set(dataset, TRSchema.describe(dataset));
        return this.schemas.get(dataset);
    },
    date(value) {
        const text = (value ?? '').trim();
        if (!text) return { iso: null, status: 'Fecha vacía' };
        const local = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
        const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
        if (!local && !iso) return { iso: null, status: 'Formato de fecha no reconocido' };
        const [year, month, day] = local ? [+local[3], +local[2], +local[1]] : [+iso[1], +iso[2], +iso[3]];
        const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
        const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) return { iso: null, status: 'Fecha no válida' };
        return { iso: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, status: '' };
    },
    history(person) {
        const rows = person.TR5.map(({record, dataset}, order) => {
            const fields = this.schema(dataset);
            const start = TRSchema.read(record, fields.start);
            const establishment = TRSchema.read(record, fields.establishment);
            const contract = TRSchema.read(record, fields.contract);
            const occupation = TRSchema.read(record, fields.occupation);
            const date = this.date(start.value);
            return { record, dataset, order, start: start.value, iso: date.iso, diagnostic: start.status || date.status,
                establishment: establishment.value, establishmentStatus: establishment.status,
                contract: contract.value, contractStatus: contract.status,
                occupation: occupation.value, occupationStatus: occupation.status };
        });
        rows.sort((a,b) => a.iso && b.iso ? a.iso.localeCompare(b.iso) || a.order-b.order : a.iso ? -1 : b.iso ? 1 : a.order-b.order);
        const dates = [...new Set(rows.map(r => r.iso).filter(Boolean))].sort();
        const distinct = field => [...new Set(rows.map(r => r[field]?.trim()).filter(Boolean))];
        return { rows, dates, first: dates[0] ?? null, latest: dates.at(-1) ?? null,
            establishments: distinct('establishment'), contracts: distinct('contract'),
            occupations: distinct('occupation'), unresolvedDates: rows.filter(r => !r.iso).length };
    },
    ruc(dataset) {
        const matches = dataset.prelude.filter(line => /^\s*(?:(?:NRO\.?|N[ÚU]MERO)\s+DE\s+)?RUC\s*:/i.test(line));
        const values = matches.map(line => /:\s*(\d{11})\s*$/.exec(line)?.[1]);
        return values.length && values.every(Boolean) && new Set(values).size === 1 ? values[0] : null;
    },
    companyName(dataset) {
        const info = TRSchema.companyInfo(dataset);
        const label = Object.keys(info).find(key => /RAZON SOCIAL|DENOMINACION/.test(this.key(key)));
        return label ? info[label] : null;
    },
    aggregateIndicator(values) {
        if (values.includes(true)) return true;
        return values.length && values.every(value => value === false) ? false : null;
    },
    build(datasets) {
        if (!datasets.length || datasets.length > 2) throw new Error('Cargue un reporte o un par TR5 y TR6.');
        if (datasets.some(dataset => !['TR5', 'TR6'].includes(dataset.type)) || new Set(datasets.map(dataset => dataset.type)).size !== datasets.length) {
            throw Object.assign(new Error('Para el cruce seleccione un TR5 y un TR6, sin repetir el tipo.'), { code: 'FORMAT' });
        }
        const rucs = datasets.map(dataset => this.ruc(dataset));
        const paired = datasets.length === 2;
        if (paired && (rucs.some(ruc => !ruc) || rucs[0] !== rucs[1])) {
            throw Object.assign(new Error('No se puede cruzar: ambos reportes deben tener un RUC identificable e idéntico.'), { code: 'FORMAT' });
        }
        const people = new Map();
        const schemaIssues = [];
        datasets.forEach((dataset, sourceIndex) => {
            const fields = this.schema(dataset);
            const documentEvaluable = fields.type.index !== null && fields.number.index !== null;
            if (!documentEvaluable) {
                schemaIssues.push({ type: dataset.type, code: 'IDENTITY_SCHEMA', message: `${dataset.type}: columnas documentales ausentes o ambiguas. Se conservan los registros por fila.` });
            }
            if (dataset.type === 'TR6' && (!fields.sctr || fields.cuspp.index === null)) {
                schemaIssues.push({ type: dataset.type, code: 'HEALTH_SCHEMA', message: 'TR6: no se pudieron identificar todos los campos de CUSPP o SCTR salud.' });
            }
            for (const record of dataset.records) {
                const type = TRSchema.read(record, fields.type).value?.trim() ?? '';
                const number = TRSchema.read(record, fields.number).value?.trim() ?? '';
                const aligned = record.rawCells.length === dataset.rawHeaders.length;
                const resolved = documentEvaluable && aligned && Boolean(this.key(type) && number);
                const id = resolved ? JSON.stringify([this.key(type), number]) : `unresolved:${sourceIndex}:${record.sourceRow}`;
                if (!people.has(id)) people.set(id, { id, type, number, resolved, documentEvaluable, TR5: [], TR6: [], names: new Set() });
                const person = people.get(id);
                const names = [fields.surname, fields.secondSurname, fields.names].map(field => TRSchema.read(record, field).value?.trim() ?? '');
                const item = { record, dataset, names };
                if (dataset.type === 'TR6') {
                    item.health = aligned ? TRSchema.health(record, fields) : { cuspp: null, sctr: null, healthRegime: null, pensionRegime: null };
                }
                person.names.add(names.filter(Boolean).join(' '));
                person[dataset.type].push(item);
            }
        });
        const crossable = paired && !schemaIssues.some(issue => issue.code === 'IDENTITY_SCHEMA');
        for (const person of people.values()) {
            if (!person.documentEvaluable) person.status = 'Identidad no evaluable';
            else if (!person.resolved) person.status = 'Identidad incompleta';
            else if (!paired) person.status = 'Sin contraparte cargada';
            else if (!crossable) person.status = 'Cruce no evaluable';
            else if (person.TR5.length && person.TR6.length) person.status = 'En ambos';
            else person.status = person.TR5.length ? 'Solo TR5' : 'Solo TR6';
            person.identityDifference = new Set([...person.TR5, ...person.TR6].map(item => JSON.stringify(item.names.map(this.key)))).size > 1;
            person.hasMultipleTR5 = person.TR5.length > 1;
            person.hasCuspp = this.aggregateIndicator(person.TR6.map(item => item.health.cuspp === null ? null : Boolean(item.health.cuspp)));
            person.hasSctr = this.aggregateIndicator(person.TR6.map(item => item.health.sctr));
        }
        const company = datasets.map(dataset => this.companyName(dataset)).find(Boolean) || null;
        return { datasets, ruc: rucs[0], company, paired, crossable, schemaIssues, people: [...people.values()] };
    }
};
if (typeof module !== 'undefined' && module.exports) module.exports = TRAnalysis;

const TRView = {
    analysis: null, intendencia: '', page: 0, selected: new Set(), filtered: [], current: null, activeQuickFilter: 'all',
    reset() {
        this.analysis = null; this.page = 0; this.selected.clear(); this.filtered = []; this.current = null; this.activeQuickFilter = 'all';
        this.intendencia = '';
        document.getElementById('tr-export-scope').value = 'all';
        document.getElementById('tr-person-search').value = '';
        document.getElementById('tr-person-filter').value = 'all';
        for (const [id, value] of [['tr-worker-field','all'],['tr-worker-type',''],['tr-worker-occupation','']]) {
            const element = document.getElementById(id);
            if (element) { element.replaceChildren(); element.value = value; }
        }
        const status = document.getElementById('tr-cross-filter-summary');
        if (status) status.textContent = 'Seleccione un reporte para consultar trabajadores.';
        const filteredButton = document.getElementById('tr-export-current-filter');
        if (filteredButton) filteredButton.disabled = true;
        TRFilterUI.reset(); TRExport.invalidate();
        document.getElementById('tr-diagnostic-preview').replaceChildren();
        document.getElementById('tr-people').classList.add('hidden');
        document.getElementById('tr-person-detail').replaceChildren();
    },
    set(analysis, intendencia) {
        this.analysis = analysis; this.page = 0; this.activeQuickFilter = 'all';
        this.intendencia = intendencia;
        TRFilterUI.set(analysis);
        this.configureWorkerFilters(analysis);
        document.getElementById('tr-people').classList.remove('hidden');
        this.updateQuickFindings();
        this.render();
    },
    configureWorkerFilters(analysis) {
        const fill = (id, options, defaultValue) => {
            const select = document.getElementById(id);
            if (!select) return;
            select.replaceChildren(...options.map(({value, label}) => {
                const option = document.createElement('option');
                option.value = value;
                option.textContent = label;
                return option;
            }));
            select.value = defaultValue;
        };
        fill('tr-worker-field', TRFilters.searchableFields(analysis), 'all');
        fill('tr-worker-type', [{value:'',label:'Todos los tipos'},
            ...TRFilters.documentTypes(analysis).map(value => ({value,label:value}))], '');
        const occupations = TRFilters.occupations(analysis);
        fill('tr-worker-occupation', [{value:'',label:occupations.length ? 'Todas las ocupaciones' : 'Sin ocupación en los reportes'},
            ...occupations.map(value => ({value,label:value}))], '');
        const occupationFilter = document.getElementById('tr-worker-occupation');
        if (occupationFilter) occupationFilter.disabled = !occupations.length;
    },
    hasActiveWorkerFilters() {
        const read = id => document.getElementById(id)?.value || '';
        return Boolean(read('tr-person-search').trim() || read('tr-worker-type') || read('tr-worker-occupation')
            || read('tr-person-filter') !== 'all' || this.activeQuickFilter !== 'all'
            || TRFilterUI.rules.length);
    },
    clearWorkerFilters() {
        if (!this.analysis) return;
        for (const [id, value] of [['tr-person-search',''], ['tr-worker-field','all'],
            ['tr-worker-type',''], ['tr-worker-occupation',''], ['tr-person-filter','all']]) {
            const element = document.getElementById(id);
            if (element) element.value = value;
        }
        this.activeQuickFilter = 'all';
        TRFilterUI.rules = [];
        TRFilterUI.draw();
        TRExport.invalidate();
        this.page = 0;
        this.render();
    },
    updateQuickFindings() {
        if (!this.analysis) return;
        const people = this.analysis.people;
        const total = people.length;
        const multiple = people.filter(p => p.hasMultipleTR5 || p.TR6.length > 1).length;
        const hasTR6 = people.some(p => p.TR6.length > 0);
        const noCuspp = hasTR6 ? people.filter(p => p.hasCuspp === false).length : 0;
        const noSctr = hasTR6 ? people.filter(p => p.hasSctr === false).length : 0;

        const setVal = (id, count, badgeSuffix = '') => {
            const el = document.getElementById(id);
            if (el) el.textContent = `${count}${badgeSuffix}`;
        };
        setVal('qf-total', total);
        setVal('qf-multiple', multiple);
        setVal('qf-no-cuspp', hasTR6 ? noCuspp : '—');
        setVal('qf-no-sctr', hasTR6 ? noSctr : '—');
        document.querySelectorAll('.quick-finding-card[data-filter="no_cuspp"], .quick-finding-card[data-filter="no_sctr"]').forEach(btn => {
            btn.disabled = !hasTR6;
            btn.title = hasTR6 ? 'Buscar registros que requieren revisión en TR6' : 'No aplica: cargue un reporte TR6 para evaluar esta condición';
        });

        // Highlight active button
        document.querySelectorAll('.quick-finding-card').forEach(btn => {
            const f = btn.getAttribute('data-filter');
            if (f === this.activeQuickFilter && (this.activeQuickFilter !== 'all' || document.getElementById('tr-person-filter').value === 'all')) btn.classList.add('active');
            else btn.classList.remove('active');
        });
    },
    render() {
        if (!this.analysis) return;
        const el = id => document.getElementById(id);
        const query = el('tr-person-search').value;
        const field = el('tr-worker-field').value;
        const documentType = el('tr-worker-type').value;
        const occupation = el('tr-worker-occupation').value;
        // Los accesos rápidos complementan al selector de estado, sin duplicarlo.
        const filter = this.activeQuickFilter !== 'all' ? this.activeQuickFilter : el('tr-person-filter').value;
        this.updateQuickFindings();

        const people = this.analysis.people.filter(p => {
            if (!TRFilters.matches(p, TRFilterUI.rules, TRAnalysis.date)) return false;
            if (!TRFilters.matchesWorker(p,{query,field,documentType,occupation})) return false;
            if (filter === 'all') return true;
            if (filter === 'selected') return this.selected.has(p.id);
            if (filter === 'differences') return p.identityDifference;
            if (filter === 'multiple') return p.hasMultipleTR5 || (p.TR6.length > 1);
            if (filter === 'no_cuspp') return p.hasCuspp === false;
            if (filter === 'no_sctr') return p.hasSctr === false;
            return p.status === filter;
        });

        this.filtered = people;
        const hasFilter = this.hasActiveWorkerFilters();
        const originalMatches = people.reduce((count, person) => count + person.TR5.length + person.TR6.length, 0);
        const summary = el('tr-cross-filter-summary');
        if (summary) summary.textContent = hasFilter
            ? `${people.length} de ${this.analysis.people.length} trabajadores encontrados · ${originalMatches} registros TR5/TR6 asociados. El Excel filtrado conservará todas sus filas.`
            : `${this.analysis.people.length} trabajadores disponibles. Combine apellido, tipo documental, ocupación y otros campos para filtrar.`;
        const exportButton = el('tr-export-current-filter');
        if (exportButton) exportButton.disabled = !hasFilter || !people.length;
        el('tr-selection-count').textContent = `${this.selected.size} trabajadores seleccionados (todas sus filas TR5/TR6)`;
        this.page = Math.max(0, Math.min(this.page, Math.ceil(people.length / 50) - 1));
        el('tr-person-summary').textContent = `${this.intendencia} · ${this.analysis.people.length} identidades · ${people.length} visibles · ${this.analysis.datasets.reduce((n,d) => n + d.records.length, 0)} registros originales · ${this.analysis.crossable ? 'Cruce validado por RUC' : this.analysis.paired ? 'Cruce documental no evaluable' : 'Un reporte'}`;
        
        el('tr-person-body').replaceChildren(...people.slice(this.page * 50, this.page * 50 + 50).map((person, idx) => {
            const row = document.createElement('tr');
            if (person.hasMultipleTR5) row.classList.add('row-has-multiple');

            // Col 0: Nº correlativo
            const tdIndex = document.createElement('td');
            tdIndex.textContent = this.page * 50 + idx + 1;
            tdIndex.className = 'text-center text-gray-600 font-mono text-xs font-semibold select-none';
            row.appendChild(tdIndex);

            // Col 1: Checkbox
            const selectCell = document.createElement('td');
            selectCell.className = 'text-center';
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = this.selected.has(person.id);
            checkbox.setAttribute('aria-label', `Seleccionar ${person.type} ${person.number}`);
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) this.selected.add(person.id);
                else this.selected.delete(person.id);
                TRExport.invalidate();
                this.render();
            });
            selectCell.appendChild(checkbox);
            row.appendChild(selectCell);

            // Col 2: Tipo Doc
            const tdType = document.createElement('td');
            tdType.textContent = person.type;
            row.appendChild(tdType);

            // Col 3: Número Doc (con font mono para inspectores)
            const tdDocNum = document.createElement('td');
            tdDocNum.className = 'font-mono font-bold';
            tdDocNum.textContent = person.number;
            row.appendChild(tdDocNum);

            // Col 4: Nombres
            const tdNames = document.createElement('td');
            tdNames.textContent = [...person.names].join(' / ');
            row.appendChild(tdNames);

            // Col 5: TR5 (badge destacado si tiene reingresos/múltiples contratos)
            const tdTR5 = document.createElement('td');
            if (person.TR5.length > 1) {
                const badge = document.createElement('span');
                badge.className = 'badge-reingreso';
                badge.textContent = `🔁 ${person.TR5.length} filas TR5`;
                badge.title = 'Hay varias filas TR5; no confirman por sí solas un reingreso';
                tdTR5.appendChild(badge);
            } else if (person.TR5.length === 1) {
                tdTR5.innerHTML = `<span class="text-gray-700 font-medium">1</span>`;
            } else {
                tdTR5.innerHTML = `<span class="text-gray-400 italic">0</span>`;
            }
            row.appendChild(tdTR5);

            // Col 6: TR6
            const tdTR6 = document.createElement('td');
            if (person.TR6.length > 0) {
                let sctrBadge = '';
                if (person.hasCuspp === false) sctrBadge += ' <span title="Sin CUSPP" class="text-xs text-orange-600 font-bold">⚠️ CUSPP no registrado</span>';
                tdTR6.innerHTML = `<span class="text-gray-700">${person.TR6.length}</span>${sctrBadge}`;
            } else {
                tdTR6.innerHTML = `<span class="text-gray-400 italic">0</span>`;
            }
            row.appendChild(tdTR6);

            // Col 7: Presencia
            const tdStatus = document.createElement('td');
            tdStatus.innerHTML = person.status === 'En ambos' 
                ? '<span class="badge-status-green">En ambos</span>'
                : `<span class="badge-status-gray">${person.status}</span>`;
            row.appendChild(tdStatus);

            // Col 8: Observaciones
            const tdObs = document.createElement('td');
            const obs = [];
            if (person.hasMultipleTR5) obs.push('<span class="text-amber-700 font-medium text-xs">Múltiples registros TR5</span>');
            if (person.identityDifference) obs.push('<span class="text-blue-700 text-xs">Diferencia nombres</span>');
            if (person.hasCuspp === false) obs.push('<span class="text-orange-700 text-xs">CUSPP no registrado</span>');
            if (person.hasSctr === false) obs.push('<span class="text-red-700 text-xs">SCTR salud sin marca (verificar)</span>');
            tdObs.innerHTML = obs.join(' · ') || '<span class="text-gray-400">-</span>';
            row.appendChild(tdObs);

            // Col 9: Botón Ficha
            const tdAction = document.createElement('td');
            const button = document.createElement('button');
            button.className = 'btn-ver-ficha';
            button.innerHTML = `<span>Ver ficha</span><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/></svg>`;
            button.addEventListener('click', () => this.detail(person));
            tdAction.appendChild(button);
            row.appendChild(tdAction);

            return row;
        }));

        el('tr-person-page').textContent = people.length ? `Página ${this.page + 1} de ${Math.ceil(people.length / 50)}` : 'Sin resultados';
        el('tr-person-prev').disabled = this.page === 0;
        el('tr-person-next').disabled = (this.page + 1) * 50 >= people.length;

        // Sincronizar desplegable de exportación dinámico
        if (typeof TRExport !== 'undefined') TRExport.syncScopeOptions();
    },
    detail(person) {
        this.current = person.id;
        TRExport.invalidate();
        const container = document.getElementById('tr-person-detail');
        container.replaceChildren();
        const safe = value => Utils.escapeHTML(value ?? '');

        // Encabezado Ficha
        const cardHeader = document.createElement('div');
        cardHeader.className = 'ficha-header flex flex-wrap items-center justify-between gap-4 p-5 bg-gradient-to-r from-blue-900 to-indigo-950 text-white rounded-2xl shadow-sm mb-5';
        
        const infoDiv = document.createElement('div');
        const badgeRep = person.hasMultipleTR5 
            ? `<span class="bg-amber-400/20 text-amber-300 border border-amber-400/30 text-xs font-bold px-2.5 py-1 rounded-full ml-3">🔁 ${person.TR5.length} registros TR5</span>`
            : `<span class="bg-green-400/20 text-green-300 border border-green-400/30 text-xs font-bold px-2.5 py-1 rounded-full ml-3">${person.TR5.length ? '1 registro TR5' : 'Sin registros TR5'}</span>`;
        
        infoDiv.innerHTML = `
            <div class="flex items-center flex-wrap gap-2">
                <span class="text-xs font-mono uppercase tracking-widest text-blue-200">${safe(person.type)} ${safe(person.number)}</span>
                ${badgeRep}
            </div>
            <h3 class="text-xl font-bold text-white mt-1">${safe([...person.names].join(' / '))}</h3>
            <p class="text-xs text-blue-200/80 mt-0.5">Estado en reportes: <strong>${safe(person.status)}</strong> · ${person.TR5.length} registros TR5, ${person.TR6.length} registros TR6</p>
        `;
        cardHeader.appendChild(infoDiv);

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'flex items-center gap-2';
        const exportButton = document.createElement('button');
        exportButton.textContent = '📥 Previsualizar este trabajador';
        exportButton.className = 'bg-white/10 hover:bg-white/20 text-white text-xs font-semibold px-4 py-2.5 rounded-xl border border-white/20 transition-all';
        exportButton.addEventListener('click', () => {
            document.getElementById('tr-export-scope').value = 'individual';
            TRExport.preview();
        });
        actionsDiv.appendChild(exportButton);
        cardHeader.appendChild(actionsDiv);
        container.appendChild(cardHeader);

        const history = TRAnalysis.history(person);

        // SECCIÓN HISTÓRICO TR5 (Condicional: si tiene >1, línea de tiempo; si tiene 1, tarjeta limpia)
        if (person.TR5.length > 1) {
            // CASO MÚLTIPLE: LÍNEA DE TIEMPO
            const timeSection = document.createElement('section');
            timeSection.className = 'timeline-box bg-white p-6 rounded-2xl border border-amber-200/80 shadow-sm mb-6';
            timeSection.innerHTML = `
                <div class="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-xl mb-6">
                    <span class="text-2xl">⚠️</span>
                    <div>
                        <h4 class="text-amber-900 font-bold text-sm">Indicador de revisión: ${person.TR5.length} registros TR5</h4>
                        <p class="text-amber-800 text-xs mt-1">Existen varias filas de TR5 para el mismo documento. No constituyen por sí solas prueba de reingreso, continuidad ni incumplimiento; contraste las fechas y condiciones con los documentos laborales.</p>
                    </div>
                </div>
                <h4 class="font-bold text-gray-900 text-base mb-4 flex items-center gap-2">
                    <span>Cronología de filas TR5 (por fecha informada)</span>
                    <span class="text-xs font-normal text-gray-500">(${history.dates.length} fechas distintas)</span>
                </h4>
            `;

            const timelineList = document.createElement('div');
            timelineList.className = 'timeline-list space-y-4 relative pl-6 border-l-2 border-amber-400 ml-3';

            history.rows.forEach((item, idx) => {
                const step = document.createElement('div');
                step.className = 'timeline-item relative';
                step.innerHTML = `
                    <div class="absolute -left-[31px] top-1 w-6 h-6 rounded-full bg-amber-500 text-white font-bold text-xs flex items-center justify-center shadow-sm">
                        ${idx + 1}
                    </div>
                    <div class="bg-gray-50 hover:bg-white p-4 rounded-xl border border-gray-200 shadow-xs transition-all">
                        <div class="flex flex-wrap items-center justify-between gap-2 border-b pb-2 mb-2">
                            <div class="flex items-center gap-2">
                                <span class="text-xs font-bold text-blue-900 bg-blue-100 px-2 py-0.5 rounded">Inicio: ${safe(item.start || 'No indicada')}</span>
                                <span class="text-xs text-gray-400 font-mono">Fila ${item.record.sourceRow}</span>
                            </div>
                            <span class="text-xs text-gray-500">${safe(item.dataset.sourceFile)}</span>
                        </div>
                        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                            <div>
                                <span class="text-gray-400 block">Tipo de Contrato</span>
                                <strong class="text-gray-800">${safe(item.contract || 'No registrado')}</strong>
                            </div>
                            <div>
                                <span class="text-gray-400 block">Ocupación / Puesto</span>
                                <strong class="text-gray-800">${safe(item.occupation || 'No registrado')}</strong>
                            </div>
                            <div>
                                <span class="text-gray-400 block">Establecimiento</span>
                                <strong class="text-gray-800">${safe(item.establishment || 'No registrado')}</strong>
                            </div>
                        </div>
                    </div>
                `;
                timelineList.appendChild(step);
            });
            timeSection.appendChild(timelineList);
            container.appendChild(timeSection);
        } else if (person.TR5.length === 1) {
            // CASO ÚNICO: TARJETA DIRECTA Y LIMPIA
            const singleItem = history.rows[0];
            const singleSection = document.createElement('section');
            singleSection.className = 'bg-white p-6 rounded-2xl border border-gray-200 shadow-sm mb-6';
            singleSection.innerHTML = `
                <h4 class="font-bold text-gray-900 text-base mb-3 flex items-center gap-2">
                    <span>Datos de la Relación Laboral (TR5)</span>
                    <span class="text-xs font-bold text-green-700 bg-green-50 border border-green-200 px-2.5 py-0.5 rounded-full">Un registro TR5</span>
                </h4>
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 bg-gray-50 rounded-xl text-xs">
                    <div>
                        <span class="text-gray-500 block mb-1">Fecha de Ingreso</span>
                        <strong class="text-base text-blue-900 font-bold">${safe(singleItem?.start || 'No indicada')}</strong>
                    </div>
                    <div>
                        <span class="text-gray-500 block mb-1">Tipo de Contrato</span>
                        <strong class="text-gray-800">${safe(singleItem?.contract || 'No registrado')}</strong>
                    </div>
                    <div>
                        <span class="text-gray-500 block mb-1">Ocupación</span>
                        <strong class="text-gray-800">${safe(singleItem?.occupation || 'No registrado')}</strong>
                    </div>
                    <div>
                        <span class="text-gray-500 block mb-1">Establecimiento</span>
                        <strong class="text-gray-800">${safe(singleItem?.establishment || 'No registrado')}</strong>
                    </div>
                </div>
            `;
            container.appendChild(singleSection);
        }

        // SECCIÓN TR6 (SEGURIDAD SOCIAL Y SCTR)
        if (person.TR6.length > 0) {
            const tr6Section = document.createElement('section');
            tr6Section.className = 'bg-white p-6 rounded-2xl border border-gray-200 shadow-sm mb-6';
            
            const tr6RecordsHtml = person.TR6.map(item => {
                const { cuspp, healthRegime, pensionRegime, sctr } = item.health;
                const sctrLabel = sctr === null ? 'No evaluable' : sctr ? 'SCTR salud marcado en esta fila' : 'SCTR salud sin marca (verificar)';
                return `
                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 bg-blue-50/50 rounded-xl text-xs border border-blue-100 mb-2">
                        <div>
                            <span class="text-gray-500 block mb-1">Aseguramiento de Salud</span>
                            <strong class="text-gray-800">${safe(healthRegime ?? 'No evaluable')}</strong>
                        </div>
                        <div>
                            <span class="text-gray-500 block mb-1">Régimen Pensionario</span>
                            <strong class="text-gray-800">${safe(pensionRegime ?? 'No evaluable')}</strong>
                        </div>
                        <div>
                            <span class="text-gray-500 block mb-1">Código CUSPP</span>
                            <strong class="${cuspp ? 'text-gray-900 font-mono' : 'text-orange-600 font-bold'}">${safe(cuspp === null ? 'No evaluable' : cuspp || 'Sin CUSPP registrado')}</strong>
                        </div>
                        <div>
                            <span class="text-gray-500 block mb-1">SCTR salud (indicador)</span>
                            <strong class="${sctr === true ? 'text-green-700' : 'text-gray-800'}">${sctrLabel}</strong>
                        </div>
                    </div>
                `;
            }).join('');

            tr6Section.innerHTML = `
                <h4 class="font-bold text-gray-900 text-base mb-3 flex items-center gap-2">
                    <span>Seguridad Social y SCTR (TR6)</span>
                    <span class="text-xs text-gray-500">(${person.TR6.length} registro${person.TR6.length > 1 ? 's' : ''})</span>
                </h4>
                ${tr6RecordsHtml}
            `;
            container.appendChild(tr6Section);
        }

        // Detalle de filas crudas (colapsado)
        const rawDetails = document.createElement('details');
        rawDetails.className = 'border rounded-xl p-4 bg-gray-50 text-xs text-gray-600';
        rawDetails.innerHTML = `<summary class="cursor-pointer font-semibold text-gray-700">Ver todas las filas originales y columnas completas (${person.TR5.length + person.TR6.length} filas)</summary>`;
        
        const rawContent = document.createElement('div');
        rawContent.className = 'mt-3 space-y-3';
        ['TR5', 'TR6'].forEach(type => {
            person[type].forEach(({record, dataset}) => {
                const box = document.createElement('div');
                box.className = 'bg-white p-3 rounded-lg border border-gray-200';
                box.innerHTML = `<span class="font-bold text-blue-900">${type} · ${safe(dataset.sourceFile)} (Fila ${record.sourceRow})</span>`;
                const pre = document.createElement('pre');
                pre.className = 'overflow-auto mt-1 p-2 bg-gray-100 rounded text-[11px] text-gray-800';
                pre.textContent = record.rawLine;
                box.appendChild(pre);
                rawContent.appendChild(box);
            });
        });
        rawDetails.appendChild(rawContent);
        container.appendChild(rawDetails);

        container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
};

if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => {
    ['tr-person-search', 'tr-person-filter', 'tr-worker-field', 'tr-worker-type', 'tr-worker-occupation'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener(id === 'tr-person-search' ? 'input' : 'change', () => {
            if (id === 'tr-person-filter') TRView.activeQuickFilter = 'all';
            TRExport.invalidate();
            TRView.page = 0;
            TRView.render();
        });
    });
    document.getElementById('tr-cross-filter-clear')?.addEventListener('click', () => TRView.clearWorkerFilters());
    document.getElementById('tr-export-current-filter')?.addEventListener('click', () => {
        if (!TRView.analysis || !TRView.hasActiveWorkerFilters() || !TRView.filtered.length) return;
        const scope = document.getElementById('tr-export-scope');
        const details = document.getElementById('tr-export-details');
        if (details) details.open = true;
        TRExport.syncScopeOptions();
        scope.value = 'filtered';
        TRExport.preview();
        document.getElementById('tr-export-center')?.scrollIntoView({block:'start',behavior:'smooth'});
    });
    const selFilt = document.getElementById('tr-select-filtered');
    if (selFilt) selFilt.addEventListener('click', () => {
        TRView.filtered.forEach(p => TRView.selected.add(p.id));
        TRExport.invalidate();
        TRView.render();
    });
    const clrFilt = document.getElementById('tr-clear-selection');
    if (clrFilt) clrFilt.addEventListener('click', () => {
        TRView.selected.clear();
        TRExport.invalidate();
        TRView.render();
    });
    const pPrev = document.getElementById('tr-person-prev');
    if (pPrev) pPrev.addEventListener('click', () => { TRView.page--; TRView.render(); });
    const pNext = document.getElementById('tr-person-next');
    if (pNext) pNext.addEventListener('click', () => { TRView.page++; TRView.render(); });

    // Quick finding buttons event listeners
    document.querySelectorAll('.quick-finding-card').forEach(btn => {
        btn.addEventListener('click', () => {
            const filterVal = btn.getAttribute('data-filter') || 'all';
            const selectEl = document.getElementById('tr-person-filter');
            if (selectEl) {
                selectEl.value = 'all';
                TRView.activeQuickFilter = filterVal;
                TRExport.invalidate();
                TRView.page = 0;
                TRView.render();
            }
        });
    });
});

