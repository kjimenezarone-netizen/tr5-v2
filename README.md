# Lector TR5/TR6 y RUC Masivo

El lector procesa TXT de TR5/TR6 y TXT o ZIP de RUC Masivo en el navegador. Permite cruzar trabajadores por documento, revisar las filas originales, filtrar y descargar Excel con trazabilidad. El servicio de estadísticas es optativo.

## Ejecutar en Windows

Instala Node.js 24. Desde la raíz de la copia, ejecuta en PowerShell:

~~~powershell
npm.cmd ci
npm.cmd run build
npm.cmd start
~~~

Abre http://127.0.0.1:8000. En Linux y macOS, usa los mismos comandos con npm en lugar de npm.cmd. El directorio dist es el sitio estático compilado. También se puede servir con un servidor HTTPS institucional. Sirve el sitio por HTTP local o HTTPS para que el navegador habilite los Workers.

Las muestras TR5 y TR6 de esta copia son sintéticas. Incluyen documentos con ceros iniciales, variantes de codificación y repeticiones. Las exportaciones contienen las filas originales cargadas en la consulta.

## Lectura y exportación

| Límite de esta versión | Valor |
| --- | --- |
| TR5/TR6 | Hasta dos archivos, 15 MiB por TXT |
| RUC Masivo | Hasta 20 archivos, 20 MiB por TXT o ZIP, 40 MiB de entrada en total |
| Entradas ZIP y fuentes RUC | Hasta 250 entradas ZIP y 100 TXT por lote |
| Expansión de ZIP | Hasta 20 MiB por TXT y 40 MiB descomprimidos por lote |
| Filas y columnas | Hasta 60 000 filas por lote y 128 columnas por archivo. Hasta 256 columnas distintas en una consulta RUC. |
| Celdas de entrada y Excel | Hasta 1 200 000 posiciones de tabla por lote y 1 500 000 celdas de salida |
| Longitud de línea | Hasta 32 767 caracteres |

Los límites son máximos de entrada y requieren validar el volumen habitual en los equipos de la institución. El motor de lectura comparte reglas entre el Worker y la alternativa para entradas de hasta 2 MiB. El Excel se genera en un Worker cancelable.

Si TR5 y TR6 tienen RUC distintos, se rechaza el cruce. Si un encabezado documental resulta ambiguo, se conservan las filas como identidades no evaluables. Los indicadores de TR6 distinguen una marca, un campo sin marca y un campo no evaluable. Son señales para revisar las fuentes.

La lectura omite los encabezados que se repiten dentro del TXT y conserva la numeración original de las filas de datos. Una carga rechazada o cancelada deja disponible la consulta previa. El Excel utiliza la intendencia que estaba seleccionada cuando se cargó la consulta.

## Pruebas

~~~sh
npm ci
npm test
npx playwright install chromium
npm run test:browser
npm audit --omit=dev --audit-level=high
~~~

Las pruebas de navegador comprueban el flujo TR5/TR6, la carga RUC ZIP, la exportación completa y filtrada, la cancelación y el cierre de consultas. Usan archivos sintéticos y una sesión administrativa simulada.

## Estadísticas y publicación

La compilación local arranca sin URL de estadísticas. Configura el servicio con las instrucciones de apps-script/INSTALACION.md y prueba el acceso desde el origen HTTPS previsto. En la compilación se incluyen la versión, el commit y el hash de los archivos estáticos. Las dependencias se instalan desde el archivo de bloqueo y se sirven desde el mismo sitio.

- El flujo Validar Lector ejecuta las pruebas y adjunta dist para revisión.
- En GitHub, protege main, exige revisión por PR y configura el check pruebas como obligatorio.
- Si se usa Pages, prepara la publicación con la opción GitHub Actions y el flujo manual Publicar Lector en Pages. Publica dist. Revisa la configuración de Pages antes de fusionar, ya que la raíz del código requiere compilación.
- Configura el entorno github-pages para limitar la publicación a main y, si tu plan lo permite, exige una revisión. Para revertir, recompila y publica un commit aprobado o vuelve a servir su artefacto guardado.

La CSP se incluye en el HTML. El servidor de pruebas agrega también las cabeceras de seguridad. Para un servidor institucional, replica esas cabeceras y habilita HTTPS en el servidor de entrada. Antes del despliegue, verifica navegación en Chrome o Edge de los equipos de trabajo, rendimiento con archivos representativos y el acceso a Apps Script.

Los XML y planes anteriores se conservan como historial de desarrollo. Este README y el manifiesto version.json del artefacto describen la entrega actual.
