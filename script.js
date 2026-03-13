// 1. CONFIGURACIÓN Y VARIABLES GLOBALES
const DRIVE_API_URL ="https://script.google.com/macros/s/AKfycbz67t6RsbO7pdx9Qupf2BFZU4OEOvq_Je1Tqn2Dsldjz5ELiNjQPglVY1jAyOIuvCk/exec";
const ADMIN_CREDENTIALS = { user: "admin", pass: "sunafil2026" };
const dropZone = document.getElementById('upload-zone');
const fileInput = document.getElementById('file_input');
const labelDefault = document.getElementById('label-content-default');
const infoContainer = document.getElementById('file-info-container');
let isLoggedIn = false;
let globalRows = [];
let globalCols = [];

// 2. GESTIÓN DE PÁGINAS Y MODAL
function showPage(pageId) {
    document.getElementById('page-procesador').classList.add('hidden');
    document.getElementById('page-dashboard').classList.add('hidden');
    const target = document.getElementById(`page-${pageId}`);
    if (target) target.classList.remove('hidden');
}

function openLoginModal() {
    if (isLoggedIn) {
        showPage('dashboard');
        renderDashboard();
    } else {
        document.getElementById('login-modal').classList.remove('hidden');
    }
}

function closeLoginModal() {
    document.getElementById('login-modal').classList.add('hidden');
}

// 3. AUTENTICACIÓN
function attemptLogin() {
    const u = document.getElementById('admin-user').value;
    const p = document.getElementById('admin-pass').value;

    // Corregido: Referencia correcta a ADMIN_CREDENTIALS
    if (u === ADMIN_CREDENTIALS.user && p === ADMIN_CREDENTIALS.pass) {
        isLoggedIn = true;
        closeLoginModal();
        showPage('dashboard');
        renderDashboard();
    } else {
        alert("Credenciales incorrectas.");
    }
}

function logout() {
    isLoggedIn = false;
    showPage('procesador');
}

// 4. INTERFAZ DE USUARIO (Activación de botones)
function toggleProcessor() {
    const int = document.getElementById('intendencia').value;
    const zone = document.getElementById('upload-zone');

    if (int !== "") {
        zone.classList.remove('opacity-30', 'pointer-events-none');
    } else {
        zone.classList.add('opacity-30', 'pointer-events-none');
    }
}

function updateFileStatus() {
    const status = document.getElementById('file_status');
    if (fileInput.files.length > 0) {
        status.textContent = `CARGADO: ${fileInput.files[0].name}`;
        labelDefault.classList.add('hidden');
        infoContainer.classList.remove('hidden');
        infoContainer.classList.add('flex');
    }
}

function clearFile(event) {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    fileInput.value = ""; // Resetea el input
    labelDefault.classList.remove('hidden');
    infoContainer.classList.add('hidden');
    infoContainer.classList.remove('flex');
    
    // Opcional: Ocultar sección de preview si se borra el archivo
    document.getElementById('preview_section').classList.add('hidden');
    globalRows = []; 
}

