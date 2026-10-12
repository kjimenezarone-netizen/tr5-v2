const assert = require('node:assert/strict');
const fs = require('node:fs');
const JSZip = require('../vendor/jszip.min.js');
const parser = require('../file-parser.js');
const model = require('../ruc.js');
async function readZip(bytes, zipName) {
    const zip = await JSZip.loadAsync(bytes);
    const sources = [];
    for (const entry of Object.values(zip.files).filter(e => !e.dir && /\.txt$/i.test(e.name))) {
        const decoded = parser.decode(await entry.async('uint8array'));
        sources.push({ zipName, entryName: entry.name, dataset: parser.parse(decoded.text, entry.name) });
    }
    return sources;
}
(async () => {
    const a = new JSZip().file('same.txt', 'NumeroRuc|Nombre|\n20123456789|Empresa A|\n|Sin RUC|');
    const b = new JSZip().file('same.txt', 'NumeroRuc|Nombre|Extra|\n20123456789|Empresa B|valor|');
    const sources = [...await readZip(await a.generateAsync({type:'nodebuffer'}), 'a.zip'), ...await readZip(await b.generateAsync({type:'nodebuffer'}), 'b.zip')];
    const result = model.consolidate(sources);
    assert.equal(result.records.length, 3);
    assert.equal(result.groups.size, 1);
    assert.equal(result.repeated.size, 1);
    assert.equal(result.differences.size, 1);
    assert.equal(new Set(result.records.map(r => r.id)).size, 3);
    assert.equal(result.records[2].rawCells[2], 'valor');
    assert.equal(result.records[0].rawCells[2], '');
    const companies = model.companies(result.records);
    assert.equal(companies.length, 1, 'No agrupar filas sin RUC válido');
    assert.equal(companies[0].records.length, 2);
    const nameField = companies[0].fields.find(f => f.label === 'Nombre');
    assert.equal(nameField.different, true);
    assert.deepEqual([...nameField.variants.keys()], ['Empresa A', 'Empresa B']);
    assert.equal(nameField.variants.get('Empresa B')[0].source.zipName, 'b.zip');
    const extraField = companies[0].fields.find(f => f.label === 'Extra');
    assert.deepEqual([...extraField.variants.keys()], [null, 'valor']);
    const consolidated = model.consolidatedSheets(result.records);
    assert.equal(consolidated[0].rows.length, 2);
    assert.ok(consolidated[0].rows[1].includes('[VALORES DIFERENTES: ver Variantes]'));
    assert.ok(consolidated[1].rows.some(row => row[1] === 'Extra' && row[3] === 'No'));
    assert.equal(model.exportRecords(result, 'company', new Set(), [], '', '20123456789').length, 2);
    assert.equal(model.exportRecords(result, 'company', new Set(), [], '', 'missing').length, 0);
    assert.equal(model.exportRecords(result, 'consolidated', new Set(), []).length, 3);
    const withConsolidated = model.exportSheets(result.records, { consolidated:true });
    assert.deepEqual(withConsolidated.slice(-2).map(s => s.name), ['RUC_Unicos', 'Variantes']);
    sources[0].zipId = 0; sources[1].zipId = 1;
    const selected = new Set([model.selectionKey(result.records[0])]);
    assert.equal(model.exportRecords(result, 'selected', selected, []).length, 2, 'Seleccionar empresa incluye ambas fuentes aunque no estén visibles');
    assert.deepEqual(model.exportRecords(result, 'filtered', selected, [result.records[2]]), [result.records[2]]);
    assert.equal(model.exportRecords(result, 'all', selected, []).length, 3);
    assert.equal(model.exportRecords(result, 'repeated', selected, []).length, 2);
    assert.equal(model.exportRecords(result, 'differences', selected, []).length, 2);
    assert.deepEqual(model.exportRecords(result, 'zip', selected, [], '1'), [result.records[2]]);
    selected.add(model.selectionKey(result.records[1]));
    assert.equal(model.exportRecords(result, 'selected', selected, []).length, 3, 'Registro sin RUC se selecciona individualmente');
    const sheets = model.exportSheets(result.records, {intendencia:'PRUEBA',scope:'Todos',query:'',filter:'Todos'});
    assert.deepEqual(sheets[1].rows[1], result.records[0].rawCells);
    assert.equal(sheets[1].rows[0][2], '', 'Encabezado vacío intacto');
    assert.equal(sheets[2].rows[1][2], 'valor');
    assert.equal(sheets[3].rows.length, 4);
    assert.equal(sheets[3].rows[3][0], 'Original_2');
    result.records[0].rawCells[1] = 'Cambio posterior';
    assert.equal(sheets[1].rows[1][1], 'Empresa A', 'Instantánea independiente del dato vivo');
    result.records[0].rawCells[1] = 'Empresa A';
    const identical = model.consolidate([sources[0], sources[0]]);
    assert.equal(identical.records.length, 4);
    assert.equal(identical.differences.size, 0);
    await assert.rejects(JSZip.loadAsync(Buffer.from('not a ZIP')));
    if (process.argv[2]) {
        const actual = model.consolidate(await readZip(fs.readFileSync(process.argv[2]), 'muestra.zip'));
        assert.equal(actual.records.length, 100);
        assert.equal(model.companies(actual.records).length, 99);
        assert.equal(model.consolidatedSheets(actual.records)[0].rows.length, 100);
        assert.equal(actual.sources[0].dataset.columns.length, 25);
        assert.equal(actual.sources[0].dataset.diagnostics.length, 0);
        actual.records.forEach(r => assert.equal(r.rawCells.join('|'), r.rawLine));
        console.log(`ZIP real: ${actual.records.length} registros y ${actual.groups.size} RUC únicos; líneas originales verificadas.`);
    }
    console.log('OK: multi-ZIP, TXT homónimos, repetidos, diferencias, campos adicionales, vacíos y ZIP inválido.');
})().catch(error => { console.error(error); process.exitCode = 1; });
