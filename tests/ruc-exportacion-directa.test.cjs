const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const RucModel = require('../ruc.js');

const source = {
    zipId: 0, zipName: 'RM2026.zip', entryName: 'RM2026.txt', encoding: 'UTF-8',
    dataset: {
        columns: [
            { label: 'NumeroRuc', rawHeader: 'NumeroRuc', index: 0 },
            { label: 'Razón social', rawHeader: 'RazonSocial', index: 1 },
            { label: 'Estado', rawHeader: 'Estado', index: 2 }
        ],
        records: [
            { rawCells: ['20123456789', 'EMPRESA NORTE', 'ACTIVO'], rawLine: '20123456789|EMPRESA NORTE|ACTIVO', sourceRow: 2 },
            { rawCells: ['20987654321', 'EMPRESA SUR', 'SUSPENDIDO'], rawLine: '20987654321|EMPRESA SUR|SUSPENDIDO', sourceRow: 3 },
            { rawCells: ['20123456789', 'EMPRESA NORTE', 'BAJA'], rawLine: '20123456789|EMPRESA NORTE|BAJA', sourceRow: 4 },
            { rawCells: ['', 'SIN RUC', 'ACTIVO'], rawLine: '|SIN RUC|ACTIVO', sourceRow: 5 }
        ]
    }
};

const model = RucModel.consolidate([source]);

test('RUC: la descarga sin filtros conserva todos los registros, incluso duplicados y sin RUC', () => {
    const rows = RucModel.exportForView(model, [model.records[1]], '', 'all');
    assert.equal(rows.length, 4);
    assert.deepEqual(rows, model.records);
    assert.notStrictEqual(rows, model.records);
    const sheets = RucModel.exportSheets(rows, { scope: 'Todos los registros originales', intendencia: 'PRUEBA', query: '', filter: 'Todos los registros', consolidated: false });
    assert.deepEqual(sheets.map(s => s.name), ['Resumen', 'Original_1', 'Fuentes']);
    assert.equal(sheets[1].rows.length, 5);
    assert.deepEqual(sheets[1].rows[0], ['NumeroRuc', 'RazonSocial', 'Estado']);
    assert.deepEqual(sheets[1].rows[2], ['20987654321', 'EMPRESA SUR', 'SUSPENDIDO']);
    assert.deepEqual(sheets[1].rows[4], ['', 'SIN RUC', 'ACTIVO']);
    assert.equal(sheets[2].rows.length, 5);
    assert.deepEqual(sheets[2].rows[1].slice(1,3), ['RM2026.zip', 'RM2026.txt']);
    assert.equal(sheets[2].rows[4][4], 5);
});

test('RUC: una búsqueda o filtro de la sección 2 limita la descarga, sin mutar las fuentes', () => {
    const before = model.records.map(r => r.rawLine);
    const byName = model.records.filter(r => r.rawCells.some(v => v.includes('NORTE')));
    const rucRepeated = model.records.filter(r => model.repeated.has(r.ruc));
    assert.deepEqual(RucModel.exportForView(model, byName, 'NORTE', 'all'), [model.records[0], model.records[2]]);
    assert.deepEqual(RucModel.exportForView(model, rucRepeated, '', 'repeated'), [model.records[0], model.records[2]]);
    assert.deepEqual(RucModel.exportForView(model, [], 'NINGUNO', 'all'), []);
    assert.equal(RucModel.exportForView(model, [], '   ', 'all').length, 4);
    assert.deepEqual(model.records.map(r => r.rawLine), before);
});

function makeElement(tag = 'div') {
    const classes = new Set(['hidden']);
    const listeners = new Map();
    return {
        tag, children: [], files: [], options: [], value: '', disabled: false, textContent: '',
        classList: {
            add(v) { classes.add(v); },
            remove(v) { classes.delete(v); },
            toggle(v, yes) { if (yes) classes.add(v); else classes.delete(v); },
            contains(v) { return classes.has(v); }
        },
        addEventListener(name, fn) { listeners.set(name, fn); },
        async trigger(name) {
            const handler = listeners.get(name);
            assert.equal(typeof handler, 'function', `No existe evento ${name} en ${tag}`);
            return handler();
        },
        appendChild(x) { this.children.push(x); return x; },
        replaceChildren(...xs) { this.children = xs; },
        setAttribute(k, v) { this[k] = v; },
        focus() {}
    };
}

