const AppState = {
    isLoggedIn: false,
    intendencia: '',
    activePage: 'inicio',
    sessionToken: null,
    sessionExpires: 0,
    sessionTimer: null,
    trGeneration: 0,
    globalRows: [],
    sourceDataset: null,
    trDatasets: [],
    trBusy: false,
    globalCols: [],
    vistasPorInt: {},
    descargasPorInt: {},
    currentPage: 1,
    pageSize: 50,
    currentFilteredRows: [],
    searchDebounceTimeout: null
};

const Utils = {
    async loadPdf() {
        if (typeof html2pdf === 'function') return;
        if (!this.pdfScript) {
            this.pdfScript = new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = ReaderConfig.asset('html2pdf.bundle.min.js');
                script.onload = resolve;
                script.onerror = () => {
                    script.remove();
                    reject(new Error('No se pudo cargar el generador PDF.'));
                };
                document.head.appendChild(script);
            }).catch(error => {
                this.pdfScript = null;
                throw error;
            });
        }
        await this.pdfScript;
    },
    escapeHTML(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    },
    showToast(message, type = 'error') {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        const bgColors = {
            'error': 'bg-red-600',
            'success': 'bg-green-600',
            'info': 'bg-blue-600'
        };

        let iconSvg = '';
        if (type === 'success') {
            iconSvg = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />';
        } else if (type === 'info') {
            iconSvg = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />';
        } else {
            iconSvg = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />';
        }

        const safeMessage = this.escapeHTML(message);
        toast.className = `${bgColors[type] || bgColors['error']} text-white px-5 py-3 rounded-lg shadow-xl font-semibold text-sm flex items-center gap-3 toast-enter`;
        toast.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">${iconSvg}</svg> <span>${safeMessage}</span>`;

        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.replace('toast-enter', 'toast-leave');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
};

