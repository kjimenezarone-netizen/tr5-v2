const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function load(Worker, run) {
    const ctx = vm.createContext({
        Worker, AbortController, DOMException, setTimeout, clearTimeout,
        ReaderConfig: { asset: name => name }, ProcessingEngine: { run }
    });
    vm.runInContext(fs.readFileSync(__dirname + '/../processing-client.js', 'utf8') + '\nglobalThis.api = Processing;', ctx);
    return ctx.api;
}

test('Una respuesta de la carga cancelada no sustituye el resultado de la siguiente', async () => {
    const outstanding = [];
    class Worker { constructor() { throw new Error('Worker no disponible'); } }
    const api = load(Worker, (_, __, { signal }) => new Promise(resolve => outstanding.push({ resolve, signal })));
    const old = api.run('RUC', []);
    await Promise.resolve();
    api.cancel('RUC');
    await assert.rejects(old, error => error.name === 'AbortError');
    assert.equal(outstanding[0].signal.aborted, true);
    const newer = api.run('RUC', []);
    await Promise.resolve();
    outstanding[0].resolve(1);
    assert.equal(api.jobs.size, 1);
    outstanding[1].resolve(2);
    assert.equal(await newer, 2);
    assert.equal(api.jobs.size, 0);
});

test('El Worker se detiene y solo inicia un fallback ante errores repetidos', async () => {
    const workers = [];
    class Worker {
        constructor() { workers.push(this); }
        postMessage() {}
        terminate() { this.terminated = true; }
    }
    let calls = 0;
    const api = load(Worker, async () => ++calls);
    const result = api.run('RUC', []);
    workers[0].onerror();
    workers[0].onerror();
    assert.equal(await result, 1);
    assert.equal(workers[0].terminated, true);
    assert.equal(api.jobs.size, 0);
});
