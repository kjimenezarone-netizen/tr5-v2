const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const parser = require('../file-parser.js');
const schema = require('../report-schema.js');

for (const type of ['TR5', 'TR6']) {
    const bytes = fs.readFileSync(path.join(__dirname, '..', 'muestras', type + '_sintetico.txt'));
    const decoded = parser.decode(bytes);
    assert.equal(decoded.encoding, type === 'TR5' ? 'utf-8' : 'windows-1252');
    const dataset = parser.parse(decoded.text.replace('PEÓN AGRÍCOLA', 'OCUPACIÓN: AGRÍCOLA'), type + '.txt');
    const company = schema.companyInfo(dataset);
    assert.equal(Object.keys(company).length, 4);
    assert.ok(company[type]);
    assert.equal(company['NRO DE RUC'], '20123456789');
    const name = Object.entries(company).find(([key]) => schema.key(key).includes('RAZON SOCIAL'))[1];
    assert.equal(name, 'EMPRESA SINTÉTICA S.A.C.');
    assert.equal(company.OCUPACIÓN, undefined);
}