// 5. PROCESAMIENTO DE DATOS TR5
async function processData(showUI = true) {
    const file = document.getElementById('file_input').files[0];
    if (!file) return alert("Seleccione un archivo");
    document.getElementById('loader').style.display = 'block';

    try {
        const text = await readAsIso(file);
        const lines = text.split(/\r?\n/);
        
        // 1. Extraer info de cabecera (RUC, Empresa, etc.) - MEJORADO
        const info = {};
        let currentKey = "";
        
        // Leer las primeras 30 líneas para capturar toda la información de la entidad
        for (let i = 0; i < Math.min(30, lines.length); i++) {
            const l = lines[i].trim();
            
            // Saltar líneas vacías y de separadores
            if (!l || l.replace(/=/g, "").replace(/-/g, "").trim() === "") continue;
            
            // Buscar líneas con formato "CLAVE: valor"
            if (l.includes(":")) {
                const colonIdx = l.indexOf(":");
                const key = l.substring(0, colonIdx).trim();
                let value = l.substring(colonIdx + 1).trim();
                
                // Si la clave existe y el valor es válido
                if (key && value && value.length > 0) {
                    // Limpiar caracteres especiales y comillas
                    value = value.replace(/^"/, "").replace(/"$/, "").trim();
                    info[key] = value;
                    currentKey = key;
                }
            } else if (currentKey && l && !l.includes("|") && !l.includes("\t")) {
                // Continuación de un valor anterior (líneas multi-línea)
                info[currentKey] += " " + l;
            }
        }

        console.log("Información de entidad extraída:", info);
        
        if (typeof renderInfoBox === "function") renderInfoBox(info);

        // 2. Identificar delimitadores (Acepta ==== y ----)
        const isDelimiter = (l) => {
            const trimmed = l.trim();
            return trimmed.length > 20 && (trimmed.replace(/=/g, "") === "" || trimmed.replace(/-/g, "") === "");
        };

        const delimiterIndexes = [];
        lines.forEach((l, i) => { if (isDelimiter(l)) delimiterIndexes.push(i); });

        if (delimiterIndexes.length < 1) throw new Error("No se encontró el formato de tabla esperado.");

        // 3. ENCONTRAR ENCABEZADOS CORRECTAMENTE (soporta tabs, pipes y fixed-width)
        let headerIdx = -1;

        // Buscar hacia atrás desde el último delimitador: aceptar líneas con tabs, pipes, o múltiples espacios contiguos
        for (let i = delimiterIndexes[delimiterIndexes.length - 1] - 1; i >= 0; i--) {
            const line = lines[i];
            const upperLine = line.toUpperCase();
            const hasManySpaces = /\s{2,}/.test(line);
            const tokensBySpaces = line.split(/\s{2,}/).filter(t => t.trim().length > 0);
            if (line.includes('\t') || line.includes('|') || (hasManySpaces && tokensBySpaces.length > 3 && line.trim().length > 10)) {
                // Heurística: presencia de palabras clave o varias columnas
                if (upperLine.includes('TIPO') || upperLine.includes('NUMER') || upperLine.includes('APELL') || upperLine.includes('NOMBRE') || upperLine.includes('SITUACI') || upperLine.includes('REGIM')) {
                    headerIdx = i;
                    break;
                }
                // Si no tiene palabras clave pero parece una línea de encabezado con muchas columnas
                if (tokensBySpaces.length > 4) {
                    headerIdx = i;
                    break;
                }
            }
        }

        if (headerIdx === -1) throw new Error("No se encontraron encabezados válidos.");

        // Elegir la mejor línea de encabezado entre headerIdx y el delimitador siguiente.
        // Muchos archivos SSA/TR6 tienen encabezados en varias líneas; seleccionamos
        // la línea con mayor número de "columnas" detectables.
        const headerCandidates = [];
        const lastDelimiter = delimiterIndexes[delimiterIndexes.length - 1];
        for (let j = headerIdx; j < lastDelimiter; j++) {
            const ln = lines[j];
            if (!ln || ln.trim().length === 0) continue;
            if (isDelimiter(ln)) continue;
            // contar tokens por distintos separadores
            const byTab = ln.includes('\t') ? ln.split('\t').map(t => t.trim()).filter(Boolean).length : 0;
            const byPipe = ln.includes('|') ? ln.split('|').map(t => t.trim()).filter(Boolean).length : 0;
            const bySpaces = ln.split(/\s{2,}/).map(t => t.trim()).filter(Boolean).length;
            const maxTokens = Math.max(byTab, byPipe, bySpaces);
            headerCandidates.push({ idx: j, line: ln, tokens: maxTokens, byTab: byTab, byPipe: byPipe, bySpaces: bySpaces });
        }

        // Si no hay candidatos (raro), usar la línea encontrada originalmente
        let chosenHeaderLine = lines[headerIdx];
        if (headerCandidates.length > 0) {
            // seleccionar la línea con más tokens (mejor detalle de columnas)
            headerCandidates.sort((a, b) => b.tokens - a.tokens);
            chosenHeaderLine = headerCandidates[0].line;
        }

        // Determinar formato de encabezado y crear rawHeaders a partir de la línea elegida
        let rawHeaders = [];
        let headerMode = 'spaces';
        if (chosenHeaderLine.includes('\t')) {
            rawHeaders = chosenHeaderLine.split('\t').map(h => h.replace(/\s+/g, ' ').trim()).filter(h => h.length > 0);
            headerMode = 'tabs';
        } else if (chosenHeaderLine.includes('|')) {
            rawHeaders = chosenHeaderLine.split('|').map(h => h.replace(/\s+/g, ' ').trim()).filter(h => h.length > 0);
            headerMode = 'pipe';
        } else {
            // fixed-width header: split por 2+ espacios
            rawHeaders = chosenHeaderLine.split(/\s{2,}/).map(h => h.replace(/\s+/g, ' ').trim()).filter(h => h.length > 0);
            headerMode = 'spaces';
        }

        // Almacenar el arreglo original antes de renombrar duplicados para el log
        const originalHeaders = [...rawHeaders];

        // Evitar pérdida de datos cuando hay encabezados idénticos (JSON no puede tener claves duplicadas).
        // Añadimos sufijos numéricos a las repeticiones.
        const counts = {};
        rawHeaders = rawHeaders.map(h => {
            const key = h || "";
            counts[key] = (counts[key] || 0) + 1;
            if (counts[key] > 1) {
                return `${h} ${counts[key]}`;
            }
            return h;
        });

        console.log("Encabezados encontrados (línea seleccionada):", rawHeaders, "modo:", headerMode);
        console.log("(original headers)", originalHeaders);

        // 4. Determinar donde comienzan los datos
        const dataStartIdx = delimiterIndexes[delimiterIndexes.length - 1] + 1;

        // 5. FUNCIÓN PARA BUSCAR ENCABEZADO SIN IMPORTAR TILDES Y MAYÚSCULAS
        const findHeaderIndex = (searchStr) => {
            const normalized = searchStr.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            return rawHeaders.findIndex(h => {
                const hNorm = h.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                return hNorm.includes(normalized) || normalized.includes(hNorm) || hNorm === normalized;
            });
        };

        // Buscar múltiples variaciones de palabras clave
        const findHeaderVariations = (keywords) => {
            for (let keyword of keywords) {
                const idx = findHeaderIndex(keyword);
                if (idx !== -1) return idx;
            }
            return -1;
        };

        // 6. MAPPING DE LAS COLUMNAS PRINCIPALES
        const mainColumns = [];
        const usedIndices = new Set();
        // índices de columnas individuales de nombre/apellidos que deben omitirse al final
        const skipIndexes = new Set();

        // Buscar y asignar columnas principales con variaciones
        const tipoIdx = findHeaderVariations(["TIPO", "TIPO DOC", "TIPO DE DOCUMENTO"]);
        if (tipoIdx !== -1) { mainColumns.push({ key: "Tipo Doc.", headerIdx: tipoIdx }); usedIndices.add(tipoIdx); }

        const numeroIdx = findHeaderVariations(["NUMERO", "NRO", "Nº", "NRO DOC", "NUM"]); 
        if (numeroIdx !== -1) { mainColumns.push({ key: "Nro Doc.", headerIdx: numeroIdx }); usedIndices.add(numeroIdx); }

        const patIdx = findHeaderVariations(["PATERNO", "APELLIDO PATERNO", "APELLIDO"]);
        const matIdx = findHeaderVariations(["MATERNO", "APELLIDO MATERNO"]);
        const nomIdx = findHeaderVariations(["NOMBRE", "NOMBRES"]);
        if (patIdx !== -1 || matIdx !== -1 || nomIdx !== -1) {
            mainColumns.push({ key: "Apellidos y Nombres", patIdx: patIdx, matIdx: matIdx, nomIdx: nomIdx, combined: true });
            if (patIdx !== -1) { usedIndices.add(patIdx); skipIndexes.add(patIdx); }
            if (matIdx !== -1) { usedIndices.add(matIdx); skipIndexes.add(matIdx); }
            if (nomIdx !== -1) { usedIndices.add(nomIdx); skipIndexes.add(nomIdx); }
        }

        const fechaIdx = findHeaderVariations(["FEC", "FECHA", "FEC. INICIO", "FECHA DE GENERACION", "FECHA INICIO"]);
        if (fechaIdx !== -1) { mainColumns.push({ key: "Fecha de Ingreso", headerIdx: fechaIdx }); usedIndices.add(fechaIdx); }

        const ocupIdx = findHeaderVariations(["OCUPACION", "OCUPACIÓN", "OCUPA"]);
        if (ocupIdx !== -1) { mainColumns.push({ key: "Ocupación", headerIdx: ocupIdx }); usedIndices.add(ocupIdx); }

        // 7. PARSING DE DATOS - PRESERVAR TODOS LOS DATOS
        // Detectar modo de datos en líneas (tabs, pipes o fixed)
        const sampleLines = lines.slice(dataStartIdx, dataStartIdx + 50);
        const hasTabs = sampleLines.some(l => l.includes('\t'));
        const hasPipes = sampleLines.some(l => l.includes('|'));
        const useFixed = !hasTabs && !hasPipes;

        // Helper: obtener celdas de una línea según el modo
        const parseLineToCells = (l) => {
            if (hasTabs) return l.split('\t').map(c => c.replace(/\s+/g, ' ').trim());
            if (hasPipes) return l.split('|').map(c => c.replace(/\s+/g, ' ').trim());
            // fixed-width: split por dos o más espacios como fallback
            return l.split(/\s{2,}/).map(c => c.replace(/\s+/g, ' ').trim());
        };

        globalRows = [];
        for (let i = dataStartIdx; i < lines.length; i++) {
            const l = lines[i];
            if (!l || l.trim().length === 0) continue;
            // skip lines that are delimiters
            if (isDelimiter(l)) continue;
            // Consider only lines that look like data (have at least one non-space)
            const cells = parseLineToCells(l);
            if (cells.length === 0) continue;

            const row = { "N°": globalRows.length + 1 };

            // Primero asignar columnas principales
            mainColumns.forEach(col => {
                if (col.combined) {
                    const pat = (col.patIdx !== -1 && col.patIdx < cells.length) ? cells[col.patIdx] : "";
                    const mat = (col.matIdx !== -1 && col.matIdx < cells.length) ? cells[col.matIdx] : "";
                    const nom = (col.nomIdx !== -1 && col.nomIdx < cells.length) ? cells[col.nomIdx] : "";
                    row["Apellidos y Nombres"] = `${pat} ${mat} ${nom}`.trim().replace(/\s+/g, ' ');
                } else {
                    if (col.headerIdx < cells.length) row[col.key] = cells[col.headerIdx] || "";
                }
            });

            // Luego agregar todas las columnas originales en su nombre original (sin duplicar)
            rawHeaders.forEach((header, idx) => {
                // omitir índices marcados para salto (por ejemplo apellidos/nombres)
                if (skipIndexes.has(idx)) return;
                if (!row.hasOwnProperty(header) && idx < cells.length) {
                    row[header] = cells[idx] || "";
                }
            });

            globalRows.push(row);
        }

        // 8. CONSTRUIR globalCols EN EL ORDEN CORRECTO - SIN DUPLICADOS
        globalCols = ["N°"];
        const columnOrder = ["Tipo Doc.", "Nro Doc.", "Apellidos y Nombres", "Fecha de Ingreso", "Ocupación"];
        columnOrder.forEach(col => { if (mainColumns.some(mc => mc.key === col)) globalCols.push(col); });

        // Agregar todas las columnas originales (rawHeaders) sin duplicar,
        // pero saltar aquellas que corresponden a partes de nombre/apellidos ya combinadas.
        rawHeaders.forEach((h, idx) => {
            if (skipIndexes.has(idx)) return;
            if (!globalCols.includes(h) && h.trim() !== "") globalCols.push(h);
        });

        console.log("Headers originales:", rawHeaders);
        console.log("Índices usados:", Array.from(usedIndices));
        console.log("Columnas finales:", globalCols);
        console.log("Filas leídas:", globalRows.length);
        if (globalRows.length > 0) console.log("Primer fila:", globalRows[0]);

        if (globalRows.length === 0) throw new Error("No se encontraron datos después de los encabezados.");

        if (showUI) {
            drawTable(globalRows, globalCols);
            document.getElementById('preview_section').classList.remove('hidden');
        }
        
        registrarEnDrive("VISUALIZACIÓN");

    } catch (error) {
        alert("Error al procesar: " + error.message);
        console.error("Detalle del error:", error);
    } finally {
        document.getElementById('loader').style.display = 'none';
    }
}

