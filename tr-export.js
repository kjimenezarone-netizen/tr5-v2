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
    getFilename(analysis, intendencia) {
        let company = (analysis?.company || '').trim();
        company = company.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, '_');
        const ruc = (analysis?.ruc || '').trim();
        if (company && ruc) return `${company}_${ruc}.xlsx`;
        if (company) return `${company}.xlsx`;
        if (ruc) return `Reporte_${ruc}_${intendencia || 'SUNAFIL'}.xlsx`;
        return `Reporte_TR_${intendencia || 'SUNAFIL'}.xlsx`;
    },
    formatWorksheet(ws, sheetName) {
        if (!ws || !ws['!ref']) return ws;
        const range = XLSX.utils.decode_range(ws['!ref']);
        const numCols = range.e.c - range.s.c + 1;
        const numRows = range.e.r - range.s.r + 1;

        let tr5Col = -1, tr6Col = -1, multiCol = -1, docNumCol = -1, docTypeCol = -1;
        for (let c = range.s.c; c <= range.e.c; c++) {
            const addr = XLSX.utils.encode_cell({ r: 0, c });
            const val = ws[addr] ? String(ws[addr].v || '').trim().toUpperCase() : '';
            if (val === 'TR5') tr5Col = c;
            else if (val === 'TR6') tr6Col = c;
            else if (val.includes('MULTIPLICIDAD') || val.includes('ALERTA')) multiCol = c;
            else if (val === 'NUMERO' || val.includes('NRO') || val.includes('RUC') || val.includes('DNI') || val === 'NUMERO DOCUMENTO') docNumCol = c;
            else if (val.includes('TIPO')) docTypeCol = c;
        }

        const borderThin = { style: 'thin', color: { rgb: 'D1D5DB' } };
        const cellBorder = { top: borderThin, bottom: borderThin, left: borderThin, right: borderThin };

        const headerStyle = {
            font: { name: 'Segoe UI', sz: 10, bold: true, color: { rgb: 'FFFFFF' } },
            fill: { fgColor: { rgb: '1B365D' } }, // Azul institucional SUNAFIL
            alignment: { vertical: 'center', horizontal: 'center', wrapText: true },
            border: {
                top: { style: 'medium', color: { rgb: '0F2942' } },
                bottom: { style: 'medium', color: { rgb: '0F2942' } },
                left: { style: 'thin', color: { rgb: '2B4C7E' } },
                right: { style: 'thin', color: { rgb: '2B4C7E' } }
            }
        };

        const regularTextStyle = {
            font: { name: 'Segoe UI', sz: 9.5, color: { rgb: '1F2937' } },
            alignment: { vertical: 'center', horizontal: 'left' },
            border: cellBorder
        };

        const centerTextStyle = {
            font: { name: 'Segoe UI', sz: 9.5, color: { rgb: '1F2937' } },
            alignment: { vertical: 'center', horizontal: 'center' },
            border: cellBorder
        };

        const countNormalStyle = {
            font: { name: 'Segoe UI', sz: 9.5, color: { rgb: '374151' } },
            alignment: { vertical: 'center', horizontal: 'center' },
            border: cellBorder
        };

        const alertCountStyle = {
            font: { name: 'Segoe UI', sz: 10, bold: true, color: { rgb: '9A3412' } }, // Ámbar oscuro
            fill: { fgColor: { rgb: 'FEF3C7' } }, // Fondo amarillo/ámbar suave
            alignment: { vertical: 'center', horizontal: 'center' },
            border: {
                top: { style: 'thin', color: { rgb: 'F59E0B' } },
                bottom: { style: 'thin', color: { rgb: 'F59E0B' } },
                left: { style: 'thin', color: { rgb: 'F59E0B' } },
                right: { style: 'thin', color: { rgb: 'F59E0B' } }
            }
        };

        const alertMultiStyle = {
            font: { name: 'Segoe UI', sz: 9, bold: true, color: { rgb: 'B45309' } },
            fill: { fgColor: { rgb: 'FFFBEB' } },
            alignment: { vertical: 'center', horizontal: 'left' },
            border: cellBorder
        };

        const colWidths = new Array(numCols).fill(12);

        for (let r = range.s.r; r <= range.e.r; r++) {
            for (let c = range.s.c; c <= range.e.c; c++) {
                const addr = XLSX.utils.encode_cell({ r, c });
                let cell = ws[addr];
                if (!cell) {
                    cell = { v: '', t: 's' };
                    ws[addr] = cell;
                }

                const strVal = cell.v != null ? String(cell.v) : '';
                colWidths[c - range.s.c] = Math.max(colWidths[c - range.s.c], strVal.length + 4);

                if (r === 0) {
                    cell.s = headerStyle;
                } else {
                    if (c === tr5Col || c === tr6Col) {
                        const num = Number(cell.v);
                        if (!isNaN(num) && num > 1) {
                            cell.s = alertCountStyle;
                        } else {
                            cell.s = countNormalStyle;
                        }
                    } else if (c === multiCol && strVal.includes('Aparece varias veces')) {
                        cell.s = alertMultiStyle;
                    } else if (c === docNumCol || (docNumCol < 0 && c === 1)) {
                        cell.s = centerTextStyle;
                        cell.t = 's'; // Preservar ceros iniciales como texto
                        cell.z = '@';
                    } else if (c === docTypeCol || (docTypeCol < 0 && c === 0)) {
                        cell.s = centerTextStyle;
                    } else {
                        cell.s = regularTextStyle;
                    }
                }
            }
        }

        // Anchos mínimos específicos según tipo de columna
        if (multiCol >= 0) colWidths[multiCol] = Math.max(colWidths[multiCol], 36);
        if (tr5Col >= 0) colWidths[tr5Col] = Math.max(colWidths[tr5Col], 10);
        if (tr6Col >= 0) colWidths[tr6Col] = Math.max(colWidths[tr6Col], 10);

        ws['!cols'] = colWidths.map(w => ({ wch: Math.min(Math.max(w, 12), 65) }));

        // Alto de filas: encabezado 28pt, datos 20pt
        const rowHeights = [];
        for (let r = 0; r < numRows; r++) {
            rowHeights.push({ hpt: r === 0 ? 28 : 20 });
        }
        ws['!rows'] = rowHeights;

        // Inmovilizar fila superior y habilitar filtros automáticos
        ws['!autofilter'] = { ref: ws['!ref'] };
        ws['!views'] = [{ state: 'frozen', ySplit: 1 }];

        return ws;
    },
    download() {
        if (!UI.requireIntendencia() || AppState.trBusy || !this.snapshot) return;
        if (this.snapshot.intendencia!==AppState.intendencia) return this.invalidate();
        try {
            const workbook = XLSX.utils.book_new();
            this.snapshot.sheets.forEach(s => {
                const rawSheet = XLSX.utils.aoa_to_sheet(s.rows);
                const styledSheet = this.formatWorksheet(rawSheet, s.name);
                XLSX.utils.book_append_sheet(workbook, styledSheet, s.name);
            });
            const filename = this.getFilename(TRView.analysis, this.snapshot.intendencia);
            XLSX.writeFile(workbook, filename);
            Dashboard.registrarEnDrive('DESCARGAR_EXCEL',this.snapshot.metadata);
            Utils.showToast(`Excel descargado correctamente: ${filename}`, 'success');
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
            sheets.forEach(s => {
                const rawSheet = XLSX.utils.aoa_to_sheet(s.rows);
                const styledSheet = this.formatWorksheet(rawSheet, s.name);
                XLSX.utils.book_append_sheet(workbook, styledSheet, s.name);
            });
            const filename = this.getFilename(TRView.analysis, AppState.intendencia);
            XLSX.writeFile(workbook, filename);
            Dashboard.registrarEnDrive('DESCARGAR_EXCEL', {
                intendencia: AppState.intendencia,
                modulo: TRView.analysis.datasets.length === 2 ? 'TR5_TR6' : TRView.analysis.datasets[0].type,
                registros: people.reduce((n, p) => n + p.TR5.length + p.TR6.length, 0),
                archivos: TRView.analysis.datasets.length
            });
            Utils.showToast(`Excel descargado correctamente: ${filename}`, 'success');
        } catch(error) {
            Utils.showToast(`No se pudo generar el Excel: ${error.message}`);
        }
    }
};
if (typeof document !== 'undefined') {
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
}
if (typeof module !== 'undefined' && module.exports) module.exports = TRExport;

