importScripts('file-parser.js', 'tr-analysis.js', 'vendor/jszip.min.js', 'ruc.js');
const progress = message => postMessage({event:'progress',message});
async function dataset(file, name) {
    progress(`Leyendo y detectando: ${name}`);
    const decoded=FileParser.decode(await file.arrayBuffer());
    progress(`Interpretando: ${name}`);
    const result=FileParser.parse(decoded.text,name);result.encoding=decoded.encoding;return result;
}
async function extract(entry) {
    return new Promise((resolve,reject)=>{
        const chunks=[];let size=0;
        const stream=entry.internalStream('uint8array');
        stream.on('data',chunk=>{
            size+=chunk.length;
            if(size>20*1024*1024){stream.pause();reject(new Error('El TXT supera 20 MB.'));return;}
            chunks.push(chunk);
        }).on('error',reject).on('end',()=>{
            const bytes=new Uint8Array(size);let offset=0;chunks.forEach(c=>{bytes.set(c,offset);offset+=c.length;});resolve(bytes);
        }).resume();
    });
}
self.onmessage=async ({data})=>{
    try {
        if(data.kind==='TR'){
            const datasets=[];
            for(const file of data.files){const parsed=await dataset(file,file.name);parsed.originalFile=file;datasets.push(parsed);}
            progress('Validando RUC y agrupando trabajadores…');
            const analysis=TRAnalysis.build(datasets);
            const table=FileParser.table(datasets[0]);
            postMessage({event:'done',result:{datasets,analysis,table}});
        }else if(data.kind==='RUC'){
            const sources=[],issues=[];let rejectedSources=0;
            for(let i=0;i<data.files.length;i++){
                const file=data.files[i];progress(`ZIP ${i+1} de ${data.files.length}: ${file.name}`);
                try{
                    if(!/\.zip$/i.test(file.name))throw new Error('El archivo no tiene extensión ZIP.');
                    if(file.size>20*1024*1024)throw new Error('El ZIP supera 20 MB.');
                    const zip=await JSZip.loadAsync(await file.arrayBuffer());
                    const entries=Object.values(zip.files).filter(e=>!e.dir && /\.txt$/i.test(e.name));
                    if(!entries.length)throw new Error('El ZIP no contiene TXT.');
                    for(const entry of entries){
                        try{
                            progress(`Extrayendo: ${entry.name}`);
                            const decoded=FileParser.decode(await extract(entry));
                            progress(`Interpretando: ${entry.name}`);
                            const parsed=FileParser.parse(decoded.text,entry.name);parsed.encoding=decoded.encoding;
                            if(parsed.type!=='RUC')throw new Error('El TXT no corresponde a resultados RUC.');
                            sources.push({zipId:i,zipName:file.name,entryName:entry.name,originalFile:file,encoding:decoded.encoding,dataset:parsed});
                            parsed.diagnostics.forEach(d=>issues.push(`${file.name} / ${entry.name}: fila ${d.sourceRow}, ${d.actual} columnas (encabezado: ${d.expected}). Se conservó la fila.`));
                            const invalid=parsed.records.filter(r=>!/^\d{11}$/.test(r.rawCells[0].trim())).length;
                            if(invalid)issues.push(`${file.name} / ${entry.name}: ${invalid} registros sin RUC de 11 dígitos, conservados sin consolidar.`);
                        }catch(error){rejectedSources++;issues.push(`${file.name} / ${entry.name}: ${error.message}`);}
                    }
                }catch(error){rejectedSources++;issues.push(`${file.name}: ${error.message}`);}
            }
            progress('Agrupando empresas y comparando fuentes…');
            postMessage({event:'done',result:{model:RucModel.consolidate(sources),issues,rejectedSources}});
        }else throw new Error('Operación no reconocida.');
    }catch(error){postMessage({event:'error',message:error.message});}
};
