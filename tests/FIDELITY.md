# Fidelidad: lo que la ida y vuelta mide hoy

Medido el 2026-09-22 sobre los ocho fixtures de `tests/corpus/`, con el runtime
de Bintana en `../bintana`. El harness es `tests/run.sh`: por cada archivo
corre `check` (que imprime el informe `touched`), guarda el XML de salida y
compara ambos contra `tests/expected/`. La corrida completa juega además una
ronda guiada de los comandos de edición sobre `01-minimal` (`check-edit`,
goldens `edit-01-minimal.*`). Un golden es una foto del comportamiento
**actual**, no del deseado; `run.sh --update` los reescribe cuando un cambio es
deliberado, nunca por accidente.

Re-medido el mismo día tras el arreglo de la clave XML en default en Bintana:
los `problems` in→out quedaron iguales en los ocho. Tercera medición, con el
header de Project (moneda incluida), los calendarios, `Estimated`/
`EffortDriven` y los recursos y asignaciones modelados: los `problems` bajan
(05 pierde el de `Estimated`, 03 y 04 los de `OvertimeRate`/`ID`/`IsNull` de
recurso, el header pierde `CurrencyDigits`/`CurrencySymbol`/`CurrencyCode`/
`CurrencySymbolPosition`, y 01 y 06 los de `ActualStart`/`ActualFinish` y
`Baseline`), los defaults entran a la lista deliberada, y los counts siguen
iguales in→out.

Cuarta medición, 2026-09-23, con el número de vínculo corregido a lo que dice
el XSD (0=FF, 1=FS, 2=SF, 3=SS; el código leía 0=SS) y los defaults del shape
alineados al XSD: `Type` ya no se omite nunca (no tiene default y un 0 es FF o
Fixed Units), y un `DefaultTaskType=1`, un `ScheduleFromStart=true` o un
`MaxUnits=1` escritos por el archivo ahora se omiten porque el esquema dice
que la ausencia vale lo mismo. `09-defaults` fija el lado que no se puede
perder: ahí todo eso va al revés y sobrevive.

Quinta medición, el mismo día, con las tablas de tasas por fecha modeladas
(`Resource.Rates`: hasta 25 períodos por tabla, cinco tablas, y el
`CostRateTable` de la asignación eligiendo). `10-rates` deja las asignaciones
**sin** `Cost` para que el número lo derive el motor: el trabajo se reparte
sobre el tiempo laborable de la asignación y cada período toma la parte que le
toca, más el costo por uso del período en que arranca (dos aserciones nuevas en
`check-cpm`).

| Fixture | tasks | hitos | attrs | links | problems in→out | touched |
|---|---|---|---|---|---|---|
| 01-minimal | 2 | 0 | 0 | 1 | 8 → 8 | 13 |
| 02-relations | 5 | 0 | 0 | 4 | 2 → 2 | 10 |
| 03-resources-assignments | 2 | 0 | 0 | 0 | 4 → 4 | 10 |
| 04-calendars | 1 | 0 | 0 | 0 | 2 → 2 | 12 |
| 05-durations | 4 | 1 | 0 | 1 | 2 → 2 | 12 |
| 06-timephased-custom | 1 | 0 | 1 | 0 | 10 → 10 | 5 |
| 07-extended-attrs | 3 | 2 | 2 | 2 | 8 → 8 | 11 |
| 08-namespace-2007 | 1 | 0 | 0 | 0 | 0 → 0 | 1 |
| 09-defaults | 2 | 0 | 0 | 1 | 1 → 1 | 4 |
| 10-rates | 2 | 0 | 0 | 0 | 4 → 4 | 8 |

Los counts de tareas, links y attrs se conservan en los diez; el Gantt dibuja
todos (el `check` lo afirma). Lo que sigue es lo que **cambia** en el archivo.

## A. Serialización (esperado)

- **Los comentarios se conservan, dentro y fuera del root.** `writeMspdi`
  escribe el documento entero (`File.SaveXml` acepta un nodo documento), así
  que el comentario de cabecera de cada fixture viaja de ida y vuelta
  (arreglado el 2026-09-22; antes se perdía).
- **La forma canónica** (indentación de dos, un newline final) reescribe el
  archivo entero; es invisible en el informe `touched` y está en los goldens.

## B. Campos modelados en su default (deliberado en `SaveXml`)

