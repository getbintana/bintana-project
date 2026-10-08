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
fila seleccionada marcada. Edición: `Edit.js` con `setFields`, `addTask`,
`removeTask` e `indent`, undo/redo por **snapshot por comando** (una baja con
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

- **El oráculo es Project** (2026-09-23, primer archivo real): `urbano
  v5.05052026.xml`, guardado por Project 16.0, medido con `check-oracle` --
  compara tarea por tarea contra las fechas del archivo. Resultado: **42 de 42
  tareas iguales** en inicio, fin y criticidad. Lo que hizo falta para llegar:
  `CalendarUID=-1` es el calendario del proyecto (el motor caía al del
  esquema), las tareas `Manual` y las terminadas (`ActualFinish`) conservan sus
  fechas, un resumen manual fija el piso de su rama, y el pase atrás arranca
  del `FinishDate` del proyecto. La ida y vuelta del archivo no pierde nada
  (`problems` 5396 → 5337 al modelarse `Manual`) y `tests/FIDELITY.md` §D lo
  detalla. Queda abrir la salida en Project para el visto bueno final.
- **La holgura en la unidad del archivo** (2026-10-01): `TotalSlack`,
  `FreeSlack`, `StartVariance` y `FinishVariance` son décimas de minuto en el
  MSPDI (`<TotalSlack>4800` es un día en el archivo real; MPXJ las escribe con
  `printDurationInIntegerTenthsOfMinutes`) y el motor escribía minutos: todo
  plan recalculado salía con la holgura diez veces menor. Ahora el shape guarda
  la unidad del archivo, como `LinkLag`, y `check-oracle` compara también la
  holgura. **Mide 35 de 42 tareas distintas** -- muchas por +3 días exactos
  (Project da `LateFinish` 01/06 a las AWS, el motor 04/06) --, así que el pase
  atrás todavía no es el de Project: el oráculo lo informa pero no falla por
  eso hasta que se arregle (el pase atrás ignora los vínculos de resúmenes).
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

**El `<Project>` del XSD, entero y en diálogos** (2026-09-23): el encabezado
se modela completo (identidad, programación, cálculo, moneda y las banderas
administrativas) y el panel deja de editarlo: la pestaña Proyecto selecciona.
**Datos del proyecto…** (`ProjectForm`) lleva la identidad y la información
--nombre, título, asunto, autor, gerente, compañía, categoría, revisión,
creación y último guardado, fecha de inicio, fecha de estado, calendario y
moneda--; **Opciones del proyecto…** (`OptionsForm`) los valores por defecto y
los switches del archivo, en solapas de Valores por defecto / Cálculo / Valor
ganado. Las banderas que escribe Project (externally edited, actuals in sync,
remove file properties, admin project) quedan modeladas sin diálogo. Los
`problems` del corpus caen a cero en ocho de los diez fixtures.

**Varios calendarios** (2026-09-23): se administran desde el menú **Proyecto →
Calendarios…** (`CalendarsForm`: la lista con Nuevo…/Editar…/Eliminar, cada
uno un undo vía `Edit.addCalendar`/`removeCalendar`, y el nuevo es una copia
de la semana real del elegido). El panel **asigna**: **Calendario por
defecto** en Proyecto, y **Calendario** en la tarea y en el recurso (Del
proyecto o uno en particular), que es lo que el motor ya leía. `CalendarForm`
muestra la semana **efectiva** (la herencia del base incluida, vía
`WorkCalendar`) y al aceptar la escribe como propia del calendario.

**Autosave y recuperación** (2026-09-23): mientras hay cambios sin guardar se
escribe una copia cada minuto en el directorio de config (nunca al lado del
plan, que puede ser de solo lectura); al abrir, una copia más nueva que el
archivo se **ofrece** -- no se toma -- y se borra al guardar. Se apaga desde
Settings.

**Las columnas a la vista** (2026-09-23): **Ver → Columnas…** (`ColumnsForm`)
elige qué muestra la tabla además del nombre -- que es el árbol y no se va --,
agregando y sacando: duración, fechas, avance, crítica, hito, trabajo, costo,
EDT, prioridad, restricción, fecha límite, calendario, tipo de tarea, notas y
el campo personalizado del archivo. El catálogo `COLUMNS` declara id, ancho y
alineación, y `cells`/`applyColumns` arman fila y encabezado juntos para que
una columna que no se muestra no se lea. Es una vista: se recuerda en Settings
y no toca el archivo (`check-edit` arma la tabla de nuevo y el plan no cambia).

**El menú del encabezado** (2026-09-29): el clic derecho en un encabezado de
columna -- el gesto de Project para agregar o sacar una columna -- ahora abre su
propio menú, con **Ocultar esta columna** (la que se apretó; sobre el nombre el
ítem está grisado, porque el nombre es el árbol), **Mostrar todas las columnas**
(que solo significa algo mientras falte alguna) y **Columnas…**. El menú se arma
en cada clic porque lo que puede hacer depende de la columna: `Tasks_HeaderClick`
devuelve el arreglo y el runtime le pasa la columna a cada handler.
`check-edit` lo afirma con el clic secundario, el ítem gris sobre el nombre y
una columna ocultada que no mueve el plan.

El bullet que decía que el encabezado no emitía ningún evento de puntero quedó
viejo: el runtime lo tuvo (`HeaderMenu`/`HeaderClick`, con su prueba
`TableHeaderMenu`), así que no hay issue que reportar -- y si lo hubiera, el
directorio de issues de Bintana borra lo que ya se llenó en vez de archivarlo.

- **El encabezado inserta y reordena** (2026-10-08): el menú tiene **Insertar
  columna…** --las que faltan, a la izquierda del encabezado apretado--,
  **Mover a la izquierda/derecha** y el diálogo de Columnas conserva el orden
  en vez de volver al del catálogo. Queda sin hacer arrastrar el encabezado.

- **Formato del gráfico** (2026-10-08): **Ver → Formato del gráfico…**
  (`FormatForm`). Cinco temas de color (`GANTT_THEMES`, un par claro/oscuro
  cada uno, con la tarea crítica siempre aparte de la común), tres tamaños de
  barra, un dato escrito a la derecha de la barra (`geom.labelOf`, que la
  aplicación resuelve con los mismos valores que las columnas más los
  recursos) y los interruptores de críticas, avance, dependencias y hoy. Es una
  preferencia de la vista como las columnas: claves sueltas en `Settings`, sin
  tocar el archivo, y el gráfico exportado la usa. **No es** formato por tarea
  (negrita o color de una barra en particular): MSPDI no lo guarda, así que
  sería algo que el archivo pierde.

- **Copiar y pegar, filtros de estado, esquema y zoom** (2026-10-08): **Copiar
  tarea** guarda la tarea con su rama --enlaces internos y asignaciones-- y
  pone el texto separado por tabuladores en el portapapeles; **Pegar** repone
  la copia con UID nuevos, o crea una tarea por línea si el texto viene de
  afuera (nombre y, si hay columna de duración, la duración). Ctrl+C/V
  funcionan sobre la lista y el gráfico, no en los campos. Un combo de
  **estado** junto al filtro (críticas, sin empezar, en curso, completadas,
  atrasadas, hitos) que compone con el nombre. **Ver →** Expandir/Contraer
  todo y Mostrar nivel 1–3, y Acercar/Alejar/Ajustar (Ctrl +, Ctrl -, Ctrl 0).
  Todo es de la vista o edición estándar: el MSPDI no cambia.

### 4 — Gantt interactivo

**La vista clásica** (2026-09-29): era la meta grande de la fase -- el plan a
la izquierda, el Gantt a la derecha, filas alineadas y un solo scroll
vertical. Se hizo en tres partes y ninguna era de la app:

- El runtime no podía decir la geometría de una tabla. `GtkColumnView` no
  expone la altura de una fila (vive en las fábricas de celdas), ni el scroll
  (el `GtkScrolledWindow` que este control ya envuelve tenía el ajuste ahí,
  sin exponerlo), ni el encabezado (que GTK 4 no puede ni esconder). Salieron
  `RowHeight`, `HeaderHeight`, `ScrollY`/`ScrollMaxY` y el evento `Scroll`, con
  `TableGeometry` en el runtime afirmándolos.
- **El filtro toma filas de las dos panes.** El gráfico recibía el plan entero
  y la lista el plan filtrado, así que con un filtro la fila *i* del gráfico era
  otra tarea y cada barra quedaba al lado del nombre equivocado. Ahora ambas
  panes llaman a `visibleTasks` en el mismo momento -- una función, no un
  cache: un comando reemplaza los registros de tarea (el Deshacer lo hace) y una
  lista cacheada dibujaba el plan de antes de la edición, que es lo que
  `check-drag` vio cuando el redimensionado dejó de mover nada.
- **La superficie y los encabezados** (2026-09-29): el gráfico se apoya en la
  misma superficie que la lista porque lleva **la misma clase** —`view`—, que es
  la que el tema usa para pintar una superficie y la que la lista ya lleva
  puesta (el tema escribe la lista como `columnview.view`). Con ella el fondo y
  la tinta son los del tema, sin ningún valor copiado que pueda quedar viejo.
  La clase la encontró quien miró la pantalla, después de dos valores que no
  cambiaron nada, y el motivo de que fallaran está medido: **un control no
  pinta fondo propio**, así que un `Background` en un `DrawingArea` es un
  no-op, y un valor puesto encima de la clase que sí funciona es peor que nada
  (el runtime lo escribe por encima del tema y los dos pelean). Y el encabezado de la lista tiene un alto
  mínimo de 34 px, porque **el encabezado no sigue la tipografía de la lista**
  (medido: a 10, 11, 12 y 13 puntos el encabezado sigue en 25 y las filas van de
  36 a 41). Con ese alto entran las dos bandas de la regla a 9 puntos, sin
  encoger la letra ni perder el mes.
- **El panel se reorganiza** (2026-10-08): había crecido hasta no servir. La
  pestaña **Tarea** era una grilla de unos treinta controles en seis secciones
  con **Aplicar** al fondo, y **Recursos** mezclaba el editor del recurso --que
  es del plan-- con las asignaciones --que son de la tarea--. Ahora son cuatro
  pestañas: **Tarea** (nombre, fechas, avance, hito, manual, notas),
  **Avanzado** (tipo, calendario, esfuerzo, estimada, restricción, fecha límite,
  campo personalizado, hipervínculo), **Vínculos** y **Recursos**, esta última
  solo con las asignaciones. Los recursos pasan a **Proyecto → Recursos…**
  (`ResourcesForm`), junto a Calendarios y Campos personalizados, y llaman a
  `Edit` como ellos. **Aplicar** está debajo de las pestañas, fuera del scroll, y solo se ve en
  las dos primeras (`PropsTabs_Switch`).
- **La pestaña Proyecto sale del panel** (2026-09-30): el panel lateral tiene
  tres pestañas y las tres son de la tarea —Tarea, Vínculos, Recursos— porque
  es lo que cambia con la selección. Lo del plan entero estaba en una cuarta,
  y sus dos primeros botones eran duplicados exactos de dos ítems del menú
  **Proyecto**. Lo que no estaba en el menú se movió a donde corresponde:
  el **calendario por defecto** y el **costo total** al diálogo de **Datos del
  proyecto…** —el `CalendarUID` es una propiedad del archivo y su diálogo ya lo
  edita, así que el combo arma sus ítems con los calendarios del plan al abrir
  (`tablesFor`, porque un mapa estático es uno para todos los diálogos)—, y
  **Guardar línea base** se quedó en el menú guardando el número 0, que es
  `BASELINE` y la línea que el Gantt dibuja. Lo que se movió se **checked en el
  mismo lugar por el que se usa**: `check-edit` abre el diálogo, lee el combo y
  el total, y cambia de calendario por la ruta del menú —que por eso es un
  método y no una lambda dentro del click— y lo deshace. Ningún fixture tiene
  dos calendarios, así que el segundo se agrega por la misma vía que la app
  usa para agregar uno.
- **El encabezado del gráfico es un control** (2026-09-30): una franja con la
  clase `button` -- la que el tema pinta para un encabezado, y la que el
  encabezado de una `ColumnView` lleva puesta, porque es un `Box` -- sobre el
  gráfico, con la regla dibujada encima. Antes la banda era dibujada dentro del
  propio gráfico: se veía parecida y no era lo mismo, porque dos Pintores
  pueden apartarse y un control y un control no. La franja toma su alto del
  encabezado de la lista y, si el tema la da más alta, es la lista la que se
  avisa (`HeaderMinHeight`), así que las dos cabeceras concuerdan sea cual sea
  el mayor. Y el alto se pide **en el `Draw` de la franja**: un pedido de tamaño
  durante el allocate es un pedido para el siguiente, y como el pane no cambia de
  tamaño nadie lo pedía (medido: se pedían 34 y se recibían 24). Con la franja,
  el gráfico ya no lleva encabezado: sus filas arrancan en el borde de su pane y
  quedan a la altura de las de la lista por construcción y no por acuerdo.
- **Los estilos del gráfico** (2026-09-29): la paleta pasa a estar en un lugar
  y con nombre de rol, la tinta es la del texto del tema (`Painter.Foreground`,
  que viene resuelta) y todo lo que es sombra es `rgba()` sobre el fondo que
  haya. Los **días que no se trabaja quedan sombreados** con el calendario del
  proyecto -- el propio archivo, no una regla fija de lunes a viernes --, los
  **vínculos van debajo de las barras**, la altura de la barra es una fracción
  de la fila (que es del tema) y no una constante, y la regla lleva **semanas
  arriba de meses** con el tipo bajando de 9 a 7 puntos antes de que se caiga una
  banda. Un painter que **escribe en vez de dibujar** (`CallLog`) es lo que hace
  afirmable todo esto: el orden en que se dibuja es parte del estilo y el dump de
  un frame real no lo dice.
- `RowHeight` se corrigió apenas se usó, y por una app: dividía `upper` por las
  filas, y `upper` es `max(contenido, página)` -- un plan que **entra** en la
  ventana dividía el viewport entero y contestaba 102 para una fila de 36. Es
  `gtk_widget_measure`, menos el encabezado, y `0` hasta que la ventana
  alrededor tiene viewport (una tabla dentro de un `Fixed` nunca lo tiene).
- La app dibuja el gráfico en las coordenadas de la lista, reusa
  `bta_scroll_get`/`bta_scroll_watch` en vez de reescribirlos, y `check-view`
  (25 aserciones) afirma la aritmética y no los píxeles: la extensión de las
  filas es la cuenta por una, las dos panes son el mismo rectángulo, un puntero
  sobre la quinta fila es la quinta fila, una muesca sobre el gráfico baja la
  lista tres filas, plegar una rama no cambia la altura de una fila, y el PNG
  exportado es tan alto como el plan y no como el panel.

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

**Varias líneas base** (2026-09-23): el combo **Línea base** de la pestaña
Proyecto elige el número (0 a 10, los que guarda Project); **Guardar** escribe
esa y el Gantt dibuja la elegida -- `Edit.setBaseline(number)` reemplaza solo
su número, ordena la lista, y `baselineOf(task, number)` la lee. El menú y el
botón llaman al mismo comando, que sigue siendo un undo. `check-edit` guarda
0 y 1 y vuelve a guardar 0 para probar el reemplazo.

- Queda: dibujar desde el extremo para enlazar en vez de redimensionar.

**El scroll no se pierde al reconstruir** (2026-09-30): hacer click en una barra
del Gantt **movía el scroll**, y no por el click: por lo que venía después.
`Gantt_MouseUp` llamaba a `fill()` siempre, y un click es un gesto que no movió
nada -- o sea, un comando que no cambia nada. Y `fill()` perdía el scroll por su
cuenta: `Clear` vacía la tabla, una tabla vacía no tiene a dónde scrollear, y el
ajuste queda **clampeado** al pasar; las filas volvían arriba y el lector con
ellas. Como **todos** los comandos terminan en `fill`, la primera tecla de
cualquier edición devolvía el plan al principio.

Las dos están arregladas. `fill` ahora **se queda donde estaba el lector** -- que
es la otra mitad de la selección, y lo mismo que ya hacía con `keep` --, clampeado
a lo que el plan nuevo pueda mostrar; y `Gantt_MouseUp` **reconstruye solo si el
gesto cambió algo**, como hace la rama del vínculo. `check-view` afirma las dos: la
reconstrucción conserva el scroll, y un click sobre una barra **no reconstruye
nada** -- lo atestigua una línea que el propio check escribe en el log, porque
`fill` lo limpia y el resumen del plan lo vuelve a escribir igual.

**Plegar una rama se las saca a las dos** (2026-09-30): el manual ya decía
"plegar una rama saca filas de las dos" y el código no lo hacía. `chartRows()`
devolvía el plan entero en orden de archivo, así que con una rama plegada la
lista mostraba 37 de 41 filas y el gráfico seguía dibujando las 41: **35 de
las filas que el lector veía llevaban la barra de otra tarea**, y como
`ganttHit` lee las mismas filas, un click en esa barra elegía esa otra tarea.

El arreglo es una línea de idea: `chartRows()` es `visibleTasks()` **menos las
ramas que la lista tiene cerradas**, y como el dibujo y el hit-test leen esa
misma llamada, los dos paneles vuelven a decir qué tarea es cada fila.

Lo interesante es **cómo se pregunta**. En el runtime no hay ningún aviso de un
plegado: la flecha no levanta evento, y un árbol contesta `Row` y `Cell` por
clave, así que nada enumera lo que la tabla está mostrando. Por eso la rama se
pregunta directo y **no se guarda**: medido en un plan de 1025 filas con 200
ramas, una pasada por todas son 0.40 ms -- 2% de un cuadro -- y una rama bajo
otra cerrada ni se pregunta, porque sus filas ya están fuera.

Medir antes fue lo que decidió el diseño: la pregunta obvia era "cachear el
estado de los pliegues", que además necesita un evento que no existe. La
segunda, "preguntar por frame", parecía cara hasta que salió a 2 us.

Preguntar al dibujar no alcanza si **nadie pide el dibujo**: plegar con la lista
scrolleada en cualquier lado que no sea el final deja `ScrollY` donde estaba, no
llega ningún `Scroll`, y el gráfico se quedaba con el cuadro viejo hasta que un
click lo redibujaba por casualidad. Así que el gráfico recuerda qué filas dibujó
(`drawnRows`) y un timer de 150 ms (`startFoldWatch`) pregunta si siguen siendo
esas, y pide un cuadro sólo cuando cambiaron. Es un sondeo porque el runtime no
ofrece otra cosa; un evento `Expand(key, open)` en `TableView` lo reemplazaría.

La escala de tiempo es la del plan (`chartRange()`, sobre `visibleTasks()`) y no
la de las filas que dejó el pliegue. Hoy da lo mismo, porque un resumen abarca
las fechas de sus hijos, pero un archivo con resúmenes desactualizados movería
todas las barras al plegar.

`check-view` pliega una rama **anidada** --con filas debajo y filas después, que
es donde los dos paneles coinciden arriba y divergen abajo-- y afirma que la fila
`i` es la misma tarea de los dos lados y que **lo dibujado** son esas filas --
con el scroll quieto, para que el redibujo sea del sondeo y no de un `Scroll`
(sin el sondeo falla: `drew 41 of 37`). Para leer la fila visible de una tabla
en árbol no hay API: `Select(i)` toma una posición visible y contesta si se
movió, y `Key` es el nodo que quedó ahí. Verificado que **las cuatro aserciones
fallan sin el arreglo** (`view every visible row is the same task on both
sides` nombra el caso: `row 2: list Fase 1 — Editor mínimo, chart Corpus
MSPDI sintético`).

Lo que queda, y ya es menor: `fill()` reconstruye el árbol y **cada comando
despliega lo que estaba plegado**, porque un árbol recién construido es
`AutoExpand`. Guardar los pliegues del lector en `fill` es el mismo problema que
guardar el scroll, y se resuelve igual.

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

**Tasas por fecha** (2026-09-23): `Resource.Rates` modelado (hasta 25 períodos
por tabla, las cinco tablas A–E) y `assignmentCost` reparte el trabajo sobre el
tiempo laborable de la asignación: cada período toma la parte que le toca y el
costo por uso es el del período en que el trabajo arranca; `CostRateTable` de
la asignación elige la tabla. El `Cost` del archivo sigue mandando. El editor
todavía no edita las tablas (se conservan tal cual), así que la tasa base que
edita el panel es la de un recurso sin períodos. `10-rates` lo fija sin `Cost`
y `check-cpm` afirma el reparto.

**El editor de tasas** (2026-09-23): **Tasas…** en la pestaña Recursos abre
`RatesForm`, que edita los períodos de las cinco tablas (fechas, tabla, tasa,
extra y costo por uso) con Agregar/Quitar; la lista vuelve entera a
`Edit.setResourceRates`, ordenada por tabla y fecha, y es un undo. Los formatos
de tasa del archivo se conservan (una fila nueva nace en horas).

- Falta: contornos de trabajo y calendario de recurso. Nivelación queda afuera
  por ahora.

**Las estadísticas del plan** (2026-09-30): **Proyecto → Estadísticas…** abre
`StatsForm`, un diálogo de solo lectura que lee el plan como número: costo
(total, por tipo de recurso, línea base y desvío, sobreasignados), fechas
(inicio, fin, fecha de estado, duración en días laborables, días de calendario,
transcurrido y restante), avance (porcentaje pesado por trabajo y el reparto en
terminadas/en curso/sin empezar) y atrasos (tareas pasado su fecha, pasado la
línea base, mayor atraso, restricciones incumplidas, días de atraso del plan) con
la lista de las tareas que no llegaron a su fecha, su fecha prometida y lo que
cuestan.

La aritmética vive en `projectStats` (`Stats.js`), no en el diálogo: **no
recalcula**, no escribe nada y por eso no tiene Aceptar — abrirlo no es un
edit. El atraso se mide contra **la promesa del archivo** (el fin de su línea
base, o su fecha límite) en días de calendario y sin mirar los feriados del
medio, que es la misma cuenta que hace `recalculate` para el registro, así que
el diálogo y el log no pueden discrepar. `check-stats` afirma los números, sin
golden porque los valores son la afirmación.

**Fechas tardías y holgura** (2026-09-30): el pase hacia atrás ya calculaba los
fechos tardíos de cada tarea y los tiraba —los usaba solo para marcar la
holgura cero como crítica—, así que la fase se cerró **guardando lo que ya se
calculaba**: `Task.LateStart`, `Task.LateFinish`, `Task.TotalSlack` y
`Task.FreeSlack` modelados y escritos, que es lo que muestra la pestaña
*Tracking* de Project. **Total y libre son dos números**: el total es lo que
puede correrse antes de que se mueva el fin del plan y el libre lo que puede
correrse antes de que se mueva lo que depende de la tarea, y por eso una tarea
puede tener un día entero contra el plan y cero contra su sucesora; una tarea
sin sucesoras tiene todo su total como libre, y los vínculos SS y SF dan cero
libre porque el inicio (o el fin) del sucesor cuelga del nuestro. La holgura se
mide en **minutos laborables** en el calendario de la tarea.

Lo que la ausente obliga a decidir es el centinela: `NO_MINUTES` es `-1` y no `0`,
porque `0` es la respuesta de una tarea crítica y es lo que Project escribe en
cada una de ellas —un `Field.Number` a secas leería "el archivo dijo cero" y
"no dijo nada" como el mismo valor y la ida y vuelta borraría el elemento—, y
porque una tarea que el pase no colocó (ALAP, o nunca fechada) tiene que poder
decir que **nadie calculó** en vez de decir que no hay margen. La columna
**Holgura** muestra la celda vacía en ese caso. Ninguno de los diez fixtures
traía estos elementos, así que sus goldens no se movieron; `check-cpm` afirma
los números.

**Desvío de cronograma** (2026-09-30): `MspBaseline` ya guardaba las fechas que
la línea base atrapó, así que compararlas con las del plan da
`Task.StartVariance` y `Task.FinishVariance`, que es lo que escribe Project. Se
calculan **al final del pase**, que es el punto donde las dos fechas son
definitivas, y solo para la línea base 0 —la que escribe *Guardar línea base*,
que es lo que `baselineOf` ya hablaba—. Van con signo (positivo es tarde), en
minutos laborables sobre el calendario de la tarea, y el centinela es el mismo
`NO_MINUTES` de la holgura: **una tarea sin línea base no tiene desvío, y eso no
es lo mismo que tener cero**. La columna **Desvío** muestra el de fin; el de
inicio queda en el archivo, que es donde Project lo lee.

A nivel de plan, `projectStats` agrega el **tramo de la línea base** (las fechas
que atrapó) contra el del plan y los **días de calendario** que el fin se movió,
que van con signo; **Proyecto → Estadísticas…** muestra los dos. Son días de
calendario a propósito —es la pregunta que se hace de voz alta— mientras el
desvío por tarea va en el calendario de la tarea. Una línea base con solo el
fin **todavía desvía y no es un tramo**, y `check-stats` afirma justamente esa
forma porque es la que Project escribe. Ningún golden se movió: **ninguno de
los diez fixtures trae línea base**, así que no hay varianza que escribir.

**Presupuesto** (2026-09-30): la fase se cierra con el número que le faltaba
al desvío de costo. **Dónde está el presupuesto lo decidió el archivo real y no
el schema**: el campo se llama `BudgetCost` y vive en la **asignación** —
`urbano v5.05052026.xml` trae 49 `<BudgetCost>` y 49 `<BudgetWork>`, uno por
asignación, entre `CreationDate` y `TimephasedData`—, así que el presupuesto del
plan es la suma de las asignaciones y no hay número a nivel de proyecto que
leer. `projectStats` agrega `budget`, `budgetVariance` y `budgetPercent`, y
**Proyecto → Estadísticas…** los muestra junto al costo; la pestaña Recursos
edita el de cada asignación con un campo y su propio botón, porque una
asignación no tiene Aplicar propio.

**El presupuesto no lleva centinela y la holgura sí, y la diferencia es el
motivo**: para dinero, ausente y cero dicen lo mismo —no hay presupuesto—, así
que no hay respuesta que solo el cero pueda dar y un centinela haría que el
editor ofreciera un valor que no significa nada. **El precio está medido**:
la ida y vuelta del archivo real ahora borra sus 49 `<BudgetCost>0</BudgetCost>`
(`touched` 871 → 920), que es el intercambio de la §B de `tests/FIDELITY.md` y
no una pérdida; el `BudgetWork` sobrevive porque su default es la cadena vacía.
Queda pendiente de la aceptación en Project si la ausencia le parece igual a un
cero, que es lo que dice el schema.

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
- **Gantt**: la vista clásica **está hecha** (2026-09-29) -- el plan a la
  izquierda y el gráfico a la derecha, en un `Split` cuyas filas se alinean y
  cuyo scroll vertical es uno solo. La decisión de arriba ("comparten
  identidad, no geometría") era lo que había que deshacer, y se deshizo
  pidiendo al runtime lo que la geometría exige: `TableView.RowHeight`,
  `HeaderHeight` y `ScrollY` con su evento `Scroll`. El gráfico se dibuja en
  las coordenadas de la lista (fila *i* en `head + i*row - scroll`), la lista
  es la única que baja, y el scroller del gráfico es horizontal porque lo que
  no entra es la escala. Ver **La vista clásica** en la fase 4.

## Abiertas

- Si una tarea nueva sin fechas debe heredar algo del vecino o quedar vacía
  (hoy queda vacía: una fecha inventada es una mentira).
- Qué hacer con `OutlineNumber`/`WBS` si el archivo real muestra que Project no
  los recompone al abrir.

## Pendientes de la auditoría (2026-10-07)

Lo que la auditoría encontró y no se arregló, porque cada uno pide una
decisión antes que un parche. Lo que sí se arregló está en los commits de
esa fecha. Ordenado por lo que cuesta no tenerlo.

### El motor

- **Los vínculos con resúmenes, resueltos** (2026-10-07): un vínculo FS/SS
  *hacia* un resumen frena a todas sus hojas, y uno *desde* un resumen espera a
  que sus hojas estén colocadas y lee su rango en la misma pasada (el resumen se
  cierra y se acumula entonces, no al final). El pase atrás los expande a las
  hojas -- todas para un vínculo de fin, las que abren la rama para uno de
  inicio -- y un resumen manual no frena a sus hijas, como Project. FF/SF hacia
  un resumen siguen sin programar. `check-cpm` suma cuatro aserciones y el
  oráculo baja de 35 a 24 tareas con holgura distinta, con fechas y críticas
  42 de 42.
- **El fin del plan se calcula** (2026-10-07): el paso atrás arranca del último
  fin de *todas* las tareas -- manuales y resúmenes incluidos, porque el resumen
  manual del archivo real termina a las 19:00 que Project llama fin del plan --
  y lo escribe en `FinishDate`; ya no lee el del archivo. Acortar un plan deja
  camino crítico. La holgura libre de una hoja ignora los vínculos de un
  resumen que no la determinan (medido contra el archivo).
- **Tareas manuales y terminadas en la holgura** (2026-10-07): nadie las mueve,
  así que un vínculo hacia una **no acota la holgura total** de su predecesora
  (la que precede a un hito manual tiene todo el margen hasta el fin del plan),
  pero sí la **libre** si es manual -- que tiene fechas que cumplir -- y no si
  es terminada. Una terminada es historia: fechas tardías iguales a las que
  tuvo, holgura cero y nunca crítica. Todo medido contra el archivo real.
  `check-cpm` fija las dos reglas. El oráculo queda en **14 de 42** tareas con
  holgura distinta, fechas y críticas 42 de 42. Lo que resta, medido en el
  archivo: las tareas **en curso** (8, 24, 31, 9) traen fechas tardías con
  minutos que ningún calendario de días enteros da -- `LateFinish 10:36`,
  `09:38:24` --, que es la **duración restante** (duración por el avance que
  falta) y no la duración entera. Es el mismo pendiente que "una tarea
  empezada se reprograma entera", así que se cierra con él: sin la duración
  restante el pase atrás no puede coincidir en esas. Las 33 y 34 cuelgan de la
  31, y 9, 10, 101 y 103 (384 décimas) del mismo redondeo. Quedan aparte las
  16-18 (SNET sin avance, 3 días de más en el total), que no se explican por
  esto.
- **Un FF ya no empieza una tarea antes del plan** (2026-10-07): con solo
  predecesores de fin (FF), la tarea arranca donde arrancaría una sin vínculos
  y termina después, como Project; un SF sigue pudiendo empezar antes, que es
  para lo que sirve. `check-cpm` fija los dos casos.
- **Una tarea empezada conserva su inicio** (2026-10-07): con `ActualStart` y
  sin fin real, los vínculos ya no la mueven -- el inicio es el real, el fin
  sale de él y un vínculo de fin puede estirarlo. Falta la **duración
  restante** (duración por lo que falta de avance): Project la usa en las
  fechas tardías de una tarea en curso y por eso el oráculo no cierra en
  ellas (ver arriba). Qué hace con el fin de una tarea al 23% no se deduce del
  archivo con lo medido.
- **`LateFinish` es el fin de la jornada** (2026-10-07): sale el viernes 17:00
  y no el lunes 08:00 que es el mismo instante de trabajo, con
  `WorkCalendar.finishAt` -- el espejo de `startAfter`. El oráculo ahora
  compara `LateFinish` al minuto: de 28 a **13 distintas**, todas tareas en
  curso (duración restante) salvo la 114, que Project cierra a las 17:00 y el
  motor a las 19:00 (sin explicar). Las restricciones de fin ya salían bien.
- **Los lags en porcentaje no se aplican** (2026-10-07): `LagFormat` 19, 20, 51
  y 52 son un porcentaje de la duración de la predecesora, y qué guarda
  `LinkLag` en ellos no está documentado (el XSD dice décimas de minuto para
  todos, lo que no puede ser cierto para un porcentaje) ni hay un archivo con
  uno para medirlo. Se leían como minutos, que es un cronograma equivocado que
  parece bien; ahora valen cero y el log cuenta cuántos quedaron sin aplicar.
  Se cierra con un `Save As` de Project con un lag del 50%.

### El formato

- **Un elemento nuevo cae donde el esquema lo pone** (2026-10-07): el runtime ya
  tiene `static Xml.Order` (el issue se llenó y se borró), y las formas de
  tarea, vínculo, recurso, tasa, asignación, calendario, día de semana,
  excepción y proyecto declaran la secuencia del XSD completa, con lo que no
  modelan como ancla -- generada del propio esquema, más `Manual` (de Project
  2010+, ubicado como Project lo escribe en el archivo real). Un
  `PredecessorLink` agregado a una tarea con `IsPublished` y `CommitmentType`
  queda antes de ellos: `11-unmodeled-order` lo fija y `check-commands` lo
  afirma sin el XSD externo (falla sin `Order`). **Si una forma gana un campo
  que el XSD no tiene, el runtime se niega a escribir y lo nombra**: hay que
  agregarlo a su `Order`.
- **`ID` no se renumera.** `addTask` le da `ID = UID` a la tarea nueva y
  `moveTask` reordena sin tocar los `ID`: agregar e indentar escribe 0,1,3,2.
  Quien ordene por `ID` (MPXJ, y por él ProjectLibre) deshace el movimiento
  o cuelga la subtarea del padre equivocado. Va con la decisión abierta de
  `OutlineNumber`/`WBS` (ver Abiertas).
- **Reasignar vuelve a costear** (2026-10-07): el `Cost` del archivo es el de
  su trabajo, así que cuando `addAssignment` cambia las unidades o el trabajo
  de una asignación -- la propia o las que el nuevo reparto mueve -- lo borra y
  el costo se calcula de nuevo. Queda sin cubrir el trabajo que cambia por
  otras vías (editar la duración de una tarea no toca el `Cost` de sus
  asignaciones).
- **Las excepciones recurrentes sobreviven a editarlas** (2026-10-07): el
  diálogo del calendario las rearmaba con `Type: 1` y sin período, días de la
  semana, mes ni ocurrencias, así que renombrar "cada lunes diez semanas" la
  volvía un rango diario. Ahora la que se elige conserva su recurrencia y solo
  cambian las fechas, el nombre y si se trabaja. `check-commands` lo fija.
- **Los `WeekDay` se aparean por posición** y su `TimePeriod` no está
  modelado: el mismo problema que `MspException` ya resolvió. Sólo afecta a
  archivos viejos, con excepciones escritas como `DayType 0`.
- **Recursos de costo, duraciones y decimales de la moneda** (2026-10-07): un
  recurso de costo (tipo 2) ya no recibe trabajo ni se cobra como horas por una
  tasa que no tiene -- su costo es el número tipeado en la asignación;
  `mspdiMinutes` distingue el lado de la `T` en que está una `M` (`P1M` es un mes,
  9600 minutos, no un minuto), lee semanas, y años y negativos siguen siendo
  nada; y `CurrencyDigits` ausente es -1, así que un plan en yenes con 0
  decimales se conserva y Estadísticas lo respeta (el diálogo muestra vacío un
  valor no dicho).

### El gráfico

- **La regla sigue al gráfico** (2026-10-07): la franja se arma sobre el ancho
  del gráfico y se corre con el scroll horizontal (`rulerFrame`,
  `GanttScroll_Scroll`), en vez de comprimir todo el rango en el ancho visible.
  `check-view` afirma el ancho y el desplazamiento.
- **Arrastrar pasa por el calendario** (2026-10-07): mover cae en el próximo
  momento laborable del calendario de la tarea y conserva su tiempo de trabajo
  -- un viernes más cuatro días es el lunes, no un sábado --; estirar termina en
  el fin de jornada. El día se cuenta en el calendario del reloj, así que un
  cambio de hora no corre la barra. Una tarea elapsed se mueve en tiempo de
  reloj. `check-drag` fija el caso del fin de semana.
- **El tipo del vínculo lo dice el gesto** (2026-10-07): Ctrl + arrastrar lee las
  mitades de las dos barras (derecha-izquierda FS, izquierda-izquierda SS,
  derecha-derecha FF, izquierda-derecha SF), marca los extremos y escribe el tipo
  junto al puntero; Ctrl+Mayús usa el combo, para los hitos. `Edit.linkProblem`
  rechaza con su motivo lo que no se puede: sí mismo, un resumen con su rama,
  un ciclo --que el motor aceptaba sin avisar--, y FF/SF hacia un resumen.
  **Un vínculo es una cosa del gráfico** (2026-10-07): se dibuja según su tipo
  (`linkShape`, que comparten el dibujo y el puntero), un clic sobre la línea lo
  elige (`ganttLinkAt`) con un punto en cada extremo, **Supr** lo quita, **Esc**
  lo suelta y un punto de un vínculo elegido se agarra y se suelta sobre otra
  tarea (`Edit.relink`, un solo undo, mismo tipo y retardo, con las mismas
  validaciones que dibujarlo). Los puntos solo se agarran con el vínculo
  elegido: uno FS termina sobre el borde de la barra sucesora y ahí una pulsación
  es de la barra. **El foco** (lo vio quien lo probó a mano): el nombre de la
  tarea lo retenía y Supr habría borrado texto ahí, porque un `DrawingArea` no
  toma el teclado salvo que sea `Focusable`; ahora lo es y el clic sobre un
  vínculo se lo lleva, lo que `check-drag` afirma partiendo del foco en el
  nombre. **Sin cubrir:** el cursor sobre las líneas.
- **Contorno y agarre al arrastrar** (2026-10-07): el contorno es un pase
  propio después de las barras -- el bucle saltaba hitos, resúmenes y marcas, que
  no se veían mientras se movían -- y una tarea sin ancho se encuadra del alto de
  una barra; el agarre de estirar es a lo sumo un tercio de la barra, así que una
  de unos píxeles se levanta por el medio y solo estira por su extremo lejano
  (`check-drag`, que con el agarre fijo de 5 px falla).
- **Las aserciones de `check-view` que no podían fallar** (2026-10-07): el rango
  contra la escala ahora se compara con el del plan calculado a mano (primera
  fecha y última, un día a cada lado), y el sombreado con el día de la semana
  de cada banda y no con la función que lo generó. La de las filas (`g.rows`
  contra `chartRows()`) era la del plegado, que ya lee las filas de la lista.

### La interfaz

- **Resuelto** (2026-10-07): una fecha sin hora en Datos del proyecto toma la hora
  de inicio del día del plan, como Nuevo proyecto; destildar todas las columnas
  se guarda y vuelve así (solo una lista nunca escrita deja las de siempre);
  `openStartup` lee los ajustes **antes** de abrir el plan, así la primera
  tabla ya tiene las columnas elegidas; la barra de estado dice "1 tarea" y
  "2 tareas" con `Locale.Plural` (una frase por cuenta, con `Plural-Forms` en
  `es.po`); y `es.po` ya no trae las diez entradas que nada usaba.
- **Los campos personalizados son del proyecto** (2026-10-08): viven en su
  propio diálogo -- **Proyecto → Campos personalizados…**, al lado de
  Calendarios… -- y no en Configuración, que es de la aplicación. Ahí se
  agregan (el primer campo `Text` libre, de Text1 = 188743731 en adelante), se
  editan (el `FieldID` queda fijo: es la identidad de los valores que las
  tareas ya llevan) y se eliminan (la definición se va con sus valores, un
  solo undo). **Mostrar en la lista** tilda más de uno y cada campo es una
  columna propia, con el nombre que el archivo le da -- id `attr:<FieldID>` en
  la lista de columnas, elegida y recordada como las demás --; la columna
  fija «Custom field» y su `FieldID` a mano en Configuración se fueron.
  `check-edit` cubre el alta, la edición, la baja y las dos columnas a la vez.
- **Las listas de valores** (2026-10-08): un campo extendido puede llevar su
  `ValueList` -- el XSD la pone última en la secuencia, con `ID`, `Value` y
  `Description` por entrada -- y el editor del campo la carga en una tabla con
  su par de casillas: **Agregar** agrega o reemplaza la fila elegida, como las
  excepciones del calendario. El valor de la tarea pasa a ser un desplegable
  con las entradas y **Ninguno** para vaciarlo, y el archivo guarda el
  `ValueGUID` que apunta a la entrada (un entero: los IDs son únicos en el
  plan y los reparte `Edit.setFieldDef`). Cambiar la lista reajusta los
  punteros en el mismo comando: la tarea cuyo texto la lista no lleva pierde
  el puntero y conserva el texto. `check-edit` cubre el alta, el puntero, un
  texto libre y la baja. El XSD oficial quedó en `mspdi_pj12.xsd` -- ignorado
  por git, adentro del repo -- y la suite entera valida contra él con
  `XSD=mspdi_pj12.xsd`: 12 salidas, `HARNESS-OK`.
- **El hipervínculo de la tarea** (2026-10-08): `Hyperlink` y
  `HyperlinkSubAddress` se sumaron al modelo junto al `HyperlinkAddress` que ya
  viajaba, y el panel los edita con un `LinkButton` al lado que abre la
  dirección (el ticket de GLPI de la tarea, para el caso que lo pidió). **Los
  campos personalizados no tienen tipo vínculo** -- el `CFType` del XSD no lo
  tiene -- y eso queda dicho en el manual. La lista tiene su columna
  (**Hipervínculo**, en Ver → Columnas…), que muestra el texto del enlace o la
  dirección cuando no hay texto. `check-edit` pone el enlace, lo afirma -- con
  su columna -- y lo limpia antes de guardar, así el golden no se mueve.
  **Y la celda es un enlace de verdad** (2026-10-08, runtime 5fa768b): la
  columna se declara `Link: true` y la dirección va por fila con `SetUri` -- el
  texto es la etiqueta y una tarea con etiqueta y sin dirección queda texto
  plano --, así que la celda se subraya y se abre con un clic (o con Enter al
  enfocarla). `check-edit` también afirma el `Link` de la spec.
- Setear `Tasks.Key` o `TxtFilter.Text` ya dispara el evento, y la llamada
  explícita que sigue redibuja una segunda vez. Quedó sin tocar: está en una
  veintena de lugares y en las pruebas, y cuesta un redibujo.

### Empaquetado y pruebas

- El metainfo ya trae la descripción del release (en inglés y castellano) y
  valida. **Faltan `<screenshots>`** (Flathub y Software los esperan, y piden una
  URL pública) y **el tag 0.1.0**, que el metainfo declara con fecha 2026-09-24
  y no existe: publicarlo es del autor.
- `tests/run.sh` con `XSD=` valida los `bintana-project-check-*` y `-edit-*`
  que haya en `$OUT`, salidas viejas incluidas.
