# Roadmap

Un editor de planes MS Project-compatible, fiel al MSPDI, en Linux y Windows.
No es un visor ni una integración: es el núcleo de Project reimplementado por
etapas, con la fidelidad como regla y el corpus como medida. Este documento es
el plan; se actualiza cuando una fase cambia de estado, no antes.

## Las cuatro capas

| Capa | Qué es | Dónde vive |
|---|---|---|
| **Documento** | MSPDI: shapes, `LoadXml` leniente, `SaveXml` sin reconstruir | `Mspdi.js`; se gradúa a `lib/mspdi` de Bintana cuando haya segundo consumidor |
| **Motor** | Calendarios, CPM, recursos, costos | `Schedule.js` (a crear) |
| **Editor** | Comandos con undo/redo, tabla, panel de propiedades, settings, i18n | `Edit.js` + UI (a crear) |
| **Plataforma** | Linux hoy; Windows depende del port de Bintana (CI MSYS2/UCRT64, en progreso) | Bintana + paquete del proyecto |

La regla de oro del documento es intocable: `SaveXml` escribe en el árbol que
recibe y toca solo lo que los shapes modelan. Ningún comando del editor puede
reescribir lo no modelado.

## Fases

### 0 — Higiene, corpus y harness (hecha)

- Corpus durable en `tests/corpus/` (8 fixtures + README), con el XSD como
  referencia, no vendoreado.
- `tests/run.sh`: ida y vuelta por archivo, informe de `touched` y goldens en
  `tests/expected/`; `tests/FIDELITY.md` clasifica lo medido.
- Primer hallazgo, upstream: `Record.SaveXml` de Bintana no matchea un elemento
  cuya clave está en su default (UID 0, la tarea resumen) y lo reemplaza,
  perdiendo los hijos no modelados. Reportar a Bintana con el repro del corpus.
- Pendiente el paso que convierte un fixture en dorado: un `Save As → XML` de
  Project real (hay acceso a uno) y su apertura de vuelta en Project.

**Criterio de cierre**: los 8 archivos con counts estables, `problems`
idénticos in/out y diff canónico vacío salvo lista blanca documentada.

### 1 — Editor mínimo

- `Edit.js`: comandos `AddTask`/`RemoveTask`/`SetField` con undo/redo, dirty
  flag, guardar/guardar como/cerrar con cambios.
- Tabla como árbol con `Key = UID` (los resúmenes visibles y plegables); doble
  clic abre el panel de propiedades (TextBox, DatePicker, SpinBox, CheckButton).
- Alta de tarea: `UID = max+1`, `ID`, `OutlineLevel` del vecino.
- `Settings` bajo `bintana-project.*` (carpeta inicial) e i18n es/en.
- Sin CPM todavía: las fechas se editan a mano.

### 2 — Calendarios y CPM

- Modelar el header de Project que hoy cae en `Problems` y que el motor
  necesita: `MinutesPerDay/Week`, `DaysPerMonth`, `DefaultTaskType`,
  `WeekStartDay`, `ScheduleFromStart`.
- Calendarios completos (`WeekDays`, `WorkingTimes`, `Exceptions`,
  `BaseCalendarUID`), base y de recurso.
- CPM: FS/SS/FF/SF con lag, constraints, deadline, Task Types, effort-driven,
  slack y ruta crítica, `DurationFormat`, elapsed.
- **El oráculo es Project**: mismo archivo, comparar `Start`/`Finish`/slack por
  tarea. La fidelidad se mide, no se argumenta.

### 3 — Editor completo

- Indent/outdent/reorder con `OutlineNumber`/`WBS` coherentes (decidir con el
  corpus quién los recalcula).
- Panel de propiedades completo, recientes, cierre seguro, pulido.

### 4 — Gantt interactivo

- Selección sincronizada con la tabla; doble clic edita.
- Arrastrar barras (mueve), estirar extremos (cambia duración), dibujar y
  borrar dependencias.
- Zoom/timescale manual, scroll, ruta crítica, línea base fantasma.
- `Save()`/`Dump()` siguen siendo la prueba.

### 5 — Recursos y costos

- Work/material/cost, tasas con tabla temporal, calendario del recurso,
  asignaciones con unidades/trabajo, totales.
- Nivelación queda afuera por ahora.

### 6 — Distribución

- Windows primero: los compañeros van a usar la app, no solo recibir XML.
- Seguir el port de Bintana (zip portable sin verificar en un desktop real),
  bundle `.bta` (plan de Bintana, no empezado) o instalador.
- Aceptación: un XML editado acá abierto en Project sin diálogo de reparación.

## Lo que se decide no hacer

`.mpp`, validación XSD, XPath, streaming (heredado de `xml-plan`); nivelación,
EVM, impresión fiel, múltiples vistas simultáneas y campos personalizados
arbitrarios en la UI (un campo configurable recién si el corpus muestra uso
real). Cada uno con su trigger para reabrir.

## Riesgos

1. **Windows** depende del port de Bintana: nadie abrió todavía el zip en un
   Windows real.
2. **CPM fiel a Project** es el mayor trabajo del proyecto y solo se mide
   contra archivos reales.
3. **Recursos y costos** amplían mucho el modelo (tasas con fechas, contornos).
4. **Scope creep**: "proyectos generales" sin la lista de "no" es una promesa
   imposible.

## Decisiones abiertas

- Quién recalcula `OutlineNumber`/`WBS` al indentar (medir con el corpus).
- Granularidad del undo (por comando vs por campo).
- Panel de tareas modal o lateral.
- Si los resúmenes se editan o son solo lectura (deberían serlo: Project los
  deriva).
