const SHEET_NAME = 'Eventos_v3';
const HEADERS = ['Fecha', 'IdEvento', 'Intendencia', 'Modulo', 'Accion', 'Registros', 'Archivos', 'DuracionMs', 'Bytes', 'Version', 'Confianza'];
const MODULES = ['TR', 'TR5', 'TR6', 'TR5_TR6', 'RUC'];
const ACTIONS = ['VISUALIZACIÓN', 'DESCARGAR_EXCEL', 'ERROR', 'FORMATO_DESCONOCIDO'];
const OFFICES = ['IRE-AMAZONAS','IRE-ANCASH','IRE-APURIMAC','IRE-AREQUIPA','IRE-AYACUCHO','IRE-CAJAMARCA','IRE-CALLAO','IRE-CUSCO','IRE-HUANCAVELICA','IRE-HUANUCO','IRE-ICA','IRE-JUNIN','IRE-LA LIBERTAD','IRE-LAMBAYEQUE','IRE-LIMA','ILM','SDIE','IRE-LORETO','IRE-MADRE DE DIOS','IRE-MOQUEGUA','IRE-PASCO','IRE-PIURA','IRE-PUNO','IRE-SAN MARTIN','IRE-TACNA','IRE-TUMBES','IRE-UCAYALI'];
const EVENT_FIELDS = ['eventId', 'intendencia', 'modulo', 'accion', 'registros', 'archivos', 'duracionMs', 'bytes', 'version', 'token'];
const DASHBOARD_ROWS = 5000;
const EVENT_LOOKBACK = 5000;
const SESSION_SECONDS = 1800;
const TIME_ZONE = 'America/Lima';

function inicializar() {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  if (!book) throw new Error('Ejecute desde el proyecto vinculado a la hoja.');
  const sheet = book.getSheetByName(SHEET_NAME) || book.insertSheet(SHEET_NAME);
  if (!sheet.getLastRow()) sheet.appendRow(HEADERS);
  verificarCabecera_(sheet);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold').setBackground('#003366').setFontColor('#ffffff');
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', book.getId());
}

function verificarCabecera_(sheet) {
  if (JSON.stringify(sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0]) !== JSON.stringify(HEADERS)) {
    throw new Error('Cabecera incompatible.');
  }
}

function hoja_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Ejecute inicializar primero.');
  const sheet = SpreadsheetApp.openById(id).getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error('La hoja Eventos_v3 no existe.');
  verificarCabecera_(sheet);
  return sheet;
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return json_({ status: 'ok', service: 'Lector TR5/TR6 y RUC Masivo', apiVersion: '3' });
}

function doPost(event) {
  try {
    const raw = event && event.postData && event.postData.contents;
    if (!raw || raw.length > 4096) return json_({ status: 'invalid_request' });
    let data;
    try { data = JSON.parse(raw); } catch { return json_({ status: 'invalid_request' }); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return json_({ status: 'invalid_request' });

    const props = PropertiesService.getScriptProperties();
    const mode = modo_(props);
    if (data.accion === 'LOGIN') return json_(crearSesion_(props, 'admin'));
    if (data.accion === 'TELEMETRY_SESSION') {
      return json_(mode === 'INSTITUTIONAL' ? crearSesion_(props, 'events') : { status: 'disabled' });
    }
    if (data.accion === 'DASHBOARD') {
      return json_(sesion_(data.token, props, 'admin') ? dashboard_(mode) : { status: 'unauthorized' });
    }
    if (data.accion === 'LOGOUT') {
      if (sesion_(data.token, props, 'admin')) CacheService.getScriptCache().remove('session:' + hash_(data.token));
      return json_({ status: 'ok' });
    }
    return json_(registrar_(data, props, mode));
  } catch {
    return json_({ status: 'error', message: 'No se pudo completar la operación. Revise la configuración del servicio.' });
  }
}

function modo_(props) {
  const value = props.getProperty('TELEMETRY_MODE');
  return ['INSTITUTIONAL', 'ANONYMOUS'].includes(value) ? value : 'OFF';
}

function hash_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)
    .map(byte => ('0' + ((byte + 256) % 256).toString(16)).slice(-2)).join('');
}

function identidad_(props) {
  const domain = (props.getProperty('INSTITUTIONAL_DOMAIN') || '').trim().toLowerCase();
  const email = (Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  return domain && email.split('@').length === 2 && email.split('@')[1] === domain ? email : null;
}

function oficina_(email, props) {
  const assignments = JSON.parse(props.getProperty('OFFICES_BY_USER') || '{}');
  const office = assignments && Object.prototype.hasOwnProperty.call(assignments, email) ? assignments[email] : null;
  return OFFICES.includes(office) ? office : null;
}

function isAdmin_(email, props) {
  return (props.getProperty('ADMIN_EMAILS') || '').split(',').map(value => value.trim().toLowerCase()).includes(email);
}

function crearSesion_(props, role) {
  const email = identidad_(props);
  if (!email || !(role === 'admin' ? isAdmin_(email, props) : oficina_(email, props))) {
    return { status: 'unauthorized' };
  }
  const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  const expires = Date.now() + SESSION_SECONDS * 1000;
  CacheService.getScriptCache().put('session:' + hash_(token), JSON.stringify({ identity: hash_(email), role, expires }), SESSION_SECONDS);
  return { status: 'ok', token, expires };
}

function sesion_(token, props, role) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/i.test(token)) return null;
  const email = identidad_(props);
  if (!email) return null;
  if (role === 'admin' && !isAdmin_(email, props)) return null;
  const raw = CacheService.getScriptCache().get('session:' + hash_(token));
  if (!raw) return null;
  const session = JSON.parse(raw);
  return session.role === role && session.identity === hash_(email) && session.expires > Date.now() ? email : null;
}

