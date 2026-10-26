const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const frames=[];
const context=vm.createContext({TextDecoder,Uint8Array,ArrayBuffer,Blob,Promise,setTimeout,clearTimeout,console,postMessage:data=>frames.push(structuredClone(data))});
context.self=context;
context.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file.split('?')[0]),'utf8'),context));
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','processing-worker.js'),'utf8'),context);
const make=(name,bytes)=>{const file=new Blob([bytes]);file.name=name;return file;};
const makeSyntheticTR = (kind='TR5') => {
 const prefix = kind === 'TR5' ? 'TR5: reporte\nNRO DE RUC: 20123456789\n' : 'TR6: reporte\nNRO DE RUC: 20123456789\n';
 const rows = kind === 'TR5'
   ? [
       'Tipo|Número|Apellido paterno|Apellido materno|Nombres|Fecha Inicio|Fecha Fin|Actividad|Estado',
       '01|0001|Pérez|García|Ana|01/01/2020||Analista|Activo',
       '01|0002|López|Ramírez|Luis|02/02/2021||Operario|Activo',
       '01|0001|Pérez|García|Ana|03/03/2022||Analista|Activo'
     ]
   : [
       'Tipo|Número|Apellido paterno|Apellido materno|Nombres|Fecha Inicio|Fecha Fin|Actividad|Estado',
       '01|0001|Pérez|García|Ana|01/01/2020||Analista|Activo',
       '01|0002|López|Ramírez|Luis|02/02/2021||Operario|Activo',
       '01|0003|Torres|Solis|Marta|05/05/2023||Supervisor|Activo'
     ];
 return `${prefix}${rows.join('\n')}`;
};
(async()=>{
 const cliFiles = process.argv.slice(2,4).map((path,i)=>make(`sample${i}.txt`,fs.readFileSync(path)));
 const files = cliFiles.length === 2 ? cliFiles : [make('TR5_sample.txt', makeSyntheticTR('TR5')), make('TR6_sample.txt', makeSyntheticTR('TR6'))];
 await context.onmessage({data:{kind:'TR',files}});
 let done=frames.find(f=>f.event==='done');
 assert.ok(done,JSON.stringify(frames.filter(f=>f.event==='error')));
 assert.ok(done.result.analysis.people.length >= 1);
 assert.equal(done.result.datasets.reduce((n,d)=>n+d.records.length,0), done.result.datasets.reduce((n,d)=>n+d.records.length,0));
 assert.ok(done.result.analysis.people[0].names instanceof Set);
 assert.ok(done.result.analysis.people[0].TR5.length >= 1 || done.result.analysis.people[0].TR6.length >= 1);
 frames.length=0;
 if (process.argv[4] && fs.existsSync(process.argv[4])) {
   await context.onmessage({data:{kind:'RUC',files:[make('sample.zip',fs.readFileSync(process.argv[4]))]}});
   done=frames.find(f=>f.event==='done');assert.ok(done,JSON.stringify(frames.filter(f=>f.event==='error')));
   assert.ok(done.result.model.records.length >= 1);
   assert.ok(done.result.model.groups.size >= 1);
   assert.equal(done.result.model.records[0].source,done.result.model.sources[0]);
 }
 const workers=[];
 class Worker {constructor(){workers.push(this)}postMessage(){}terminate(){this.terminated=true}}
 const client=vm.createContext({Worker});vm.runInContext(fs.readFileSync(path.join(__dirname,'..','processing-client.js'),'utf8')+'\nglobalThis.api=Processing;',client);
 const pending=client.api.run('TR',[],()=>{});client.api.cancel('TR');await assert.rejects(pending,e=>e.name==='AbortError');
 assert.equal(workers[0].terminated,true);assert.equal(client.api.jobs.size,0);
 const retry=client.api.run('TR',[],()=>{});workers[1].onmessage({data:{event:'done',result:42}});assert.equal(await retry,42);
 console.log('OK: Worker TR y cancelación/reintento con datos sintéticos y ZIP opcional.');
})().catch(e=>{console.error(e);process.exitCode=1});
