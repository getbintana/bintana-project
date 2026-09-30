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

Las columnas se eligen en **Ver → Columnas…** (o en el menú de la fila,
**Columnas…**): se agregan y se sacan con un tilde, entre duración, fechas,
avance, crítica, hito, trabajo, costo, EDT, prioridad, restricción, fecha
límite, calendario, tipo de tarea, notas y el campo personalizado del archivo.
El nombre es el árbol y no se va. La elección es una vista, como la escala: se
recuerda para la próxima ventana y no toca el archivo.

El clic derecho en el **encabezado** de una columna es el atajo de Project, y
también lleva a lo mismo: **Ocultar esta columna** saca la que se apretó (sobre
el nombre no se puede: es el árbol), **Mostrar todas las columnas** vuelve a
ponerlas todas y **Columnas…** abre el diálogo completo para elegir cuáles.

La lista es la mitad izquierda de la vista: a su derecha está el Gantt, las dos
en el mismo `Split`, y **la lista es la que baja** — su barra de desplazamiento,
la rueda sobre cualquiera de las dos y el teclado mueven las dos. Plegar una
rama saca filas de las dos.

**Lo que crece cuando agrandás la ventana es el gráfico.** El panel de
propiedades tiene un ancho propio —es un formulario, no un espacio— y la lista
conserva el suyo, así que una ventana más ancha compra timescale y no aire. Los
dos divisores se arrastran a mano y la app no los mueve después.

**El gráfico se apoya en la misma superficie que la lista**: lleva puesta la
misma clase que lleva la lista (`view`), que es la que el tema usa para pintar
una superficie —el tema escribe la lista como `columnview.view`—, así que el
fondo y el color del texto son los del tema y no hay ningún valor copiado que
pueda quedar viejo. Lo que sí lleva fondo propio es el **archivo exportado**,
que no tiene nada atrás.

**La ventana se achica todo lo que quieras, también después de maximizar.** Por
debajo: el gráfico no se le asigna un ancho —eso sería un *piso* para la ventana
y realimentaría cada redimensionamiento— sino un mínimo, y ese mínimo se queda
dentro del scroller horizontal, que es el que muestra lo que no entra. Con
**Días** o **Semanas** el gráfico es más ancho que su panel y hay que
desplazarlo; con **Ajustar a la ventana** es exactamente el ancho del panel.

El campo de la barra superior **filtra por nombre**: quedan las tareas que
coinciden y los resúmenes que les dan lugar. La lupa limpia el filtro, y
`Ctrl+F` lleva el cursor ahí. **El Gantt filtra con la lista**: el gráfico dibuja
las mismas filas que la tabla, así que con un filtro las barras quedan al lado
del nombre que les corresponde —no del resto del plan— y la escala de tiempo se
acorta a lo que se está viendo. **Exportar** sale con las mismas filas.

**Clic derecho** sobre una fila abre el menú de la tarea —agregar, eliminar,
indentar, quitar nivel, subir y bajar—, y **doble clic** (o Enter) deja el
cursor en el nombre, listo para renombrar. En el Gantt el clic derecho también
elige la tarea que está bajo el puntero.

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
  esa línea como barra fina gris debajo de cada tarea, para leer el desvío.
  Guarda el número 0 y dibuja el 0: **la línea base en curso**, que es lo que
  el menú puede decir sin preguntar nada. Guardar dos veces el mismo número la
  reemplaza sin tocar las demás.
- El **avance** mueve las fechas reales: arriba de cero hay inicio real, al
  cien por ciento hay fin real, y en cero no hay ninguno.
- Las tareas **terminadas** (con fin real) y las **programadas manualmente**
  (el tilde del panel) no se mueven al recalcular: sus fechas son las que
  tienen, y las sucesoras se enlazan a ellas. Un resumen manual fija además el
  piso de su rama.
- En Configuración podés pedir que se recalcule solo después de cada cambio.
  **Recalcular** (F5) sobre un plan que ya está donde el pase lo deja no mueve
  nada: no ensucia el archivo ni agrega un paso de Deshacer.

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

Las tres pestañas del panel lateral son **Tarea**, **Vínculos** y
**Recursos**: lo que es de *esta* tarea. Lo que es del plan entero está en el
menú **Proyecto**, porque lo del plan no cambia con la selección y una pestaña
para eso ocupaba lugar sin contenido propio.

**Datos del proyecto…** edita la identidad y la información (nombre, título,
asunto, autor, gerente, compañía, categoría, revisión, fecha de creación y
último guardado —esos dos de solo lectura—, fecha de inicio, fecha de estado,
**calendario por defecto**, **costo total** —de solo lectura, lo que suman las
asignaciones— y la moneda), y **Opciones del proyecto…** los valores por defecto
y los switches del archivo (tipo de tarea, tasas y formato de trabajo, minutos
por día y por semana —lo que significa un `1d` tipeado—, holgura crítica, año
fiscal, respetar restricciones, valor ganado y demás). Cada uno es un solo
Deshacer.

Los calendarios se **administran** desde el menú **Proyecto → Calendarios…**:
la lista con **Nuevo…** (copia el elegido, o el del proyecto, y abre el
diálogo para ponerle nombre), **Editar…** y **Eliminar** (borra uno que no sea
el del proyecto, y las tareas o recursos que lo usaban vuelven al default).

El diálogo de un calendario edita los días laborables con sus tramos como
texto (`08:00-12:00 13:00-17:00`, porque un día puede tener más de uno) y las
excepciones, que es como se cargan los feriados. Muestra la semana **efectiva**
—con lo que herede de su calendario base— y al aceptar la deja escrita.

