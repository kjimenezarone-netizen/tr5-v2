const assert = require('node:assert/strict');
const parser = require('../file-parser.js');
const fs = require('node:fs');

const synthetic = parser.parse('TR6: reporte\r\nTipo|Número|Apellido paterno|Nombres|Fecha Inicio|Fecha Inicio\r\n01|00123| A  B |Ana||2026-01-01\r\n01|00123| A  B |Ana|||extra', 'sample.txt');
assert.equal(synthetic.records.length, 2);
assert.equal(synthetic.records[0].rawCells[2], ' A  B ');
assert.equal(synthetic.records[0].rawCells[4], '');
assert.equal(synthetic.records[1].rawCells[6], 'extra');
assert.equal(synthetic.columns.length, 7);
assert.equal(synthetic.diagnostics.length, 1);
assert.equal(new Set(synthetic.columns.map(c => c.label)).size, 7);
assert.equal(parser.table(synthetic).rows[0]['Nro Doc.'], '00123');
assert.ok(!parser.table(synthetic).cols.includes('Fecha de Ingreso'));
assert.throws(() => parser.parse('un formato desconocido'));
for (const path of process.argv.slice(2)) {
    const decoded = parser.decode(fs.readFileSync(path));
    const dataset = parser.parse(decoded.text, 'fixture');
    assert.equal(dataset.diagnostics.length, 0);
    const expected = dataset.type === 'TR5' ? [122, 25] : [121, 21];
    assert.deepEqual([dataset.records.length, dataset.columns.length], expected);
    assert.equal(decoded.encoding, 'windows-1252');
    for (const record of dataset.records) assert.equal(record.rawCells.join('|'), record.rawLine);
    console.log(`${dataset.type}: ${dataset.records.length} registros, ${dataset.columns.length} columnas, integridad verificada.`);
}
console.log('OK: vacíos, columnas adicionales, encabezados repetidos, ceros iniciales y rechazo de formato desconocido.');
