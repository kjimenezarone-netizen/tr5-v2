const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const parser = require('../file-parser.js');
const tr = require('../tr-analysis.js');
const filters = require('../tr-filters.js');

const sameRuc = 'NRO DE RUC: 20123456789';
const tr5 = parser.parse([
  'TR5: reporte', sameRuc,
  'Tipo|Número|Apellido paterno|Apellido materno|Nombres|Ocupación|Centro',
  '01|000123|García|Pérez|María|Operario|Sede Norte',
  '01|000123|García|Pérez|María|Supervisora|Sede Sur',
  '04|000999|Guzmán|Rojas|Pedro|Operario|Sede Este',
  '01|000456|López|Jiménez|Ana|Técnica|Sede Oeste'
].join('\n'),'tr5.txt');
const tr6 = parser.parse([
  'TR6: reporte', sameRuc,
  'Tipo|Número|Apellido paterno|Apellido materno|Nombres|Cargo|Plan',
  '01|000123|García|Pérez|María|Auxiliar|SNP',
  '04|000999|Guzmán|Rojas|Pedro|Operario|AFP'
].join('\n'),'tr6.txt');
const analysis = tr.build([tr5,tr6]);
const maria = analysis.people.find(p=>p.number==='000123');
const pedro = analysis.people.find(p=>p.number==='000999');

const select = options => analysis.people.filter(person => filters.matchesWorker(person, options));

test('Filtros del cruce: apellido sin tildes, tipo, ocupación y campo original combinados', () => {
  assert.equal(analysis.people.length,3);
  assert.deepEqual(select({query:'garcia',field:'surname'}),[maria]);
  assert.deepEqual(select({query:'MARIA',field:'names',documentType:'01',occupation:'SUPERVISORA'}),[maria]);
  assert.deepEqual(select({query:'000999',field:'document',occupation:'Operario'}),[pedro]);
  assert.deepEqual(select({documentType:'04',occupation:'operario'}),[pedro]);
  assert.deepEqual(select({query:'sede sur',field:'raw:TR5:6',documentType:'01',occupation:'operario'}),[maria]);
  assert.deepEqual(select({query:'GARCIA',field:'surname',documentType:'04',occupation:'Operario'}),[]);
  assert.deepEqual(select({query:'GARCIA',field:'names'}),[],'Apellidos no coinciden con nombres');
  assert.deepEqual(select({occupation:'AUXILIAR'}),[maria],'La ocupación de TR6 también puede usarse');
  assert.equal(filters.matchesWorker(maria,{query:'GARCIA',field:'raw:TR5:3'}),false,'No se debe cruzar una columna distinta');
});

test('Valores de los selectores: tipos y ocupaciones reales, sin listas codificadas', () => {
  const docs = filters.documentTypes(analysis);
  assert.deepEqual(docs,['01','04']);
  assert.deepEqual(filters.occupations(analysis),['Auxiliar','Operario','Supervisora','Técnica']);
  const fields = filters.searchableFields(analysis);
  assert.ok(fields.some(x=>x.value==='raw:TR5:5' && x.label.includes('Ocupación')));
  assert.ok(fields.some(x=>x.value==='raw:TR6:5' && x.label.includes('Cargo')));
  assert.equal(filters.occupations(tr.build([parser.parse('TR5: reporte\nTipo|Número|Apellido paterno|Nombres\n01|1|A|B','sin-ocupacion')])).length,0);
});

