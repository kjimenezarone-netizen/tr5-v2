# TR5-V2 — Proyecto completo actualizado v3.2: filtros dentro del cruce TR5/TR6

**Esta versión incluye todo el código fuente.** Es continuación de la entrega v3.1. Se integraron los filtros de columna, tipo de documento y oficio/ocupación directamente en el **paso 3: Trabajadores y Cruce Inspectivo TR5/TR6**. Ya no aparecen en el paso 2 de registros originales.

## Cómo usar los filtros y descargar el Excel

1. Seleccione intendencia, cargue un TXT TR5 o un par TR5 + TR6 del mismo RUC y pulse **Visualizar datos**.
2. En el **paso 3 (Cruce Inspectivo)** escriba un apellido, nombre, documento u oficio en **Buscar trabajador**. En **Columna de búsqueda** puede elegir *Todos los campos*, *Apellido paterno o materno*, *Nombres*, *Tipo o número de documento*, *Oficio u ocupación*, o una columna original específica del TR5/TR6.
3. Combine la búsqueda con **Tipo de documento**, **Oficio u ocupación** y opcionalmente **Presencia o condición**. Los valores se extraen de los reportes cargados. Los filtros adicionales avanzados por columnas siguen disponibles.
4. Revise cuántos **trabajadores** y **filas TR5/TR6 asociadas** coinciden. Pulse **Exportar resultados filtrados** para abrir automáticamente el paso 4, previsualizando el alcance filtrado, o seleccione manualmente *Resultados del filtro aplicado* en el centro de exportación.
5. Descargue el Excel. Incluye todas las filas originales correspondientes a cada trabajador encontrado (aunque haya varias ocupaciones o múltiples filas) y conserva columnas, valores, nombres de archivo y filas de procedencia.
6. Para quitar solamente los criterios sin eliminar archivos procesados, pulse **Limpiar filtros del cruce**. Para terminar la sesión utilice **Finalizar consulta y limpiar todo**, que pide confirmación. Descargar Excel no reinicia el sistema.

**Importante:** la búsqueda del **paso 2 (Registros originales)** es solo para consultar filas. La exportación por trabajadores depende de los filtros del **paso 3**, no de la búsqueda del paso 2. Los datos originales se conservan en memoria hasta que termine la consulta y no se editan los TXT.

## Archivos modificados en v3.2

- `index.html`: trasladar controles al cruce, mostrar estado de búsqueda y acceso directo a la exportación filtrada.
- `tr-filters.js`: criterios combinados por persona, apellidos, nombres, tipo documental, oficio/ocupación y columnas originales TR5/TR6.
- `tr-analysis.js`: poblar opciones dinámicas, aplicar los criterios, restablecerlos sin borrar selecciones y conservar resultados asociados.
- `tr-export.js`: reconocer nuevos filtros, documentar criterios en el XLSX y previsualizar el alcance correcto.
- `script.js`: retirar los antiguos filtros redundantes de la vista de registros originales y conservar su búsqueda independiente.
- `tests/tr-cruce-filtros-integracion.test.cjs`: casos sintéticos y reales, con cruces, fechas y trazabilidad.

## Validación de v3.2

- `node --test`: **26 pruebas aprobadas** en Node.js 22.
- Sintaxis de los JavaScript y unicidad de los IDs de HTML verificadas.
- Flujo de UI comprobado en Chromium con el HTML y scripts insertados localmente en una página de pruebas, por restricciones de navegación del entorno. Se comprobó la selección combinada y se descargó un XLSX válido de seis hojas. **No sustituye la comprobación manual al desplegar en un servidor normal.**
- Muestras: **6 filas TR5 + 121 filas TR6** presentes, y selección combinada de un trabajador con 2 filas TR5 + 1 fila TR6 conservadas.

## Instalación desde cero en Windows

1. Descomprima este ZIP. Abra la carpeta `TR5V2_Proyecto_Revisado` en Visual Studio Code.
2. Abra una terminal en esa carpeta, ejecute `node --test` y confirme que las 26 pruebas pasan.
3. Ejecute `py -m http.server 8000` y visite `http://localhost:8000` en Chrome/Edge. Requiere Internet para algunas dependencias externas del diseño y gráficos.
4. Para publicar en GitHub sin sobreescribir directamente `main`, clone el repositorio y cree una rama, copie el contenido corregido sin reemplazar `.git`, confirme `node --test`, haga commit y abra Pull Request.

```powershell
git clone https://github.com/kjimenezarone-netizen/tr5-v2.git
cd tr5-v2
git switch -c feat/filtros-cruce-tr-v3-2
# Copie aquí los archivos de esta carpeta sin reemplazar .git
node --test
git diff --check
git add -A
git commit -m "feat: integrar filtros de oficio y documento en cruce TR"
git push -u origin feat/filtros-cruce-tr-v3-2
```