// RENDERIZADO DE INTERFAZ
function renderInfoBox(data) {
    const container = document.getElementById('company_list');
    if (!container) return;
    
    // Ordenar las claves para mostrar primero las más importantes
    const keyOrder = ['TR5', 'TR6', 'NRO DE RUC', 'NOMBRE, DENOMINACIÓN O RAZÓN SOCIAL', 'FECHA DE GENERACIÓN'];
    const sortedEntries = [];
    
    // Primero agregar en orden especial
    keyOrder.forEach(key => {
        Object.entries(data).forEach(([k, v]) => {
            if (k.includes(key) && !sortedEntries.find(entry => entry[0] === k)) {
                sortedEntries.push([k, v]);
            }
        });
    });
    
    // Luego agregar el resto
    Object.entries(data).forEach(([k, v]) => {
        if (!sortedEntries.find(entry => entry[0] === k)) {
            sortedEntries.push([k, v]);
        }
    });
    
    container.innerHTML = sortedEntries.map(([k, v]) => {
        // Limpiar valores muy largos para que se vean mejor
        let displayValue = v ? String(v).substring(0, 200) : '';
        return `<div style="margin-bottom: 8px;"><span class="text-[#003366] font-black" style="color: #003366; font-weight: bold;">${k}:</span> <span class="text-slate-600 font-medium" style="color: #475569;">${displayValue}</span></div>`;
    }).join('');
    
    document.getElementById('company_container').classList.remove('hidden');
}

