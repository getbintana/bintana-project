# Manual de bintana-project

Un editor de planes compatible con MS Project (archivos XML MSPDI) para
Linux. Abre el XML que Project exporta, lo edita y lo devuelve tal que
Project lo vuelve a abrir sin reparar. No lee `.mpp`: el intercambio va por
XML.

## Abrir

- Al arrancar **sin ningún archivo en la línea de comandos** la ventana abre la
  **página de bienvenida**: el ícono de la aplicación y, al lado, lo único que
  una ventana sin plan abierto puede hacer — **Nuevo proyecto…**, **Abrir…**,
  **Abrir el ejemplo** y la lista de los **recientes**. Cada fila trae el
  nombre del archivo y la carpeta al lado, porque dos planes llamados
  `plan.xml` son dos planes. Con la lista vacía, en vez de filas dice
  *(ninguno todavía)*.
- **Archivo → Nuevo proyecto…** (`Ctrl+Shift+N`) hace lo mismo desde el menú.
  Abre un diálogo con cuatro cosas: el **nombre** del plan (el único campo
  obligatorio), el **título** que Project muestra encima, la **fecha de inicio**
  —que si la dejás vacía es hoy— y la **carpeta** y el **archivo** donde va.
  La carpeta arranca donde vino el último archivo y se puede cambiar con el ícono
  o escribiéndola. Debajo se ve la ruta completa, y **Crear se pone gris si esa
  ruta ya tiene un archivo**: un plan nuevo nunca reemplaza a otro.
  Lo que se escribe es un plan en blanco —calendario Standard de lunes a
  viernes, dos turnos, sin tareas— con la fecha de estado leída como el inicio.
- **Archivo → Abrir…** (`Ctrl+O`), o arrastrá un XML a la ventana, o pasá el
  archivo en la línea de comandos:
  `bintana /ruta/al/proyecto plan.xml`.
- **Archivo → Abrir reciente** guarda los últimos ocho.
- Al abrir, si hay una **copia de recuperación más nueva** que el archivo (de
  una sesión que quedó sin guardar), la app pregunta si querés abrirla. La
  copia se escribe cada minuto mientras hay cambios sin guardar, en el
  directorio de configuración — nunca al lado del plan, y una por archivo: dos
  `plan.xml` de carpetas distintas no se pisan. Se borra al guardar o al
  descartar los cambios. Lo recuperado queda **sin guardar** (el título lleva
  el `•`) hasta que guardes.
- Abrir otro plan —por cualquier camino: Abrir, recientes, arrastrar, Nuevo o
  el ejemplo— con cambios sin guardar **pregunta antes**: Guardar, Descartar o
  Cancelar, igual que al cerrar.

Con un archivo nombrado en la línea de comandos no hay página de bienvenida: la
ventana abre directamente el plan.

## La tabla

Es la EDT en árbol, con los resúmenes plegables y las filas nulas salteadas.
La columna **Duración** la lee en la unidad que el archivo declara. **Costo**
suma lo que cuestan las asignaciones de la tarea: unidades por tarifa del
recurso, o el costo fijo del material; queda vacía si la tarea no cuesta nada.

Las columnas se eligen en **Ver → Columnas…** (o en el menú de la fila,
**Columnas…**): se agregan y se sacan con un tilde, entre duración, fechas,
avance, crítica, holgura, desvío, hito, trabajo, costo, EDT, prioridad,
restricción, fecha límite, calendario, tipo de tarea, notas e hipervínculo. El
nombre es el árbol y no se va. La elección es una vista, como la escala: se
recuerda para la próxima ventana y no toca el archivo.

Los **campos personalizados** que el plan define son columnas aparte, una por
campo y con el nombre que el archivo les da: se tildan —varios a la vez— en
**Proyecto → Campos personalizados…** y quedan en la lista como cualquier
columna.

La **holgura** es lo que el pase hacia atrás calcula y hasta ahora no guardaba:
cuánto puede correrse la tarea antes de que se mueva el **fin del plan**. La
**holgura libre** es otra cosa y también se guarda, aunque no tiene columna: es
lo que puede correrse antes de que se mueva lo que depende de esta tarea. Una
tarea puede tener un día entero contra el plan y cero contra su sucesora. La
que nadie espera puede correrse todo su total. Si el paso no/programó esa tarea
—es ALAP, o el archivo nunca la fechados— la celda queda **vacía y no en cero**,
porque un `0` ahí sería decir que no hay margen cuando nadie miró.

El **desvío** es la otra mitad de la línea base y va con signo: **positivo es
tarde**, y el signo va en la celda (`-1d` es un día antes). Compara el fin de
la tarea con el fin que la línea base le había atrapado, en la unidad de la
propia tarea. Solo se calcula contra la línea base 0 —la que escribe *Guardar
línea base*—, así que un archivo que trae varias tiene desvío solo contra esa.
Si la tarea no tiene línea base, o al lado no hay fecha, la celda queda vacía: un
plan sin línea base no está *en su* línea base, está sin una.

