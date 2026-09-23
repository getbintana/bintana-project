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

- `Settings` bajo `bintana-project.*`: carpeta, timescale, campo personalizado
  que muestra la lista y unidad de una duración sin sufijo; los edita el
  diálogo **Settings** de la barra, y solo la ventana los lee o escribe (un
  check no toca nada). i18n: los textos de los forms se traducen al
  construirse, los del código van por `Locale.Text`, y `po/es.po` es el
  catálogo que viaja. El harness fija `LANGUAGE=en` para que los goldens no
  dependan del idioma.
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

**Ampliado** (2026-09-22): `Estimated` y `EffortDriven` están modelados (y en
el panel), y las duraciones elapsed (`ed`, `eh`, …) se leen, se escriben y se
planifican en tiempo calendario -- el caso en `check-cpm` lo distingue del
laborable. `Type` (Fixed Units/Duration/Work) se modela, pero su semántica
necesita asignaciones: queda con recursos.

**Task Types** (2026-09-22): el combo en la pestaña Tarea, la identidad
aplicada al asignar -- effort-driven conserva el trabajo y acorta al sumar
unidades, Fixed Duration ignora el flag, el resto conserva la duración y deja
crecer el trabajo (`assignmentDuration`) -- y la misma identidad aplicada por
`recalculate` a todo el plan (`workDuration`: la tarea se planifica en
`trabajo / unidades`, o deriva el trabajo de la duración si es Fixed Duration),
con ocho aserciones en `check-cpm`. Falta el calendario de recurso.

**La numeración de los vínculos** (2026-09-23): el motor leía `Type` 0=SS,
2=FF, 3=SF; el XSD dice 0=FF, 1=FS, 2=SF, 3=SS, y el corpus sintético lo
repetía. Se corrigieron las dos pasadas, el combo, la tabla y los fixtures, y
de paso los defaults del shape se alinearon al XSD: `Type` (tarea y vínculo)
no tiene default, así que arranca en -1 y un 0 presente se escribe -- antes se
borraba y un FF volvía como FS --; `DefaultTaskType` es 1, `ScheduleFromStart`
es true y `MaxUnits` es 1, que es lo que la ausencia significa. El fixture
`09-defaults` fija el lado que no se puede perder y `check-cpm` sube a 49
aserciones con los defaults del shape.

- **El oráculo es Project**: mismo archivo, comparar `Start`/`Finish`/slack por
  tarea. La fidelidad se mide, no se argumenta. El corpus sintético no es
  CPM-consistente (sus fechas están escritas a mano), así que la validación
  real espera el archivo de Project.
- **Constraints blandas** (2026-09-23): SNLT/FNLT no pinchan nada -- la tarea
  se planifica ASAP y `notMet` cuenta las fechas que pasó, leídas contra la
  fecha cruda (un feriado en el medio no corre la promesa); ALAP conserva las
  fechas del archivo porque colocarla tarde es el backward pass de Project.
- Decisión abierta que el archivo real define: si Project tolera los defaults
  de calendario que `SaveXml` borra (`DayWorking=false`, `IsBaseCalendar=false`,
  `EnteredByOccurrences=false`, `Period=0`, `DaysOfWeek=0`).

### 3 — Editor completo

**Hecha** (2026-09-22): el panel edita nombre, fechas, duración, avance, hito,
restricción, deadline, notas y los vínculos; Up/Down reordenan con el subárbol;
Recent guarda los últimos ocho archivos; el cierre con cambios pregunta;
`OutlineNumber`/`WBS` los deriva Project.

**Profesionalizada** (2026-09-22): barra de menú (Archivo/Editar/Ver/
Herramientas/Ayuda), toolbar de íconos con `Style: "toolbar"`, barra de estado,
y cada comando declarado una vez como `Action` -- un solo `Enabled` y una sola
etiqueta para el botón, el ítem de menú y su atajo. Los combos hablan en
nombres ("Ajustar a la ventana", "Fin a inicio", "Lo antes posible") y el
catálogo `es.po` los cubre. El panel de propiedades es un `Switcher` de cuatro
pestañas (Tarea/Vínculos/Recursos/Proyecto) dentro de un `Scroller` con
`Arrangement` --que es lo que lo hace ocupar el ancho--, y el log arranca
oculto (Ver → Ver log).

