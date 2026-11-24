/* Datos originales por posición; la normalización solo alimenta la vista. */
(function (root) {
    'use strict';
    const schema = typeof module !== 'undefined' && module.exports ? require('./report-schema.js') : ReportSchema;
    const key = schema.key;
    function decode(buffer) {
        try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer), encoding: 'utf-8' }; }
        catch { return { text: new TextDecoder('windows-1252').decode(buffer), encoding: 'windows-1252' }; }
    }
    function parse(text, sourceFile = '', limits = {}) {
        const { maxRows = Infinity, maxColumns = Infinity, maxCells = Infinity, maxLineLength = Infinity } = limits;
        if (text.includes('\u0000')) throw Object.assign(new Error('El archivo contiene caracteres nulos. Compruebe su codificación.'), { code: 'FORMAT' });
        const lines = text.split(/\r\n|\n|\r/);
        const firstLine = lines.find(l => l.trim().length > 0) || '';
        const firstCell = key(firstLine.split('|')[0]).replace(/\s+/g, '');
        const isRuc = firstCell === 'NUMERORUC' || firstCell === 'RUC';
        const type = /^\s*(TR[56]):/i.exec(firstLine)?.[1].toUpperCase() || (isRuc ? 'RUC' : null);
        if (!type) throw Object.assign(new Error('Formato no reconocido. No se ha interpretado el archivo.'), { code: 'FORMAT' });
        const headerIndex = type === 'RUC' ? lines.findIndex(l => l.trim().length > 0)
            : lines.slice(0, 100).findIndex(line => line.length <= maxLineLength && schema.isWorkerHeader(line));
        if (headerIndex < 0) throw Object.assign(new Error('No se encontró un encabezado reconocible para este reporte.'), { code: 'FORMAT' });
        const limitError = message => Object.assign(new Error(message), { code: 'LIMIT' });
        if (lines[headerIndex].length > maxLineLength) throw limitError('El encabezado supera la longitud permitida.');
        const rawHeaders = lines[headerIndex].split('|');
        if (rawHeaders.length > maxColumns) throw limitError('El archivo supera la cantidad permitida de columnas.');
        const prelude = lines.slice(0, headerIndex);
        const headerKeys = rawHeaders.map(key);
        const groupHeadings = new Set(prelude.filter(line => line.includes('|')).map(line => line.trim()));
        const records = [];
        const diagnostics = [];
        let width = rawHeaders.length;
        let cells = 0;
        for (let i = headerIndex + 1; i < lines.length; i++) {
            const rawLine = lines[i];
            if (rawLine.length > maxLineLength) throw limitError(`La fila ${i + 1} supera la longitud permitida.`);
            const trimmed = rawLine.trim();
            if (!trimmed || /^\s*[=-]+\s*$/.test(trimmed) || groupHeadings.has(trimmed)) continue;
            const rawCells = rawLine.split('|');
            if (rawCells.length === headerKeys.length && rawCells.every((value, column) => key(value) === headerKeys[column])) continue;
            cells += rawCells.length;
            if (rawCells.length > maxColumns || cells > maxCells || records.length >= maxRows) {
                throw limitError('El archivo supera el límite de filas, columnas o celdas de la consulta.');
            }
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
        return { type, sourceFile, prelude, headerRow: headerIndex + 1, rawHeaders, columns, records, diagnostics };
    }
    function table(dataset) {
        const aliases = {
            TIPO: 'Tipo Doc.',
            'TIPO DOC': 'Tipo Doc.',
            'TIPO DOCUMENTO': 'Tipo Doc.',
            'TIPO DE DOCUMENTO': 'Tipo Doc.',
            'TIP DOC': 'Tipo Doc.',
            NUMERO: 'Nro Doc.',
            'NUMERO DOC': 'Nro Doc.',
            'NUMERO DOCUMENTO': 'Nro Doc.',
            'NUMERO DE DOCUMENTO': 'Nro Doc.',
            'NRO DOC': 'Nro Doc.',
            'NRO DOCUMENTO': 'Nro Doc.',
            'NRO DE DOCUMENTO': 'Nro Doc.',
            'DOCUMENTO DE IDENTIDAD': 'Nro Doc.',
            'APELLIDO PATERNO': 'Apellido Paterno',
            'APELLIDO MATERNO': 'Apellido Materno',
            NOMBRES: 'Nombres',
            OCUPACION: 'Ocupación'
        };
        if (dataset.type === 'TR5') aliases['FEC INICIO'] = 'Fecha de Ingreso';
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
