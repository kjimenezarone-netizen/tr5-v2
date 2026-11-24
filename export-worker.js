importScripts('report-schema.js', 'tr-analysis.js', 'ruc.js', 'exceljs.min.js', 'workbook.js');

self.onmessage = async ({ data }) => {
    const progress = message => postMessage({ event: 'progress', message });
    try {
        progress('Organizando los registros…');
        let sheets;
        if (data.kind === 'TR') sheets = TRAnalysis.sheets(data.analysis, data.people, data.context);
        else if (data.kind === 'RUC') sheets = RucModel.exportSheets(data.records, data.context);
        else throw new Error('Tipo de exportación no reconocido.');
        const bytes = await Workbook.write(sheets, ExcelJS, progress);
        postMessage({ event: 'done', result: bytes }, [bytes]);
    } catch (error) {
        postMessage({ event: 'error', message: error.message });
    }
};
