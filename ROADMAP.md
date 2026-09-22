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
- Primer hallazgo, upstream y ya arreglado en Bintana (2026-09-22):
  `Record.SaveXml` no matcheaba un elemento cuya clave está en su default
  (UID 0, la tarea resumen) y lo reemplazaba, perdiendo los hijos no modelados.
  Una clave ahora es identidad y se escribe siempre; el issue se cerró y los
  goldens se regeneraron (`tests/FIDELITY.md`).
- Pendiente el paso que convierte un fixture en dorado: un `Save As → XML` de
  Project real (hay acceso a uno) y su apertura de vuelta en Project.

**Criterio de cierre**: los 8 archivos con counts estables, `problems`
idénticos in/out y diff canónico vacío salvo lista blanca documentada.

### 1 — Editor mínimo

**Hecha** (2026-09-22). Lectura: abrir por argumento, drop y diálogo; tabla
árbol con `Key = UID` (resúmenes plegables, duración en la unidad del
`DurationFormat`); Gantt con resúmenes como corchetes, criticidad en rojo y la
fila seleccionada marcada. Edición: `Edit.js` con `SetFields`, `AddTask`,
`RemoveTask` e `Indent`, undo/redo por **snapshot por comando** (una baja con
links vuelve entera), dirty flag, guardar/guardar como/cerrar con pregunta; el
panel lateral edita la tarea seleccionada y solo el nombre de un resumen
(Project deriva lo demás). El harness corre además un round trip de edición
guiado (`check-edit`) con su golden.

- `Settings` bajo `bintana-project.*`: carpeta del último archivo y timescale,
  leídos y escritos solo por la ventana (un check no toca nada). i18n: los
  textos de los forms se traducen al construirse, los del código van por
  `Locale.Text`, y `po/es.po` es el catálogo que viaja. El harness fija
  `LANGUAGE=en` para que los goldens no dependan del idioma.
- Queda: el diálogo único de settings, el campo personalizado que muestra la
  lista y la unidad de una duración sin sufijo.
- Sin CPM todavía: las fechas se editan a mano, y `OutlineNumber`/`WBS` quedan
  como estaban -- Project los deriva.

### 2 — Calendarios y CPM

**A medias** (2026-09-22). Hecho: el header de Project que el motor necesita
(`MinutesPerDay/Week`, `DaysPerMonth`, `DefaultTaskType`, `WeekStartDay`,
`ScheduleFromStart`, `DefaultStartTime/FinishTime`, `DurationFormat`,
`WorkFormat`) y los calendarios completos (`WeekDays`, `WorkingTimes`,
`Exceptions`, `BaseCalendarUID`), con `Schedule.js`: aritmética de tiempo
laborable, herencia del calendario base, feriados, la pasada forward del CPM
con FS/SS/FF/SF y lag en décimas de minuto, y la pasada backward con slack y
`Critical` (límite 0: `CriticalSlackLimit` no está modelado). Botón
**Recalculate** (F5) como un undo, y `check-cpm` con 26 aserciones calculadas a
mano. Además, la edición de vínculos del panel (Link/Unlink, tipo y lag en
minutos) -- de la fase 1, pero llegó acá porque sin vínculos el CPM no tiene
qué calcular. `ConstraintType`/`ConstraintDate`/`Deadline` están modelados y
el forward pass honra las duras (MSO/MFO/SNET/FNET); ALAP/SNLT/FNLT dejan las
fechas del archivo y el deadline solo se cuenta en el log.

- Falta: Task Types y effort-driven, elapsed, y el calendario de recurso.
- **El oráculo es Project**: mismo archivo, comparar `Start`/`Finish`/slack por
  tarea. La fidelidad se mide, no se argumenta. El corpus sintético no es
  CPM-consistente (sus fechas están escritas a mano), así que la validación
  real espera el archivo de Project.
- Decisión abierta que el archivo real define: si Project tolera los defaults
  de calendario que `SaveXml` borra (`DayWorking=false`, `IsBaseCalendar=false`,
  `EnteredByOccurrences=false`, `Period=0`, `DaysOfWeek=0`).

### 3 — Editor completo

**Adelantado** (2026-09-22): el panel ya edita nombre, fechas, duración,
avance, hito, restricción, deadline, notas y los vínculos; el cierre con
cambios pregunta; `OutlineNumber`/`WBS` los deriva Project.

- Queda: reordenar filas, la lista de recientes, y el pulido del panel.

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

**Adelantado**: export del gráfico a PNG/PDF, que es lo que un compañero sin la
app puede abrir.

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

## Decisiones tomadas

- **`OutlineNumber`/`WBS` al indentar**: los deriva Project; la app los deja
  como están y no los inventa (se medirá con el archivo real).
- **Undo**: snapshot por comando, no comandos inversos; una baja con links
  vuelve entera (`Edit.js`).
- **Panel de tareas**: lateral dentro de un `Split`, no modal.
- **Resúmenes**: solo su nombre se edita; fechas, duración y avance son lo que
  Project deriva de los hijos.
- **Orden y filtro por columnas**: no por ahora. La tabla es el WBS en orden de
  archivo y el Gantt dibuja ese orden; ordenar rompería la adyacencia
  padre-hijo. Si se quiere, será una vista aparte.
- **Gantt**: el scroller es suyo (vertical por filas, horizontal por timescale),
  no sincronizado con la tabla -- la misma simplificación de siempre: comparten
  identidad, no geometría.

## Abiertas

- Si una tarea nueva sin fechas debe heredar algo del vecino o quedar vacía
  (hoy queda vacía: una fecha inventada es una mentira).
- Qué hacer con `OutlineNumber`/`WBS` si el archivo real muestra que Project no
  los recompone al abrir.