El clic derecho en el **encabezado** de una columna es el atajo de Project, y
también lleva a lo mismo: **Ocultar esta columna** saca la que se apretó (sobre
el nombre no se puede: es el árbol), **Mostrar todas las columnas** vuelve a
ponerlas todas y **Columnas…** abre el diálogo completo para elegir cuáles.
**Insertar columna…** ofrece las que faltan y la pone a la izquierda del
encabezado que apretaste; **Mover a la izquierda** y **Mover a la derecha**
cambian el orden. El orden se recuerda con las columnas, y el diálogo de
**Columnas…** lo respeta: lo que tildás de nuevo va al final.

El puntero dice qué se puede hacer donde está: una **mano abierta** sobre una
barra (se mueve arrastrándola), la **flecha de redimensionar** en su borde
derecho, una **cruz** si mantenés Ctrl (arrastrando se dibuja una dependencia),
una **mano** sobre la línea de una dependencia y la mano que **agarra** en los
puntos de la dependencia elegida. Mientras se arrastra, la mano cerrada o la
flecha; y al dibujar una dependencia que no se puede hacer, el círculo
tachado.

Al parar el puntero sobre una barra, un resumen, un hito o una línea de
dependencia aparece un cuadro con lo que importa: la tarea y su EDT, las fechas,
la duración, el avance, los recursos, el trabajo, el costo, si es crítica o su
holgura y la fecha límite --una línea solo aparece si tiene algo que decir--; en
una dependencia, qué une, de qué tipo y con qué retardo.

**Ver → Formato del gráfico…** cambia cómo se ve el Gantt, sin tocar el archivo:
los **colores** (Clásico, Bosque, Ámbar, Violeta y Grafito; en todos la tarea
crítica se distingue de la común), el **tamaño de la barra**, y qué se dibuja:
el color de las críticas, el avance dentro de la barra, las dependencias y la
línea de hoy. **Junto a la barra** escribe a su derecha un dato de la tarea:
nombre, recursos, avance, fechas, duración, trabajo, costo o EDT. Es una
preferencia de la vista —se recuerda— y el gráfico exportado la lleva puesta.

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
lo de todos los días: nombre, inicio, fin, duración (`2d`, `8h`, `30m`, `2ed`
para elapsed, o un número en la unidad de la tarea), avance, hito, programada
manualmente y notas. **Avanzado** tiene lo que se toca poco: tipo de tarea,
calendario, condicionada por esfuerzo, estimada, restricción con su fecha,
fecha límite, el valor de un campo personalizado del archivo y el
**hipervínculo** de la tarea —texto, dirección y marcador—, con **Abrir** al
lado para ir a la dirección (el ticket de GLPI de esa tarea, por ejemplo); en
la columna **Hipervínculo** de la lista la celda es un enlace de verdad: se ve
subrayada y se abre con un clic, o con Enter cuando tiene el foco.
**Los campos personalizados no tienen tipo vínculo**: para una dirección, este
es el lugar. **Aplicar** está debajo de las pestañas, fuera de lo que se desplaza, y se ve en
**Tarea** y **Avanzado**: escribe todo junto en un solo Deshacer.

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
otra crea un vínculo, y **el tipo lo dicen las mitades de las barras**: la
mitad derecha de la que sale es su fin y la izquierda su inicio, y lo mismo
donde se suelta. De derecha a izquierda es Fin a inicio; de izquierda a
izquierda, Inicio a inicio; de derecha a derecha, Fin a fin; de izquierda a
derecha, Inicio a fin. Mientras se arrastra se marcan los dos extremos y el
tipo aparece junto al puntero. Los vínculos se dibujan según su tipo (un
Inicio a inicio sale por la izquierda). **Un clic sobre la línea** de un
vínculo lo elige -- se marca más gruesa, con un punto en cada extremo --;
**Supr** lo quita y **Esc** lo suelta; y un **punto** de un vínculo elegido se
agarra y se suelta sobre otra tarea para cambiarle esa punta, con el mismo tipo
y retardo y en un solo Deshacer. **Ctrl + Mayús + arrastrar** ignora las mitades
y dibuja el tipo de **Vínculo nuevo**, que es lo que sirve con un hito. Lo que
no se puede dibujar -- una tarea con ella misma, un resumen con sus propias
tareas, un ciclo, un vínculo de fin hacia un resumen -- muestra el motivo en
rojo y no escribe nada.

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

Los recursos son del plan y se administran en **Proyecto → Recursos…**, junto a
los calendarios y los campos personalizados. El diálogo los lista con su
máximo, **Pico** (las unidades simultáneas: si supera el máximo, está
sobreasignado), su tasa y el costo de sus asignaciones. **Nuevo**/**Aplicar**/
**Eliminar** editan el recurso; eliminar uno se lleva sus asignaciones.
**Tasas…** abre las tablas de tasas por fecha del recurso (A–E): los períodos
con sus fechas, su tasa, la extra y el costo por uso, con Agregar/Quitar;
aceptar es un solo Deshacer.

