/** Contratos de interfaz tras aplicar el kit en el repositorio.
 * Ejecutar con node --test; solo lee el código, no requiere navegador.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('Orden del lector: carga -> originales -> trabajadores -> Excel', () => {
  const html = read('index.html');
  const steps = [
    'id="page-procesador"',
    '<!-- PASO 2: Registros originales -->',
    '<!-- PASO 3: Trabajadores -->',
    'id="tr-export-center"',
  ];
  const positions = steps.map(s => html.indexOf(s));
  assert.ok(positions.every(n => n > -1), 'Falta alguna sección esencial');
  assert.deepEqual([...positions].sort((a,b)=>a-b), positions);
  assert.equal((html.match(/id="tr-export-center"/g)||[]).length, 1);
  assert.equal((html.match(/id="tr-export-scope"/g)||[]).length, 1);
  assert.equal((html.match(/id="tr-export-download"/g)||[]).length, 1);
});

test('El selector de columnas visuales TR y exportación redundante desaparecen; las funciones de Excel se mantienen', () => {
  const html = read('index.html');
  const js = read('script.js');
  const exportJs = read('tr-export.js');
  assert.ok(!html.includes('id="tr-column-options"'));
  assert.ok(!html.includes('id="btn_download_excel"'));
  assert.ok(!js.includes('ColumnChooser.mount(\'tr-column-options\''));
  assert.ok(js.includes('const cols = AppState.globalCols;'));
  for (const id of ['tr-export-prepare','tr-export-download','tr-export-details','tr-reset-all','tr-reset-all-bottom','ruc-reset-all']) {
    assert.ok(html.includes(`id="${id}"`), `${id} ausente`);
  }
  assert.ok(exportJs.includes('TRAnalysis.sheets('));
  assert.ok(exportJs.includes('XLSX.writeFile('));
  assert.ok(!exportJs.includes('quickDownload()'));
});

test('Limpiar selección TR no borra datasets; limpiar todo requiere confirmación', () => {
  const script = read('script.js');
  const elements = new Map();
  const node = id => {
    if (!elements.has(id)) {
      const states = new Set();
      elements.set(id, {
        id, value: '', textContent: '', disabled: false,
        children: ['simulado'],
        classList: {
          add: cls => states.add(cls),
          remove: cls => states.delete(cls),
          contains: cls => states.has(cls),
        },
        replaceChildren(...children) { this.children = children; },
      });
    }
    return elements.get(id);
  };
  let confirmed = false;
  let resetView = 0;
  let invalidate = 0;
  const context = vm.createContext({
    window: { confirm: () => confirmed, chartFileTipo: null, chartFileOcup: null },
    document: { getElementById: node, addEventListener() {} },
    sessionStorage: { getItem: () => null, removeItem() {} },
    localStorage: { getItem: () => null, setItem() {} },
    ColumnChooser: { reset() {} },
    TRView: { reset() { resetView++; } },
    TRExport: { invalidate() { invalidate++; } },
    Option: class { constructor(text, value) { this.text=text; this.value=value; } },
    console, setTimeout, clearTimeout,
  });
  vm.runInContext(script + '\nglobalThis.__appState=AppState;globalThis.__ui=UI;', context);
  const st = context.__appState;
  node('file_input').value = 'C:/archivo.txt';
  st.trDatasets = [{ id: 1 }]; st.globalRows = [{ x: 1 }]; st.currentFilteredRows = st.globalRows;
  context.__ui.clearFile();
  assert.equal(node('file_input').value, '');
  assert.equal(st.trDatasets.length, 1, 'Quitar selección no debe borrar el análisis');
  assert.equal(st.globalRows.length, 1);
  context.__ui.resetWorkspaceTR();
  assert.equal(st.globalRows.length, 1, 'Cancelar confirmación conserva todo');
  confirmed = true;
  context.__ui.resetWorkspaceTR();
  assert.equal(st.globalRows.length, 0);
  assert.equal(st.trDatasets.length, 0);
  assert.equal(st.currentFilteredRows.length, 0);
  assert.ok(node('preview_section').classList.contains('hidden'));
  assert.ok(node('file_metrics_container').classList.contains('hidden'));
  assert.equal(node('tr-reset-all-bottom').disabled, true);
  assert.equal(resetView, 1);
  assert.ok(invalidate > 0);
});

test('Limpieza RUC explícita y descarga sin controles de selección', () => {
  const js = read('ruc.js');
  assert.match(js, /ruc-reset-all.*addEventListener\('click'/);
  assert.ok(js.includes('model = RucModel.consolidate([]);'));
  assert.ok(js.includes('el(\'ruc-files\').value = \'\';'));
  assert.ok(!js.includes('ColumnChooser.reset(\'ruc-records\');'));
  assert.ok(js.includes("el('ruc-download').addEventListener('click'"));
  assert.ok(js.includes('window.confirm('));
  assert.ok(js.includes('el(\'ruc-files\').value = \'\'; // No elimina el modelo'));
});
