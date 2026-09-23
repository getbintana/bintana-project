# Manual de bintana-project

Un editor de planes compatible con MS Project (archivos XML MSPDI) para
Linux. Abre el XML que Project exporta, lo edita y lo devuelve tal que
Project lo vuelve a abrir sin reparar. No lee `.mpp`: el intercambio va por
XML.

## Abrir

- **Archivo → Abrir…** (`Ctrl+O`), o arrastrá un XML a la ventana, o pasá el
  archivo en la línea de comandos:
  `bintana /ruta/al/proyecto plan.xml`.
- **Archivo → Abrir reciente** guarda los últimos ocho.
- Al abrir, si hay una **copia de recuperación más nueva** que el archivo (de
  una sesión que quedó sin guardar), la app pregunta si querés abrirla. La
  copia se escribe cada minuto mientras hay cambios sin guardar, en el
  directorio de configuración — nunca al lado del plan. Se borra al guardar.

## La tabla

Es la EDT en árbol, con los resúmenes plegables y las filas nulas salteadas.
La columna **Duración** la lee en la unidad que el archivo declara; **Campo**
muestra el campo personalizado que elijas en Configuración. **Costo** suma lo
que cuestan las asignaciones de la tarea: unidades por tarifa del recurso, o el
costo fijo del material; queda vacía si la tarea no cuesta nada.

El campo de la barra superior **filtra por nombre**: quedan las tareas que
coinciden y los resúmenes que les dan lugar. La lupa limpia el filtro.

## Editar una tarea

Seleccioná una fila y usá el panel de la derecha. La pestaña **Tarea** tiene
nombre, inicio, fin, duración (`2d`, `8h`, `30m`, `2ed` para elapsed, o un
número en la unidad de la tarea), avance, hito, programada manualmente,
condicionada por esfuerzo, estimada, tipo de tarea, restricción con su fecha,
fecha límite, notas y el
valor de un campo personalizado del archivo. **Aplicar** escribe todo junto:
es un solo Deshacer.

- **Agregar** crea una tarea después de la seleccionada (y de su subárbol);
  **Eliminar** se lleva la tarea y todo lo que cuelga de ella.
- **Subir**/**Bajar** la intercambian con su hermana, subárbol incluido.
- **Indentar**/**Quitar nivel** la mueven un nivel; los resúmenes se recalculan
  solos, y de un resumen solo se edita el nombre (las fechas las deriva
  Project).
- Los resúmenes no se editan en fechas ni duración: son el reflejo de sus
  hijas.

## Vínculos

La pestaña **Vínculos** lista los predecesores de la tarea. Elegí tarea, tipo
(**Fin a inicio**, **Inicio a inicio**, **Fin a fin**, **Inicio a fin**) y
retardo en minutos; **Enlazar** agrega o actualiza, **Desenlazar** borra la
fila elegida.

En el Gantt también se dibujan: **Ctrl + arrastrar** desde una barra hasta
otra crea un Fin a inicio.

## Calcular

**Recalcular** (`F5`) acomoda las fechas: cada tarea sin predecesoras arranca
en el inicio del proyecto, las demás apenas se lo permiten sus vínculos, los
resúmenes se estiran, y una pasada hacia atrás marca **crítica** a la tarea
sin holgura. El registro (Ver → Ver log) dice cuántas tareas, cuántas
críticas, cuántas pasadas de fecha límite, cuántos recursos sobreasignados y
cuántas restricciones incumplidas.

- **Restricciones duras**: `Debe empezar el` (MSO) fija el inicio, `Debe
  terminar el` (MFO) el fin, `No empezar antes del` (SNET) y `No terminar
  antes del` (FNET) ponen pisos.
- **Restricciones blandas**: `No empezar después del` (SNLT) y `No terminar
  después del` (FNLT) no fijan nada; la tarea se planifica lo antes posible y
  si pasa la fecha, se cuenta.
- **ALAP** (lo más tarde posible) conserva las fechas del archivo.
- La **fecha límite** es un objetivo: no mueve nada, y las tareas que la pasan
  llevan una flecha roja sobre la barra.
- **Editar → Guardar línea base** guarda el plan tal como está; el Gantt dibuja
  esa línea como barra fina gris debajo de cada tarea, para leer el desvío. El
  combo **Línea base** de la pestaña Proyecto elige el número (0 a 10, como
  Project): Guardar escribe esa y el Gantt dibuja esa; guardar dos veces el
  mismo número la reemplaza sin tocar las demás.
