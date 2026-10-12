# Lector TR5/TR6 y RUC Masivo — plan V2

Estado: propuesta de implementación basada en la especificación XML V2 y la revisión estática de la V1. No acredita pruebas funcionales ni revisión del backend.

Entregas implementadas: inicio con selector compartido de intendencia, navegación TR/RUC y validación de intendencia; parser TR con originales; RUC con carga multi-ZIP, previsualización paginada, búsqueda, repetidos, diferencias y trazabilidad. RUC conserva todos los registros y no ofrece todavía exportación ni selección. Se mantiene el contrato existente con Google Apps Script para guardar estadísticas TR en Google Sheets; aún no se envían eventos RUC porque su ampliación requiere revisar el backend.

RUC utiliza JSZip 3.10.1 local (vendor/jszip.min.js, licencia incluida en su cabecera). Referencia de extracción: https://stuk.github.io/jszip/documentation/api_jszip/load_async.html. Límite inicial: 20 MB por ZIP y por TXT descomprimido. El procesamiento aún no utiliza Worker; cancelar interrumpe la extracción o el paso a la siguiente entrada, pero no un parseo síncrono ya iniciado. Cada carga reemplaza los resultados RUC anteriores; una cancelación no publica resultados parciales. Los errores por fuente aparecen en la pantalla y no impiden revisar las fuentes válidas.

## Alcance acordado

Procesamiento en Worker implementado: lectura/decodificación/parsing TR, agrupación y cruce; extracción ZIP, parsing y consolidación RUC. Progreso textual por etapas y cancelación mediante terminate, sin publicación parcial. Requiere servir la aplicación por HTTP/HTTPS; se muestra error si Worker no inicia. Se mantienen límites de 15 MB por TR y 20 MB por ZIP/TXT RUC; no se declara capacidad ilimitada. Transferencia de resultados, renderizado, búsqueda, diagnósticos y exportación siguen en el hilo principal. El parsing se realiza en el Worker, pero aún no es incremental ni streaming por filas. Pruebas de lógica Worker y structured clone en Node; revisión de rendimiento y cancelación en navegador pendiente.

Diagnóstico descargable implementado: JSON con previsualización, versiones, conteos de fuentes/registros, discrepancias de columnas por número de fila y vacíos/ausentes por posición de columna. Se excluyen encabezados, nombres de archivos, RUC, documentos, nombres y contenido de filas. TR describe fuentes procesadas; RUC además cuenta rechazos de ZIP/TXT durante la carga. No estima filas de archivos rechazados ni certifica validez semántica; descartados=0 corresponde solo a registros de fuentes interpretadas. Una nueva carga invalida el diagnóstico anterior. Descarga local sin envío a Sheets. Pruebas de privacidad estructural y muestra TR5; validación visual pendiente.

Columnas configurables implementadas para tablas originales TR y RUC: controles por nombre, mostrar todas, al menos una columna de datos visible, estado temporal por archivo TR y por lote RUC. Se conserva entre búsquedas/páginas y cambios de reporte; nueva carga reinicia preferencias. Los campos de trazabilidad/selección/ficha RUC permanecen visibles. Ocultar solo afecta presentación; consultas, modelos y exportaciones conservan todas las columnas. Pruebas automatizadas de aislamiento y exportación íntegra; revisión visual pendiente.

Filtros avanzados TR implementados: columnas dinámicas identificadas por reporte y posición; contiene/igual/distinto/empieza, vacío/con información, fecha igual/desde/hasta/entre inclusivas. Combinación AND: una fila debe cumplir todas las condiciones de su reporte; condiciones en ambos tipos requieren coincidencia en cada tipo. Campos ausentes no coinciden con vacío, fechas no interpretables no coinciden con condiciones temporales. Chips de filtros activos removibles, reinicio al cargar y selección conservada al filtrar. Exportación filtrada utiliza los trabajadores coincidentes con todas sus filas e incluye descripción de filtros en Resumen; cambios invalidan la previsualización. Pendientes: operadores numéricos, grupos OR, columnas configurables y validación visual en navegador.