function drawTable(rows, cols) {
    document.getElementById('table_head').innerHTML = cols.map(c => `<th class="px-4 py-3 border-b whitespace-nowrap">${c}</th>`).join('');
    document.getElementById('table_body').innerHTML = rows.map(r => `<tr> ${cols.map(c => `<td class="px-4 py-2 border-b whitespace-nowrap">${r[c] || ""}</td>`).join('')} </tr>`).join('');
}

// DASHBOARD Y GOOGLE DRIVE.
async function renderDashboard() {
    const txtVis = document.getElementById('stat-total-vis');
    const txtDesc = document.getElementById('stat-total-desc');
    const topSedeLabel = document.getElementById('stat-top-sede');
    
    if (txtVis) txtVis.innerText = "Cargando...";

    try {
        const response = await fetch(DRIVE_API_URL + "?t=" + new Date().getTime());
        const allData = await response.json();

        const entriesVis = Object.entries(allData.visualizaciones || {}).filter(([sede, valor]) => valor > 0);
        const labelsVis = entriesVis.map(e => e[0]); 
        const valuesVis = entriesVis.map(e => e[1]);
        const totalVis = valuesVis.reduce((a, b) => a + b, 0);

        const entriesDesc = Object.entries(allData.descargas || {}).filter(([sede, valor]) => valor > 0);
        const labelsDesc = entriesDesc.map(e => e[0]);
        const valuesDesc = entriesDesc.map(e => e[1]);
        const totalDesc = valuesDesc.reduce((a, b) => a + b, 0);

        if (txtVis) txtVis.innerText = totalVis;
        if (txtDesc) txtDesc.innerText = totalDesc;

        const combined = {};
        entriesVis.forEach(([s,v]) => combined[s] = (combined[s] || 0) + v);
        entriesDesc.forEach(([s,v]) => combined[s] = (combined[s] || 0) + v);

        const topSede = Object.keys(combined).length > 0
            ? Object.keys(combined).reduce((a,b) => combined[a] > combined[b] ? a : b)
            : "NINGUNA";

        if (topSedeLabel) topSedeLabel.innerText = topSede;

        renderBarChart('chart-vis', labelsVis, valuesVis, 'Visualizaciones');
        renderBarChart('chart-desc', labelsDesc, valuesDesc, 'Descargas Excel');

    } catch (e) {
        console.error("Error al cargar dashboard:", e);
        if (txtVis) txtVis.innerText = "Error";
    }
}

