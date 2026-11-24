const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { test } = require('node:test');

function setup() {
    const props = new Map([
        ['INSTITUTIONAL_DOMAIN', 'example.test'],
        ['ADMIN_EMAILS', 'admin@example.test'],
        ['OFFICES_BY_USER', JSON.stringify({ 'reader@example.test': 'IRE-LIMA' })],
        ['TELEMETRY_MODE', 'INSTITUTIONAL']
    ]);
    const cache = new Map();
    const written = [];
    const ranges = [];
    let email = '';
    let now = new Date('2026-11-23T12:00:00Z').getTime();
    class Clock extends Date { static now() { return now; } }
    const propertyApi = { getProperty: key => props.get(key) || null };
    const context = vm.createContext({
        Date: Clock,
        Session: { getActiveUser: () => ({ getEmail: () => email }) },
        PropertiesService: { getScriptProperties: () => propertyApi },
        CacheService: { getScriptCache: () => ({
            put: (key, value) => cache.set(key, value),
            get: key => cache.get(key) || null,
            remove: key => cache.delete(key)
        }) },
        LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
        Utilities: {
            DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf-8' },
            computeDigest: (algorithm, value) => [...createHash(algorithm).update(value).digest()],
            getUuid: randomUUID,
            formatDate: (value, _, format) => format === 'yyyy-MM' ? value.toISOString().slice(0, 7) : value.toISOString()
        },
        ContentService: { createTextOutput: text => ({ setMimeType: () => JSON.parse(text) }), MimeType: { JSON: 'json' } }
    });
    vm.runInContext(fs.readFileSync(__dirname + '/Code.gs', 'utf8'), context);
    const sheet = {
        getLastRow: () => written.length + 1,
        appendRow: row => written.push(row),
        getRange: (first, column, count) => {
            ranges.push({ first, column, count });
            return {
                getValues: () => written.slice(first - 2, first - 2 + count),
                getValue: () => written[first - 2][column - 1],
                createTextFinder: id => ({
                    matchEntireCell: () => ({ findNext: () => {
                        const index = written.slice(first - 2, first - 2 + count).findIndex(row => row[column - 1] === id);
                        return index < 0 ? null : { getRow: () => first + index };
                    } })
                })
            };
        }
    };
    context.hoja_ = () => sheet;
    const post = data => context.doPost({ postData: { contents: JSON.stringify(data) } });
    return { props, cache, written, ranges, post, setEmail: value => { email = value; }, advance: ms => { now += ms; } };
}

const event = () => ({
    eventId: randomUUID(), intendencia: 'IRE-LIMA', modulo: 'RUC', accion: 'VISUALIZACIÓN',
    registros: 100, archivos: 1, duracionMs: 100, bytes: 1000, version: '3.3.0'
});

test('Las estadísticas institucionales verifican la cuenta y la intendencia y deduplican la escritura', () => {
    const { post, setEmail, cache, written } = setup();
    assert.equal(post(event()).status, 'unauthorized');
    setEmail('reader@example.test');
    assert.equal(post({ accion: 'LOGIN' }).status, 'unauthorized');
    const session = post({ accion: 'TELEMETRY_SESSION' });
    assert.equal(session.status, 'ok');
    const input = { ...event(), token: session.token };
    assert.equal(post({ ...input, intendencia: 'IRE-ICA' }).status, 'unauthorized');
    assert.equal(post({ ...input, nombres: 'dato no permitido' }).status, 'invalid_event');
    assert.equal(post({ ...input, intendencia: '=FORMULA()' }).status, 'invalid_event');
    assert.equal(post({ ...input, registros: 60001 }).status, 'invalid_event');
    assert.equal(post(input).status, 'ok');
    cache.delete('event:INSTITUTIONAL:' + input.eventId);
    assert.equal(post(input).duplicate, true);
    assert.equal(written.length, 1);
    assert.equal(written[0][10], 'INSTITUTIONAL');
    assert.ok(!written[0].includes('reader@example.test'));
});

test('La sesión administrativa se vincula a la cuenta y se revoca al salir o expirar', () => {
    const { post, setEmail, advance } = setup();
    setEmail('admin@example.test');
    const { token } = post({ accion: 'LOGIN' });
    assert.equal(post({ accion: 'DASHBOARD', token }).status, 'ok');
    setEmail('reader@example.test');
    assert.equal(post({ accion: 'DASHBOARD', token }).status, 'unauthorized');
    setEmail('admin@example.test');
    assert.equal(post({ accion: 'LOGOUT', token }).status, 'ok');
    assert.equal(post({ accion: 'DASHBOARD', token }).status, 'unauthorized');
    const renewed = post({ accion: 'LOGIN' });
    advance(30 * 60 * 1000 + 1);
    assert.equal(post({ accion: 'DASHBOARD', token: renewed.token }).status, 'unauthorized');
});

test('El modo optativo anónimo mantiene procedencia separada y acota la lectura de la hoja', () => {
    const { post, setEmail, props, written, ranges } = setup();
    props.set('TELEMETRY_MODE', 'OFF');
    assert.equal(post(event()).status, 'disabled');
    props.set('TELEMETRY_MODE', 'ANONYMOUS');
    assert.equal(post(event()).status, 'ok');
    assert.equal(written[0][10], 'ANONYMOUS');
    for (let index = 0; index < 5001; index++) written.push([...written[0], 'dummy']);
    written.at(-1)[10] = 'INSTITUTIONAL';
    setEmail('admin@example.test');
    const { token } = post({ accion: 'LOGIN' });
    const result = post({ accion: 'DASHBOARD', token });
    assert.equal(result.limited, true);
    assert.equal(result.visualizaciones['IRE-LIMA'], 4999);
    assert.deepEqual(ranges.at(-1), { first: 4, column: 1, count: 5000 });
});