En la pestaña **Tarea** y en el editor de recursos, **Calendario** elige cuál
rige para esa tarea o ese recurso: **Del proyecto** o uno en particular.

## Estadísticas

**Proyecto → Estadísticas…** abre el plan leído como un número: **costo**,
**fechas**, **avance** y **atrasos**. Es de solo lectura y no tiene Aceptar:
abrirlo no ensucia el archivo, no agrega un Deshacer y **no recalcula** — un
plan que todavía no fue calculado se muestra como está, con lo que el archivo
trae.

- **Costo**: el total del plan y su reparto entre recursos de trabajo,
  material y costo; el costo y el trabajo de la **línea base** y el desvío,
  cuando el plan tiene línea base; y cuántos recursos están **sobreasignados**
  (el pico de unidades supera su máximo, que es lo que dice la columna Pico).
  El dinero sale con el símbolo y las posiciones decimales que trae el archivo
  —la moneda del plan— y con el orden de símbolos de este escritorio.
- **Fechas**: inicio y fin del plan, la **fecha de estado** (o la fecha de la
  máquina, si el archivo no escribió ninguna) y los tres tramos: duración en
  **días laborables** sobre el calendario del proyecto, días de calendario, y
  lo transcurrido y lo restante.
- **Avance**: el porcentaje del plan **pesado por trabajo** —una tarea con mil
  horas pesa lo que mil tareas sin ninguna— y el reparto en terminadas, en
  curso, sin empezar, con los resúmenes, los hitos y las críticas aparte.
- **Atrasos**: cuántas tareas pasaron su fecha y cuántas la línea base, el
  mayor atraso en días, las **restricciones incumplidas** y los días que el
  plan lleva de atraso sobre su propio fin. Abajo, la lista de las tareas que
  no llegaron a la fecha que tenían, con la fecha prometida, la fecha que
  tienen, los días de atraso y lo que cuestan.

Una tarea está atrasada contra **la fecha que el archivo le dio**: el fin de
su línea base si tiene una, su **fecha límite** si no, y nada si no tiene
ninguna de las dos. Se cuenta en días de calendario y sin mirar los feriados
del medio, porque un feriado no la hace tarde antes — que es la misma cuenta
que hace **Recalcular** para el registro.

## El Gantt

El gráfico está **al lado de la lista, no debajo**: las dos panes comparten el
divisor que se arrastra, la fila *i* del gráfico es donde está la fila *i* de la
tabla -- a la altura que tengan las filas, que es la del tema y no una constante
de la app -- y **la lista es la única que baja**: su barra, la rueda sobre
cualquiera de las dos y el teclado mueven las dos. El scroller del gráfico es
horizontal, porque lo que no entra en un gráfico es la escala de tiempo. La banda del
encabezado del gráfico es **un control propio**, una franja con la clase `button`
del tema -- la misma clase que lleva el encabezado de la lista -- y del alto que
tiene ese encabezado: por eso las dos cabeceras se leen como una sola y las
filas empiezan en la misma línea a los dos lados del divisor. En la banda van las
**semanas arriba de los meses**.

Muestra las tareas en orden de archivo, con los resúmenes como corchetes, las
críticas en rojo y el avance como banda dentro de la barra. La fila
seleccionada se resalta, en las dos panes.

**Los días que no se trabaja quedan sombreados**, y el que se sombrea es el del
calendario del proyecto: una plan que trabaja de lunes a viernes tiene sombreado
el fin de semana y nada más. **La regla lleva semanas arriba de meses**, y las dos bandas entran
porque el encabezado de la lista tiene un alto propio de 34 px: sin ese alto,
dos líneas de letra de regla en 25 px obligaban a letra de 7 puntos o a perder
el mes. Ese alto lo fija la lista y la franja del gráfico lo sigue, con un alto
declarado en el `Draw` de la franja: **un pedido de tamaño hecho durante el
allocate es un pedido para el siguiente**, y como el pane no cambia de tamaño
nadie lo pedía -- medido, se pedían 34 y se recibían 24. Los
vínculos se dibujan **debajo** de las barras, que es como los dibuja Project y
lo que hace legible un plan apretado. Los colores vienen del tema: la tinta es
la del texto del tema y lo que es sombreado es una capa `rgba()` sobre el fondo
que haya, así que el gráfico sigue a un tema claro o oscuro sin adivinar un
fondo.

- **Clic** selecciona; **arrastrar** una barra mueve la tarea; arrastrar su
  **extremo** la estira (la duración sale del tiempo laborable del calendario
  de la tarea); **Ctrl + arrastrar** dibuja un vínculo del tipo elegido en
  **Vínculo nuevo** (fin a inicio por defecto).
- Nada se escribe hasta soltar el botón: un gesto es un Deshacer.
- **Escala**: Ajustar a la ventana, Días, Semanas, Meses; el gráfico se
  desplaza con sus barras.
- **Exportar** (barra o menú Archivo) escribe el gráfico como PNG o PDF -- el
  plan entero desde su primera fila y con los nombres de las tareas, porque un
  archivo no tiene una lista al lado -- para mandárselo a quien no corre la app.

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
recuperación. Las **columnas** también se recuerdan, pero se eligen en
**Ver → Columnas…**.

## Lo que no hace

No lee ni escribe `.mpp` (solo Microsoft escribe ese formato). No nivela
recursos: detecta la sobreasignación y la informa, pero no la resuelve. No
calcula valor ganado ni imprime vistas de uso de recursos. Las tareas
recurrentes y las divisiones (splits) no están modeladas.
