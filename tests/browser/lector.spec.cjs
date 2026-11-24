const { test, expect } = require('@playwright/test');
const path = require('node:path');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const fixtures = path.resolve(__dirname, '../../muestras');
const rucTxt = 'NumeroRuc|Razon social|Estado\n20123456789|EMPRESA NORTE|ACTIVO\n20987654321|EMPRESA SUR|ACTIVO\n20123456789|EMPRESA NORTE|BAJA\n|SIN RUC|ACTIVO';

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.locator('#intendencia').selectOption('IRE-LAMBAYEQUE');
});

async function loadTR(page) {
    await page.locator('#nav_procesador').click();
    await page.locator('#file_input').setInputFiles([
        path.join(fixtures, 'TR5_sintetico.txt'), path.join(fixtures, 'TR6_sintetico.txt')
    ]);
    await page.locator('#btn_process_data').click();
    await expect(page.locator('#tr-processing-status')).toContainText('Carga finalizada');
}

async function loadRUC(page, file) {
    await page.locator('#nav_ruc').click();
    await page.locator('#ruc-files').setInputFiles(file);
    await page.locator('#ruc-load').click();
    await expect(page.locator('#ruc-status')).toContainText('Carga finalizada');
}

async function workbook(page, click) {
    const [download] = await Promise.all([page.waitForEvent('download'), click()]);
    const book = new ExcelJS.Workbook();
    await book.xlsx.readFile(await download.path());
    return book;
}

test('Cruce TR5/TR6 filtra una persona y conserva todas sus filas originales en Excel', async ({ page }) => {
    const errors = [];
    const external = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
        if (!request.url().startsWith('http://127.0.0.1:8312/') && !request.url().startsWith('blob:')) external.push(request.url());
    });
    await loadTR(page);
    await expect(page.locator('#tr-person-summary')).toContainText('Cruce validado por RUC');
    await page.locator('#tr-person-search').fill('EJEMPLO');
    await expect(page.locator('#tr-cross-filter-summary')).toContainText('3 registros TR5/TR6 asociados');
    await page.locator('#tr-export-current-filter').click();
    await expect(page.locator('#tr-export-sheets')).toContainText('TR5 Original: 2 filas');
    const book = await workbook(page, () => page.locator('#tr-export-download').click());
    expect(book.getWorksheet('Trabajadores').rowCount).toBe(2);
    const tr5 = book.getWorksheet('TR5 Original');
    expect(tr5.rowCount).toBe(3);
    expect(tr5.getCell('B2').value.trim()).toBe('00000001');
    expect(tr5.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(book.getWorksheet('TR6 Original').rowCount).toBe(2);
    expect(book.getWorksheet('Fuentes').rowCount).toBe(4);
    expect(book.getWorksheet('Resumen').getCell('B9').value).toBe(3);
    expect(external).toEqual([]);
    expect(errors).toEqual([]);
});

test('TR conserva la consulta ante una carga rechazada o cancelada y exporta el filtro con su intendencia', async ({ page }) => {
    await loadTR(page);
    await page.locator('#tr-person-search').fill('EJEMPLO');
    await expect(page.locator('#tr-cross-filter-summary')).toContainText('3 registros TR5/TR6 asociados');
    await page.locator('#intendencia').selectOption('IRE-AMAZONAS');
    await page.locator('#file_input').setInputFiles({ name: 'sin-cabecera.txt', mimeType: 'text/plain', buffer: Buffer.from('Formato sintético incorrecto') });
    await page.locator('#btn_process_data').click();
    await expect(page.locator('#tr-processing-status')).toContainText('Se conserva la consulta anterior');
    await expect(page.locator('#tr-person-search')).toHaveValue('EJEMPLO');
    await expect(page.locator('#tr-person-summary')).toContainText('IRE-LAMBAYEQUE');

    let releaseWorker;
    const pendingWorker = new Promise(resolve => { releaseWorker = resolve; });
    await page.route('**/processing-worker.js', async route => {
        await pendingWorker;
        await route.continue().catch(() => {});
    });
    try {
        await page.locator('#file_input').setInputFiles(path.join(fixtures, 'TR5_sintetico.txt'));
        await page.locator('#btn_process_data').click();
        await page.locator('#tr-cancel').click();
        await expect(page.locator('#tr-processing-status')).toContainText('Operación cancelada. Se conserva la consulta anterior.');
        await expect(page.locator('#tr-person-search')).toHaveValue('EJEMPLO');
    } finally {
        releaseWorker();
    }

    await page.locator('#tr-direct-download-excel').click();
    await expect(page.locator('#tr-export-scope')).toHaveValue('filtered');
    await expect(page.locator('#tr-export-scope')).toBeFocused();
    await expect(page.locator('#tr-export-preview')).toBeHidden();
    await expect(page.locator('#tr-export-download')).toHaveText('Descargar 1 trabajador');
    const book = await workbook(page, () => page.locator('#tr-export-download').click());
    expect(book.getWorksheet('Trabajadores').rowCount).toBe(2);
    expect(book.getWorksheet('Resumen').getCell('B2').value).toBe('IRE-LAMBAYEQUE');
});

