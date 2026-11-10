/* Copiar este archivo a tests/ del proyecto después de aplicar el parche.
   Ejecutar: node --test tests/ui-carga-regresion.test.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const repo = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(repo, file), 'utf8');

function element(value = '') {
    const classes = new Set();
    return {
        value, textContent: 'Mensaje anterior', options: [], children: ['tarjeta'],
        classList: {
            add(c) {classes.add(c);}, remove(c) {classes.delete(c);},
            toggle(c, on) {if (on) classes.add(c); else classes.delete(c);},
            contains(c) {return classes.has(c);}
        },
        replaceChildren(...items) {this.children = items;}
    };
}

test('TR: limpiar selección no borra tablas, fichas, reportes ni archivos en memoria', () => {
    const src = read('script.js');
    const start = src.indexOf('    resetFileSelection() {');
    const end = src.indexOf('    clearFile(event) {', start);
    assert.ok(start >= 0 && end > start, 'Existe función separada para la limpieza');
    const body = src.slice(start, end).trim().replace(/,\s*$/, '');
    const ids = ['file_input','file-cards','file_status','label-content-default','file-info-container'];
    const nodes = new Map(ids.map(id => [id, element(id === 'file_input' ? 'TR5.txt' : '')]));
    nodes.get('file-info-container').classList.add('flex');
    nodes.get('label-content-default').classList.add('hidden');
    const state = { people: [{ id: '01-00123' }], sheets: ['Resumen', 'TR5 Original'] };
    const dom = {getElementById(id) {return nodes.get(id)}};
    const reset = new Function('document', `return ({${body}}).resetFileSelection;`)(dom);
    reset();
    assert.equal(nodes.get('file_input').value, '');
    assert.deepEqual(nodes.get('file-cards').children, []);
    assert.equal(nodes.get('file_status').textContent, '');
    assert.equal(nodes.get('label-content-default').classList.contains('hidden'), false);
    assert.equal(nodes.get('file-info-container').classList.contains('hidden'), true);
    assert.deepEqual(state.people, [{id:'01-00123'}]);
    assert.deepEqual(state.sheets, ['Resumen', 'TR5 Original']);
    assert.match(src, /TRView\.set\(analysis\);[\s\S]*?UI\.resetFileSelection\(\)/);
    assert.doesNotMatch(src, /TRView\.set\(analysis\);\s*UI\.clearFile\(/);
});

test('RUC: solo se limpia input si hubo fuentes válidas, sin tocar modelo', () => {
    const src = read('ruc.js');
    const start = src.indexOf('            if (model.sources.length > 0) {');
    const end = src.indexOf('\n            }\n', start);
    assert.ok(start >= 0 && end > start, 'Existe rama de carga exitosa');
    const fragment = src.slice(start, end + '\n            }'.length);
    const file = element('consulta_2026.zip');
    const model = {sources: []};
    const statuses = [];
    const execute = new Function('model','el','status','sources','issues', fragment);
    execute(model, () => file, s => statuses.push(s), [], ['Archivo inválido']);
    assert.equal(file.value, 'consulta_2026.zip', 'En lote inválido se permite corregir/reintentar');
    assert.match(statuses.at(-1), /No se procesó/);
    model.sources = [{id:1}];
    execute(model, () => file, s => statuses.push(s), model.sources, []);
    assert.equal(file.value, '', 'Lote válido libera el input TXT/ZIP');
    assert.equal(model.sources.length, 1, 'Las fuentes procesadas continúan en memoria');
});

test('RUC: flujo simplificado de tres pasos y descarga directa sin previsualización', () => {
    const html = read('index.html');
    const js = read('ruc.js');
    const start = html.indexOf('<main id="page-ruc"');
    const end = html.indexOf('<main id="page-procesador"');
    assert.ok(start >= 0 && end > start);
    const ruc = html.slice(start, end);
    for (const legacy of [
        'ruc-diagnostic-prepare', 'ruc-diagnostic-preview', 'ruc-select-filtered',
        'ruc-clear-selection', 'ruc-selection-count', 'ruc-column-control',
        'ruc-column-options', 'ruc-export-scope', 'ruc-export-zip',
        'ruc-export-preview', 'ruc-preview-button', 'ruc-detail-export'
    ]) {
        assert.ok(!ruc.includes(`id="${legacy}"`), `${legacy} no debe aparecer en RUC`);
        assert.ok(!js.includes(`el('${legacy}')`), `${legacy} no debe tener manejadores activos`);
    }
    assert.match(ruc, /id="ruc-export-hint"/);
    assert.match(ruc, /id="ruc-download"/);
    assert.match(ruc, /Descargar Excel/);
    assert.match(js, /RucModel\.exportForView\(model, filtered, query, mode\)/);
    const select = ruc.slice(ruc.indexOf('<select id="ruc-filter"'),ruc.indexOf('</select>',ruc.indexOf('<select id="ruc-filter"')));
    assert.match(select, /value="all"/);
    assert.match(select, /value="repeated"/);
    assert.doesNotMatch(select, /value="selected"|value="differences"/);
});

test('TR: tarjetas rápidas sin opciones duplicadas; exportar respeta su selección', () => {
    const html = read('index.html');
    const dropdown = html.slice(html.indexOf('<select id="tr-person-filter"'), html.indexOf('</select>',html.indexOf('<select id="tr-person-filter"')));
    for (const filter of ['multiple','no_cuspp','no_sctr']) {
        assert.doesNotMatch(dropdown, new RegExp(`value="${filter}"`));
        assert.match(html, new RegExp(`data-filter="${filter}"`));
    }
    assert.match(read('tr-export.js'), /TRView\.activeQuickFilter !== 'all'/);
    assert.match(read('tr-analysis.js'), /TRExport\.invalidate\(\);\s*TRView\.page = 0;\s*TRView\.render\(\);/);
    assert.match(html, /id="ruc-download"/);
});