Selección/exportación TR implementada: checkboxes por identidad, selección de todos los trabajadores filtrados, limpieza y vista de selección persistente entre búsquedas/páginas. Una carga nueva reinicia la selección. Centro de exportación con alcances completo, trabajadores filtrados, seleccionados y trabajador de ficha. Incluye Resumen, Trabajadores, Historico laboral, originales por tipo y Fuentes. Previsualización obligatoria con conteos y muestra, invalidada al cambiar contexto. El antiguo botón de descarga abre esta previsualización. Se mantiene el evento DESCARGAR_EXCEL a Apps Script tras generar el archivo, sin modificar el contrato de Sheets. El filtrado de exportación corresponde a trabajadores, no a filtros independientes de las tablas originales. Pendientes: filtros avanzados por campos, CSV, diagnóstico descargable, rendimiento con Worker y validación visual.

Histórico laboral implementado en ficha: orden cronológico de todas las filas TR5, primera/última fecha válida, fechas distintas, establecimientos y tipos de contrato distintos (valores no vacíos, recortados solo para conteo). Fechas estrictas dd/mm/aaaa o aaaa-mm-dd; vacías, inválidas o columnas ambiguas se diagnostican sin descartar filas. Origen y línea original disponibles por fila. No infiere reingresos ni ceses y no toma fechas TR6 como ingresos laborales. Validación automatizada sintética y con muestra TR5; revisión visual pendiente.

Entrega TR de cruce/fichas: carga de un archivo o de un TR5 y un TR6, validación de RUC idéntico e identificable antes del cruce, agrupación por tipo/número documental, identidades incompletas separadas por fila, multiplicidad y diferencias de nombres. Vista paginada/buscable de personas y ficha con todas las columnas y líneas de cada registro. Selector para consultar las tablas TR originales por fuente. Excel mantiene originales de ambos archivos y trazabilidad; DATA_SUNAFIL refleja solo el reporte elegido. Pruebas automatizadas con 243 filas de las muestras reales y casos sintéticos. Pendientes: histórico laboral, selección/filtros avanzados TR, centro de exportación TR y verificación visual en navegador.

Entrega de fichas RUC: vista paginada de empresas únicas, ficha agrupada en datos generales/ubicación/actividad/información tributaria/otros, variantes con procedencia y líneas originales. La vista única busca sobre registros y muestra las empresas coincidentes; sus fichas siempre incluyen todas las apariciones. Consolidado Excel añade RUC_Unicos y Variantes a las hojas originales. Los campos en conflicto se marcan y sus valores/fuentes se enumeran en Variantes, sin elegir un ganador. Empresa individual se exporta desde la ficha mediante previsualización. Los registros sin RUC válido se conservan en originales y se excluyen únicamente de la agrupación por empresa. Pruebas automatizadas sobre modelo y ZIP real; validación visual en navegador pendiente.

Entrega de selección/exportación RUC: selección por empresa (todas sus apariciones), con selección individual para filas sin RUC válido; persiste al buscar y paginar. Alcances Excel: originales, filtrados, seleccionados, repetidos, diferencias y ZIP de origen. La previsualización captura datos, muestra recuentos/columnas por hoja y cinco filas; se invalida al cambiar filtros, selección, alcance, intendencia o carga. Cada TXT conserva sus encabezados y celdas en una hoja Original_N, con Resumen y Fuentes. No se emiten todavía estadísticas RUC a Sheets; pendiente contrato de Apps Script. Pendientes: exportación consolidada de únicos, CSV, ficha y exportación individual desde ficha.

- La selección de intendencia es el primer paso obligatorio para utilizar TR5/TR6 o RUC Masivo. Se conserva al cambiar de módulo durante la sesión.
- TR5/TR6 y RUC Masivo funcionan sin login; el dashboard requiere autenticación.
- RUC Masivo procesa ZIP de resultados de consultas ya realizadas. La consulta directa a SUNAT no forma parte del alcance del XML.
- Preservar registros, columnas, valores vacíos y trazabilidad. No eliminar repeticiones automáticamente.
- Separar datos originales, normalizados, derivados y observaciones del usuario.
- Previsualizar antes de descargar; estadísticas sin contenido de los archivos.

## Diagnóstico inicial de la V1

