/* Datos originales por posición; la normalización solo alimenta la vista. */
(function (root) {
    'use strict';
    const key = value => value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/N[^\w\s]?MERO/gi, 'NUMERO').replace(/[^A-Z0-9\s]/gi, '').toUpperCase();
    function decode(buffer) {
        try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer), encoding: 'utf-8' }; }
        catch { return { text: new TextDecoder('windows-1252').decode(buffer), encoding: 'windows-1252' }; }
    }
    function parse(text, sourceFile = '') {
        const lines = text.split(/\r\n|\n|\r/);
        const firstLine = lines.find(l => l.trim().length > 0) || '';
        const firstCell = key(firstLine.split('|')[0]).replace(/\s+/g, '');
        const isRuc = firstCell === 'NUMERORUC' || firstCell === 'RUC';
        const type = /^\s*(TR[56]):/i.exec(firstLine)?.[1].toUpperCase() || (isRuc ? 'RUC' : null);
        if (!type) throw new Error('Formato no reconocido. No se ha interpretado el archivo.');
        const headerIndex = type === 'RUC' ? lines.findIndex(l => l.trim().length > 0) : lines.findIndex(line => {
            const cells = line.split('|').map(key);
            const hasPaterno = cells.some(c => c.includes('APELLIDO PATERNO'));
            const hasNombres = cells.some(c => c.includes('NOMBRES'));
            const hasNumero = cells.some(c => c === 'NUMERO' || c.includes('NUMERO'));
            return hasPaterno && hasNombres && hasNumero;
        });
        if (headerIndex < 0) throw new Error('No se encontró un encabezado seguro para este reporte.');
        const rawHeaders = lines[headerIndex].split('|');
        const records = [];
        const diagnostics = [];
        let width = rawHeaders.length;
        for (let i = headerIndex + 1; i < lines.length; i++) {
            const rawLine = lines[i];
            if (!rawLine.trim() || /^\s*[=-]+\s*$/.test(rawLine)) continue;
            const rawCells = rawLine.split('|');
            width = Math.max(width, rawCells.length);
            const record = { id: `${sourceFile}:${i + 1}`, sourceFile, sourceRow: i + 1, rawLine, rawCells };
            records.push(record);
            if (rawCells.length !== rawHeaders.length) diagnostics.push({ sourceRow: i + 1, expected: rawHeaders.length, actual: rawCells.length });
        }
        const used = new Set();
        const columns = Array.from({ length: width }, (_, i) => {
            const label = rawHeaders[i]?.trim() || `Columna sin encabezado ${i + 1}`;
            let name = label;
            let suffix = 2;
            while (used.has(name)) name = `${label} (${suffix++})`;
            used.add(name);
            return { id: `column_${i}`, label: name, rawHeader: rawHeaders[i] ?? null, index: i };
        });
        return { type, sourceFile, text, headerRow: headerIndex + 1, rawHeaders, columns, records, diagnostics };
    }
    function table(dataset) {
        const aliases = { TIPO: 'Tipo Doc.', NUMERO: 'Nro Doc.', 'APELLIDO PATERNO': 'Apellido Paterno', 'APELLIDO MATERNO': 'Apellido Materno', NOMBRES: 'Nombres', OCUPACION: 'Ocupación' };
        if (dataset.type === 'TR5') aliases['FEC. INICIO'] = 'Fecha de Ingreso';
        const used = new Set(['N°']);
        const names = dataset.columns.map(column => {
            const base = aliases[key(column.label)] || column.label;
            let name = base, suffix = 2;
            while (used.has(name)) name = `${base} (${suffix++})`;
            used.add(name);
            return name;
        });
        const rows = dataset.records.map((record, i) => {
            const row = Object.create(null);
            row['N°'] = i + 1;
            names.forEach((name, j) => { row[name] = (record.rawCells[j] ?? '').trim(); });
            return row;
        });
        return { rows, cols: ['N°', ...names] };
    }
    const api = { decode, parse, table };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.FileParser = api;
})(globalThis);
