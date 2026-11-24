const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const JSZip = require('jszip');

function testWorker() {
    const frames = [];
    const context = vm.createContext({
        TextDecoder, Uint8Array, ArrayBuffer, Blob, AbortController, DOMException,
        setTimeout, clearTimeout, console, postMessage: data => frames.push(structuredClone(data))
    });
    context.self = context;
    context.importScripts = (...files) => {
        for (const file of files) {
            const source = file === 'jszip.min.js' ? require.resolve('jszip/dist/jszip.min.js') : path.join(__dirname, '..', file);
            vm.runInContext(fs.readFileSync(source, 'utf8'), context);
        }
    };
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'processing-worker.js'), 'utf8'), context);
    vm.runInContext('globalThis.engine = ProcessingEngine;', context);
    return { context, frames };
}

const file = (name, bytes) => Object.assign(new Blob([bytes]), { name });
const report = (type, rows) => type + ': sintético\nRUC: 20123456789\nTipo|Número|Apellido paterno|Nombres\n' + rows;

test('El Worker cruza el par y conserva cada registro y su fuente', async () => {
    const { context, frames } = testWorker();
    await context.onmessage({ data: { kind: 'TR', files: [
        file('TR5.txt', report('TR5', '01|0001|PRUEBA|ANA\n01|0001|PRUEBA|ANA')),
        file('TR6.txt', report('TR6', '01|0001|PRUEBA|ANA\n01|0002|MUESTRA|BEA'))
    ] } });
    const result = frames.find(frame => frame.event === 'done').result;
    assert.deepEqual(result.datasets.map(dataset => dataset.records.length), [2, 2]);
    assert.equal(result.analysis.people.length, 2);
    assert.equal(result.analysis.people[0].status, 'En ambos');
    assert.equal(result.analysis.people[0].TR5[1].record, result.datasets[0].records[1]);
});

test('El motor encuentra TXT dentro de ZIP y aplica límites por entrada y por lote', async () => {
    const { context, frames } = testWorker();
    const content = 'NumeroRuc|Razon social\n20123456789|EMPRESA SINTETICA';
    const zip = new JSZip().file('uno.txt', content).file('dos.txt', content);
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const files = [file('muestra.zip', bytes)];
    await context.onmessage({ data: { kind: 'RUC', files } });
    const result = frames.find(frame => frame.event === 'done').result;
    assert.equal(result.model.records.length, 2);
    assert.deepEqual(result.model.sources.map(source => source.entryName), ['uno.txt', 'dos.txt']);
    assert.equal(result.model.repeated.size, 1);
    const caps = context.engine.limits;
    const rejected = await context.engine.run('RUC', files, { caps: { ...caps, entryBytes: 40 } });
    assert.equal(rejected.rejectedSources, 2);
    assert.equal(rejected.model.records.length, 0);
    await assert.rejects(context.engine.run('RUC', files, { caps: { ...caps, expandedBytes: 90 } }), error => error.code === 'BATCH_LIMIT');
    await assert.rejects(context.engine.run('RUC', files, { caps: { ...caps, rows: 1 } }), error => error.code === 'BATCH_LIMIT');
    await assert.rejects(context.engine.run('RUC', files, { caps: { ...caps, entries: 1 } }), error => error.code === 'BATCH_LIMIT');
});

test('Una cancelación durante la lectura no publica resultados', async () => {
    const { context } = testWorker();
    const controller = new AbortController();
    const pending = context.engine.run('RUC', [file('muestra.txt', 'RUC|Nombre\n20123456789|PRUEBA')], {
        signal: controller.signal, progress: () => controller.abort()
    });
    await assert.rejects(pending, error => error.name === 'AbortError');
});
