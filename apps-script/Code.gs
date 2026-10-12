// Vincular este proyecto desde Extensiones > Apps Script de la hoja V2tr5/tr6.
const HEADERS = ['Fecha', 'IdEvento', 'Intendencia', 'Modulo', 'Accion', 'Registros', 'Archivos', 'DuracionMs', 'Bytes', 'Version'];
const MODULES = ['TR5', 'TR6', 'TR5_TR6', 'RUC'];
const ACTIONS = ['VISUALIZACIÓN', 'DESCARGAR_EXCEL', 'ERROR', 'FORMATO_DESCONOCIDO'];
const OFFICES = ['IRE-AMAZONAS','IRE-ANCASH','IRE-APURIMAC','IRE-AREQUIPA','IRE-AYACUCHO','IRE-CAJAMARCA','IRE-CALLAO','IRE-CUSCO','IRE-HUANCAVELICA','IRE-HUANUCO','IRE-ICA','IRE-JUNIN','IRE-LA LIBERTAD','IRE-LAMBAYEQUE','IRE-LIMA','ILM','SDIE','IRE-LORETO','IRE-MADRE DE DIOS','IRE-MOQUEGUA','IRE-PASCO','IRE-PIURA','IRE-PUNO','IRE-SAN MARTIN','IRE-TACNA','IRE-TUMBES','IRE-UCAYALI'];