- El **avance** mueve las fechas reales: arriba de cero hay inicio real, al
  cien por ciento hay fin real, y en cero no hay ninguno.
- Las tareas **terminadas** (con fin real) y las **programadas manualmente**
  (el tilde del panel) no se mueven al recalcular: sus fechas son las que
  tienen, y las sucesoras se enlazan a ellas. Un resumen manual fija además el
  piso de su rama.
- En Configuración podés pedir que se recalcule solo después de cada cambio.

## Recursos y costos

La pestaña **Recursos** lista los recursos con su máximo, **Pico** (las
unidades simultáneas: si supera el máximo, está sobreasignado), su tasa y el
costo de sus asignaciones. **Nuevo**/**Aplicar**/**Eliminar** editan el
recurso; eliminar uno se lleva sus asignaciones. **Tasas…** abre las tablas de
tasas por fecha del recurso (A–E): los períodos con sus fechas, su tasa, la
extra y el costo por uso, con Agregar/Quitar; aceptar es un solo Deshacer.

Abajo, las asignaciones de la tarea seleccionada: elegí recurso y unidades y
**Asignar**; **Quitar** las deshace. El trabajo se calcula desde la duración,
y lo que las unidades le hacen a la duración depende del tipo de tarea y de
si es condicionada por esfuerzo (una tarea que ya carga una unidad tarda la
mitad cuando llega otra).

El costo sale del trabajo por la tasa en un recurso de trabajo, de las
unidades por la tasa en uno material, más el costo por uso; si el archivo trae
su propio costo, ese manda. Si el recurso trae **tasas por fecha** (tablas A–E,
las edita **Tasas…**), el trabajo se reparte sobre el tiempo laborable de la
asignación y cada período cobra la parte que le toca: la asignación elige la
tabla y el período en que arranca el trabajo fija el costo por uso.

## Proyecto y calendarios

La pestaña **Proyecto** edita el encabezado: fecha de inicio, calendario por
defecto, minutos por día y por semana, días por mes, tipo de tarea por
defecto, el día en que empieza la semana y la moneda. Los minutos por día son
lo que significa un `1d` tipeado. Abajo del todo, **Costo total** es lo que
suman las asignaciones del plan.

**Editar…** abre el calendario elegido: los días laborables con sus tramos
como texto (`08:00-12:00 13:00-17:00`, porque un día puede tener más de uno) y
las excepciones, que es como se cargan los feriados.

## El Gantt

Muestra las tareas en orden de archivo, con los resúmenes como corchetes, las
críticas en rojo y el avance como banda dentro de la barra. La fila
seleccionada se resalta.

- **Clic** selecciona; **arrastrar** una barra mueve la tarea; arrastrar su
  **extremo** la estira (la duración sale del tiempo laborable del calendario
  de la tarea); **Ctrl + arrastrar** dibuja un vínculo del tipo elegido en
  **Vínculo nuevo** (fin a inicio por defecto).
- Nada se escribe hasta soltar el botón: un gesto es un Deshacer.
- **Escala**: Ajustar a la ventana, Días, Semanas, Meses; el gráfico se
  desplaza con sus barras.
- **Exportar** (barra o menú Archivo) escribe el gráfico como PNG o PDF, para
  mandárselo a quien no corre la app.

## Informes

**Archivo → Informe…** arma un documento con todas las tareas —inicio, fin,
duración, avance, criticidad y costo— con el total al pie, en A4 apaisado, y lo
guarda como PDF. Las columnas se repiten en cada página y el título lleva el
nombre del proyecto y la ruta del archivo.

## Atajos

| | |
|---|---|
| `Ctrl+O` | Abrir |
| `Ctrl+S` / `Ctrl+Shift+S` | Guardar / Guardar como |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Deshacer / Rehacer |
| `Ctrl+N` | Agregar tarea |
| `F5` | Recalcular |
| `Ctrl+Q` | Salir |

## Configuración

**Herramientas → Configuración…** edita lo que la app recuerda: carpeta por
donde abre el diálogo, escala, campo personalizado que muestra la lista,
unidad de una duración sin sufijo, y si recalcula solo y si guarda la copia de
recuperación.

## Lo que no hace

No lee ni escribe `.mpp` (solo Microsoft escribe ese formato). No nivela
recursos: detecta la sobreasignación y la informa, pero no la resuelve. No
calcula valor ganado ni imprime vistas de uso de recursos. Las tareas
recurrentes y las divisiones (splits) no están modeladas.
