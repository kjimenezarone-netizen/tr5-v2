const TRExport = {
    snapshot: null,
    busy: false,
    invalidate() {
        ExportFile.cancel('TR');
        this.snapshot = null;
        document.getElementById('tr-export-cancel').disabled = true;
        document.getElementById('tr-export-status').textContent = '';
        document.getElementById('tr-export-preview').classList.add('hidden');
        this.syncDownloadControls();
    },
    syncDownloadControls() {
        const scope = document.getElementById('tr-export-scope').value;
        const counts = {
            all: TRView.analysis?.people.length ?? 0,
            filtered: TRView.filtered.length,
            selected: TRView.selected.size,
            individual: TRView.current ? 1 : 0
        };
        const count = counts[scope] ?? 0;
        const disabled = !count || AppState.trBusy || this.busy;
        document.getElementById('tr-export-download').disabled = disabled;
        document.getElementById('tr-export-prepare').disabled = disabled;
        const label = document.getElementById('tr-export-download-label');
        const peopleLabel = count === 1 ? 'trabajador' : 'trabajadores';
        label.textContent = scope === 'all' ? 'Descargar archivo completo'
            : `Descargar ${count} ${peopleLabel}`;
    },
    syncScopeOptions() {
        // Calcula el estado actual para mostrar/ocultar opciones del desplegable
        const hasSearch = (document.getElementById('tr-person-search')?.value || '').trim() !== '';
        const hasFilter = document.getElementById('tr-person-filter')?.value !== 'all' || TRView.activeQuickFilter !== 'all';
        const hasAdvanced = TRFilterUI.rules.length > 0;
        const hasWorkerType = Boolean(document.getElementById('tr-worker-type')?.value);
        const hasWorkerOccupation = Boolean(document.getElementById('tr-worker-occupation')?.value);
        const hasSelected = TRView.selected && TRView.selected.size > 0;
        const hasCurrent = !!TRView.current;

        const setOption = (id, visible, labelSuffix = '') => {
            const opt = document.getElementById(id);
            if (!opt) return;
            if (visible) {
                opt.classList.remove('hidden');
                opt.disabled = false;
                if (labelSuffix) opt.textContent = opt.textContent.replace(/ \(.*\)$/, '') + ` (${labelSuffix})`;
            } else {
                opt.classList.add('hidden');
                opt.disabled = true;
                // Si esta opción estaba seleccionada, volver a "todos"
                const scope = document.getElementById('tr-export-scope');
                if (scope && scope.value === opt.value) scope.value = 'all';
            }
        };

        const info = document.getElementById('tr-export-dataset-info');
        if (info && TRView.analysis) {
            const a = TRView.analysis;
            const total = a.datasets.reduce((n, d) => n + d.records.length, 0);
            const types = a.datasets.map(d => d.type).join(' + ');
            info.textContent = `${TRView.intendencia} · ${types} · ${a.datasets.length} archivo(s) · ${a.people.length} trabajadores · ${total} registros originales · ${a.company || 'Entidad sin razón social identificada'}`;
        }
        const filteredCount = TRView.filtered ? TRView.filtered.length : 0;
        const selectedCount = TRView.selected ? TRView.selected.size : 0;

        setOption('tr-scope-filtered', hasSearch || hasFilter || hasAdvanced || hasWorkerType || hasWorkerOccupation,
            filteredCount > 0 ? `${filteredCount} ${filteredCount === 1 ? 'trabajador' : 'trabajadores'}` : null);
        setOption('tr-scope-selected', hasSelected,
            selectedCount > 0 ? `${selectedCount} ${selectedCount === 1 ? 'marcado' : 'marcados'}` : null);
        setOption('tr-scope-individual', hasCurrent);

        // Actualizar hint según opción seleccionada
        const scope = document.getElementById('tr-export-scope');
        const hint = document.getElementById('tr-export-hint');
        if (scope && hint) {
            const hints = {
                all: 'Se exportarán todos los trabajadores del reporte con sus filas completas de TR5 y TR6.',
                filtered: 'Se exportarán únicamente los trabajadores que cumplen la búsqueda combinada, con todas sus filas TR5/TR6 y columnas originales.',
                selected: 'Se exportarán solo los trabajadores que tiene marcados con el checkbox.',
                individual: 'Se exportará únicamente el trabajador cuya ficha está abierta actualmente.'
            };
            hint.textContent = hints[scope.value] || hints.all;
        }
        this.syncDownloadControls();
    },
    snapshotForScope() {
        const { analysis, intendencia } = TRView;
        if (!analysis) return null;
        const el = id=>document.getElementById(id), scope = el('tr-export-scope');
        const people = TRAnalysis.scope(analysis, scope.value, TRView.selected, TRView.filtered, TRView.current);
        if (!people.length) return null;
        const quickLabels = { multiple: 'Múltiples registros', no_cuspp: 'CUSPP no registrado', no_sctr: 'SCTR salud no detectado' };
        const enabledSelect = id => { const node = el(id); return node?.value ? node.selectedOptions[0]?.textContent : null; };
        const criteria = [
            TRView.activeQuickFilter !== 'all' ? quickLabels[TRView.activeQuickFilter] :
                el('tr-person-filter').value !== 'all' ? el('tr-person-filter').selectedOptions[0].textContent : null,
            el('tr-person-search').value.trim() ? `Campo: ${el('tr-worker-field').selectedOptions[0].textContent}` : null,
            enabledSelect('tr-worker-type') ? `Tipo documento: ${enabledSelect('tr-worker-type')}` : null,
            enabledSelect('tr-worker-occupation') ? `Oficio u ocupación: ${enabledSelect('tr-worker-occupation')}` : null,
            ...TRFilterUI.descriptions()
        ];
        const filterDescription = criteria.filter(Boolean).join(' · ') || 'Sin filtros';
        const context = { intendencia, scope: scope.selectedOptions[0].textContent, query: el('tr-person-search').value, filter: filterDescription };
        const records = people.reduce((count, person) => count + person.TR5.length + person.TR6.length, 0);
        return {
            analysis, people, context,
            scopeCode: scope.value,
            metadata: { intendencia: context.intendencia, modulo: analysis.paired ? 'TR5_TR6' : analysis.datasets[0].type, registros: records, archivos: analysis.datasets.length }
        };
    },
    preview() {
        if (!UI.requireIntendencia() || AppState.trBusy || this.busy) return;
        this.invalidate();
        const snapshot = this.snapshotForScope();
        if (!snapshot) return Utils.showToast('El alcance elegido no contiene trabajadores.', 'info');
        this.snapshot = snapshot;
        const { analysis, people, context, scopeCode } = snapshot;
        const { sheets, records } = TRAnalysis.describeExport(analysis, people);
        const el = id => document.getElementById(id);
        el('tr-export-summary').textContent = context.scope + ': ' + people.length + ' trabajadores · ' + records + ' registros. Se incluyen todas las columnas originales.';
        el('tr-export-summary').textContent += scopeCode === 'filtered'
            ? ` Criterios aplicados: ${context.filter}. Se conservan todas las filas TR5/TR6 asociadas.`
            : ` Filtros activos en pantalla: ${context.filter}.`;
        el('tr-export-sheets').replaceChildren(...sheets.map(s=>{ const li=document.createElement('li'); li.textContent=`${s.name}: ${s.rows} filas · ${s.columns} columnas`; return li; }));
        const table = el('tr-export-sample'); table.replaceChildren();
        [TRAnalysis.workerHeader, ...people.slice(0, 5).map(person => TRAnalysis.workerRow(person))].forEach((values,index)=>{const row=document.createElement('tr');values.forEach(value=>{const cell=document.createElement(index?'td':'th');cell.textContent=value;row.appendChild(cell);});table.appendChild(row);});
        el('tr-export-preview').classList.remove('hidden');
        el('tr-export-preview').scrollIntoView({block:'nearest'});
    },
    getFilename(analysis, intendencia) {
        let company = (analysis?.company || '').trim();
        company = company.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, '_');
        const ruc = (analysis?.ruc || '').trim();
        if (company && ruc) return `${company}_${ruc}.xlsx`;
        if (company) return `${company}.xlsx`;
        if (ruc) return `Reporte_${ruc}_${intendencia || 'SUNAFIL'}.xlsx`;
        return `Reporte_TR_${intendencia || 'SUNAFIL'}.xlsx`;
    },
    async download() {
        if (!UI.requireIntendencia() || AppState.trBusy || this.busy) return;
        const snapshot = this.snapshot || this.snapshotForScope();
        if (!snapshot) return Utils.showToast('El alcance elegido no contiene trabajadores.', 'info');
        this.snapshot = snapshot;
        const status = document.getElementById('tr-export-status');
        const cancel = document.getElementById('tr-export-cancel');
        const { analysis, people, context } = snapshot;
        this.busy = true;
        this.syncDownloadControls();
        cancel.disabled = false;
        status.textContent = 'Preparando el Excel…';
        try {
            const bytes = await ExportFile.run('TR', { analysis, people, context }, message => { status.textContent = message; });
            if (snapshot !== this.snapshot) return;
            const filename = this.getFilename(analysis, context.intendencia);
            const finalName = snapshot.scopeCode === 'all' ? filename : filename.slice(0, -5) + '_' + snapshot.scopeCode + '.xlsx';
            ExportFile.save(bytes, finalName);
            Dashboard.registrarEnDrive('DESCARGAR_EXCEL', snapshot.metadata);
            status.textContent = 'Excel descargado: ' + finalName;
        } catch (error) {
            if (snapshot === this.snapshot) status.textContent = error.message;
        } finally {
            this.busy = false;
            cancel.disabled = true;
            this.syncDownloadControls();
        }
    }

};
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded',()=>{
        const scope = document.getElementById('tr-export-scope');
        scope.addEventListener('change', () => {
            TRExport.invalidate();
            TRExport.syncScopeOptions();
        });
        document.getElementById('tr-export-prepare').addEventListener('click',()=>TRExport.preview());
        document.getElementById('tr-export-download').addEventListener('click', () => TRExport.download());
        document.getElementById('tr-export-cancel').addEventListener('click', () => ExportFile.cancel('TR'));
        const directBtn = document.getElementById('tr-direct-download-excel');
        if (directBtn) directBtn.addEventListener('click', () => {
            document.getElementById('tr-export-details').open = true;
            if (TRView.analysis && scope.value === 'all' && TRView.hasActiveWorkerFilters()) {
                scope.value = 'filtered';
                TRExport.invalidate();
                TRExport.syncScopeOptions();
            }
            document.getElementById('tr-export-center').scrollIntoView({ block: 'start' });
            scope.focus({ preventScroll: true });
        });
    });
}
if (typeof module !== 'undefined' && module.exports) module.exports = TRExport;