**GitHub no se modificó automáticamente:** la conexión remota no concedió permisos de escritura. El ZIP incluye el código listo para revisión y publicación.

## Documentación

`DOCUMENTACION_CAMBIOS.xml`: documento actualizado de v3.2 (cambios e instrucciones).  
`DOCUMENTACION_CAMBIOS_V3_1.xml`: documentación histórica previa.  
`CAMBIOS_FILTROS_CRUCE_V3_2.patch`: diff entre v3.1 y v3.2.  
`CAMBIOS_APLICADOS_V3_1.patch`: diff histórico original de v3.1.

---

## Historial anterior — v3.1

# TR5-V2 — Proyecto revisado y corregido (v3.1)

Este paquete contiene el **código completo** extraído del RAR proporcionado por el usuario, con las mejoras implementadas en TR5/TR6 y RUC Masivo. No es un aplicador ni requiere descargar otro kit.

## Qué se cambió

1. Orden TR: **Carga → Registros originales → Trabajadores/cruce → Exportación Excel**.
2. Se eliminó de la **interfaz TR** el panel de columnas visibles; las columnas originales NO se borran del TXT, de la tabla ni de Excel.
3. Se centralizó Excel en un único panel con alcance, resumen de hojas, previsualización y descarga; el botón antiguo de descarga rápida se convirtió en acceso al centro.
4. La zona de carga se limpia automáticamente al finalizar con éxito, sin borrar los resultados procesados.
5. Se añadió **Finalizar consulta y limpiar todo**, con confirmación explícita, para TR y RUC. Descargar Excel NO limpia la consulta.
6. Los filtros secundarios y gráficos se consultan en paneles desplegables; las tarjetas de hallazgos rápidos TR reemplazan opciones duplicadas.
7. Se corrigió la cancelación real del RUC, se mejoró el aislamiento de tareas y se protegió la presentación HTML de valores importados.
8. La ficha TR6 diferencia las dos columnas de régimen (salud y pensión). Los textos laborales expresan *indicadores a verificar*, no conclusiones de incumplimiento.
9. Se quitaron funciones JavaScript sin referencias y se incorporaron pruebas de regresión.

## Requisitos

- Navegador moderno (Chrome/Edge/Firefox).
- Para pruebas automatizadas: **Node.js 18 o posterior** (validado con Node.js 22).
- Para servir la aplicación en local: **Python 3** o extensión **Live Server** de VS Code.
- Conexión a Internet si se usan Chart.js, Tailwind y html2pdf desde sus CDN.

## Uso local

Abra esta carpeta en Visual Studio Code y, desde su terminal:

```powershell
node --test
py -m http.server 8000
```

Visite `http://localhost:8000`, seleccione intendencia y pruebe los lectores. No ejecute el `index.html` desde `file://` si puede usar un servidor local, ya que el Worker puede necesitar HTTP.

## Publicar en GitHub sin tocar `main` directamente

1. Haga una copia de seguridad o clone el repositorio:

```powershell
git clone https://github.com/kjimenezarone-netizen/tr5-v2.git
cd tr5-v2
git switch -c mejora/reorganizacion-lectores-v3-1
```

2. Copie **el contenido** de esta carpeta corregida a la raíz del clon. Mantenga la carpeta `.git` del clon (no sustituir). Revise `git status` y los archivos afectados.
3. Verifique y publique:

```powershell
node --test
git diff --check
git add -A
git commit -m "feat: reorganizar lectores TR5 TR6 y RUC masivo"
git push -u origin mejora/reorganizacion-lectores-v3-1
```

4. En GitHub cree el Pull Request y revise los archivos antes de fusionarlo en `main`.

## Comprobación técnica de esta entrega

- **21 pruebas automáticas pasadas**, sintaxis de JS correcta.
- **127 registros** de las muestras: **6 TR5 + 121 TR6**, agrupados en **121 identidades** sin pérdida de filas; **4 identidades** en ambos reportes.
- HTML: **4 pasos**, **151 IDs únicos** y ningún control de selección de columnas TR.
- **Pendiente:** prueba visual y de clics en navegador real. Chromium no pudo navegar en este entorno por una restricción administrativa.

## Archivos de documentación

- `DOCUMENTACION_CAMBIOS.xml`: especificación técnica, matriz de 21 cambios, pruebas, instrucciones y limitaciones.
- `CAMBIOS_APLICADOS.patch`: diferencia detallada entre el RAR original y el código corregido.

## Advertencias

- RUC soporta **TXT y ZIP**. No se implementaron lectores RAR ni TAR.
- El repositorio público puede contener datos en `muestras/`; verifique si esas muestras requieren anonimización antes de publicarlas.
- Los controles de limpieza no modifican originales ni los Excel ya descargados. Solo descartan datos temporales en memoria y vistas.