`SaveXml` borra un elemento modelado cuyo valor es el default **declarado en el
shape**, y desde el 2026-09-23 ese default es el del XSD donde el XSD tiene
uno. Así, un `ScheduleFromStart=true`, un `DefaultTaskType=1` o un `MaxUnits=1`
escritos por el archivo se omiten -- la ausencia vale lo mismo para el
esquema -- y `Type` (tarea y `PredecessorLink`), que no tiene default en el
XSD, ya no se omite nunca: un 0 es FF en un vínculo y Fixed Units en una tarea,
y borrarlo cambiaba el plan. `09-defaults` cubre ese lado: `false`, `0` y la
ausencia de `MaxUnits` sobreviven la vuelta.

El resto de la lista son ceros y falses que el esquema tampoco declara pero que
la ausencia lee igual: `IsNull=false`, `LinkLag=0`, `OutlineLevel=0`,
`PercentComplete=0`, `<Name></Name>` vacío, `ID` 0 de la tarea resumen,
`CurrencySymbolPosition=0`, `RateTable=0` y `CostRateTable=0` (la tabla A es
la que un lector asume, como FS en un vínculo sin `Type`), y los defaults de
calendario: `DayWorking=false` (día no laborable), `IsBaseCalendar=false`
(calendario de recurso), `EnteredByOccurrences=false`, `Period=0` y
`DaysOfWeek=0`. Cada uno aparece en `touched` como `removed`. `ID` no es clave
en el shape y su ausencia es posicional para Project.

Una clave, en cambio, no es un default: `UID 0` se escribe siempre (arreglado
en Bintana el 2026-09-22), así que no aparece en `touched`.

¿Project tolera estos defaults? Es la pregunta que contesta el archivo real:
los declarados por el esquema deberían ser equivalentes por definición; los
demás, ceros que Project escribe o no según el caso, quedan pendientes.

## C. Lo que sí se conserva

Todo lo no modelado sobrevive: los elementos del header que el shape no declara
(`Title`, `FYStartDate`, `CriticalSlackLimit`, `StatusDate`, `CurrentDate`,
`DefaultStandardRate`/`DefaultOvertimeRate` y compañía), los `WeekDays` y
`Exceptions` completos de cada calendario, `TimephasedData` de tareas, recursos
y asignaciones, los actuals de la asignación, `Interim`/`BCWS`/`BCWP` de las
líneas base, `SecondaryPID`/`AutoRollDown`/`Ltuid` de los campos extendidos y
el `CreateDate` de la tarea resumen. Los `problem-in` y `problem-out` son
idénticos en los diez.

## D. El oráculo: un archivo de Project (2026-09-23)

El primer archivo real: `urbano v5.05052026.xml`, guardado por Project 16.0
(326 KB, 59 `Task` -- 49 tareas y 10 nulas --, 45 `PredecessorLink`, 49
asignaciones al recurso nulo, 185 `TimephasedData`, sin baselines). No se
versiona: es de un tercero. Se copió a `/tmp` y se midió con `check` y con
`check-oracle`.

- **Ida y vuelta**: `problems` 5396 → 5337 (los 59 `Manual` dejan de ser un
  problema al modelarse), `touched` 843, y ningún elemento perdido: las 752
  bajas son defaults (los ceros que Project escribe en cada tarea) y los 91
  cambios de valor son la forma booleana (`1`/`0` de Project → `true`/`false`
  del esquema). `ScheduleFromStart=1` se omite porque el XSD lo declara
  `true`; los `Estimated=0` y el `WeekStartDay=0` ahora se conservan.
- **CPM**: `check-oracle` compara tarea por tarea contra las fechas que
  escribió Project: **42 de 42 iguales** en inicio, fin y criticidad. Las
  reglas que hizo falta agregar, todas verificadas contra el archivo:
  - `CalendarUID=-1` en una tarea es el calendario del proyecto; el motor caía
    al calendario del esquema y corría todas las horas (09:00-13:00 y
    15:00-19:00 en el archivo).
  - Las tareas `Manual` conservan sus fechas, y un resumen manual fija el piso
    de su rama.
  - Una tarea terminada (`ActualFinish`) no se reprograma: es historia.
  - El pase atrás arranca del `FinishDate` del proyecto y no del último fin
    programado (la tarea manual final corre el fin del plan).
- Queda abierto: los `EffortDriven=0` (59) todavía se omiten -- no hay default
  en el XSD y MPXJ lee la ausencia como falso, pero Project los escribe
  siempre; conviene confirmarlo abriendo la salida en Project.

## Qué sigue

1. Abrir en Project el XML que sale de acá (el archivo real ya está): contesta
   B, el `EffortDriven` omitido y convierte el corpus en dorado.
2. Medir el CPM de los cuatro tipos de vínculo contra Project: el archivo real
   trae 45 vínculos, casi todos FS; los otros tipos siguen calculados a mano.