test('RUC: flujo de interfaz real descarga directamente sin previsualizar ni limpiar sesión', async () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'ruc.js'), 'utf8');
    const elements = new Map();
    const get = id => {
        if (!elements.has(id)) elements.set(id, makeElement(id));
        return elements.get(id);
    };
    const writes = [];
    const events = [];
    const documentListeners = new Map();
    const mockDocument = {
        getElementById: get,
        createElement: tag => makeElement(tag),
        addEventListener(type, cb) { documentListeners.set(type, cb); }
    };
    get('ruc-view').value = 'records';
    get('ruc-filter').value = 'all';
    // Emula la propiedad de los selectores HTML consultada por la descarga.
    Object.defineProperty(get('ruc-filter'), 'selectedOptions', {
        get() { return [{ textContent: this.value === 'all' ? 'Todos los registros' : 'RUC repetidos' }]; }
    });
    get('ruc-files').files = [{ name: 'RM2026.txt', size: 130 }];
    const workbookApi = {
        book_new: () => ({ sheets: new Map() }),
        aoa_to_sheet: rows => ({ rows }),
        book_append_sheet: (wb, ws, name) => wb.sheets.set(name, ws)
    };
    let confirm = false;
    const context = vm.createContext({
        document: mockDocument,
        window: { confirm: () => confirm },
        console,
        performance: { now: () => 10 },
        UI: { requireIntendencia: () => true },
        AppState: { intendencia: 'PRUEBA' },
        Processing: { async run() { return { model, issues: [], rejectedSources: 0 }; }, cancel() {} },
        SheetsAPI: { event(name, data) { events.push({ name, data }); } },
        XLSX: { utils: workbookApi, writeFile(wb, name) { writes.push({ wb, name }); } }
    });
    vm.runInContext(src, context);
    assert.ok(documentListeners.has('DOMContentLoaded'));
    documentListeners.get('DOMContentLoaded')();
    assert.equal(get('ruc-download').disabled, true);
    await get('ruc-load').trigger('click');
    assert.equal(get('ruc-download').disabled, false);
    assert.equal(get('ruc-files').value, '', 'La carga válida deja libre el selector');

    await get('ruc-download').trigger('click');
    assert.equal(writes.length, 1);
    assert.equal(writes[0].name, 'RUC_PRUEBA.xlsx');
    assert.equal(writes[0].wb.sheets.get('Original_1').rows.length, 5);
    assert.equal(writes[0].wb.sheets.get('Fuentes').rows.length, 5);
    assert.equal(get('ruc-download').disabled, false, 'La descarga no debe cerrar el trabajo');
    assert.equal(get('ruc-page').textContent, '4 registros · Página 1 de 1');

    get('ruc-search').value = 'NORTE';
    await get('ruc-search').trigger('input');
    assert.equal(get('ruc-export-hint').textContent, 'Descargar resultado filtrado: 2 registros de la sección 2.');
    await get('ruc-download').trigger('click');
    assert.equal(writes.length, 2);
    assert.equal(writes[1].wb.sheets.get('Original_1').rows.length, 3);
    assert.equal(writes[1].wb.sheets.get('Fuentes').rows.length, 3);
    assert.equal(get('ruc-page').textContent, '2 registros · Página 1 de 1');

    get('ruc-search').value = '';
    await get('ruc-search').trigger('input');
    get('ruc-filter').value = 'repeated';
    await get('ruc-filter').trigger('change');
    await get('ruc-download').trigger('click');
    assert.equal(writes.length, 3);
    assert.equal(writes[2].wb.sheets.get('Original_1').rows.length, 3);

    await get('ruc-reset-all').trigger('click');
    assert.equal(get('ruc-page').textContent, '2 registros · Página 1 de 1', 'Cancelar el reinicio conserva resultados');
    confirm = true;
    await get('ruc-reset-all').trigger('click');
    assert.equal(get('ruc-download').disabled, true);
    assert.equal(get('ruc-page').textContent, 'Sin resultados');
    assert.equal(get('ruc-filter').value, 'all');
    assert.equal(writes.length, 3, 'Los libros ya descargados no se modifican');
    assert.equal(events.filter(e => e.name === 'DESCARGAR_EXCEL').length, 3);
});