function renderBarChart(canvasId, labels, data, title, color) {
    const ctx = document.getElementById(canvasId).getContext('2d');

    if (window[canvasId + 'Chart'])
        window[canvasId + 'Chart'].destroy();

    const colores = labels.map((_,i) => `hsla(${(i*360 / labels.length)}, 70%, 50%, 0.8)`);
    const bordes = labels.map((_, i) => `hsla(${(i*360 / labels.length)}, 70%, 50%, 1)`);
    window[canvasId + 'Chart'] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: title,
                data: data,
                backgroundColor: colores,
                borderColor: bordes,
                borderWidth: {
                    top:1,
                    right: 4,
                    botton: 4,
                    left: 1
                },
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
                y: { beginAtZero: true,
                    grid: {color: 'rgba(200,200,200,0.2'}
                 },
                x: { ticks: { autoSkip: false, maxRotation: 90, minRotation: 90,
                    font: { size: 10}
                 },
                     grid: {display:false} }
            },
            Animation: {
                duration:2000,
                easing: 'easeOutQuart'
            }
        },
            plugins: [{
                beforeDraw: (chart) => {
                    const {ctx} = chart;
                    ctx.save();
                    ctx.shadowColor = 'rgba(0,0,0,0.3)';
                    ctx.shadowBlur = 10;
                    ctx.shadowOffsetX = 5;
                    ctx.shadowOffsetY = 5;
                },
                afterDraw: (chart) => {
                    chart.ctx.restore();
                },
                legend: { display: false }
            }],
            maxBarThickness: 50,
    });
}