// vistas
const UI = {
    showPage(pageId) {
        if (!['inicio', 'procesador', 'ruc', 'dashboard'].includes(pageId)) return;
        if (['procesador', 'ruc'].includes(pageId) && !UI.requireIntendencia()) return;
        if (pageId === 'dashboard' && !AppState.isLoggedIn) return;
        ['inicio', 'procesador', 'ruc', 'dashboard'].forEach(page => {
            document.getElementById(`page-${page}`).classList.add('hidden');
            const button = document.getElementById(`nav_${page}`);
            if (page === pageId) button?.setAttribute('aria-current', 'page');
            else button?.removeAttribute('aria-current');
        });
        AppState.activePage = pageId;
        document.getElementById('session-context').classList.toggle('hidden', pageId === 'dashboard');
        const target = document.getElementById(`page-${pageId}`);
        if (target) target.classList.remove('hidden');
    },
    requireIntendencia() {
        if (AppState.intendencia) return true;
        Utils.showToast('Seleccione su intendencia antes de continuar.', 'info');
        document.getElementById('intendencia').focus();
        return false;
    },
    toggleProcessor() {
        const int = document.getElementById('intendencia').value;
        AppState.intendencia = int;
        ['nav_procesador', 'nav_ruc', 'open-tr', 'open-ruc'].forEach(id => {
            document.getElementById(id).disabled = !int;
        });
        document.getElementById('file_input').disabled = !int || AppState.trBusy;
        document.getElementById('btn_process_data').disabled = !int || AppState.trBusy;
        document.getElementById('intendencia-help').textContent = int
            ? 'Intendencia para la próxima carga.'
            : 'Seleccione su intendencia para acceder a los módulos.';
        if (!int && ['procesador', 'ruc'].includes(AppState.activePage)) UI.showPage('inicio');
        const zone = document.getElementById('upload-zone');
        if (int !== "") {
            zone.classList.remove('opacity-30', 'pointer-events-none');
        } else {
            zone.classList.add('opacity-30', 'pointer-events-none');
        }
    },
    updateFileStatus() {
        const fileInput = document.getElementById('file_input');
        const labelDefault = document.getElementById('label-content-default');
        const infoContainer = document.getElementById('file-info-container');
        const fileCards = document.getElementById('file-cards');
        const status = document.getElementById('file_status');

        if (fileInput.files.length > 0) {
            labelDefault.classList.add('hidden');
            infoContainer.classList.remove('hidden');
            infoContainer.classList.add('flex');

            const files = [...fileInput.files];
            // Crear tarjetas individuales por archivo
            if (fileCards) {
                fileCards.innerHTML = files.map(f => {
                    // Detectar tipo por nombre
                    const upper = f.name.toUpperCase();
                    const isTR6 = upper.includes('TR6');
                    const isTR5 = upper.includes('TR5') || (!isTR6 && upper.endsWith('.TXT'));
                    const typeLabel = isTR6 ? 'TR6' : (isTR5 ? 'TR5' : 'TXT');
                    const badgeColor = isTR6 ? 'bg-emerald-50 text-emerald-800 border-emerald-300' : 'bg-blue-50 text-blue-800 border-blue-300';
                    const iconColor = isTR6 ? 'text-emerald-600' : 'text-blue-600';
                    const sizekb = (f.size / 1024).toFixed(0);
                    const shortName = f.name.length > 40 ? f.name.substring(0, 37) + '...' : f.name;
                    return `<div class="flex items-center gap-3 px-4 py-2.5 rounded-xl border ${badgeColor} shadow-sm bg-white min-w-[220px]">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-7 w-7 ${iconColor} flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                        <div class="flex flex-col text-left">
                            <span class="text-xs font-black uppercase tracking-wider">${typeLabel}</span>
                            <span class="text-xs font-semibold text-gray-800 break-all">${Utils.escapeHTML(shortName)}</span>
                            <span class="text-[10px] text-gray-500">${sizekb} KB</span>
                        </div>
                    </div>`;
                }).join('');
            }

            // Actualizar file_status con texto visible
            if (status) {
                const count = files.length;
                status.textContent = count === 1
                    ? `1 archivo listo: ${files[0].name}`
                    : `${count} archivos listos: ${files.map(f => f.name).join(' + ')}`;
            }
        }
    },
    resetFileSelection() {
        // Libera la selección del input sin alterar tablas, datasets ni exportaciones.
        const input = document.getElementById('file_input');
        if (input) input.value = '';
        document.getElementById('file-cards')?.replaceChildren();
        const status = document.getElementById('file_status');
        if (status) status.textContent = '';
        document.getElementById('label-content-default')?.classList.remove('hidden');
        const info = document.getElementById('file-info-container');
        info?.classList.add('hidden');
        info?.classList.remove('flex');
    },
    clearFile(event) {
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        UI.resetFileSelection();
    },
    resetWorkspaceTR() {
        if (AppState.trBusy) return;
        if (!window.confirm('¿Finalizar esta consulta? Se borrarán los resultados, filtros, fichas y vistas del lector TR. Sus archivos TXT y los Excel descargados no se modifican.')) return;
        UI.clearWorkspaceTR();
    },
    clearWorkspaceTR() {
        AppState.trGeneration++;
        Processing.cancel('TR');
        AppState.trBusy = false;
        document.getElementById('file_input').disabled = !AppState.intendencia;
        document.getElementById('btn_process_data').disabled = !AppState.intendencia;
        document.getElementById('tr-cancel').disabled = true;
        document.getElementById('btn_clear_file').disabled = false;
        document.getElementById('loader').style.display = 'none';
        UI.resetFileSelection();
        clearTimeout(AppState.searchDebounceTimeout);
        AppState.searchDebounceTimeout = null;
        AppState.globalRows = [];
        AppState.globalCols = [];
        AppState.currentFilteredRows = [];
        AppState.currentPage = 1;
        AppState.trDatasets = [];
        AppState.sourceDataset = null;
        TRView.reset();
        TRExport.invalidate();
        document.getElementById('preview_section').classList.add('hidden');
        document.getElementById('company_list').replaceChildren();
        document.getElementById('company_container').classList.add('hidden');
        document.getElementById('file_metrics_container').classList.add('hidden');
        document.getElementById('tr-source-select').replaceChildren();
        // Eliminar también los nodos de tablas y previsualizaciones ocultas.
        ['tr-person-body', 'tr-person-detail', 'tr-export-sheets', 'tr-export-sample',
            'tr-export-summary', 'tr-export-dataset-info', 'table_body', 'table_head',
            'tr-person-summary', 'tr-selection-count'].forEach(id => {
                document.getElementById(id)?.replaceChildren();
            });
        document.getElementById('search_box').value = '';
        if (window.chartFileTipo) { window.chartFileTipo.destroy(); window.chartFileTipo = null; }
        if (window.chartFileOcup) { window.chartFileOcup.destroy(); window.chartFileOcup = null; }
        document.getElementById('tr-processing-status').textContent = 'Consulta finalizada. Puede cargar un nuevo reporte.';
        document.getElementById('tr-reset-all').disabled = true;
        document.getElementById('tr-reset-all-bottom').disabled = true;
    },
    renderInfoBox(data) {
        const container = document.getElementById('company_list');
        const companyContainer = document.getElementById('company_container');
        if (!container || !companyContainer) return;

        const norm = str => String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();

        // Orden canónico para el Resumen de la Entidad (cuadrícula 2x2):
        // 1. Cabecera de reporte (TR5 / TR6)
        // 2. RUC
        // 3. Razón Social
        // 4. Fecha de Generación
        const matchers = [
            k => norm(k).startsWith('TR5') || norm(k).startsWith('TR6'),
            k => norm(k).includes('RUC'),
            k => norm(k).includes('NOMBRE') || norm(k).includes('RAZON SOCIAL') || norm(k).includes('DENOMINACION'),
            k => norm(k).includes('FECHA') || norm(k).includes('GENERACION')
        ];

        const sortedEntries = [];
        const usedKeys = new Set();

        matchers.forEach(matcher => {
            for (const [k, v] of Object.entries(data)) {
                if (!usedKeys.has(k) && !k.includes('|') && matcher(k)) {
                    sortedEntries.push([k, v]);
                    usedKeys.add(k);
                    break;
                }
            }
        });

        // Entradas adicionales de la cabecera que no contengan pipes (|) ni parezcan filas de trabajadores
        Object.entries(data).forEach(([k, v]) => {
            if (!usedKeys.has(k) && !k.includes('|') && !String(v).includes('|')) {
                sortedEntries.push([k, v]);
                usedKeys.add(k);
            }
        });

        if (sortedEntries.length === 0) {
            companyContainer.classList.add('hidden');
            return;
        }

        container.innerHTML = sortedEntries.map(([k, v]) => {
            let displayValue = v ? String(v).substring(0, 200) : '';
            const safeK = Utils.escapeHTML(k);
            const safeV = Utils.escapeHTML(displayValue);
            return `<div style="margin-bottom: 8px;"><span class="text-[#003366] font-black" style="color: #003366; font-weight: bold;">${safeK}:</span> <span class="text-slate-600 font-medium" style="color: #475569;">${safeV}</span></div>`;
        }).join('');

        companyContainer.classList.remove('hidden');
    },
    drawTable(rows, cols) {
        AppState.currentFilteredRows = rows;
        AppState.currentPage = 1;
        this.renderCurrentPage();
    },
    renderCurrentPage() {
        // Se muestran todas las columnas del TXT; se retiró el control de visibilidad redundante.
        const cols = AppState.globalCols;
        document.getElementById('table_head').innerHTML = cols.map(c => `<th class="px-4 py-3 border-b whitespace-nowrap">${Utils.escapeHTML(c)}</th>`).join('');
        const startIndex = (AppState.currentPage - 1) * AppState.pageSize;
        const endIndex = Math.min(startIndex + AppState.pageSize, AppState.currentFilteredRows.length);
        const pageRows = AppState.currentFilteredRows.slice(startIndex, endIndex);

        document.getElementById('table_body').innerHTML = pageRows.length ? pageRows.map(r => `<tr> ${cols.map(c => `<td class="px-4 py-2 border-b whitespace-nowrap">${Utils.escapeHTML(r[c] ?? "")}</td>`).join('')} </tr>`).join('') : `<tr><td colspan="${Math.max(cols.length, 1)}" class="px-4 py-8 text-center">No se encontraron resultados</td></tr>`;

        const container = document.getElementById('pagination_container');
        if (container) {
            if (AppState.currentFilteredRows.length > 0) {
                container.classList.remove('hidden');
                document.getElementById('page_info').textContent = `Mostrando ${startIndex + 1} - ${endIndex} de ${AppState.currentFilteredRows.length} registros`;
            } else {
                container.classList.add('hidden');
            }
            document.getElementById('btn_prev').disabled = AppState.currentPage === 1;
            document.getElementById('btn_next').disabled = endIndex >= AppState.currentFilteredRows.length;
        }
    },

    renderFileMetricsAndFilters(rows) {
        document.getElementById('file_metrics_container').classList.remove('hidden');

        const conteoTipos = Object.create(null);
        const conteoOcup = Object.create(null);

        rows.forEach(r => {
            const t = r["Tipo Doc."] || "No Reportado";
            const o = r["Ocupación"] || "No Reportado";
            conteoTipos[t] = (conteoTipos[t] || 0) + 1;
            conteoOcup[o] = (conteoOcup[o] || 0) + 1;
        });

        // --- 2. Dibujar Gráficos Minilíticos ---
        const ctxTipo = document.getElementById('chart-file-tipo');
        if (window.chartFileTipo) window.chartFileTipo.destroy();
        if (ctxTipo && typeof Chart !== 'undefined') {
            const labelsT = Object.keys(conteoTipos);
            const dataT = Object.values(conteoTipos);
            const coloresT = labelsT.map((_, i) => `hsla(${(i * 360) / (labelsT.length || 1)}, 70%, 55%, 0.8)`);

            window.chartFileTipo = new Chart(ctxTipo, {
                type: 'pie',
                data: { labels: labelsT, datasets: [{ data: dataT, backgroundColor: coloresT, borderWidth: 1 }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 10 } } } } }
            });
        }

        const ctxOcup = document.getElementById('chart-file-ocup');
        if (window.chartFileOcup) window.chartFileOcup.destroy();
        if (ctxOcup && typeof Chart !== 'undefined') {
            const topOcups = Object.entries(conteoOcup).sort((a, b) => b[1] - a[1]).slice(0, 5);
            const labelsO = topOcups.map(e => e[0]);
            const dataO = topOcups.map(e => e[1]);
            const coloresO = labelsO.map((_, i) => `hsla(${190 + (i * 40)}, 60%, 50%, 0.8)`);

            window.chartFileOcup = new Chart(ctxOcup, {
                type: 'doughnut',
                data: { labels: labelsO, datasets: [{ data: dataO, backgroundColor: coloresO, borderWidth: 1 }] },
                options: { responsive: true, maintainAspectRatio: false, cutout: '55%', plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 10 } } } } }
            });
        }
    }
};