function registrar_(data, props, mode) {
  if (mode === 'OFF') return { status: 'disabled' };
  if (Object.keys(data).some(key => !EVENT_FIELDS.includes(key)) || !OFFICES.includes(data.intendencia)
      || !MODULES.includes(data.modulo) || !ACTIONS.includes(data.accion)) return { status: 'invalid_event' };
  if (typeof data.eventId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(data.eventId)
      || typeof data.version !== 'string' || !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(data.version)) return { status: 'invalid_event' };
  const numbers = [data.registros, data.archivos, data.duracionMs, data.bytes];
  const maxima = [60000, 20, 600000, 40 * 1024 * 1024];
  if (numbers.some((value, index) => !Number.isSafeInteger(value) || value < 0 || value > maxima[index])) return { status: 'invalid_event' };

  const identity = mode === 'INSTITUTIONAL' ? sesion_(data.token, props, 'events') : null;
  if (mode === 'INSTITUTIONAL' && (!identity || oficina_(identity, props) !== data.intendencia)) return { status: 'unauthorized' };
  const key = identity ? hash_(identity) : 'anonymous';
  const cache = CacheService.getScriptCache();
  const eventId = data.eventId.toLowerCase();
  const idKey = 'event:' + mode + ':' + eventId;
  const quotaKey = 'quota:' + key + ':' + Math.floor(Date.now() / 60000);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(2500)) return { status: 'busy' };
  try {
    if (cache.get(idKey)) return { status: 'ok', duplicate: true };
    const used = Number(cache.get(quotaKey) || 0);
    if (used >= (identity ? 40 : 90)) return { status: 'rate_limited' };
    cache.put(quotaKey, String(used + 1), 90);
    const sheet = hoja_();
    const length = Math.min(sheet.getLastRow() - 1, EVENT_LOOKBACK);
    if (length > 0) {
      const first = sheet.getLastRow() - length + 1;
      const prior = sheet.getRange(first, 2, length, 1).createTextFinder(eventId).matchEntireCell(true).findNext();
      if (prior && sheet.getRange(prior.getRow(), 11).getValue() === mode) return { status: 'ok', duplicate: true };
    }
    sheet.appendRow([new Date(), eventId, data.intendencia, data.modulo, data.accion, ...numbers, data.version, mode]);
    cache.put(idKey, '1', 21600);
    cache.remove('dashboard:' + mode);
    return { status: 'ok' };
  } finally {
    lock.releaseLock();
  }
}

function dashboard_(mode) {
  const cache = CacheService.getScriptCache();
  const key = 'dashboard:' + mode;
  const cached = cache.get(key);
  if (cached) return JSON.parse(cached);

  const sheet = hoja_();
  const lastRow = sheet.getLastRow();
  const size = Math.min(lastRow - 1, DASHBOARD_ROWS);
  const rows = size > 0 ? sheet.getRange(lastRow - size + 1, 1, size, HEADERS.length).getValues() : [];
  const result = {
    status: 'ok', mode, visualizaciones: {}, descargas: {}, porModulo: {}, ultimosRegistros: [],
    mesActual: 0, mesAnterior: 0, windowLimit: DASHBOARD_ROWS, limited: lastRow - 1 > DASHBOARD_ROWS
  };
  const month = Utilities.formatDate(new Date(), TIME_ZONE, 'yyyy-MM');
  const [year, monthNumber] = month.split('-').map(Number);
  const previous = monthNumber === 1 ? (year - 1) + '-12' : year + '-' + String(monthNumber - 1).padStart(2, '0');
  const valid = [];
  for (const row of rows) {
    const [date, , office, module, action, records, , , , , confidence] = row;
    if (confidence !== mode || !(date instanceof Date) || Number.isNaN(date.getTime())
        || !OFFICES.includes(office) || !MODULES.includes(module) || !ACTIONS.includes(action)) continue;
    valid.push({ date, office, module, action });
    result.porModulo[module] ??= { procesamientos: 0, exportaciones: 0, registros: 0, errores: 0 };
    const stats = result.porModulo[module];
    if (action === 'VISUALIZACIÓN') {
      result.visualizaciones[office] = (result.visualizaciones[office] || 0) + 1;
      stats.procesamientos++;
      stats.registros += Number(records) || 0;
    } else if (action === 'DESCARGAR_EXCEL') {
      result.descargas[office] = (result.descargas[office] || 0) + 1;
      stats.exportaciones++;
    } else {
      stats.errores++;
    }
    const period = Utilities.formatDate(date, TIME_ZONE, 'yyyy-MM');
    if (period === month) result.mesActual++;
    if (period === previous) result.mesAnterior++;
  }
  result.ultimosRegistros = valid.slice(-50).reverse().map(row => ({
    fecha: Utilities.formatDate(row.date, TIME_ZONE, 'dd/MM/yyyy HH:mm:ss'),
    intendencia: row.office,
    modulo: row.module,
    accion: row.action
  }));
  cache.put(key, JSON.stringify(result), 60);
  return result;
}