async function registrarEnDrive(accion) {
    const int = document.getElementById('intendencia').value;
    const payload = { intendencia: int, accion: accion };
    try {
        await fetch(DRIVE_API_URL, { 
            method: 'POST', 
            mode: 'no-cors', 
            body: JSON.stringify(payload) 
        });
    } catch (e) { console.warn("Error log Drive"); }
}

// 8. UTILIDADES
function readAsIso(f) {
    return new Promise(res => {
        let r = new FileReader();
        r.onload = () => res(r.result);
        r.readAsText(f, "ISO-8859-1");
    });
}

function runFilter() {
    const query = document.getElementById('search_box').value.toLowerCase();
    const tbody = document.getElementById('table_body');
    const rows = tbody.querySelectorAll('tr');

    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(query) ? '' : 'none';
    });
}

function downloadExcel() {
    if (!globalRows.length) return alert("No hay datos para descargar");

    const int = document.getElementById('intendencia').value;
    const ws = XLSX.utils.json_to_sheet(globalRows, { header: globalCols });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "DATA_SUNAFIL");
    XLSX.writeFile(wb, `Reporte_TR5_${int}.xlsx`);

    registrarEnDrive("DESCARGAR_EXCEL");
}

// Prevenir comportamiento por defecto del navegador (evita que se abra el archivo)
['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, e => {
        e.preventDefault();
        e.stopPropagation();
    }, false);
});

// Efecto visual: Resaltar la zona cuando el archivo está encima
['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => {
        dropZone.classList.add('border-[#003366]', 'bg-blue-50', 'scale-[1.02]');
    }, false);
});

// Quitar efecto visual cuando el archivo sale o se suelta
['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => {
        dropZone.classList.remove('border-[#003366]', 'bg-blue-50', 'scale-[1.02]');
    }, false);
});

// Capturar el archivo soltado
dropZone.addEventListener('drop', e => {
    const dt = e.dataTransfer;
    const files = dt.files;

    if (files.length > 0) {
        // Asignamos el archivo soltado al input oculto
        fileInput.files = files;
        
        // Ejecutamos la función que ya tienes para actualizar la UI
        updateFileStatus();
        
        // Opcional: Si quieres que procese inmediatamente al soltar, descomenta la siguiente línea:
        // processFile();
    }
}, false);