// logica
const Core = {
    async processData() {
        if (!UI.requireIntendencia()) return;
        if (AppState.trBusy) return;
        if (TRExport.busy) return Utils.showToast('Espera a que termine el Excel o cancela su generación.', 'info');
        const files = [...document.getElementById('file_input').files];
        if (files.length > 2) return Utils.showToast('Seleccione como máximo un TR5 y un TR6.', 'info');
        const file = document.getElementById('file_input').files[0];
        if (!file) return Utils.showToast("Seleccione un archivo", "info");

        // Guard: archivos mayores a 15MB pueden congelar el navegador
        if (files.some(f => f.size > 15 * 1024 * 1024)) {
            return Utils.showToast("El archivo supera 15MB. Divídalo en partes para evitar lentitud.", "error");
        }

        document.getElementById('loader').style.display = 'block';
        const processingStarted = performance.now();
        const processingOffice = AppState.intendencia;
        const request = ++AppState.trGeneration;
        AppState.trBusy = true;
        document.getElementById('file_input').disabled = true;
        document.getElementById('btn_process_data').disabled = true;
        document.getElementById('tr-reset-all').disabled = true;
        document.getElementById('tr-reset-all-bottom').disabled = true;
        document.getElementById('tr-cancel').disabled = false;
        document.getElementById('btn_clear_file').disabled = true;
        TRExport.syncDownloadControls();

        try {
            const result = await Processing.run('TR', files, message => {
                if (request === AppState.trGeneration) document.getElementById('tr-processing-status').textContent = message;
            });
            if (request !== AppState.trGeneration) return;
            const { datasets, analysis, table: { rows, cols } } = result;
            const dataset = datasets[0];

            clearTimeout(AppState.searchDebounceTimeout);
            AppState.searchDebounceTimeout = null;
            document.getElementById('search_box').value = '';
            TRView.reset();
            UI.renderInfoBox(ReportSchema.companyInfo(dataset));
            AppState.trDatasets = datasets;

            AppState.globalRows = rows;
            AppState.sourceDataset = dataset;
            AppState.globalCols = cols;

            UI.drawTable(AppState.globalRows, AppState.globalCols);
            UI.renderFileMetricsAndFilters(AppState.globalRows);

            document.getElementById('preview_section').classList.remove('hidden');
            // Actualizar tarjetas de archivo con datos reales del dataset procesado
            const fileCards = document.getElementById('file-cards');
            if (fileCards) {
                fileCards.innerHTML = datasets.map(d => {
                    const isTR6 = d.type === 'TR6';
                    const badgeColor = isTR6 ? 'bg-emerald-50 text-emerald-800 border-emerald-300' : 'bg-blue-50 text-blue-800 border-blue-300';
                    const iconColor = isTR6 ? 'text-emerald-600' : 'text-blue-600';
                    const diag = d.diagnostics.length > 0 ? `<span class="text-[10px] text-amber-700">⚠️ ${d.diagnostics.length} filas con columnas disparejas</span>` : '';
                    const shortFile = (d.sourceFile || '').length > 40 ? d.sourceFile.substring(0, 37) + '...' : (d.sourceFile || '');
                    return `<div class="flex items-center gap-3 px-4 py-2.5 rounded-xl border ${badgeColor} shadow-sm bg-white min-w-[220px]">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-7 w-7 ${iconColor} flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                        <div class="flex flex-col text-left">
                            <div class="flex items-center gap-2">
                                <span class="text-xs font-black uppercase tracking-wider">${d.type}</span>
                                <span class="text-[11px] font-medium text-gray-500">${Utils.escapeHTML(shortFile)}</span>
                            </div>
                            <span class="text-xs font-bold text-gray-800">${d.records.length} trabajadores · ${d.columns.length} columnas</span>
                            ${diag}
                        </div>
                    </div>`;
                }).join('');
            }
            const status = document.getElementById('file_status');
            if (status) {
                status.textContent = datasets.map(d => `${d.type}: ${d.records.length} registros`).join(' · ');
            }
            const sourceSelect = document.getElementById('tr-source-select');
            sourceSelect.replaceChildren(...datasets.map((d, i) => { const option = document.createElement('option'); option.value = String(i); option.textContent = `${d.type} — ${d.sourceFile}`; return option; }));
            TRView.set(analysis, processingOffice);
            document.getElementById('tr-reset-all').disabled = false;
            document.getElementById('tr-reset-all-bottom').disabled = false;
            UI.resetFileSelection(); // Solo al terminar correctamente. Mantener TRView y AppState.
            const warnings = analysis.schemaIssues.map(issue => issue.message).join(' ');
            document.getElementById('tr-processing-status').textContent = 'Carga finalizada. ' + (warnings || 'Puede seleccionar nuevos TXT; los resultados siguen disponibles.');

            Dashboard.registrarEnDrive('VISUALIZACIÓN', { intendencia: processingOffice, modulo: datasets.length === 2 ? 'TR5_TR6' : dataset.type, registros: datasets.reduce((n, d) => n + d.records.length, 0), archivos: files.length, bytes: files.reduce((n, f) => n + f.size, 0), duracionMs: performance.now() - processingStarted });

        } catch (error) {
            if (request !== AppState.trGeneration) return;
            const retained = TRView.analysis ? ' Se conserva la consulta anterior.' : '';
            document.getElementById('tr-processing-status').textContent = error.message + retained;
            if (error.name !== 'AbortError') {
                Utils.showToast('Error al procesar: ' + error.message);
                Dashboard.registrarEnDrive(error.code === 'FORMAT' ? 'FORMATO_DESCONOCIDO' : 'ERROR', {
                    intendencia: processingOffice, modulo: 'TR', archivos: files.length,
                    bytes: files.reduce((sum, input) => sum + input.size, 0)
                });
            }
        } finally {
            if (request === AppState.trGeneration) {
                AppState.trBusy = false;
                const hasResults = Boolean(TRView.analysis);
                document.getElementById('tr-reset-all').disabled = !hasResults;
                document.getElementById('tr-reset-all-bottom').disabled = !hasResults;
                document.getElementById('tr-cancel').disabled = true;
                document.getElementById('btn_clear_file').disabled = false;
                document.getElementById('loader').style.display = 'none';
                document.getElementById('file_input').disabled = !AppState.intendencia;
                document.getElementById('btn_process_data').disabled = !AppState.intendencia;
                TRExport.syncDownloadControls();
            }
        }
    },

    switchSource(index) {
        const dataset = AppState.trDatasets[index];
        if (!dataset) return;
        clearTimeout(AppState.searchDebounceTimeout);
        const { rows, cols } = FileParser.table(dataset);
        AppState.sourceDataset = dataset; AppState.globalRows = rows; AppState.globalCols = cols;
        UI.renderInfoBox(ReportSchema.companyInfo(dataset));
        document.getElementById('search_box').value = '';
        UI.drawTable(rows, cols); UI.renderFileMetricsAndFilters(rows);
    },

    runFilter() {
        clearTimeout(AppState.searchDebounceTimeout);
        AppState.searchDebounceTimeout = setTimeout(() => {
            const query = document.getElementById('search_box').value.toLowerCase().trim();
            AppState.currentFilteredRows = AppState.globalRows.filter(row => {
                let match = true;

                if (query) {
                    match = Object.values(row).some(value => String(value ?? '').toLowerCase().includes(query));
                }

                return match;
            });

            AppState.currentPage = 1;
            UI.renderCurrentPage(); // La tabla decide si oculta su paginador.
        }, 300);
    },

};

