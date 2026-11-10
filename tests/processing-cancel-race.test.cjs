const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('Fallback cancelado no borra una nueva carga RUC iniciada antes de terminar', async () => {
  const outstanding=[];
  class Worker { constructor() { throw new Error('worker unavailable'); } }
  const ctx=vm.createContext({Worker,Promise,Error,Map,console});
  vm.runInContext(fs.readFileSync(__dirname+'/../processing-client.js','utf8') + '\nglobalThis.api=Processing;',ctx);
  ctx.api.runFallback=()=>new Promise((resolve,reject)=>outstanding.push({resolve,reject}));
  const old=ctx.api.run('RUC',[],()=>{});
  ctx.api.cancel('RUC');
  await assert.rejects(old, e=>e.name==='AbortError');
  const newer=ctx.api.run('RUC',[],()=>{});
  assert.equal(ctx.api.jobs.size,1);
  outstanding[0].resolve(1);
  await Promise.resolve();await Promise.resolve();
  assert.equal(ctx.api.jobs.size,1,'El fallback de la carga cancelada no debe cancelar la nueva carga');
  outstanding[1].resolve(2);
  assert.equal(await newer,2);
  assert.equal(ctx.api.jobs.size,0);
});
