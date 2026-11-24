# Configurar las estadísticas del lector

El lector procesa archivos y genera Excel localmente. Si necesitas estadísticas, prepara una hoja de pruebas en Google Workspace, abre el proyecto vinculado y actualiza Code.gs. Ejecuta inicializar para crear Eventos_v3. La pestaña Eventos de versiones anteriores se conserva aparte.

En las propiedades del script, configura:

| Propiedad | Significado |
| --- | --- |
| INSTITUTIONAL_DOMAIN | Dominio de Google Workspace autorizado |
| ADMIN_EMAILS | Correos de administradores separados por comas |
| TELEMETRY_MODE | OFF, INSTITUTIONAL o ANONYMOUS. El valor inicial es OFF. |
| OFFICES_BY_USER | Objeto JSON de correo institucional a código de intendencia para el modo INSTITUTIONAL |

Ejemplo sintético de asignación de intendencias:

~~~json
{"inspectora@example.test":"IRE-LAMBAYEQUE"}
~~~

Publica como aplicación web dentro del dominio de pruebas. Verifica que Session.getActiveUser().getEmail() devuelva el correo del usuario real con el modo de ejecución elegido. Cuando Google no entrega el correo, el servicio deniega el acceso. Conserva los permisos de la hoja y utiliza una ruta institucional que permita autenticar la sesión desde el origen del lector. El modo de ejecución y la disponibilidad de cookies dependen de la configuración de Google Workspace y del navegador. Nunca uses Session.getEffectiveUser() como identidad del visitante.

## Compilar y probar la integración

Configura LEC_API_URL con la URL HTTPS aprobada o una ruta de la misma aplicación, por ejemplo /api/lector. Si se utiliza una URL de otro origen, configura LEC_API_CREDENTIALS=include y prueba la política CORS y las redirecciones con la sesión real. Una pasarela institucional del mismo origen puede ser necesaria si el despliegue de Apps Script no admite peticiones con credenciales desde Pages.

Establece LEC_TELEMETRY_MODE con el mismo valor del script. El modo institucional asigna la intendencia según la cuenta aprobada y rechaza eventos de otra intendencia. El modo anónimo produce estadísticas declaradas y las identifica como tales en el tablero. El panel administrativo siempre requiere una cuenta de ADMIN_EMAILS.

| Petición | Resultado esperado |
| --- | --- |
| GET | Estado del servicio y versión de API |
| POST, accion LOGIN | Token temporal para el panel de la cuenta autorizada |
| POST, accion DASHBOARD con token | Agregados del modo activo y últimos 50 eventos |
| POST, accion LOGOUT con token | Revocación de la sesión administrativa |
| POST, accion TELEMETRY_SESSION | Token temporal para registrar eventos institucionales |
| POST, evento | Confirmación, duplicado, rechazo o límite de frecuencia |

El cuerpo se envía como JSON con Content-Type text/plain;charset=UTF-8. El servidor espera que la cuenta de Google validada siga activa al utilizar un token institucional. Las contraseñas ADMIN_USER y ADMIN_PASSWORD de la versión anterior ya no se utilizan.

El panel limita la lectura a los últimos 5 000 eventos y separa los tipos de procedencia. Comprueba los duplicados recientes en la hoja y utiliza una caché temporal. Las métricas no guardan textos, archivos, DNI, RUC ni correos. Define con el responsable de datos la retención de Eventos_v3 y valida la capacidad con el volumen real.

Antes de habilitar el servicio, prueba desde el sitio de ensayo el acceso con cuenta autorizada, el rechazo de una cuenta sin acceso, el registro, la revocación, la caída temporal del servidor y el funcionamiento local del lector. Las pruebas automatizadas utilizan una sesión y una hoja simuladas.

Referencias:

- [Aplicaciones web de Apps Script](https://developers.google.com/apps-script/guides/web)
- [Identidad del usuario activo en Apps Script](https://developers.google.com/apps-script/reference/base/session)
