const TRExport = {
    snapshot: null,
    invalidate() {
        this.snapshot = null;
        document.getElementById('tr-export-preview').classList.add('hidden');
        document.getElementById('tr-export-download').disabled = true;
    },
    syncScopeOptions() {
        // Calcula el estado actual para mostrar/ocultar opciones del desplegable
        const hasSearch = (document.getElementById('tr-person-search')?.value || '').trim() !== '';
        const hasFilter = document.getElementById('tr-person-filter')?.value !== 'all';
        const hasAdvanced = TRFilterUI.rules.length > 0;
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

        const filteredCount = TRView.filtered ? TRView.filtered.length : 0;
        const selectedCount = TRView.selected ? TRView.selected.size : 0;

        setOption('tr-scope-filtered', hasSearch || hasFilter || hasAdvanced,
            filteredCount > 0 ? `${filteredCount} trabajadores` : null);
        setOption('tr-scope-selected', hasSelected,
            selectedCount > 0 ? `${selectedCount} marcados` : null);
        setOption('tr-scope-individual', hasCurrent);

        // Actualizar hint según opción seleccionada
        const scope = document.getElementById('tr-export-scope');
        const hint = document.getElementById('tr-export-hint');
        if (scope && hint) {
            const hints = {
                all: 'Se exportarán todos los trabajadores del reporte con sus filas completas de TR5 y TR6.',
                filtered: 'Se exportarán solo los trabajadores que coinciden con la búsqueda y filtros activos.',
                selected: 'Se exportarán solo los trabajadores que tiene marcados con el checkbox.',
                individual: 'Se exportará únicamente el trabajador cuya ficha está abierta actualmente.'
            };
            hint.textContent = hints[scope.value] || hints.all;
        }
    },
    preview() {
        this.invalidate();
        if (!UI.requireIntendencia() || AppState.trBusy) return;
        if (!TRView.analysis) return Utils.showToast('Primero cargue y visualice los reportes.', 'info');
        const el = id=>document.getElementById(id), scope = el('tr-export-scope');
        const people = TRAnalysis.scope(TRView.analysis,scope.value,TRView.selected,TRView.filtered,TRView.current);
        if (!people.length) return Utils.showToast('El alcance elegido no contiene trabajadores. Seleccione trabajadores o abra una ficha.', 'info');
        const filterDescription = [el('tr-person-filter').selectedOptions[0].textContent,...TRFilterUI.descriptions()].join(' · ');
        const sheets = TRAnalysis.sheets(TRView.analysis,people,{intendencia:AppState.intendencia,scope:scope.selectedOptions[0].textContent,query:el('tr-person-search').value,filter:filterDescription});
        if (sheets.some(s=>s.rows.length>1048576 || s.rows.some(r=>r.length>16384 || r.some(v=>typeof v==='string' && v.length>32767)))) return Utils.showToast('El alcance supera los límites de Excel. Redúzcalo para evitar pérdida de datos.', 'info');
        this.snapshot = {sheets,intendencia:AppState.intendencia,metadata:{intendencia:AppState.intendencia,modulo:TRView.analysis.datasets.length===2?'TR5_TR6':TRView.analysis.datasets[0].type,registros:people.reduce((n,p)=>n+p.TR5.length+p.TR6.length,0),archivos:TRView.analysis.datasets.length}};
        el('tr-export-summary').textContent = `${scope.selectedOptions[0].textContent}: ${people.length} trabajadores · ${people.reduce((n,p)=>n+p.TR5.length+p.TR6.length,0)} registros. Se incluyen todas las columnas originales.`;
        el('tr-export-summary').textContent += ` Filtros de la vista: ${filterDescription}. Solo se aplican al alcance Trabajadores filtrados.`;
        el('tr-export-sheets').replaceChildren(...sheets.map(s=>{ const li=document.createElement('li'); li.textContent=`${s.name}: ${s.rows.length-1} filas · ${s.rows[0].length} columnas`; return li; }));
        const table = el('tr-export-sample'); table.replaceChildren();
        sheets[1].rows.slice(0,6).forEach((values,index)=>{const row=document.createElement('tr');values.forEach(value=>{const cell=document.createElement(index?'td':'th');cell.textContent=value;row.appendChild(cell);});table.appendChild(row);});
        el('tr-export-preview').classList.remove('hidden'); el('tr-export-download').disabled=false;
        el('tr-export-preview').scrollIntoView({block:'nearest'});
    },
    download() {
        if (!UI.requireIntendencia() || AppState.trBusy || !this.snapshot) return;
        if (this.snapshot.intendencia!==AppState.intendencia) return this.invalidate();
        try {
            const workbook=XLSX.utils.book_new();
            this.snapshot.sheets.forEach(s=>XLSX.utils.book_append_sheet(workbook,XLSX.utils.aoa_to_sheet(s.rows),s.name));
            XLSX.writeFile(workbook,`TR_${this.snapshot.intendencia}.xlsx`);
            Dashboard.registrarEnDrive('DESCARGAR_EXCEL',this.snapshot.metadata);
        } catch(error) { Utils.showToast(`No se pudo generar el Excel: ${error.message}`); }
    },
    quickDownload() {
        if (!UI.requireIntendencia() || AppState.trBusy) return;
        if (!TRView.analysis) return Utils.showToast('Primero cargue los reportes TR5 o TR6.', 'info');
        const people = TRView.analysis.people;
        if (!people.length) return Utils.showToast('No hay trabajadores para exportar.', 'info');
        try {
            const sheets = TRAnalysis.sheets(TRView.analysis, people, {
                intendencia: AppState.intendencia,
                scope: 'Completo (Informe de Inspección)',
                query: '',
                filter: 'Sin filtros aplicados'
            });
            const workbook = XLSX.utils.book_new();
            sheets.forEach(s => XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(s.rows), s.name));
            const rucStr = TRView.analysis.ruc ? `_${TRView.analysis.ruc}` : '';
            XLSX.writeFile(workbook, `Reporte_Inspeccion_TR${rucStr}_${AppState.intendencia || 'SUNAFIL'}.xlsx`);
            Dashboard.registrarEnDrive('DESCARGAR_EXCEL', {
                intendencia: AppState.intendencia,
                modulo: TRView.analysis.datasets.length === 2 ? 'TR5_TR6' : TRView.analysis.datasets[0].type,
                registros: people.reduce((n, p) => n + p.TR5.length + p.TR6.length, 0),
                archivos: TRView.analysis.datasets.length
            });
            Utils.showToast('Excel generado y descargado correctamente para su informe.', 'success');
        } catch(error) {
            Utils.showToast(`No se pudo generar el Excel: ${error.message}`);
        }
    }
};
document.addEventListener('DOMContentLoaded',()=>{
    ['tr-export-scope','intendencia'].forEach(id=>{
        const el = document.getElementById(id);
        if (el) el.addEventListener('change',()=>{
            TRExport.invalidate();
            TRExport.syncScopeOptions();
        });
    });
    document.getElementById('tr-export-prepare').addEventListener('click',()=>TRExport.preview());
    document.getElementById('tr-export-download').addEventListener('click',()=>TRExport.download());
    const directBtn = document.getElementById('tr-direct-download-excel');
    if (directBtn) directBtn.addEventListener('click', () => TRExport.quickDownload());
});

