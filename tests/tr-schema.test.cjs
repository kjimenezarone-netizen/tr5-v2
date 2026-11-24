const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const parser = require('../file-parser.js');
const tr = require('../tr-analysis.js');

function report(type, header, rows) {
    return parser.parse(type + ': sintético\nRUC: 20123456789\n' + header + '\n' + rows.join('\n'), type + '.txt');
}

test('Una cabecera documental ambigua conserva los originales sin agrupar identidades', () => {
    const a = report('TR5', 'Tipo|Número|Número|Apellido Paterno|Nombres', [
        '01|000001|000011|PRUEBA|ANA', '01|000001|000022|MUESTRA|BEA'
    ]);
    const b = report('TR6', 'Tipo|Número|Apellido Paterno|Nombres', ['01|000001|PRUEBA|ANA']);
    const result = tr.build([a, b]);
    assert.equal(result.crossable, false);
    assert.equal(result.people.length, 3);
    assert.equal(result.people.filter(person => person.status === 'Identidad no evaluable').length, 2);
    assert.equal(result.people.filter(person => person.status === 'Cruce no evaluable').length, 1);
    assert.equal(tr.sheets(result, result.people, {}).find(sheet => sheet.name === 'TR5 Original').rows.length, 3);
    const contract = report('TR5', 'Tipo contrato|Número contrato|Apellido Paterno|Nombres', ['FIJO|000001|PRUEBA|ANA']);
    assert.equal(tr.build([contract]).people[0].resolved, false);
});

test('SCTR explícito se interpreta por columna, admite reordenación y separa ausencia de dato', () => {
    const matching = report('TR6', 'Tipo|Número|Apellido Paterno|Nombres|CUSPP|SCTR Salud EPS', [
        '01|000001|PRUEBA|ANA|PRUEBA|X', '01|000001|PRUEBA|ANA||'
    ]);
    const moved = report('TR6', 'SCTR Salud EPS|Tipo|Número|Apellido Paterno|Nombres|CUSPP', ['X|01|000001|PRUEBA|ANA|PRUEBA']);
    const missing = report('TR6', 'Tipo|Número|Apellido Paterno|Nombres|EPS', ['01|000001|PRUEBA|ANA|X']);
    const person = tr.build([matching]).people[0];
    assert.equal(person.hasSctr, true);
    assert.deepEqual(person.TR6.map(item => item.health.sctr), [true, false]);
    assert.equal(tr.build([moved]).people[0].hasSctr, true);
    const unknown = tr.build([missing]).people[0];
    assert.equal(unknown.hasSctr, null);
    assert.equal(unknown.hasCuspp, null);
});

test('TR6 de ancho fijo reconoce los grupos por su cabecera superior y deja separado SCTR pensión', () => {
    const input = fs.readFileSync(path.join(__dirname, '..', 'muestras', 'TR6_sintetico.txt'));
    const data = parser.parse(parser.decode(input).text, 'TR6_sintetico.txt');
    const { people } = tr.build([data]);
    assert.deepEqual(people.map(person => person.hasSctr), [true, false, false, true]);
    assert.deepEqual(people.map(person => person.hasCuspp), [true, false, false, false]);
    assert.equal(people[0].TR6[0].health.healthRegime, 'RÉGIMEN A');
    assert.equal(people[0].TR6[0].health.pensionRegime, 'RÉGIMEN B');
});
