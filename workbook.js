const Workbook = (() => {
    const limits = { rows: 1048576, columns: 16384, text: 32767, cells: 1500000 };

    function verify(sheets) {
        let cells = 0;
        for (const { rows } of sheets) {
            if (rows.length > limits.rows) throw new Error('Una hoja supera el límite de filas de Excel.');
            for (const row of rows) {
                cells += row.length;
                if (row.length > limits.columns || cells > limits.cells) {
                    throw new Error('La exportación supera el límite de celdas. Reduzca su alcance.');
                }
                for (const value of row) {
                    if (typeof value !== 'string') continue;
                    if (value.length > limits.text) throw new Error('Una celda supera el límite de caracteres de Excel.');
                    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/.test(value)) {
                        throw new Error('Una celda contiene caracteres de control incompatibles con Excel.');
                    }
                }
            }
        }
    }

    async function write(sheets, excel, progress = () => {}) {
        verify(sheets);
        const workbook = new excel.Workbook();
        for (const sheet of sheets) {
            progress('Preparando hoja: ' + sheet.name);
            const worksheet = workbook.addWorksheet(sheet.name, { views: [{ state: 'frozen', ySplit: 1 }] });
            const widths = [];
            for (const [index, values] of sheet.rows.entries()) {
                const row = worksheet.addRow(values);
                if (index === 0) {
                    row.font = { name: 'Segoe UI', bold: true, color: { argb: 'FFFFFFFF' } };
                    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B365D' } };
                    row.alignment = { vertical: 'middle', wrapText: true };
                    row.height = 28;
                }
                if (index < 200) {
                    values.forEach((value, column) => {
                        widths[column] = Math.max(widths[column] ?? 12, Math.min(String(value ?? '').length + 4, 65));
                    });
                }
                if (index > 0 && sheet.name === 'Trabajadores') {
                    for (const column of [4, 5]) {
                        const cell = row.getCell(column);
                        if (cell.value > 1) cell.font = { bold: true, color: { argb: 'FF9A3412' } };
                    }
                }
            }
            widths.forEach((width, index) => { worksheet.getColumn(index + 1).width = width; });
            if (sheet.rows[0]?.length) {
                worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: sheet.rows.length, column: sheet.rows[0].length } };
            }
        }
        progress('Comprimiendo el archivo Excel…');
        const buffer = await workbook.xlsx.writeBuffer();
        return buffer instanceof ArrayBuffer ? buffer : buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    }

    return { write };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Workbook;