**Configuración del plan** (2026-09-22): la pestaña Proyecto edita el
encabezado (fecha de inicio, calendario por defecto, minutos por día/semana,
días por mes, tipo de tarea por defecto, inicio de semana y moneda) y lista los
calendarios; **Editar…** abre uno entero -- días laborables con sus tramos como
texto (`08:00-12:00 13:00-17:00`, porque un día puede tener más de uno) y
excepciones (feriados). Los minutos por día ahora mandan: es lo que significa
un `1d` tipeado. El recálculo automático es una opción, apagada por defecto.
Los campos personalizados que el archivo define se editan en la pestaña Tarea
(por `FieldID`, el mismo que puede mostrar la columna de la lista). La barra
tiene un filtro por nombre --el match y sus ancestros, con la lupa para
limpiar-- y el menú Editar, **Save Baseline**, con la línea base dibujada como
barra fina debajo de cada tarea.

**Autosave y recuperación** (2026-09-23): mientras hay cambios sin guardar se
escribe una copia cada minuto en el directorio de config (nunca al lado del
plan, que puede ser de solo lectura); al abrir, una copia más nueva que el
archivo se **ofrece** -- no se toma -- y se borra al guardar. Se apaga desde
Settings.

### 4 — Gantt interactivo

**Hecha** (2026-09-22): selección sincronizada con la tabla, arrastrar una
barra para mover la tarea, su extremo para estirar (la duración sale del
tiempo laborable del calendario de la tarea) y Ctrl-arrastrar de una barra a
otra para dibujar un FS; nada se escribe hasta soltar, así que un gesto es un
undo. Zoom/timescale manual, scroll y ruta crítica ya estaban. `check-drag`
afirma los tres gestos con la geometría del propio gráfico.

**Línea base y seguimiento** (2026-09-22): `Baseline`, `ActualStart` y
`ActualFinish` modelados (01 y 06 dejan de reportarlos en `Problems`); **Save
Baseline** en el menú Editar guarda el plan como está en un undo, el Gantt
dibuja la línea base como barra fina debajo de la tarea, y el porcentaje mueve
las fechas reales como las lee Project (arriba de cero hay inicio real, al
ciento hay fin real, en cero no hay ninguno).

**El tipo al dibujar** (2026-09-23): el combo **Vínculo nuevo**, en la barra del
Gantt, elige los cuatro tipos (FS por defecto) y **Ctrl + arrastrar** crea el
que dice; `check-drag` lo afirma con un Start to start.

- Queda: dibujar desde el extremo para enlazar en vez de redimensionar, y
  varias líneas base.

### 5 — Recursos y costos

**Hecha en lo esencial** (2026-09-22): recursos (tipo, unidades máximas, tasas
estándar y extra, costo por uso, calendario) y asignaciones (unidades, trabajo,
costo) modelados y editables desde la pestaña Recursos: alta/edición/baja de
recurso (la baja se lleva sus asignaciones), y la asignación de un recurso a la
tarea seleccionada, con el trabajo calculado desde la duración. El costo se
calcula -- trabajo por la tasa en un recurso work, unidades por la tasa en uno
material, más el costo por uso, y el `Cost` del archivo manda si lo trae -- y
`check-cpm` afirma los casos. La **sobreasignación se detecta** (la columna
Peak suma las asignaciones que se solapan y el log cuenta los recursos pasados
de su máximo); no se nivela.

**El costo a la vista** (2026-09-23): la tabla tiene una columna **Costo** por
tarea (`taskCost`, vacía cuando la tarea no cuesta nada), la pestaña Proyecto
muestra el **costo total** del plan (`projectCost`) y el informe usa la misma
cuenta. Nada de esto se guarda: el `Cost` del archivo manda donde lo trae.

- Falta: tablas de tasas por fecha, contornos de trabajo y calendario de
  recurso. Nivelación queda afuera por ahora.

### 6 — Distribución

**Adelantado**: export del gráfico a PNG/PDF y **Archivo → Informe…**, que
arma con `lib/report` el plan como documento paginado (tareas con fechas,
duración, avance y costo, con total) y lo guarda en PDF. Es lo que un
compañero sin la app puede abrir.

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