// dashboard
const Dashboard = {
    async attemptLogin() {
        const button = document.getElementById('btn_login_submit');
        if (button.disabled) return;
        button.disabled = true;
        button.textContent = 'Verificando…';
        try {
            const data = await SheetsAPI.request({ accion: 'LOGIN' });
            if (data.status !== 'ok' || !data.token || data.expires <= Date.now()) {
                return Utils.showToast('La cuenta institucional no tiene permiso para consultar las estadísticas.');
            }
            AppState.isLoggedIn = true;
            AppState.sessionToken = data.token;
            AppState.sessionExpires = data.expires;
            clearTimeout(AppState.sessionTimer);
            AppState.sessionTimer = setTimeout(() => this.logout('La sesión expiró.'), data.expires - Date.now());
            document.getElementById('login-modal').classList.add('hidden');
            UI.showPage('dashboard');
            await this.renderDashboard();
        } catch (error) {
            Utils.showToast(error.message);
        } finally {
            button.disabled = false;
            button.textContent = 'Verificar acceso';
        }
    },
    logout(message = 'Sesión cerrada.') {
        const token = AppState.sessionToken;
        AppState.isLoggedIn = false;
        AppState.sessionToken = null;
        AppState.sessionExpires = 0;
        clearTimeout(AppState.sessionTimer);
        AppState.sessionTimer = null;
        if (token) SheetsAPI.request({ accion: 'LOGOUT', token }).catch(() => {});
        SheetsAPI.reset();
        UI.clearWorkspaceTR();
        document.dispatchEvent(new Event('lector:reset'));
        AppState.vistasPorInt = {};
        AppState.descargasPorInt = {};
        this.growthValue = 'N/A';
        this.growthSign = '';
        for (const id of ['audit-tbody', 'stat-total-vis', 'stat-total-desc', 'stat-top-sede', 'stat-growth', 'dashboard-scope', 'contenedor-pdf-temporal']) {
            document.getElementById(id).replaceChildren();
        }
        for (const id of ['chart-visChart', 'chart-descChart']) {
            window[id]?.destroy();
            window[id] = null;
        }
        document.getElementById('contenedor-pdf-temporal').style.display = 'none';
        document.getElementById('btn_report_pdf').disabled = true;
        document.getElementById('intendencia').value = '';
        UI.toggleProcessor();
        UI.showPage('inicio');
        Utils.showToast(message, 'info');
    },
    async renderDashboard() {
        const txtVis = document.getElementById('stat-total-vis');
        const txtDesc = document.getElementById('stat-total-desc');
        const topSedeLabel = document.getElementById('stat-top-sede');
        const scope = document.getElementById('dashboard-scope');
        const report = document.getElementById('btn_report_pdf');
        const token = AppState.sessionToken;
        if (!token || AppState.sessionExpires <= Date.now()) return this.logout('La sesión expiró.');
        report.disabled = true;
        txtVis.textContent = 'Cargando…';
        try {
            const allData = await SheetsAPI.request({ accion: 'DASHBOARD', token });
            if (AppState.sessionToken !== token) return;
            if (allData.status === 'unauthorized') return this.logout('La sesión institucional ya no está disponible.');
            if (allData.status !== 'ok') throw new Error('No se pudieron consultar las estadísticas.');
            const modeLabel = { ANONYMOUS: 'Estadísticas declaradas por el usuario', INSTITUTIONAL: 'Estadísticas por cuenta institucional', OFF: 'Estadísticas desactivadas' };
            scope.textContent = (modeLabel[allData.mode] || 'Estadísticas de uso') + (allData.limited ? ' · Últimos ' + allData.windowLimit + ' eventos' : '');
            report.disabled = false;

            AppState.vistasPorInt = allData.visualizaciones || {};
            AppState.descargasPorInt = allData.descargas || {};

            const entriesVis = Object.entries(AppState.vistasPorInt).filter(([sede, valor]) => valor > 0);
            const labelsVis = entriesVis.map(e => e[0]);
            const valuesVis = entriesVis.map(e => e[1]);
            const totalVis = valuesVis.reduce((a, b) => a + b, 0);

            const entriesDesc = Object.entries(AppState.descargasPorInt).filter(([sede, valor]) => valor > 0);
            const labelsDesc = entriesDesc.map(e => e[0]);
            const valuesDesc = entriesDesc.map(e => e[1]);
            const totalDesc = valuesDesc.reduce((a, b) => a + b, 0);

            if (txtVis) txtVis.innerText = totalVis;
            if (txtDesc) txtDesc.innerText = totalDesc;

            const combined = {};
            Object.entries(AppState.vistasPorInt).forEach(([s, v]) => combined[s] = (combined[s] || 0) + v);
            Object.entries(AppState.descargasPorInt).forEach(([s, v]) => combined[s] = (combined[s] || 0) + v);

            const topSede = Object.keys(combined).length > 0
                ? Object.keys(combined).reduce((a, b) => combined[a] > combined[b] ? a : b)
                : "NINGUNA";

            if (topSedeLabel) topSedeLabel.innerText = topSede;

            // calculo de crecimiento de mes
            Dashboard.growthValue = "N/A";
            Dashboard.growthSign = "";

            if (allData.mesActual !== undefined && allData.mesAnterior !== undefined) {
                if (allData.mesAnterior === 0 || allData.limited) {
                    Dashboard.growthValue = 'N/A';
                } else {
                    const diff = allData.mesActual - allData.mesAnterior;
                    const pct = (diff / allData.mesAnterior) * 100;
                    Dashboard.growthValue = Math.abs(pct).toFixed(1);
                    Dashboard.growthSign = pct > 0 ? "+" : (pct < 0 ? "-" : "");
                }
            }

            const statGrowth = document.getElementById('stat-growth');
            const statGrowthIcon = document.getElementById('stat-growth-icon');

            if (statGrowth && Dashboard.growthValue !== "N/A") {
                statGrowth.innerText = Dashboard.growthValue + "%";
                const isPositive = Dashboard.growthSign === "+";
                const isNegative = Dashboard.growthSign === "-";

                statGrowth.className = `text-3xl font-black ${isPositive ? 'text-green-600' : (isNegative ? 'text-red-600' : 'text-gray-500')}`;

                if (statGrowthIcon) {
                    statGrowthIcon.innerText = isPositive ? "▲" : (isNegative ? "▼" : "⏸");
                    statGrowthIcon.className = `text-xs font-bold px-2 py-1 rounded-full ${isPositive ? 'text-green-700 bg-green-100' : (isNegative ? 'text-red-700 bg-red-100' : 'text-gray-700 bg-gray-100')}`;
                    statGrowthIcon.classList.remove('hidden');
                }
            } else if (statGrowth) {
                statGrowth.innerText = "N/A";
                statGrowth.className = "text-3xl font-black text-gray-400";
                if (statGrowthIcon) statGrowthIcon.classList.add('hidden');
            }

            this.renderBarChart('chart-vis', labelsVis, valuesVis, 'Visualizaciones');
            this.renderBarChart('chart-desc', labelsDesc, valuesDesc, 'Descargas Excel');
            this.renderAuditLog(allData.ultimosRegistros || []);

        } catch (e) {
            if (AppState.sessionToken === token) {
                txtVis.textContent = 'Sin datos';
                txtDesc.textContent = 'Sin datos';
                scope.textContent = e.message;
            }
        }
    },
    renderAuditLog(registros) {
        const tbody = document.getElementById('audit-tbody');
        if (!tbody) return;
        if (!registros || registros.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="px-4 py-6 text-center text-gray-400">Sin actividad registrada</td></tr>';
            return;
        }
        tbody.innerHTML = registros.map((r, i) => {
            const actions = {
                'VISUALIZACIÓN': ['text-blue-700 bg-blue-50', 'Visualización'],
                DESCARGAR_EXCEL: ['text-green-700 bg-green-50', 'Descarga Excel'],
                ERROR: ['text-red-700 bg-red-50', 'Error de procesamiento'],
                FORMATO_DESCONOCIDO: ['text-amber-700 bg-amber-50', 'Formato desconocido']
            };
            const [accionColor, accionLabel] = Object.hasOwn(actions, r.accion) ? actions[r.accion] : ['text-gray-700 bg-gray-100', 'Evento'];
            return `<tr class="audit-row border-b border-gray-100">
                <td class="px-4 py-2 text-gray-400 font-mono">${registros.length - i}</td>
                <td class="px-4 py-2 text-gray-600">${Utils.escapeHTML(r.fecha)}</td>
                <td class="px-4 py-2 font-semibold text-[#003366]">${Utils.escapeHTML(r.intendencia)}</td>
                <td class="px-4 py-2"><span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${accionColor}">${accionLabel}</span></td>
            </tr>`;
        }).join('');
    },
    renderBarChart(canvasId, labels, data, title) {
        const ctx = document.getElementById(canvasId).getContext('2d');
        if (window[canvasId + 'Chart']) window[canvasId + 'Chart'].destroy();

        const colores = labels.map((_, i) => `hsla(${(i * 360 / labels.length)}, 70%, 50%, 0.8)`);
        const bordes = labels.map((_, i) => `hsla(${(i * 360 / labels.length)}, 70%, 50%, 1)`);
        window[canvasId + 'Chart'] = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: title,
                    data: data,
                    backgroundColor: colores,
                    borderColor: bordes,
                    borderWidth: { top: 1, right: 4, bottom: 4, left: 1 },
                    borderRadius: 5,
                    categoryPercentage: 0.8,
                    barPercentage: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                layout: { padding: { top: 20, bottom: 40 } },
                scales: {
                    y: { beginAtZero: true, grid: { color: 'rgba(200,200,200,0.2)' } },
                    x: { ticks: { autoSkip: false, maxRotation: 90, minRotation: 90, font: { size: 10 } }, grid: { display: false } }
                },
                animation: { duration: 2000, easing: 'easeOutQuart' }
            },
            plugins: [
                {
                    id: 'valueLabels',
                    afterDatasetsDraw: (chart, args, options) => {
                        const { ctx } = chart;
                        ctx.save();
                        chart.data.datasets.forEach((dataset, di) => {
                            const meta = chart.getDatasetMeta(di);
                            meta.data.forEach((bar, index) => {
                                const value = dataset.data[index];
                                const pos = bar.tooltipPosition();
                                ctx.font = '700 11px Arial';
                                ctx.fillStyle = '#1e293b';
                                ctx.textAlign = 'center';
                                ctx.textBaseline = 'bottom';
                                ctx.fillText(String(value), pos.x, bar.y - 6);
                            });
                        });
                        ctx.restore();
                    }
                },
                {
                    beforeDraw: (chart) => {
                        const { ctx } = chart;
                        ctx.save();
                        ctx.shadowColor = 'rgba(0,0,0,0.3)';
                        ctx.shadowBlur = 10;
                        ctx.shadowOffsetX = 5;
                        ctx.shadowOffsetY = 5;
                    },
                    afterDraw: (chart) => chart.ctx.restore()
                }
            ],
            maxBarThickness: 50,
        });
    },
    async registrarEnDrive(accion, metadata) {
        return SheetsAPI.event(accion, metadata);
    },
    obtenerImagenesGraficos() {
        try {
            const c1 = document.getElementById('chart-vis');
            const c2 = document.getElementById('chart-desc');
            const chart1 = (c1 && typeof c1.toDataURL === 'function') ? c1.toDataURL("image/png") : '';
            const chart2 = (c2 && typeof c2.toDataURL === 'function') ? c2.toDataURL("image/png") : '';
            return { chart1, chart2 };
        } catch (e) {
            console.warn('No se pudieron extraer las imágenes de los gráficos:', e);
            return { chart1: '', chart2: '' };
        }
    },
    async generarReportePDF() {
        const token = AppState.sessionToken;
        if (!token || AppState.sessionExpires <= Date.now()) return;
        const button = document.getElementById('btn_report_pdf');
        if (button.disabled) return;
        const txtTotalVistas = document.getElementById('stat-total-vis')?.innerText || "0";
        const txtTotalDescargas = document.getElementById('stat-total-desc')?.innerText || "0";
        const topSede = document.getElementById('stat-top-sede')?.innerText || "NINGUNA";
        const scopeLabel = document.getElementById('dashboard-scope').textContent;
        const valCrecimiento = Dashboard.growthValue || "N/A";
        const signoCrecimiento = Dashboard.growthSign || "";
        const fechaActual = new Date().toLocaleString('es-PE', {
            timeZone: 'America/Lima', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });

        let tablaHTML = "";
        const nombresIntendencias = [...new Set([...Object.keys(AppState.vistasPorInt), ...Object.keys(AppState.descargasPorInt)])].sort();

        if (nombresIntendencias.length > 0) {
            nombresIntendencias.forEach(int => {
                const v = AppState.vistasPorInt[int] || 0;
                const d = AppState.descargasPorInt[int] || 0;
                tablaHTML += `
                    <tr style="border-bottom: 1px solid #e2e8f0;">
                        <td style="padding: 12px; text-align: left; font-weight: 600; color: #1e293b;">${Utils.escapeHTML(int)}</td>
                        <td style="padding: 12px; text-align: center; color: #003366; font-weight: bold;">${Utils.escapeHTML(v)}</td>
                        <td style="padding: 12px; text-align: center; color: #dc2626; font-weight: bold;">${Utils.escapeHTML(d)}</td>
                    </tr>`;
            });
        } else {
            tablaHTML = '<tr><td colspan="3" style="padding:30px; text-align:center; color:#94a3b8;">No se encontraron datos registrados.</td></tr>';
        }

        const imagenes = this.obtenerImagenesGraficos();

        const diseñoHTML = `
            <div style="padding: 40px; font-family: 'Helvetica', Arial, sans-serif; background-color: #f8fafc; min-height: 1000px;">
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 4px solid #003366; padding-bottom: 15px; margin-bottom: 30px; background: white; padding: 20px; border-radius: 10px 10px 0 0;">
                    <div>
                        <h1 style="color: #003366; margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.5px;">INFORME DE ACTIVIDAD DE USUARIOS</h1>
                        <p style="margin: 5px 0; color: #dc2626; font-size: 12px; font-weight: bold; letter-spacing: 1px;">SUNAFIL - DINI - SDAN</p>
                        <p style="margin: 4px 0; color: #475569; font-size: 11px;">${Utils.escapeHTML(scopeLabel)}</p>
                    </div>
                    <div style="text-align: right;">
                        <p style="margin: 0; color: #64748b; font-size: 11px;">Fecha de emisión:</p>
                        <p style="margin: 0; color: #1e293b; font-size: 12px; font-weight: bold;">${fechaActual}</p>
                    </div>
                </div>

                <div style="background: white; padding: 20px; border-radius: 10px; margin-bottom: 25px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                    <h3 style="color: #003366; font-size: 16px; margin-top: 0; border-left: 5px solid #003366; padding-left: 15px;">I. RESUMEN EJECUTIVO</h3>
                    <p style="font-size: 13px; line-height: 1.6; color: #475569; text-align: justify; margin-bottom: 0;">
                        El presente documento expone el monitoreo detallado de interacción y procesamiento de información a través de la plataforma institucional <b>Lector de Archivos TR5/TR6</b>. Este reporte proporciona métricas clave sobre el volumen de consultas (visualizaciones) y las exportaciones de bases de datos (descargas) ejecutadas por las diferentes Intendencias Regionales a nivel nacional.
                    </p>
                </div>

                <div style="display: flex; gap: 15px; margin-bottom: 30px;">
                    <div style="flex: 1; background: white; padding: 15px; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); text-align: center;">
                        <p style="margin: 0; color: #64748b; font-size: 10px; font-weight: bold; text-transform: uppercase;">Visualizaciones</p>
                        <h2 style="margin: 10px 0; color: #003366; font-size: 28px; font-weight: 800;">${Utils.escapeHTML(txtTotalVistas)}</h2>
                    </div>
                    <div style="flex: 1; background: white; padding: 15px; border-radius: 12px; border: 1px solid #fee2e2; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); text-align: center;">
                        <p style="margin: 0; color: #b91c1c; font-size: 10px; font-weight: bold; text-transform: uppercase;">Descargas Excel</p>
                        <h2 style="margin: 10px 0; color: #dc2626; font-size: 28px; font-weight: 800;">${Utils.escapeHTML(txtTotalDescargas)}</h2>
                    </div>
                    <div style="flex: 1; background: white; padding: 15px; border-radius: 12px; border: 1px solid #e0e7ff; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); text-align: center;">
                        <p style="margin: 0; color: #4338ca; font-size: 10px; font-weight: bold; text-transform: uppercase;">Crecimiento Mensual</p>
                        <h2 style="margin: 10px 0; color: ${valCrecimiento === 'N/A' ? '#94a3b8' : (signoCrecimiento === '+' ? '#16a34a' : '#ef4444')}; font-size: 28px; font-weight: 800;">
                            ${signoCrecimiento}${valCrecimiento}${valCrecimiento !== 'N/A' ? '%' : ''}
                        </h2>
                    </div>
                </div>

                <div style="background: white; padding: 25px; border-radius: 15px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); page-break-inside: auto;">
                    <h3 style="color: #003366; font-size: 16px; margin-top: 0; margin-bottom: 20px;">II. DESGLOSE POR INTENDENCIA REGIONAL</h3>
                    <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                        <thead>
                            <tr style="background-color: #000000; color: #003366;">
                                <th style="padding: 15px; text-align: left; border-radius: 8px 0 0 0;">Intendencia</th>
                                <th style="padding: 15px; text-align: center;">Vistas</th>
                                <th style="padding: 15px; text-align: center; border-radius: 0 8px 0 0;">Descargas</th>
                            </tr>
                        </thead>
                        <tbody>${tablaHTML}</tbody>
                    </table>
                </div>
                
                <div style="margin-top: 40px; page-break-before: always; padding-top: 10px;">
                    <h3 style="color: #003366; font-size: 16px; margin-bottom: 25px; border-left: 5px solid #003366; padding-left: 15px;">III. VISUALIZACIÓN GRÁFICA DE MÉTRICAS</h3>
                    <div style="display: block; gap: 20px;">
                        <div style="width: 100%; margin-bottom: 30px; text-align: center; page-break-inside: avoid;">
                            <p style="font-size: 13px; font-weight: bold; color: #475569; margin-bottom:12px; letter-spacing: 0.5px;">VISTAS POR SEDE</p>
                            <img src="${imagenes.chart1}" style="display:block; width:98%; max-width:1000px; height:auto; margin:0 auto; border: 1px solid #e2e8f0; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                        </div>
                        <hr style="border: 0; border-top: 1px dashed #e2e8f0; margin: 20px 0;">
                        <div style="width: 100%; text-align: center; page-break-inside: avoid;">
                            <p style="font-size: 13px; font-weight: bold; color: #475569; margin-bottom:12px; letter-spacing: 0.5px;">DESCARGAS POR SEDE</p>
                            <img src="${imagenes.chart2}" style="display:block; width:98%; max-width:1000px; height:auto; margin:0 auto; border: 1px solid #e2e8f0; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05);">
                        </div>
                    </div>
                </div>

                <div style="margin-top: 35px; background: #003366; color: white; padding: 25px; border-radius: 12px; page-break-inside: avoid; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                    <p style="margin: 0; font-size: 13.5px; line-height: 1.6;">
                        <b>CONCLUSIÓN ANALÍTICA:</b> Tras la evaluación de las métricas de uso, se identifica que la <b>${Utils.escapeHTML(topSede)}</b> registra el mayor índice de actividad en la plataforma. Se sugiere considerar estos patrones estadísticos para la toma de decisiones a nivel regional, priorización de soporte técnico y optimización continua de la infraestructura para garantizar el desempeño de la subdirección.
                    </p>
                </div>
                <div style="margin-top: 40px; text-align: center; color: #94a3b8; font-size: 10px;">
                    © 2026 SUNAFIL - Documento Digital Informativo de Uso Interno
                </div>
            </div>`;

        const contenedor = document.getElementById('contenedor-pdf-temporal');
        contenedor.innerHTML = diseñoHTML;
        contenedor.style.display = 'block';

        const opciones = {
            margin: [15, 10, 15, 10],
            filename: `Reporte_Actividad_TR_${new Date().toISOString().slice(0, 10)}.pdf`,
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 3, useCORS: true, letterRendering: true },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
            pagebreak: { mode: ['css', 'legacy'] }
        };

        button.disabled = true;
        try {
            await Utils.loadPdf();
            if (AppState.sessionToken !== token) return;
            const pdf = await html2pdf().set(opciones).from(contenedor).toPdf().get('pdf');
            if (AppState.sessionToken === token) pdf.save(opciones.filename);
        } catch {
            if (AppState.sessionToken === token) Utils.showToast('No se pudo generar el reporte PDF.');
        } finally {
            if (AppState.sessionToken === token) {
                contenedor.style.display = 'none';
                contenedor.replaceChildren();
                button.disabled = false;
            }
        }
    }
};

