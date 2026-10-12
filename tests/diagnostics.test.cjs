const assert=require('node:assert/strict');
const fs=require('node:fs');
const parser=require('../file-parser.js');
const diagnostics=require('../diagnostics.js');
const dataset=parser.parse('TR5: reporte\nNRO DE RUC: 20123456789\nTipo|Número|Apellido paterno|Nombres|CABECERA_PRIVADA\n01|00123456|APELLIDO_PRIVADO|NOMBRE_PRIVADO|\n01|00987654|OTRO\n01|00765432|A|B|dato|extra', 'ARCHIVO_PRIVADO.txt');
dataset.encoding='utf-8';
const original=JSON.stringify(dataset);
const report=diagnostics.build([dataset],'TR');
assert.equal(report.processedRecords,3);
assert.equal(report.problematicRows,2);
assert.equal(report.discardedRecords,0);
assert.equal(report.sources[0].retainedColumns,6);
assert.equal(report.sources[0].headerColumns,5);
assert.equal(report.sources[0].columns[4].emptyValues,1);
assert.equal(report.sources[0].columns[4].missingValues,1);
assert.equal(report.sources[0].columns[5].hasHeader,false);
assert.deepEqual(report.sources[0].rowsWithColumnMismatch[0],{row:5,expectedColumns:5,actualColumns:3});
const serialized=JSON.stringify(report);
for(const forbidden of ['20123456789','00123456','00987654','00765432','APELLIDO_PRIVADO','NOMBRE_PRIVADO','ARCHIVO_PRIVADO','CABECERA_PRIVADA','rawLine','rawCells'])assert.equal(serialized.includes(forbidden),false,forbidden);
assert.equal(JSON.stringify(dataset),original);
assert.equal(diagnostics.build([],'RUC',2).rejectedSources,2);
if(process.argv[2]){
 const data=parser.parse(parser.decode(fs.readFileSync(process.argv[2])).text,'private');
 const actual=diagnostics.build([data],'TR');
 assert.equal(actual.processedRecords,122);assert.equal(actual.problematicRows,0);
 console.log('TR5 real: 122 registros y 0 diferencias de cantidad de columnas.');
}
console.log('OK: conteos, filas problemáticas, vacíos frente a ausentes y exclusión de datos identificatorios.');