test('RUC lee ZIP y descarga el conjunto completo o filtrado', async ({ page }) => {
    const zip = await new JSZip().file('muestra-ruc.txt', rucTxt).generateAsync({ type: 'nodebuffer' });
    await loadRUC(page, { name: 'muestra-ruc.zip', mimeType: 'application/zip', buffer: zip });
    const all = await workbook(page, () => page.locator('#ruc-download').click());
    expect(all.getWorksheet('Original_1').rowCount).toBe(5);
    expect(all.getWorksheet('Original_1').getCell('A5').value).toBe('');
    expect(all.getWorksheet('Fuentes').getCell('C2').value).toBe('muestra-ruc.txt');
    await page.locator('#ruc-search').fill('EMPRESA SUR');
    const filtered = await workbook(page, () => page.locator('#ruc-download').click());
    expect(filtered.getWorksheet('Original_1').rowCount).toBe(2);
    expect(filtered.getWorksheet('Original_1').getCell('A2').value).toBe('20987654321');
});

test('RUC conserva el filtro y la intendencia después de rechazar otro archivo', async ({ page }) => {
    const buffer = Buffer.from(rucTxt.replace('EMPRESA SUR', 'EMPRESA PERÚ'));
    await loadRUC(page, { name: 'ruc-sintetico.txt', mimeType: 'text/plain', buffer });
    await page.locator('#ruc-search').fill('PERU');
    await expect(page.locator('#ruc-export-hint')).toContainText('1 registro de la sección 2');
    await page.locator('#intendencia').selectOption('IRE-AMAZONAS');
    await page.locator('#ruc-files').setInputFiles({ name: 'formato-incorrecto.txt', mimeType: 'text/plain', buffer: Buffer.from('Formato sintético incorrecto') });
    await page.locator('#ruc-load').click();
    await expect(page.locator('#ruc-status')).toContainText('Se conserva la consulta anterior');
    await expect(page.locator('#ruc-metrics')).toContainText('IRE-LAMBAYEQUE');
    await expect(page.locator('#ruc-search')).toHaveValue('PERU');
    const book = await workbook(page, () => page.locator('#ruc-download').click());
    expect(book.getWorksheet('Resumen').getCell('B2').value).toBe('IRE-LAMBAYEQUE');
    expect(book.getWorksheet('Original_1').rowCount).toBe(2);
    expect(book.getWorksheet('Original_1').getCell('B2').value).toBe('EMPRESA PERÚ');
});

test('Cancelar una exportación permite solicitar el Excel de nuevo', async ({ page }) => {
    await loadRUC(page, { name: 'muestra.txt', mimeType: 'text/plain', buffer: Buffer.from(rucTxt) });
    let hold = true;
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    await page.route('**/export-worker.js', async route => {
        if (hold) await pending;
        await route.continue().catch(() => {});
    });
    await page.locator('#ruc-download').click();
    await page.locator('#ruc-export-cancel').click();
    await expect(page.locator('#ruc-export-status')).toHaveText('Operación cancelada.');
    hold = false;
    release();
    const book = await workbook(page, () => page.locator('#ruc-download').click());
    expect(book.getWorksheet('Original_1').rowCount).toBe(5);
});

test('El cierre del panel limpia consultas TR y RUC y muestra los tipos de evento correctos', async ({ page }) => {
    await loadTR(page);
    await loadRUC(page, { name: 'muestra.txt', mimeType: 'text/plain', buffer: Buffer.from(rucTxt) });
    await page.evaluate(() => {
        document.getElementById('nav_dashboard').hidden = false;
        SheetsAPI.request = async ({ accion }) => {
            if (accion === 'LOGIN') return { status: 'ok', token: 'test-sintetico', expires: Date.now() + 60000 };
            if (accion === 'DASHBOARD') return {
                status: 'ok', mode: 'INSTITUTIONAL', visualizaciones: {}, descargas: { 'IRE-LAMBAYEQUE': 1 },
                ultimosRegistros: [{ fecha: '23/11/2026', intendencia: 'IRE-LAMBAYEQUE', accion: 'ERROR' }]
            };
            return { status: 'ok' };
        };
    });
    await page.locator('#nav_dashboard').click();
    await page.locator('#btn_login_submit').click();
    await expect(page.locator('#audit-tbody')).toContainText('Error de procesamiento');
    const [report] = await Promise.all([page.waitForEvent('download'), page.locator('#btn_report_pdf').click()]);
    expect(report.suggestedFilename()).toMatch(/\.pdf$/);
    await page.locator('#btn_logout').click();
    await expect(page.locator('#page-inicio')).toBeVisible();
    await expect(page.locator('#ruc-page')).toHaveText('Sin resultados');
    expect(await page.evaluate(() => ({
        resultsTR: AppState.trDatasets.length,
        model: TRView.analysis,
        snapshot: TRExport.snapshot,
        session: AppState.sessionToken
    }))).toEqual({ resultsTR: 0, model: null, snapshot: null, session: null });
});
