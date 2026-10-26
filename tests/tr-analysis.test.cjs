const assert = require('node:assert/strict');
const fs = require('node:fs');
const parser = require('../file-parser.js');
const tr = require('../tr-analysis.js');
const source = (type, rows, ruc = '20123456789') => parser.parse(`${type}: reporte\nNRO DE RUC: ${ruc}\nTipo|Número|Apellido paterno|Apellido materno|Nombres\n${rows}`, `${type}.txt`);
const a = source('TR5', '01|00123|Perez|Soto|Ana\n01|00123|Perez|Soto|Ana\n||Sin||Documento\n||Otro||Registro');
const b = source('TR6', '01|00123|Perez|Soto|Anita\n04|00123|Otro|Soto|Ana\n01|00999|Solo|TR6|Persona');
const result = tr.build([a,b]);
assert.equal(result.people.length, 5);
const person = result.people.find(p => p.type === '01' && p.number === '00123');
assert.equal(person.TR5.length, 2); assert.equal(person.TR6.length, 1);
assert.equal(person.status, 'En ambos'); assert.equal(person.identityDifference, true);
assert.equal(result.people.filter(p => !p.resolved).length, 2);
assert.equal(result.people.find(p => p.type === '04').status, 'Solo TR6');
assert.equal(tr.build([a]).people[0].status, 'Sin contraparte cargada');
assert.throws(() => tr.build([a,a]));
assert.throws(() => tr.build([a,source('TR6','01|1|A|B|C','20999999999')]));
assert.throws(() => tr.build([a,source('TR6','01|1|A|B|C','')]));
if (process.argv.length > 3) {
    const datasets = process.argv.slice(2).map(path => parser.parse(parser.decode(fs.readFileSync(path)).text, 'muestra'));
    const real = tr.build(datasets);
    assert.equal(real.paired, true);
    assert.equal(real.people.reduce((n,p) => n+p.TR5.length+p.TR6.length,0), 243);
    console.log(`Muestras reales: ${real.people.length} identidades, 243 registros conservados, ${real.people.filter(p=>p.status==='En ambos').length} en ambos reportes.`);
}
// Pruebas de compatibilidad con variaciones en nombres de columnas de documentos
const c = parser.parse(`TR5: reporte\nNRO DE RUC: 20123456789\nTipo de Documento|Número de Documento|Apellido paterno|Apellido materno|Nombres\n01|45678901|Gomez|Luna|Carlos`, 'TR5_var1.txt');
const d = parser.parse(`TR6: reporte\nNRO DE RUC: 20123456789\nTipo Doc.|Nro. Documento|Apellido paterno|Apellido materno|Nombres\n01|45678901|Gomez|Luna|Carlos`, 'TR6_var2.txt');
const resultVar = tr.build([c, d]);
assert.equal(resultVar.people.length, 1);
assert.equal(resultVar.people[0].type, '01');
assert.equal(resultVar.people[0].number, '45678901');
assert.equal(resultVar.people[0].status, 'En ambos');
assert.equal(resultVar.people[0].TR5.length, 1);
assert.equal(resultVar.people[0].TR6.length, 1);

console.log('OK: multiplicidad, ceros iniciales, tipo documental, identidad incompleta, diferencias, variantes de cabecera y rechazo de cruces inseguros.');
