# Aceptación: la salida de la app abierta en MS Project

Lo que hay que probar es que un XML **escrito por esta app** lo abra
**Microsoft Project de escritorio** sin diálogo de reparación y con el plan
igual al original. Es el paso que cierra `tests/FIDELITY.md` §B y §D.

## Preparar la salida

Con el archivo real a mano (por ejemplo `urbano v5.05052026.xml`):

```sh
tests/aceptacion.sh "/home/matias/Escritorio/urbano v5.05052026.xml"
```

Sin el archivo real, `examples/desarrollo-bintana.xml` sirve igual: es de la
app y no lleva datos de nadie.

```sh
tests/aceptacion.sh examples/desarrollo-bintana.xml
```

Deja la salida y su informe en `/tmp/bintana-project-aceptacion/`. La última
línea dice cuál es el XML a abrir. El original **no se toca**: se trabaja sobre
una copia.

## El checklist

Abrir ese XML en Project de escritorio (2016, 2019, 2021 o 365) y mirar:

1. **Al abrir**: no debe aparecer ningún diálogo de reparación ni de
   advertencia. Anotar el texto exacto si aparece alguno.
2. **Contar**: 49 tareas y 5 hitos; 44 vínculos en la vista Gantt.
3. **F9** (Recalcular todo): nada debe moverse. Anotar cualquier tarea que
   cambie de fecha, con su nombre.
4. **Condicionada por esfuerzo** (clic derecho en el encabezado de columnas →
   *Insertar columna* → *Condicionada por esfuerzo*): todas en **No**. Es el
   único punto que puede fallar: la app omite ese campo cuando vale 0 y Project
   siempre lo escribe (ver §D).
5. **Estimada**: todas en **No**.
6. **Modo de programación** (columna *Programación manual* o *Modo de
   programación*): las 9 tareas manuales del archivo siguen en **Manual** y el
   resto en **Automática**.
7. **Fechas testigo**: fin del proyecto **10/06/2026 19:00**; "Documentación"
   del **05/06** al **09/06**; "Reunión inicial" el **10/02** (empieza antes
   del inicio del proyecto, con fechas reales).
8. **Guardar** de nuevo desde Project (Archivo → Guardar como, otro nombre):
   que Project lo guarde sin quejarse.

## Qué reportar

- Cualquier diálogo al abrir (texto literal).
- Si el F9 movió algo: qué tarea y de qué fecha a qué fecha.
- Si algún tilde de los puntos 4–6 difiere.
- Si el guardado de Project (punto 8) falló.

Con eso alcanza para saber si la vuelta quedó cerrada o si hay que tocar la
serialización de `Estimated`/`EffortDriven` (`Mspdi.js`).
