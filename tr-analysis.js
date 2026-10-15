const TRAnalysis = {
    scope(analysis, scope, selected, filtered, current) {
        if (scope === 'all') return analysis.people.slice();
        if (scope === 'filtered') return filtered.slice();
        if (scope === 'selected') return analysis.people.filter(p => selected.has(p.id));
        if (scope === 'individual') return analysis.people.filter(p => p.id === current);
        throw new Error('Alcance desconocido.');
    },
    sheets(analysis, people, context) {
        const items = people.flatMap(p => [...p.TR5, ...p.TR6]);
        const sources = analysis.datasets;
        const sheets = [
            { name: 'Resumen', rows: [['Concepto','Valor'], ['Intendencia',context.intendencia], ['RUC',analysis.ruc ?? ''], ['Alcance',context.scope], ['Búsqueda de trabajadores',context.query], ['Filtro de trabajadores',context.filter], ['Trabajadores',people.length], ['Registros',items.length], ['Nota','El alcance filtrado aplica a la vista de trabajadores e incluye todas sus filas TR5/TR6. Las tablas de registros tienen filtros independientes.']] },
            { name: 'Trabajadores', rows: [['Tipo documento','Número','Nombres registrados','TR5','TR6','Presencia','Diferencias de identidad'], ...people.map(p => [p.type,p.number,[...p.names].join(' / '),p.TR5.length,p.TR6.length,p.status,p.identityDifference ? 'Sí' : 'No'])] },
            { name: 'Historico laboral', rows: [['Tipo documento','Número','Ingreso original','Ingreso interpretado','Establecimiento original','Contrato original','Diagnóstico','Archivo','Fila'], ...people.flatMap(p => this.history(p).rows.map(r => [p.type,p.number,r.start ?? '',r.iso ?? '',r.establishment ?? '',r.contract ?? '',[r.diagnostic,r.establishmentStatus,r.contractStatus].filter(Boolean).join(' / '),r.dataset.sourceFile,r.record.sourceRow]))] }
        ];
        sources.forEach(dataset => {
            const included = new Set(items.filter(i => i.dataset === dataset).map(i => i.record));
            sheets.push({name:`${dataset.type} Original`,rows:[dataset.columns.map(c=>c.rawHeader ?? c.label),...dataset.records.filter(r=>included.has(r)).map(r=>r.rawCells.slice())]});
        });
        sheets.push({name:'Fuentes',rows:[['Reporte','Archivo','Fila','Línea original'],...items.map(i=>[i.dataset.type,i.dataset.sourceFile,i.record.sourceRow,i.record.rawLine])]});
        return sheets;
    },
    key(value) { return (value || '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/N[^\w\s]?MERO/gi, 'NUMERO').replace(/[^A-Z0-9\s]/gi, '').toUpperCase(); },
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
            const read = aliases => {
                const normAliases = aliases.map(a => this.key(a));
                const columns = dataset.columns.filter(c => normAliases.includes(this.key(c.rawHeader || '')));
                return columns.length === 1 ? { value: record.rawCells[columns[0].index] ?? null, status: '' }
                    : { value: null, status: columns.length ? 'Columna ambigua' : 'Campo ausente' };
            };
            const start = read(['FEC. INICIO', 'FECHA DE INGRESO', 'FECHA INGRESO']);
            const establishment = read(['ESTABLECIMIENTO EN EL QUE LABORA', 'ESTABLECIMIENTO']);
            const contract = read(['TIPO DE CONTRATO', 'CONTRATO']);
            const occupation = read(['OCUPACION', 'PUESTO', 'CARGO']);
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
        const matches = dataset.text.split(/\r\n|\n|\r/).slice(0, dataset.headerRow - 1)
            .filter(line => /^\s*(?:NRO\.?\s+DE\s+)?RUC\s*:/i.test(line))
            .map(line => /:\s*(\d{11})\s*$/.exec(line)?.[1]).filter(Boolean);
        return new Set(matches).size === 1 ? matches[0] : null;
    },
    build(datasets) {
        if (!datasets.length || datasets.length > 2) throw new Error('Cargue un reporte o un par TR5 y TR6.');
        if (datasets.some(d => !['TR5', 'TR6'].includes(d.type)) || new Set(datasets.map(d => d.type)).size !== datasets.length) throw new Error('Para el cruce seleccione un TR5 y un TR6, sin repetir el tipo.');
        const rucs = datasets.map(d => this.ruc(d));
        if (datasets.length === 2 && (rucs.some(r => !r) || rucs[0] !== rucs[1])) throw new Error('No se puede cruzar: ambos reportes deben tener un RUC identificable e idéntico.');
        const people = new Map();
        datasets.forEach((dataset, sourceIndex) => {
            const index = name => dataset.columns.findIndex(c => this.key(c.rawHeader || '') === name);
            const typeIndex = index('TIPO'), numberIndex = index('NUMERO');
            if (typeIndex < 0 || numberIndex < 0) throw new Error('No se identificaron las columnas de documento con seguridad.');
            const nameIndexes = ['APELLIDO PATERNO', 'APELLIDO MATERNO', 'NOMBRES'].map(index);
            dataset.records.forEach(record => {
                const type = (record.rawCells[typeIndex] || '').trim(), number = (record.rawCells[numberIndex] || '').trim();
                const resolved = Boolean(type && number);
                const id = resolved ? JSON.stringify([this.key(type), number]) : `unresolved:${sourceIndex}:${record.sourceRow}`;
                if (!people.has(id)) people.set(id, { id, type, number, resolved, TR5: [], TR6: [], names: new Set() });
                const person = people.get(id);
                const names = nameIndexes.map(i => i < 0 ? '' : (record.rawCells[i] || '').trim());
                person.names.add(names.join(' '));
                person[dataset.type].push({ record, dataset, names });
            });
        });
        const paired = datasets.length === 2;
        people.forEach(person => {
            person.status = !person.resolved ? 'Identidad incompleta' : !paired ? 'Sin contraparte cargada' : person.TR5.length && person.TR6.length ? 'En ambos' : person.TR5.length ? 'Solo TR5' : 'Solo TR6';
            person.identityDifference = new Set([...person.TR5, ...person.TR6].map(item => JSON.stringify(item.names.map(n => this.key(n))))).size > 1;
            
            // Inspección laboral: indicadores de fiscalización
            person.hasMultipleTR5 = person.TR5.length > 1;
            
            // CUSPP en TR6
            if (person.TR6.length > 0) {
                const cusppFound = person.TR6.some(item => {
                    const idx = item.dataset.columns.findIndex(c => TRAnalysis.key(c.rawHeader || '') === 'CUSPP');
                    return idx >= 0 && (item.record.rawCells[idx] || '').trim().length > 0;
                });
                person.hasCuspp = cusppFound;

                // SCTR Salud en TR6
                const sctrSaludFound = person.TR6.some(item => {
                    return item.dataset.columns.some((c, cIdx) => {
                        const k = TRAnalysis.key(c.rawHeader || '');
                        if ((k === 'EPS' || k === 'ESSALUD') && cIdx >= 12 && cIdx <= 16) {
                            return (item.record.rawCells[cIdx] || '').trim().toUpperCase() === 'X';
                        }
                        return false;
                    });
                });
                person.hasSctr = sctrSaludFound;
            } else {
                person.hasCuspp = null;
                person.hasSctr = null;
            }
        });
        return { datasets, ruc: rucs[0], paired, people: [...people.values()] };
    }
};
if (typeof module !== 'undefined' && module.exports) module.exports = TRAnalysis;

const TRView = {
    analysis: null, page: 0, selected: new Set(), filtered: [], current: null, activeQuickFilter: 'all',
    reset() {
        this.analysis = null; this.page = 0; this.selected.clear(); this.filtered = []; this.current = null; this.activeQuickFilter = 'all';
        TRFilterUI.reset(); TRExport.invalidate();
        document.getElementById('tr-diagnostic-preview').replaceChildren();
        document.getElementById('tr-people').classList.add('hidden');
        document.getElementById('tr-person-detail').replaceChildren();
    },
    set(analysis) {
        this.analysis = analysis; this.page = 0; this.activeQuickFilter = 'all';
        TRFilterUI.set(analysis);
        document.getElementById('tr-people').classList.remove('hidden');
        this.updateQuickFindings();
        this.render();
    },
    updateQuickFindings() {
        if (!this.analysis) return;
        const people = this.analysis.people;
        const total = people.length;
        const multiple = people.filter(p => p.hasMultipleTR5).length;
        const hasTR6 = people.some(p => p.TR6.length > 0);
        const noCuspp = hasTR6 ? people.filter(p => p.TR6.length > 0 && !p.hasCuspp).length : 0;
        const noSctr = hasTR6 ? people.filter(p => p.TR6.length > 0 && !p.hasSctr).length : 0;

        const setVal = (id, count, badgeSuffix = '') => {
            const el = document.getElementById(id);
            if (el) el.textContent = `${count}${badgeSuffix}`;
        };
        setVal('qf-total', total);
        setVal('qf-multiple', multiple);
        setVal('qf-no-cuspp', noCuspp);
        setVal('qf-no-sctr', noSctr);

        // Highlight active button
        document.querySelectorAll('.quick-finding-card').forEach(btn => {
            const f = btn.getAttribute('data-filter');
            if (f === this.activeQuickFilter) btn.classList.add('active');
            else btn.classList.remove('active');
        });
    },
    render() {
        if (!this.analysis) return;
        const el = id => document.getElementById(id);
        const query = TRAnalysis.key(el('tr-person-search').value);
        const filter = el('tr-person-filter').value;
        this.activeQuickFilter = filter;
        this.updateQuickFindings();

        const people = this.analysis.people.filter(p => {
            if (!TRFilters.matches(p, TRFilterUI.rules, TRAnalysis.date)) return false;
            if (query && !TRAnalysis.key([p.type, p.number, ...p.names].join(' ')).includes(query)) return false;
            if (filter === 'all') return true;
            if (filter === 'selected') return this.selected.has(p.id);
            if (filter === 'differences') return p.identityDifference;
            if (filter === 'multiple') return p.hasMultipleTR5 || (p.TR6.length > 1);
            if (filter === 'no_cuspp') return p.TR6.length > 0 && !p.hasCuspp;
            if (filter === 'no_sctr') return p.TR6.length > 0 && !p.hasSctr;
            return p.status === filter;
        });

        this.filtered = people;
        el('tr-selection-count').textContent = `${this.selected.size} trabajadores seleccionados (todas sus filas TR5/TR6)`;
        this.page = Math.max(0, Math.min(this.page, Math.ceil(people.length / 50) - 1));
        el('tr-person-summary').textContent = `${this.analysis.people.length} identidades · ${people.length} visibles · ${this.analysis.datasets.reduce((n,d) => n + d.records.length, 0)} registros originales · ${this.analysis.paired ? 'Cruce validado por RUC' : 'Un reporte'}`;
        
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
                badge.textContent = `🔁 ${person.TR5.length} contratos`;
                badge.title = 'Este trabajador tiene múltiples registros o reingresos en TR5';
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
                if (person.hasCuspp === false) sctrBadge += ' <span title="Sin CUSPP" class="text-xs text-orange-600 font-bold">⚠️ Sin CUSPP</span>';
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
            if (person.hasMultipleTR5) obs.push('<span class="text-amber-700 font-medium text-xs">Reingresos / Sucesión</span>');
            if (person.identityDifference) obs.push('<span class="text-blue-700 text-xs">Diferencia nombres</span>');
            if (person.hasCuspp === false) obs.push('<span class="text-orange-700 text-xs">Sin CUSPP</span>');
            if (person.hasSctr === false) obs.push('<span class="text-red-700 text-xs">Sin SCTR</span>');
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

        // Encabezado Ficha
        const cardHeader = document.createElement('div');
        cardHeader.className = 'ficha-header flex flex-wrap items-center justify-between gap-4 p-5 bg-gradient-to-r from-blue-900 to-indigo-950 text-white rounded-2xl shadow-sm mb-5';
        
        const infoDiv = document.createElement('div');
        const badgeRep = person.hasMultipleTR5 
            ? `<span class="bg-amber-400/20 text-amber-300 border border-amber-400/30 text-xs font-bold px-2.5 py-1 rounded-full ml-3">🔁 ${person.TR5.length} Contratos / Reingresos</span>`
            : `<span class="bg-green-400/20 text-green-300 border border-green-400/30 text-xs font-bold px-2.5 py-1 rounded-full ml-3">✅ Contrato único</span>`;
        
        infoDiv.innerHTML = `
            <div class="flex items-center flex-wrap gap-2">
                <span class="text-xs font-mono uppercase tracking-widest text-blue-200">${person.type} ${person.number}</span>
                ${badgeRep}
            </div>
            <h3 class="text-xl font-bold text-white mt-1">${[...person.names].join(' / ')}</h3>
            <p class="text-xs text-blue-200/80 mt-0.5">Estado en reportes: <strong>${person.status}</strong> · ${person.TR5.length} registros TR5, ${person.TR6.length} registros TR6</p>
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
                        <h4 class="text-amber-900 font-bold text-sm">Alerta Inspectiva: Trabajador con ${person.TR5.length} contratos / reingresos</h4>
                        <p class="text-amber-800 text-xs mt-1">Este trabajador figura en varias filas de TR5 con distintas fechas o condiciones. Verifique si hubo continuidad laboral encubierta (desnaturalización de contratos modales) o si existió liquidación de beneficios sociales entre cada periodo.</p>
                    </div>
                </div>
                <h4 class="font-bold text-gray-900 text-base mb-4 flex items-center gap-2">
                    <span>Línea de Tiempo de Contrataciones (Cronológico)</span>
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
                                <span class="text-xs font-bold text-blue-900 bg-blue-100 px-2 py-0.5 rounded">Inicio: ${item.start || 'No indicada'}</span>
                                <span class="text-xs text-gray-400 font-mono">Fila ${item.record.sourceRow}</span>
                            </div>
                            <span class="text-xs text-gray-500">${item.dataset.sourceFile}</span>
                        </div>
                        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                            <div>
                                <span class="text-gray-400 block">Tipo de Contrato</span>
                                <strong class="text-gray-800">${item.contract || 'No registrado'}</strong>
                            </div>
                            <div>
                                <span class="text-gray-400 block">Ocupación / Puesto</span>
                                <strong class="text-gray-800">${item.occupation || 'No registrado'}</strong>
                            </div>
                            <div>
                                <span class="text-gray-400 block">Establecimiento</span>
                                <strong class="text-gray-800">${item.establishment || 'No registrado'}</strong>
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
                    <span class="text-xs font-bold text-green-700 bg-green-50 border border-green-200 px-2.5 py-0.5 rounded-full">Contrato Único</span>
                </h4>
                <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 bg-gray-50 rounded-xl text-xs">
                    <div>
                        <span class="text-gray-500 block mb-1">Fecha de Ingreso</span>
                        <strong class="text-base text-blue-900 font-bold">${singleItem?.start || 'No indicada'}</strong>
                    </div>
                    <div>
                        <span class="text-gray-500 block mb-1">Tipo de Contrato</span>
                        <strong class="text-gray-800">${singleItem?.contract || 'No registrado'}</strong>
                    </div>
                    <div>
                        <span class="text-gray-500 block mb-1">Ocupación</span>
                        <strong class="text-gray-800">${singleItem?.occupation || 'No registrado'}</strong>
                    </div>
                    <div>
                        <span class="text-gray-500 block mb-1">Establecimiento</span>
                        <strong class="text-gray-800">${singleItem?.establishment || 'No registrado'}</strong>
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
                const getCell = colName => {
                    const idx = item.dataset.columns.findIndex(c => TRAnalysis.key(c.rawHeader || '').includes(colName));
                    return idx >= 0 ? (item.record.rawCells[idx] || '').trim() : '-';
                };
                const cuspp = getCell('CUSPP');
                const regimenSalud = getCell('REGIMEN') || getCell('SALUD');
                const regimenPension = getCell('PENSION') || getCell('SISTEMA');

                return `
                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 bg-blue-50/50 rounded-xl text-xs border border-blue-100 mb-2">
                        <div>
                            <span class="text-gray-500 block mb-1">Aseguramiento de Salud</span>
                            <strong class="text-gray-800">${regimenSalud || 'ESSALUD'}</strong>
                        </div>
                        <div>
                            <span class="text-gray-500 block mb-1">Régimen Pensionario</span>
                            <strong class="text-gray-800">${regimenPension || 'No registrado'}</strong>
                        </div>
                        <div>
                            <span class="text-gray-500 block mb-1">Código CUSPP</span>
                            <strong class="${cuspp ? 'text-gray-900 font-mono' : 'text-orange-600 font-bold'}">${cuspp || '⚠️ Sin CUSPP'}</strong>
                        </div>
                        <div>
                            <span class="text-gray-500 block mb-1">Cobertura SCTR</span>
                            <strong class="${person.hasSctr ? 'text-green-700' : 'text-red-700'}">${person.hasSctr ? '✅ SCTR Activo' : '🛡️ Sin SCTR detectado'}</strong>
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
                box.innerHTML = `<span class="font-bold text-blue-900">${type} · ${dataset.sourceFile} (Fila ${record.sourceRow})</span>`;
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
    ['tr-person-search', 'tr-person-filter'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener(id.endsWith('search') ? 'input' : 'change', () => {
            TRExport.invalidate();
            TRView.page = 0;
            TRView.render();
        });
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
                selectEl.value = filterVal;
                TRView.page = 0;
                TRView.render();
            }
        });
    });
});

