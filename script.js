// 1. CONFIGURACIÓN Y VARIABLES GLOBALES
const DRIVE_API_URL ="https://script.google.com/macros/s/AKfycbz67t6RsbO7pdx9Qupf2BFZU4OEOvq_Je1Tqn2Dsldjz5ELiNjQPglVY1jAyOIuvCk/exec";
const ADMIN_CREDENTIALS = { user: "admin", pass: "sunafil2026" };
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
    const f = document.getElementById('file_input').files[0];
    if (f) {
        document.getElementById('file_label').innerHTML = `<span class="text-blue-600 font-bold underline">CARGADO: ${f.name}</span>`;
    }
}

// 5. PROCESAMIENTO DE DATOS TR5
async function processData(showUI = true) {
    const file = document.getElementById('file_input').files[0];
    if (!file) return alert("Seleccione un archivo");
    document.getElementById('loader').style.display = 'block';

    try {
        const text = await readAsIso(file);
        const lines = text.split(/\r?\n/);
        
        // Extraer info de cabecera
        const info = {};
        lines.slice(0, 20).forEach(l => {
            if (l.includes(":")) {
                const parts = l.split(":");
                info[parts.shift().trim()] = parts.join(":").trim();
            }
        });
        
        // Llamar a la función de renderizado de cabecera
        if (typeof renderInfoBox === "function") renderInfoBox(info);

        const isDelimiter = (l) => l.trim().length > 0 && l.trim().replace(/=/g, "") === "";
        const eqPoints = [];
        lines.forEach((l, i) => { if (isDelimiter(l)) eqPoints.push(i); });

        const splitPipe = (l) => {
            let p = l.split('|').map(x => x.trim());
            while (p.length > 0 && p[p.length - 1] === "") p.pop();
            if (p.length > 0 && p[0] === "") p.shift(); // Corregido .length
            return p;
        }

        const originalCols = splitPipe(lines.slice(eqPoints[0] + 1, eqPoints[1]).reduce((a, b) => a.length > b.length ? a : b));
        const findIndex = (str) => originalCols.findIndex(c => c.toUpperCase().includes(str));

        // Mapeo de filas
        globalRows = lines.slice(eqPoints[1] + 1).filter(l => l.includes('|')).map((l, index) => {
            let p = splitPipe(l), row = {};
            row["N°"] = index + 1;
            row["Tipo Doc."] = p[findIndex("TIPO")] || "";
            row["Nro Doc."] = p[findIndex("NÚMERO")] || "";
            row["Apellidos y Nombres"] = `${p[findIndex("PATERNO")] || ""} ${p[findIndex("MATERNO")] || ""} ${p[findIndex("NOMBRES")] || ""}`.trim().replace(/\s+/g, " ");
            row["Fecha de Ingreso"] = p[findIndex("FEC. INICIO")] || "";
            row["Ocupacion"] = p[findIndex("OCUPACIÓN")] || "";

            originalCols.forEach((col, i) => {
                const handled = ["TIPO", "NÚMERO", "FEC. INICIO", "PATERNO", "MATERNO", "NOMBRES", "OCUPACIÓN"];
                if (!handled.some(k => col.toUpperCase().includes(k))) { row[col] = p[i] || ""; }
            });
            return row;
        });

        globalCols = ["N°", "Tipo Doc.", "Nro Doc.", "Apellidos y Nombres", "Fecha de Ingreso", "Ocupacion"];
        originalCols.forEach(c => {
            const handled = ["TIPO", "NÚMERO", "FEC. INICIO", "PATERNO", "MATERNO", "NOMBRES", "OCUPACIÓN"];
            if (!handled.some(k => c.toUpperCase().includes(k))) globalCols.push(c);
        });

        if (showUI) {
            drawTable(globalRows, globalCols);
            document.getElementById('preview_section').classList.remove('hidden');
        }
        
        registrarEnDrive("VISUALIZACIÓN");

    } catch (error) {
        alert("Error: " + error.message);
    } finally {
        document.getElementById('loader').style.display = 'none';
    }
}

// RENDERIZADO DE INTERFAZ
function renderInfoBox(data) {
    const container = document.getElementById('company_list');
    if (!container) return;
    container.innerHTML = Object.entries(data).map(([k, v]) => {
        return `<div><span class="text-[#003366] font-black">${k}:</span> <span class="text-slate-600 font-medium">${v}</span></div>`;
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
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: 10 },
            scales: {
                y: { beginAtZero: true,
                    grid: {color: 'rgba(200,200,200,0.2'}
                 },
                x: { ticks: { autoSkip: false, maxRotation: 0, minRotation: 0 },
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