El proyecto contiene index.html, script.js y style.css. Tiene carga individual de TXT, tabla paginada, búsqueda, filtros, exportación XLSX y dashboard conectado a un servicio externo. No se encontraron un módulo RUC, configuración de pruebas ni código del backend en la raíz revisada.

| Componente | Tratamiento para V2 |
| --- | --- |
| Identidad visual y catálogo de intendencias | Conservar y reutilizar. |
| Selección de intendencia | Convertir en estado compartido y validar también al procesar, además del bloqueo visual. |
| Tabla y filtros | Separar del estado global actual; ampliar con filtros dinámicos, selección y columnas configurables. |
| Parser TR | Refactorizar: hoy normaliza espacios, usa alias amplios y puede omitir celdas sin encabezado. |
| Exportación | Reemplazar la dependencia exclusiva de globalRows por un alcance explícito y previsualizado. |
| Dashboard | Revisar compatibilidad del backend antes de cambiar autenticación y eventos. |
| RUC Masivo | Construir módulo nuevo usando el núcleo compartido. |

## Modelo mínimo

- AnalysisSession: intendencia seleccionada, fuentes, filtros, selecciones y observaciones por módulo.
- SourceFile: identificador, archivo original, nombre, tipo, codificación, esquema y metadatos detectados; para ZIP, identificar también cada entrada TXT.
- SourceRecord: identificador estable por fuente y fila, línea original, celdas originales ordenadas y diagnósticos. Encabezados vacíos o repetidos mantienen su posición e identidad propia.
- NormalizedRecord: valores de consulta separados del original, con referencia al registro fuente.
- Person: clave de tipo y número de documento, con listas de registros TR5/TR6. Identidades incompletas quedan sin resolver y no se agrupan por una clave vacía.
- Company: RUC y todas sus apariciones; diferencias entre fuentes explícitas.
- ExportScope: módulo, fuentes, vista, filtros y selección capturados para que la descarga coincida con la previsualización.

Los identificadores documentales se conservan como texto. Preservar el archivo original permite recuperar bytes, codificación y saltos de línea; XLSX/CSV son representaciones de sus datos.

## Entregas

1. Base de navegación: intendencia compartida, acceso a TR y RUC, dashboard separado. Validar bloqueo sin intendencia y conservación al cambiar de módulo.
2. Núcleo TR fiable: originales, esquemas, diagnóstico, Worker con progreso y cancelación. Validar vacíos, ceros iniciales, columnas adicionales, encabezados repetidos y filas problemáticas.
3. Consulta y exportación TR: filtros por columnas reales, selección persistente, previsualización y alcances completo/filtrado/seleccionado/individual. Comprobar que descarga y previsualización coinciden.
4. Análisis TR: ficha, persona frente a registro, histórico y cruce por RUC y documento con multiplicidad. No inferir ceses ni reingresos confirmados a partir de datos insuficientes.
5. RUC Masivo: extracción multi-ZIP, 24 campos conocidos y adicionales, originales, únicos, diferencias, ficha, selección y exportación por fuente o alcance.
6. Integración posterior: relación RUC/TR, comparación temporal y ampliación de estadísticas administrativas.

Diagnóstico, integridad, rendimiento y seguridad se validan en cada entrega, no solo al finalizar.

## Primera entrega concreta

Flujo: seleccionar intendencia → elegir TR5/TR6 o RUC Masivo → trabajar en el módulo. La intendencia permanece visible y compartida. Mantener el lector operativo mientras se incorporan los nuevos componentes; no presentar acciones pendientes como funcionales.

## Evidencia pendiente

- Muestras anonimizadas representativas de TR5, TR6 y ZIP RUC, conservando estructura, delimitadores y vacíos, para confirmar esquemas reales.
- Volúmenes habituales y máximos para fijar objetivos medibles de rendimiento.
- Código o contrato del backend administrativo para verificar autenticación y métricas.
- Regla para elegir valores principales cuando fuentes del mismo RUC discrepan; hasta definirla, mostrar las alternativas con su origen.

Se puede comenzar con navegación y estado compartido mientras se obtienen las muestras. Los datos sintéticos sirven para comprobar invariantes, pero no acreditan compatibilidad con todos los formatos reales.
