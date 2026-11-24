const ReportSchema = (() => {
    function key(value) {
        return String(value ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/N[^\w\s]?MERO/gi, 'NUMERO').replace(/[^A-Z0-9\s]/gi, ' ')
            .replace(/\s+/g, ' ').trim().toUpperCase();
    }

    const fieldAliases = {
        type: ['TIPO', 'TIPO DOC', 'TIPO DOCUMENTO', 'TIPO DE DOCUMENTO', 'TIP DOC', 'TIP DE DOC', 'TIPO DE DOC', 'TIPO DOCUMENTO DE IDENTIDAD', 'TIPO DE DOCUMENTO DE IDENTIDAD'],
        number: ['NUMERO', 'NUMERO DOC', 'NUMERO DOCUMENTO', 'NUMERO DE DOCUMENTO', 'NRO DOC', 'NRO DOCUMENTO', 'NRO DE DOCUMENTO', 'NUM DOC', 'NUM DOCUMENTO', 'DOCUMENTO DE IDENTIDAD', 'NRO', 'DOCUMENTO', 'NUMERO DE DOCUMENTO DE IDENTIDAD', 'NRO DOCUMENTO DE IDENTIDAD'],
        surname: ['APELLIDO PATERNO', 'PRIMER APELLIDO', 'PATERNO', 'APELLIDOS', 'APELLIDO'],
        secondSurname: ['APELLIDO MATERNO', 'SEGUNDO APELLIDO', 'MATERNO'],
        names: ['NOMBRES', 'NOMBRE', 'NOMBRES DEL TRABAJADOR'],
        start: ['FEC INICIO', 'FECHA DE INGRESO', 'FECHA INGRESO'],
        establishment: ['ESTABLECIMIENTO EN EL QUE LABORA', 'ESTABLECIMIENTO'],
        contract: ['TIPO DE CONTRATO', 'CONTRATO'],
        occupation: ['OCUPACION', 'PUESTO', 'CARGO', 'OFICIO'],
        cuspp: ['CUSPP', 'CODIGO CUSPP'],
        healthRegime: ['REGIMEN DE SALUD', 'TIPO DE REGIMEN DE SALUD', 'REGIMEN DE ASEGURAMIENTO DE SALUD'],
        pensionRegime: ['REGIMEN PENSIONARIO', 'TIPO DE REGIMEN PENSIONARIO', 'REGIMEN DE PENSIONES']
    };

    function unique(columns, aliases) {
        const matches = columns.filter(column => aliases.includes(column.key));
        return {
            index: matches.length === 1 ? matches[0].index : null,
            status: matches.length === 1 ? '' : matches.length ? 'Columna ambigua' : 'Campo ausente'
        };
    }

    function spans(cells) {
        let start = 0;
        return cells.map((value, index) => {
            const end = start + (value ?? '').length;
            const cell = { key: key(value), index, start, end };
            start = end + 1;
            return cell;
        });
    }

    function groupColumns(dataset, columns, groupPattern) {
        for (const line of (dataset.prelude ?? []).slice().reverse()) {
            if (!line.includes('|')) continue;
            const groups = spans(line.split('|')).filter(group => groupPattern.test(group.key));
            if (groups.length > 1) return [];
            if (!groups.length) continue;
            const [group] = groups;
            return columns.filter(column => column.start >= group.start && column.end <= group.end);
        }
        return [];
    }

    function describe(dataset) {
        const columns = spans(dataset.rawHeaders);
        const fields = Object.fromEntries(Object.entries(fieldAliases).map(([field, aliases]) => [field, unique(columns, aliases)]));
        if (dataset.type === 'TR6') {
            const healthGroup = groupColumns(dataset, columns, /^REGIMEN DE ASEGUR.*SALUD$/);
            const pensionGroup = groupColumns(dataset, columns, /^REGIMEN PENSIONARIO$/);
            if (fields.healthRegime.status === 'Campo ausente') fields.healthRegime = unique(healthGroup, ['TIPO DE REGIMEN']);
            if (fields.pensionRegime.status === 'Campo ausente') fields.pensionRegime = unique(pensionGroup, ['TIPO DE REGIMEN']);
            const healthSctrGroup = groupColumns(dataset, columns, /^SCTR.*SALUD$/);
            const explicit = columns.filter(column => /^(SCTR.*SALUD.*(?:EPS|ESSALUD|NINGUNO)|(?:EPS|ESSALUD|NINGUNO).*SCTR.*SALUD)$/.test(column.key));
            const candidates = explicit.length ? explicit : healthSctrGroup.filter(column => ['ESSALUD', 'EPS', 'NINGUNO'].includes(column.key));
            const providers = candidates.filter(column => /\b(?:ESSALUD|EPS)\b/.test(column.key));
            const none = candidates.filter(column => /\bNINGUNO\b/.test(column.key));
            const ambiguous = new Set(providers.map(column => column.key.match(/\b(?:ESSALUD|EPS)\b/)[0])).size !== providers.length || none.length > 1;
            fields.sctr = ambiguous || !providers.length ? null : { providers: providers.map(column => column.index), none: none[0]?.index ?? null };
        }
        return fields;
    }

    function read(record, field) {
        if (field.index === null) return { value: null, status: field.status };
        const value = record.rawCells[field.index];
        return value === undefined ? { value: null, status: 'Valor ausente en la fila' } : { value, status: '' };
    }

    function health(record, fields) {
        const cuspp = read(record, fields.cuspp).value;
        let sctr = null;
        if (fields.sctr) {
            const values = fields.sctr.providers.map(index => record.rawCells[index]?.trim().toUpperCase());
            const none = fields.sctr.none === null ? '' : record.rawCells[fields.sctr.none]?.trim().toUpperCase();
            if (values.every(value => value === '' || value === 'X') && (none === '' || none === 'X')) {
                const marked = values.includes('X');
                if (!(marked && none === 'X')) sctr = marked;
            }
        }
        return {
            cuspp: cuspp?.trim() ?? null,
            sctr,
            healthRegime: read(record, fields.healthRegime).value?.trim() ?? null,
            pensionRegime: read(record, fields.pensionRegime).value?.trim() ?? null
        };
    }

    function companyInfo(dataset) {
        const info = Object.create(null);
        let current = '';
        for (const raw of dataset.prelude ?? []) {
            const line = raw.trim();
            if (!line) continue;
            if (/^[=-]{3,}/.test(line) || line.includes('|')) break;
            const colon = line.indexOf(':');
            if (colon >= 0) {
                const label = line.slice(0, colon).trim();
                const value = line.slice(colon + 1).trim().replace(/^"|"$/g, '').trim();
                if (label && value) {
                    info[label] = value;
                    current = label;
                }
            } else if (current && !line.includes('\t')) {
                info[current] += ' ' + line;
            }
        }
        return info;
    }

    function isWorkerHeader(line) {
        if (!line.includes('|')) return false;
        const cells = line.split('|').map(key);
        return cells.some(cell => fieldAliases.surname.includes(cell))
            && cells.some(cell => fieldAliases.names.includes(cell));
    }

    return { key, describe, read, health, companyInfo, isWorkerHeader };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = ReportSchema;
