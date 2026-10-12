/* Diagnóstico técnico con lista cerrada de campos: nunca copiar valores o nombres de fuentes. */
const Diagnostics = {
    build(datasets, moduleName, rejectedSources = 0) {
        return {
            diagnosticVersion: '1.0', parserVersion: '2.1', module: moduleName,
            generatedAt: new Date().toISOString(),
            processedSources: datasets.length, rejectedSources,
            processedRecords: datasets.reduce((n,d) => n+d.records.length,0),
            problematicRows: datasets.reduce((n,d) => n+d.diagnostics.length,0),
            discardedRecords: 0,
            limitation: 'Los conteos describen únicamente fuentes procesadas. Las fuentes rechazadas no se contabilizan como registros. No evalúa infracciones ni certifica validez semántica.',
            sources: datasets.map((dataset,index) => {
                const columns = dataset.columns.map(column => {
                    let empty = 0, missing = 0;
                    dataset.records.forEach(record => {
                        const value = record.rawCells[column.index];
                        if (value === undefined) missing++;
                        else if (!value.trim()) empty++;
                    });
                    return {position:column.index+1,hasHeader:Boolean(column.rawHeader?.trim()),emptyValues:empty,missingValues:missing};
                });
                return {
                    sourceId:`source_${index+1}`,type:dataset.type,encoding:dataset.encoding || 'unknown',
                    headerRow:dataset.headerRow,headerColumns:dataset.rawHeaders.length,retainedColumns:dataset.columns.length,
                    records:dataset.records.length,
                    rowsWithColumnMismatch:dataset.diagnostics.map(d=>({row:d.sourceRow,expectedColumns:d.expected,actualColumns:d.actual})),
                    columns
                };
            })
        };
    },
    preview(containerId, report) {
        const node=document.getElementById(containerId);
        node.replaceChildren();
        const p=document.createElement('p');
        p.textContent=`Diagnóstico: ${report.processedSources} fuentes procesadas · ${report.processedRecords} registros conservados · ${report.problematicRows} filas con distinta cantidad de columnas · ${report.rejectedSources} fuentes rechazadas.`;
        const details=document.createElement('details'), summary=document.createElement('summary'), pre=document.createElement('pre');
        summary.textContent='Ver contenido técnico antes de descargar';pre.textContent=JSON.stringify(report,null,2);pre.className='overflow-auto max-h-[300px] text-xs';details.append(summary,pre);
        const button=document.createElement('button');button.textContent='Descargar diagnóstico JSON';button.className='border rounded px-3 py-2 my-3';
        button.addEventListener('click',()=>this.download(report));
        node.append(p,details,button);
    },
    download(report) {
        if (!UI.requireIntendencia()) return;
        const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json;charset=utf-8'}));
        const link=document.createElement('a');link.href=url;link.download=`diagnostico_${report.module}.json`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
};
if(typeof module!=='undefined' && module.exports)module.exports=Diagnostics;
if(typeof document!=='undefined')document.addEventListener('DOMContentLoaded',()=>{
    document.getElementById('tr-diagnostic-prepare').addEventListener('click',()=>{
        if(!UI.requireIntendencia() || AppState.trBusy) return;
        if(!AppState.trDatasets.length)return Utils.showToast('Cargue primero un reporte TR.','info');
        Diagnostics.preview('tr-diagnostic-preview',Diagnostics.build(AppState.trDatasets,'TR'));
    });
});