// eventos 
document.addEventListener('DOMContentLoaded', () => {

    // Inyección dinámica de Intendencias 
    const intData = ["LS1TRUxFQ0NJT05BUiBJTlRFTkRFTkNJQVMtLQ==", "SVJFLUFNQVpPTkFTOklOVEVOREVOQ0lBIFJFR0lPTkFMIEFNQVpPTkFT", "SVJFLUFOQ0FTSDpJTlRFTkRFTkNJQSBSRUdJT05BTCBBTkNBU0g=", "SVJFLUFQVVJJTUFDOklOVEVOREVOQ0lBIFJFR0lPTkFMIEFQVVJJTUFD", "SVJFLUFSRVFVSVBBOklOVEVOREVOQ0lBIFJFR0lOQUwgQVJFUVVJUEE=", "SVJFLUFZQUNVQ0hPOklOVEVOREVOQ0lBIFJFR0lPTkFMIEFZQUNVQ0hP", "SVJFLUNBSkFNQVJDQTpJTlRFTkRFTkNJQSBSRUdJT05BTCBDQUpBTUFSQ0E=", "SVJFLUNBTExBTzpJTlRFTkRFTkNJQSBSRUdJT05BTCBDQUxMQU8=", "SVJFLUNVU0NPOklOVEVOREVOQ0lBIFJFR0lPTkFMIENVU0NP", "SVJFLUhVQU5DQVZFTElDQTpJTlRFTkRFTkNJQSBSRUdJT05BTCBIVUFOQ0FWRUxJQ0E=", "SVJFLUhVQU5VQ086SU5URU5ERU5DSUEgUkVHSU9OQUwgSFVBTlVDTw==", "SVJFLUlDQTpJTlRFTkRFTkNJQSBSRUdJT05BTCBJQ0E=", "SVJFLUpVTklOOklOVEVOREVOQ0lBIFJFR0lPTkFMIEpVTklO", "SVJFLUxBIExJQkVSVEFEOklOVEVOREVOQ0lBIFJFR0lPTkFMIExBIExJQkVSVEFE", "SVJFLUxBTUJBWUVRVUU6SU5URU5ERU5DSUEgUkVHSU9OQUwgTEFNQkFZRVFVRQ==", "SVJFLUxJTUE6SU5URU5ERU5DSUEgUkVHSU9OQUwgTElNQQ==", "SUxNOklOVEVOREVOQ0lBIExJTUEgTUVUUk9QT0xJVEFOQQ==", "U0RJRTpTVUJESVJFQ0NJT04gREUgSU5URVJWRU5DSU9ORVMgRVNQRUNJQUxFUw==", "SVJFLUxPUkVUTzpJTlRFTkRFTkNJQSBSRUdJT05BTCBMT1JFVE8=", "SVJFLU1BRFJFIERFIERJT1M6SU5URU5ERU5DSUEgUkVHSU9OQUwgTUFEUkUgREUgRElPUw==", "SVJFLU1PUVVFR1VBOklOVEVOREVOQ0lBIFJFR0lPTkFMIE1PUVVFR1VB", "SVJFLVBBU0NPOklOVEVOREVOQ0lBIFJFR0lPTkFMIFBBU0NP", "SVJFLVBJVVJBOklOVEVOREVOQ0lBIFJFR0lPTkFMIFBJVVJB", "SVJFLVBVTk86SU5URU5ERU5DSUEgUkVHSU9OQUwgUFVOTw==", "SVJFLVNBTiBNQVJUSU46SU5URU5ERU5DSUEgUkVHSU9OQUwgU0FOIE1BUlRJTg==", "SVJFLVRBQ05BOklOVEVOREVOQ0lBIFJFR0lPTkFMIFRBQ05B", "SVJFLVRVTUJFUzpJTlRFTkRFTkNJQSBSRUdJT05BTCBUVU1CRVM=", "SVJFLVVDQVlBTEk6SU5URU5ERU5DSUEgUkVHSU9OQUwgVUNBWUFMSQ=="];
    const selectIntendencia = document.getElementById('intendencia');
    if (selectIntendencia) {
        intData.forEach((enc, index) => {
            const dec = atob(enc);
            const opt = document.createElement('option');
            if (index === 0) {
                opt.value = ""; opt.textContent = dec;
            } else {
                const parts = dec.split(':');
                opt.value = parts[0]; opt.textContent = parts[1];
            }
            selectIntendencia.appendChild(opt);
        });
    }

    // Navegacion
    UI.toggleProcessor();
    UI.showPage('inicio');
    document.getElementById('nav_inicio').addEventListener('click', () => UI.showPage('inicio'));
    document.getElementById('nav_ruc').addEventListener('click', () => UI.showPage('ruc'));
    document.getElementById('open-tr').addEventListener('click', () => UI.showPage('procesador'));
    document.getElementById('open-ruc').addEventListener('click', () => UI.showPage('ruc'));
    document.getElementById('nav_procesador')?.addEventListener('click', () => UI.showPage('procesador'));
    document.getElementById('lector-version').textContent = ReaderConfig.version + ' (' + ReaderConfig.revision + ')';
    const dashboardButton = document.getElementById('nav_dashboard');
    dashboardButton.hidden = !ReaderConfig.apiUrl;
    dashboardButton.addEventListener('click', () => {
        if (AppState.isLoggedIn) {
            UI.showPage('dashboard');
            Dashboard.renderDashboard();
        } else {
            document.getElementById('login-modal').classList.remove('hidden');
            document.getElementById('btn_login_submit').focus();
        }
    });

    document.getElementById('tr-cancel').addEventListener('click', () => Processing.cancel('TR'));
    // Procesador
    document.getElementById('tr-source-select').addEventListener('change', event => Core.switchSource(Number(event.target.value)));
    document.getElementById('tr-charts-details')?.addEventListener('toggle', event => {
        if (!event.target.open) return;
        requestAnimationFrame(() => {
            window.chartFileTipo?.resize();
            window.chartFileOcup?.resize();
        });
    });
    document.getElementById('intendencia')?.addEventListener('change', UI.toggleProcessor);
    document.getElementById('file_input')?.addEventListener('change', UI.updateFileStatus);
    document.getElementById('btn_clear_file')?.addEventListener('click', UI.clearFile);
    document.getElementById('btn_process_data')?.addEventListener('click', () => Core.processData());
    ['tr-reset-all', 'tr-reset-all-bottom'].forEach(id => document.getElementById(id)?.addEventListener('click', () => UI.resetWorkspaceTR()));
    document.getElementById('search_box')?.addEventListener('input', Core.runFilter);

    // Modo Oscuro — toggle + persistencia
    const btnDark = document.getElementById('btn-dark-mode');
    const applyDark = (on) => {
        document.documentElement.classList.toggle('dark-mode', on);
        if (btnDark) btnDark.textContent = on ? '☀️' : '🌙';
        try { localStorage.setItem('tr5_dark', on ? '1' : '0'); } catch {}
    };
    try { applyDark(localStorage.getItem('tr5_dark') === '1'); } catch {}
    btnDark?.addEventListener('click', () => applyDark(!document.documentElement.classList.contains('dark-mode')));

    document.getElementById('btn_prev')?.addEventListener('click', () => {
        if (AppState.currentPage > 1) { AppState.currentPage--; UI.renderCurrentPage(); }
    });
    document.getElementById('btn_next')?.addEventListener('click', () => {
        if (AppState.currentPage < Math.ceil(AppState.currentFilteredRows.length / AppState.pageSize)) {
            AppState.currentPage++; UI.renderCurrentPage();
        }
    });

    // Dashboard Buttons
    document.getElementById('btn_report_pdf')?.addEventListener('click', () => Dashboard.generarReportePDF());
    document.getElementById('btn_logout')?.addEventListener('click', () => Dashboard.logout());

    // Login 
    document.getElementById('btn_login_submit')?.addEventListener('click', () => Dashboard.attemptLogin());
    const closeLogin = () => {
        document.getElementById('login-modal').classList.add('hidden');
        dashboardButton.focus();
    };
    document.getElementById('btn_login_cancel').addEventListener('click', closeLogin);
    document.getElementById('login-modal').addEventListener('keydown', event => {
        if (event.key === 'Escape') closeLogin();
    });

    // actualizar drop zone
    const dropZone = document.getElementById('upload-zone');
    if (dropZone) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, e => {
                e.preventDefault(); e.stopPropagation();
            }, false);
        });

        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => dropZone.classList.add('border-[#003366]', 'bg-blue-50', 'scale-[1.02]'));
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => dropZone.classList.remove('border-[#003366]', 'bg-blue-50', 'scale-[1.02]'));
        });

        dropZone.addEventListener('drop', e => {
            if (AppState.trBusy || !UI.requireIntendencia()) return;
            const dt = e.dataTransfer;
            if (dt.files.length > 0) {
                document.getElementById('file_input').files = dt.files;
                UI.updateFileStatus();
            }
        });
    }
});
