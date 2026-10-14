const assert = require('node:assert/strict');
const fs = require('node:fs');
const parser = require('../file-parser.js');

function extractCompanyInfo(linesOrDataset, maybeDataset) {
    let lines = [];
    let dataset = null;
    if (Array.isArray(linesOrDataset)) {
        lines = linesOrDataset;
        dataset = maybeDataset || null;
    } else if (linesOrDataset && typeof linesOrDataset === 'object') {
        dataset = linesOrDataset;
        lines = (dataset.text || '').split(/\r\n|\n|\r/);
    } else if (typeof linesOrDataset === 'string') {
        lines = linesOrDataset.split(/\r\n|\n|\r/);
    }

    const info = {};
    let currentKey = '';
    const maxLines = dataset?.headerRow ? Math.min(dataset.headerRow - 1, lines.length) : lines.length;

    for (let i = 0; i < maxLines; i++) {
        const raw = lines[i];
        const l = (raw || '').trim();
        if (!l) continue;

        if (/^[=-]{3,}/.test(l) || l.includes('|')) {
            break;
        }

        if (l.includes(':')) {
            const colonIdx = l.indexOf(':');
            const key = l.substring(0, colonIdx).trim();
            let value = l.substring(colonIdx + 1).trim();
            if (key && value && value.length > 0) {
                value = value.replace(/^"/, '').replace(/"$/, '').trim();
                info[key] = value;
                currentKey = key;
            }
        } else if (currentKey && l && !l.includes('|') && !l.includes('\t')) {
            info[currentKey] += ' ' + l;
        }
    }
    return info;
}

function getSortedEntries(data) {
    const norm = str => String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    const matchers = [
        k => norm(k).startsWith('TR5') || norm(k).startsWith('TR6'),
        k => norm(k).includes('RUC'),
        k => norm(k).includes('NOMBRE') || norm(k).includes('RAZON SOCIAL') || norm(k).includes('DENOMINACION'),
        k => norm(k).includes('FECHA') || norm(k).includes('GENERACION')
    ];

    const sortedEntries = [];
    const usedKeys = new Set();

    matchers.forEach(matcher => {
        for (const [k, v] of Object.entries(data)) {
            if (!usedKeys.has(k) && !k.includes('|') && matcher(k)) {
                sortedEntries.push([k, v]);
                usedKeys.add(k);
                break;
            }
        }
    });

    Object.entries(data).forEach(([k, v]) => {
        if (!usedKeys.has(k) && !k.includes('|') && !String(v).includes('|')) {
            sortedEntries.push([k, v]);
            usedKeys.add(k);
        }
    });

    return sortedEntries;
}

// Test sample TR5
const tr5Text = fs.readFileSync('muestras/muestra_TR5_ACELIM.txt', 'utf8');
const tr5Info = extractCompanyInfo(tr5Text.split(/\r\n|\n|\r/));
assert.equal(Object.keys(tr5Info).length, 4);
assert.ok(tr5Info['TR5']);
assert.equal(tr5Info['NRO DE RUC'], '20600264762');
assert.equal(tr5Info['NOMBRE, DENOMINACION O RAZON SOCIAL'], 'ACELIM DEL PERU S.R.L.');
assert.equal(tr5Info['FECHA DE GENERACION'], '14/07/2026 23:04:06');

// Test sample TR5 with colon in worker row
const tr5WithWorkerColon = tr5Text.replace('PEON AGRICOLA', 'COSECHADOR: MANI, ALGODON, PAJAS, ETC.');
const tr5WithWorkerColonInfo = extractCompanyInfo(tr5WithWorkerColon.split(/\r\n|\n|\r/));
assert.equal(Object.keys(tr5WithWorkerColonInfo).length, 4);
assert.equal(tr5WithWorkerColonInfo['NRO DE RUC'], '20600264762');

// Test sample TR6
const tr6Decoded = parser.decode(fs.readFileSync('muestras/muestra_TR6_ACELIM.txt'));
const tr6Info = extractCompanyInfo(tr6Decoded.text.split(/\r\n|\n|\r/));
assert.equal(Object.keys(tr6Info).length, 4);
assert.ok(tr6Info['TR6']);
assert.equal(tr6Info['NRO DE RUC'], '20600264762');

// Test sorted entries
const sortedTR5 = getSortedEntries(tr5Info);
assert.equal(sortedTR5.length, 4);
assert.equal(sortedTR5[0][0], 'TR5');
assert.equal(sortedTR5[1][0], 'NRO DE RUC');
assert.equal(sortedTR5[2][0], 'NOMBRE, DENOMINACION O RAZON SOCIAL');
assert.equal(sortedTR5[3][0], 'FECHA DE GENERACION');

console.log('OK: extractCompanyInfo y getSortedEntries filtran trabajadores y preservan datos de entidad para TR5 y TR6.');