test('Excel del cruce filtrado conserva todas las filas y columnas originales del trabajador', () => {
  const originals = [tr5,tr6].map(d=>d.records.map(r=>r.rawLine));
  const filtered = select({query:'garcia',field:'surname',documentType:'01',occupation:'Supervisora'});
  const selected = tr.scope(analysis,'filtered',new Set(),filtered,null);
  assert.equal(selected.length,1);
  const sheets = tr.sheets(analysis,selected,{intendencia:'TEST',scope:'Resultados filtrados',query:'garcia',filter:'DNI · Supervisora'});
  const tr5Original = sheets.find(s=>s.name==='TR5 Original');
  const tr6Original = sheets.find(s=>s.name==='TR6 Original');
  assert.equal(tr5Original.rows.length,3,'Se conservan ambas filas TR5 de María');
  assert.equal(tr6Original.rows.length,2,'Se conserva su fila TR6');
  assert.equal(tr5Original.rows[0].length,7);
  assert.equal(tr6Original.rows[0].length,7);
  assert.equal(tr5Original.rows[1][1],'000123','Ceros iniciales intactos');
  assert.equal(tr5Original.rows[1][5],'Operario','Se conserva la fila de otra ocupación de la misma persona');
  assert.equal(tr5Original.rows[2][5],'Supervisora');
  assert.equal(sheets.find(s=>s.name==='Fuentes').rows.length,4,'Trazabilidad de todas las filas');
  assert.deepEqual([tr5,tr6].map(d=>d.records.map(r=>r.rawLine)),originals,'No modificar fuentes');
  assert.equal(analysis.people.length,3,'No eliminar trabajadores del análisis original');
});

test('Filtros de interfaz ubicados dentro del cruce, sin duplicarse en originales', () => {
  const html = fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  const originalStart = html.indexOf('<!-- PASO 2: Registros originales -->');
  const crossStart = html.indexOf('<!-- PASO 3: Trabajadores -->');
  const exportStart = html.indexOf('<!-- PASO 4: Centro de exportación -->');
  assert.ok(originalStart>=0 && crossStart>originalStart && exportStart>crossStart);
  for (const id of ['tr-worker-field','tr-worker-type','tr-worker-occupation','tr-person-search','tr-export-current-filter','tr-cross-filter-clear']) {
    const mark=`id="${id}"`;
    assert.equal(html.split(mark).length-1,1,`${id} debe aparecer una vez`);
    assert.ok(html.indexOf(mark)>crossStart && html.indexOf(mark)<exportStart, `${id} debe estar en Cruce Inspectivo`);
  }
  for (const legacy of ['filter_tipo','filter_ocupacion','filter_columna']) {
    assert.equal(html.includes(`id="${legacy}"`),false, `${legacy} no debe mantenerse como filtro de registros originales`);
  }
  assert.ok(html.includes('id="tr-scope-filtered"'));
  const js = fs.readFileSync(path.join(__dirname,'../tr-export.js'),'utf8');
  assert.ok(js.includes("hasWorkerOccupation") && js.includes("hasWorkerType"));
  assert.ok(js.includes('TRAnalysis.sheets('));
});

test('Muestras aportadas: filtro combinado por apellido, DNI y oficio conserva la multiplicidad', () => {
  const base=path.join(__dirname,'../muestras');
  const real5=parser.parse(parser.decode(fs.readFileSync(path.join(base,'muestra_TR5_ACELIM.txt'))).text,'muestra_TR5');
  const real6=parser.parse(parser.decode(fs.readFileSync(path.join(base,'muestra_TR6_ACELIM.txt'))).text,'muestra_TR6');
  const real=tr.build([real5,real6]);
  assert.ok(filters.occupations(real).includes('PEON AGRICOLA'));
  assert.ok(filters.documentTypes(real).includes('L.E / DNI'));
  const workers=real.people.filter(p=>filters.matchesWorker(p,{
    query:'ALAMA',field:'surname',documentType:'L.E / DNI',occupation:'PEON AGRICOLA'
  }));
  assert.equal(workers.length,1);
  assert.equal(workers[0].TR5.length,2);
  assert.equal(workers[0].TR6.length,1);
  const pages=tr.sheets(real,workers,{intendencia:'PRUEBA',scope:'filtrado',query:'ALAMA',filter:'PEON AGRICOLA'});
  assert.equal(pages.find(s=>s.name==='TR5 Original').rows.length,3);
  assert.equal(pages.find(s=>s.name==='TR6 Original').rows.length,2);
  assert.equal(real5.records.length,6);
  assert.equal(real6.records.length,121);
});
