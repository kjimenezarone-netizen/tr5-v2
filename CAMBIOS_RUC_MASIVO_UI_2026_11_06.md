# RUC Masivo — Simplificación de interfaz y descarga directa

Fecha: 2026-11-06. Alcance: **exclusivamente RUC Masivo**. No se modificó el flujo TR5/TR6.

## Cambios implementados

| Paso | Resultado |
|---|---|
| 1 — Cargar archivos TXT/ZIP | Eliminado el bloque de diagnóstico técnico. Se conservan selección de archivos, procesamiento, cancelación, estado y observaciones. |
| 2 — Explorar resultados | En **Mostrar** solo permanecen **Todos los registros** y **RUC repetidos**. |
| 2 — Explorar resultados | Eliminados **RUC con diferencias** y **Selección de trabajo** del desplegable. |
| 2 — Explorar resultados | Eliminados selección masiva de empresas, casillas por registro, limpiar selección y contador. |
| 2 — Explorar resultados | Eliminadas **Ayuda sobre vistas y selección** y **Columnas visibles de registros RUC**; la tabla presenta todas las columnas originales. |
| 2 — Explorar resultados | Se conservan búsqueda, vista por registros / empresas únicas, tabla, paginación y ficha de empresa. |
| 3 — Descargar Excel | Se eliminaron el desplegable de alcances, selector de archivo de origen y previsualización. Hay un único botón **Descargar Excel**. |
| 3 — Descargar Excel | Se conserva **Finalizar consulta y limpiar todo**, con confirmación explícita. |

## Regla de descarga

- **Sin búsqueda y con Mostrar = Todos los registros:** descarga todo el conjunto de registros originales procesados, de todos los TXT/ZIP cargados en esa consulta.
- **Con búsqueda escrita o Mostrar = RUC repetidos:** descarga **únicamente las filas que coinciden con los filtros de la sección 2**. Ambas condiciones se pueden combinar.
- Cambiar entre vista **Registros** y **Empresas únicas** no cambia el alcance: la descarga sigue siendo de los registros originales, no de una fila consolidada.
- Si la búsqueda no devuelve registros, el botón queda deshabilitado.
- Descargar **no** limpia la sesión ni modifica los TXT/ZIP.

El libro conserva las hojas **Resumen**, **Original_1, Original_2...** (según las fuentes que tengan registros en el alcance) y **Fuentes**. Se mantienen encabezados, valores, ceros iniciales, filas repetidas, referencias ZIP/TXT, fila y línea original. No se exportan hojas de consolidación opcionales en el nuevo flujo directo; la vista de empresas sigue disponible en la sección 2.

## Archivos modificados

- `index.html`: controles de RUC Masivo y paso 3.
- `ruc.js`: lógica de filtros de la vista, indicadores y descarga directa.
- `tests/ui-carga-regresion.test.cjs`: prueba de interfaz ajustada al nuevo flujo.
- `tests/ui-organizacion-regresion.test.cjs`: contrato de limpieza actualizado.
- `tests/ruc-exportacion-directa.test.cjs`: nuevas pruebas de exportación completa, exportación filtrada y simulación de acciones de la UI (archivo nuevo).

`file-parser.js`, `processing-client.js`, `processing-worker.js`, `tr-analysis.js`, `tr-export.js`, `tr-filters.js`, `script.js` y los archivos de TR5/TR6 se preservaron.

## Verificación

Se ejecutó `node --test` en la copia completa del proyecto: **29 pruebas aprobadas, 0 fallidas**.

Se realizaron pruebas automatizadas de modelo y de eventos de la interfaz mediante simulación del DOM, comprobando carga válida, descarga sin filtro, búsqueda, filtro de RUC repetidos, conservación de sesión y confirmación de reinicio.

**Pendiente antes de publicar en producción:** validación visual/manual en Chrome/Edge, incluyendo carga real de archivos SUNAT, revisión del XLSX en Microsoft Excel y pruebas responsive. Un intento de automatización con Chromium fue bloqueado por las restricciones del entorno de prueba, por lo que no se declara probado en navegador real.

## Cómo aplicar al repositorio Git

Desde la raíz de un clon actualizado de `kjimenezarone-netizen/lector-tr5-sunafil`:

```powershell
git switch main
git pull origin main
git switch -c mejora/ruc-masivo-descarga-directa
git apply --check .\RUC_MASIVO_MEJORAS_INTERFAZ_DESCARGA.patch
git apply .\RUC_MASIVO_MEJORAS_INTERFAZ_DESCARGA.patch
node --test
git status
git add index.html ruc.js tests/ui-carga-regresion.test.cjs tests/ui-organizacion-regresion.test.cjs tests/ruc-exportacion-directa.test.cjs
git commit -m "feat(ruc): simplificar filtros y descarga directa Excel"
git push -u origin mejora/ruc-masivo-descarga-directa
```

Copiar el `.patch` descargado a la raíz del repositorio **antes** de ejecutar los comandos `git apply`. En GitHub, abrir un Pull Request hacia `main` y revisar los cambios antes de fusionar.

**Nota:** la rama remota y el Pull Request no se crean automáticamente desde esta entrega porque la integración de GitHub carece de permiso de escritura.
