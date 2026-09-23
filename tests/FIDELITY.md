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

| Fixture | tasks | hitos | attrs | links | problems in→out | touched |
|---|---|---|---|---|---|---|
| 01-minimal | 2 | 0 | 0 | 1 | 8 → 8 | 11 |
| 02-relations | 5 | 0 | 0 | 4 | 2 → 2 | 9 |
| 03-resources-assignments | 2 | 0 | 0 | 0 | 4 → 4 | 10 |
| 04-calendars | 1 | 0 | 0 | 0 | 2 → 2 | 9 |
| 05-durations | 4 | 1 | 0 | 1 | 2 → 2 | 10 |
| 06-timephased-custom | 1 | 0 | 1 | 0 | 10 → 10 | 5 |
| 07-extended-attrs | 3 | 2 | 2 | 2 | 8 → 8 | 9 |
| 08-namespace-2007 | 1 | 0 | 0 | 0 | 0 → 0 | 1 |

Los counts de tareas, links y attrs se conservan en los ocho; el Gantt dibuja
todos (el `check` lo afirma). Lo que sigue es lo que **cambia** en el archivo.

## A. Serialización (esperado)

- **Los comentarios se conservan, dentro y fuera del root.** `writeMspdi`
  escribe el documento entero (`File.SaveXml` acepta un nodo documento), así
  que el comentario de cabecera de cada fixture viaja de ida y vuelta
  (arreglado el 2026-09-22; antes se perdía).
- **La forma canónica** (indentación de dos, un newline final) reescribe el
  archivo entero; es invisible en el informe `touched` y está en los goldens.

## B. Campos modelados en su default (deliberado en `SaveXml`)

`SaveXml` borra un elemento modelado cuyo valor es el default del campo. En el
corpus eso toca: `IsNull=false`, `Type=0` (tarea y `PredecessorLink`),
`LinkLag=0`, `OutlineLevel=0`, `PercentComplete=0`, `<Name></Name>` vacío,
`ID` 0 de la tarea resumen, `IsNull=false` de un recurso,
`CurrencySymbolPosition=0`, y -- desde que el header y los calendarios se
modelan -- `DefaultTaskType=0` y los defaults de calendario: `DayWorking=false`
(día no laborable), `IsBaseCalendar=false` (calendario de recurso),
`EnteredByOccurrences=false`, `Period=0` y `DaysOfWeek=0`. Cada uno aparece en `touched` como `removed`. `ID` no es clave
en el shape y su ausencia es posicional para Project.

Una clave, en cambio, no es un default: `UID 0` se escribe siempre (arreglado
en Bintana el 2026-09-22), así que no aparece en `touched`.

¿Project tolera estos defaults? Es la pregunta que contesta el archivo real:
son defaults del esquema y la ausencia debería ser equivalente; queda
pendiente medirlo.

## C. Lo que sí se conserva

Todo lo no modelado sobrevive: header de Project, `WeekDays` y `Exceptions` de
calendarios, `Baseline`, `TimephasedData`, `ActualStart/Finish`, `Hyperlink`,
`Estimated`, `OvertimeRate`, `SecondaryPID`/`AutoRollDown`/`Ltuid`, y el
`CreateDate` de la tarea resumen. Los `problem-in` y `problem-out` son idénticos
en los ocho.

## Qué sigue

1. Decidir A: ¿escribir el documento entero para conservar el comentario?
2. Conseguir el `Save As → XML` real y abrirlo en Project: eso convierte estos
   fixtures en dorado y contesta B.