La pestaña **Recursos** del panel solo asigna: las asignaciones de la tarea seleccionada. Elegí recurso y unidades y
**Asignar**; **Quitar** las deshace. El trabajo se calcula desde la duración,
y lo que las unidades le hacen a la duración depende del tipo de tarea y de
si es condicionada por esfuerzo (una tarea que ya carga una unidad tarda la
mitad cuando llega otra).

El **presupuesto** de cada asignación se edita con el campo **Presupuesto** y
el botón del mismo nombre, sobre la asignación elegida en la tabla: el
presupuesto del plan **es la suma de las asignaciones** y no hay un total que se
escriba aparte —en el archivo el campo está en la asignación, y por eso no
está en otro lado—. Es un Deshacer y se puede dejar en cero, que es lo mismo
que no presupuestar.

El costo sale del trabajo por la tasa en un recurso de trabajo, de las
unidades por la tasa en uno material, más el costo por uso; si el archivo trae
su propio costo, ese manda. Si el recurso trae **tasas por fecha** (tablas A–E,
las edita **Tasas…**), el trabajo se reparte sobre el tiempo laborable de la
asignación y cada período cobra la parte que le toca: la asignación elige la
tabla y el período en que arranca el trabajo fija el costo por uso.

## Proyecto y calendarios

Las cuatro pestañas del panel lateral son **Tarea**, **Avanzado**,
**Vínculos** y **Recursos**: lo que es de *esta* tarea. Lo que es del plan entero está en el
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

**Proyecto → Campos personalizados…** administra los que el archivo define: la
lista con **Nuevo…** (arranca en el primer campo de texto libre, Text1 =
188743731 en adelante), **Editar…** (el `FieldID` no se toca, porque es la
identidad de los valores que las tareas ya llevan) y **Eliminar** (la
definición se va junto con sus valores). **Mostrar en la lista** tilda el
elegido, y se pueden mostrar **varios a la vez**: cada campo tildado es una
columna con el alias —o el nombre— que el archivo le da, y la elección es una
vista, se recuerda y no toca el archivo. Los valores de cada tarea se siguen
escribiendo en la pestaña **Tarea**.

Un campo puede ser **una lista de valores**: en **Editar…** se tilda *Una
lista de valores* y se cargan las entradas —valor y descripción—, que se
agregan y se quitan con los botones de abajo (cambiar una entrada es elegirla
y volver a **Agregar**). En la pestaña **Tarea** el valor de ese campo es un
desplegable con las entradas y **Ninguno** para dejarlo vacío, y el archivo
guarda, además del texto, el puntero a la entrada elegida. Quitar una entrada
o la lista entera no reescribe lo que las tareas decían: solo suelta el
puntero.

## Estadísticas

**Proyecto → Estadísticas…** abre el plan leído como un número: **costo**,
**fechas**, **avance** y **atrasos**. Es de solo lectura y no tiene Aceptar:
abrirlo no ensucia el archivo, no agrega un Deshacer y **no recalcula** — un
plan que todavía no fue calculado se muestra como está, con lo que el archivo
trae.

- **Costo**: el total del plan y su reparto entre recursos de trabajo,
  material y costo; el **presupuesto** que suman las asignaciones y su
  desvío, con lo que ya se gastó del presupuesto en porcentaje; el costo y el
  trabajo de la **línea base** y el desvío, cuando el plan tiene línea base; y
  cuántos recursos están **sobreasignados** (el pico de unidades supera su
  máximo, que es lo que dice la columna Pico). El dinero sale con el símbolo y
  las posiciones decimales que trae el archivo —la moneda del plan— y con el
  orden de símbolos de este escritorio. Un plan sin presupuesto muestra la
  fila vacía y no en cero: no tener presupuesto no es estar exactamente en él.
- **Cronograma**: el **tramo de la línea base** (las fechas que atrapó, de
  inicio a fin) contra el tramo que tiene el plan ahora, y el **desvío de
  cronograma** en **días de calendario** —con signo, y `en línea base` cuando
  es cero—. Son días de calendario y no laborables a propósito, porque esa es
  la pregunta que uno hace de voz alta ("¿cuánto vamos de tarde?"), mientras
  el desvío por tarea sí va en el calendario de la tarea. Una línea base que
  solo trae el fin **todavía desvía** pero **no es un tramo**: el desvío
  necesita una fecha de cada lado y el tramo necesita dos de la línea base.
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
  de la tarea); **Ctrl + arrastrar** dibuja un vínculo (el tipo lo dicen las
  mitades de las barras; con **Mayús** se usa el de **Vínculo nuevo**).
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
donde abre el diálogo, escala, unidad de una duración sin sufijo, y si
recalcula solo y si guarda la copia de recuperación. Las **columnas** también
se recuerdan, pero se eligen en **Ver → Columnas…**.

## Lo que no hace

No lee ni escribe `.mpp` (solo Microsoft escribe ese formato). No nivela
recursos: detecta la sobreasignación y la informa, pero no la resuelve. No
calcula valor ganado ni imprime vistas de uso de recursos. Las tareas
recurrentes y las divisiones (splits) no están modeladas.