function inicializar() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  if (!book) throw new Error('Ejecute desde el proyecto vinculado a su hoja.');
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', book.getId());
  const sheet = book.getSheetByName('Eventos') || book.insertSheet('Eventos');
  if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);
  verificarCabecera_(sheet);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold').setBackground('#003366').setFontColor('#ffffff');
  sheet.autoResizeColumns(1, HEADERS.length);
}
function verificarCabecera_(sheet) {
  if (JSON.stringify(sheet.getRange(1,1,1,HEADERS.length).getValues()[0]) !== JSON.stringify(HEADERS)) throw new Error('Cabecera incompatible.');
}
function hoja_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Ejecute inicializar primero.');
  const sheet = SpreadsheetApp.openById(id).getSheetByName('Eventos');
  if (!sheet) throw new Error('No existe Eventos.');
  verificarCabecera_(sheet); return sheet;
}
function json_(data) { return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON); }
function doGet() { return json_({status:'ok',service:'Lector V2',version:'2.0'}); }
function doPost(e) {
  try {
    const raw = e && e.postData && e.postData.contents;
    if (!raw || raw.length > 4096) return json_({status:'invalid_request'});
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return json_({status:'invalid_request'});
    if (data.accion === 'LOGIN') return json_(login_(data));
    if (data.accion === 'DASHBOARD') return json_(sesion_(data.token) ? dashboard_() : {status:'unauthorized'});
    if (data.accion === 'LOGOUT') {
      if (typeof data.token === 'string') CacheService.getScriptCache().remove('session:'+hash_(data.token));
      return json_({status:'ok'});
    }
    return json_(registrar_(data));
  } catch (error) { return json_({status:'error',message:'No se pudo completar la operación. Revise configuración y encabezados.'}); }
}
function hash_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,value,Utilities.Charset.UTF_8).map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');
}
function login_(data) {
  const props = PropertiesService.getScriptProperties();
  const user = props.getProperty('ADMIN_USER'), pass = props.getProperty('ADMIN_PASSWORD');
  if (!user || !pass || pass.length < 16) return {status:'not_configured'};
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const state = JSON.parse(props.getProperty('LOGIN_LIMIT') || '{"attempts":0,"until":0}');
    if (state.until > Date.now()) return {status:'locked'};
    if (state.until) { state.attempts=0; state.until=0; }
    const receivedPassword = data.password;
    let credentialsMatch = false;
    if (typeof receivedPassword === 'string') {
      if (data.user === user) {
        credentialsMatch = hash_(receivedPassword) === hash_(pass);
      }
    }
    if (!credentialsMatch) {
      state.attempts++;
      if (state.attempts >= 5) state.until = Date.now()+15*60*1000;
      props.setProperty('LOGIN_LIMIT',JSON.stringify(state)); return {status:'unauthorized'};
    }
    props.deleteProperty('LOGIN_LIMIT');
    const token = Utilities.getUuid()+Utilities.getUuid();
    const expires = Date.now()+2*60*60*1000;
    CacheService.getScriptCache().put('session:'+hash_(token),String(expires),7200);
    return {status:'ok',token,expires};
  } finally { lock.releaseLock(); }
}
function sesion_(token) {
  return typeof token === 'string' && token.length < 200 && Number(CacheService.getScriptCache().get('session:'+hash_(token))) > Date.now();
}
function registrar_(data) {
  // Endpoint público: valida estructura, no acredita identidad del remitente.
  const allowed = ['eventId','intendencia','modulo','accion','registros','archivos','duracionMs','bytes','version'];
  if (Object.keys(data).some(k=>!allowed.includes(k)) || !OFFICES.includes(data.intendencia) || !MODULES.includes(data.modulo) || !ACTIONS.includes(data.accion)) return {status:'invalid_event'};
  if (typeof data.eventId !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(data.eventId) || typeof data.version !== 'string' || !/^\d+\.\d+(?:\.\d+)?$/.test(data.version)) return {status:'invalid_event'};
  const numbers = ['registros','archivos','duracionMs','bytes'].map(k=>data[k]);
  if (numbers.some(n=>!Number.isSafeInteger(n) || n<0 || n>1e12)) return {status:'invalid_event'};
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const sheet = hoja_();
    if (sheet.getLastRow()>1 && sheet.getRange(2,2,sheet.getLastRow()-1,1).createTextFinder(data.eventId).matchEntireCell(true).findNext()) return {status:'ok',duplicate:true};
    sheet.appendRow([new Date(),data.eventId,data.intendencia,data.modulo,data.accion,...numbers,data.version]);
    return {status:'ok'};
  } finally { lock.releaseLock(); }
}
function dashboard_() {
  const rows = hoja_().getDataRange().getValues().slice(1);
  const result = {status:'ok',visualizaciones:{},descargas:{},porModulo:{},ultimosRegistros:[],mesActual:0,mesAnterior:0};
  const now = new Date(), previous = new Date(now.getFullYear(),now.getMonth()-1,15);
  const month = Utilities.formatDate(now,'America/Lima','yyyy-MM'), prevMonth = Utilities.formatDate(previous,'America/Lima','yyyy-MM');
  rows.forEach(row=>{
    const [date,id,office,mod,action,records] = row;
    if (!(date instanceof Date)) return;
    if (!result.porModulo[mod]) result.porModulo[mod]={procesamientos:0,exportaciones:0,registros:0,errores:0};
    if (action==='VISUALIZACIÓN') { result.visualizaciones[office]=(result.visualizaciones[office]||0)+1;result.porModulo[mod].procesamientos++;result.porModulo[mod].registros+=Number(records)||0; }
    if (action==='DESCARGAR_EXCEL') { result.descargas[office]=(result.descargas[office]||0)+1;result.porModulo[mod].exportaciones++; }
    if (action==='ERROR' || action==='FORMATO_DESCONOCIDO') result.porModulo[mod].errores++;
    const period=Utilities.formatDate(date,'America/Lima','yyyy-MM');
    if(period===month)result.mesActual++;if(period===prevMonth)result.mesAnterior++;
  });
  result.ultimosRegistros=rows.slice(-50).reverse().map(r=>({fecha:Utilities.formatDate(new Date(r[0]),'America/Lima','dd/MM/yyyy HH:mm:ss'),intendencia:r[2],modulo:r[3],accion:r[4]}));
  return result;
}
