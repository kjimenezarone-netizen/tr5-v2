# Preparar V2tr5/tr6

1. Abra el Google Sheets llamado V2tr5/tr6. No necesita crear pestañas ni encabezados manualmente.
2. Abra **Extensiones > Apps Script** y nombre el proyecto **Lector V2 Estadísticas**.
3. Reemplace el contenido de Código.gs con el archivo Code.gs de esta carpeta y guarde.
4. En **Configuración del proyecto > Propiedades de secuencia de comandos**, agregue ADMIN_USER (usuario administrativo) y ADMIN_PASSWORD (contraseña única de al menos 16 caracteres). No comparta la contraseña en el chat ni la coloque en el HTML/JavaScript público. Los editores del proyecto pueden acceder a estas propiedades.
5. En el editor seleccione **inicializar** y pulse **Ejecutar**. Autorice el acceso solicitado a su hoja. Se crea la pestaña Eventos, se guardan sus encabezados y el ID de esta hoja en las propiedades. Puede repetirse sin borrar eventos; una cabecera incompatible provoca error.
6. Use **Implementar > Nueva implementación > Aplicación web**. Ejecutar como: usted. Acceso: cualquier usuario, si su organización permite esta opción. Es necesario para registrar estadísticas de módulos sin login; no publique la hoja de cálculo ni cambie sus permisos de uso compartido. Si su organización restringe esa opción, revise el esquema de acceso antes de conectar el frontend.
7. Implemente y copie la URL terminada en **/exec**. Comparta únicamente esa URL para conectar la V2. No use /dev.
8. Al abrir /exec debe obtener un JSON con status ok y service Lector V2. Esto comprueba el servicio, no la escritura de eventos ni el login.

## Estado de integración

Este backend nuevo AÚN NO está conectado al frontend. El proyecto conserva la URL anterior. No es suficiente reemplazarla: hay que adaptar LOGIN (user/password sin Base64), DASHBOARD por POST con token en el cuerpo, LOGOUT y eventos con el esquema nuevo. Esos cambios se harán al recibir la URL y se probarán contra el despliegue.

## Datos guardados

Eventos: Fecha, IdEvento, Intendencia, Modulo, Accion, Registros, Archivos, DuracionMs, Bytes, Version. Módulos TR5, TR6, TR5_TR6, RUC. Una carga conjunta cuenta como un procesamiento TR5_TR6. Registros en descarga cuenta filas exportadas; no se suma al total de registros procesados.

El servidor rechaza campos adicionales en eventos. No recibe archivos, nombres de archivos, RUC, DNI, nombres de personas ni mensajes de error libres. Usa hora del servidor. IdEvento permite evitar duplicados en reintentos.

## Contrato de API

POST con cuerpo JSON y Content-Type text/plain;charset=UTF-8 (evitar preflight en Apps Script). El cliente debe leer el JSON y confirmar status ok; no tratar una respuesta opaca no-cors como escritura confirmada. Validar redirecciones/CORS desde el origen real antes de dar por completada la integración.

- LOGIN: {accion: "LOGIN", user, password}; devuelve token y expires.
- DASHBOARD: {accion: "DASHBOARD", token}; devuelve agregados y últimos 50 eventos.
- LOGOUT: {accion: "LOGOUT", token}; invalida sesión.
- Evento: {eventId, intendencia, modulo, accion, registros, archivos, duracionMs, bytes, version:"2.0"}.

Sesiones de hasta 2 horas en caché (Google puede expulsarlas antes). Cinco fallos bloquean el login administrativo global durante 15 minutos. Los eventos son públicos y autodeclarados: la validación no impide que terceros simulen estadísticas; no usar estos contadores como auditoría certificada. No hay secretos embebidos en frontend. El dashboard lee todas las filas y la deduplicación busca IDs en la hoja: evaluar volumen/cuotas antes de uso masivo y migrar almacenamiento si el crecimiento lo exige.

Referencias oficiales: https://developers.google.com/apps-script/guides/web y https://developers.google.com/apps-script/guides/properties
