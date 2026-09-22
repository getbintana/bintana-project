# Fidelidad: lo que la ida y vuelta mide hoy

Medido el 2026-09-22 sobre los ocho fixtures de `tests/corpus/`, con el runtime
de Bintana en `../bintana`. El harness es `tests/run.sh`: por cada archivo
corre `check` (que imprime el informe `touched`), guarda el XML de salida y
compara ambos contra `tests/expected/`. Un golden es una foto del
comportamiento **actual**, no del deseado; `run.sh --update` los reescribe
cuando un cambio es deliberado, nunca por accidente.

| Fixture | tasks | hitos | attrs | links | problems in→out | touched |
|---|---|---|---|---|---|---|
| 01-minimal | 2 | 0 | 0 | 1 | 26 → 25 | 10 |
| 02-relations | 5 | 0 | 0 | 4 | 15 → 15 | 8 |
| 03-resources-assignments | 2 | 0 | 0 | 0 | 25 → 25 | 5 |
| 04-calendars | 1 | 0 | 0 | 0 | 22 → 22 | 1 |
| 05-durations | 4 | 1 | 0 | 1 | 16 → 16 | 10 |
| 06-timephased-custom | 1 | 0 | 1 | 0 | 26 → 26 | 2 |
| 07-extended-attrs | 3 | 2 | 2 | 2 | 21 → 20 | 10 |
| 08-namespace-2007 | 1 | 0 | 0 | 0 | 0 → 0 | 1 |

Los counts de tareas, links y attrs se conservan en los ocho; el Gantt dibuja
todos (el `check` lo afirma). Lo que sigue es lo que **cambia** en el archivo.

## A. Serialización (esperado)

- **El comentario antes del root se pierde en los ocho.** `writeMspdi` escribe
  `doc.Root`, así que todo lo que está fuera del elemento raíz queda fuera de
  la escritura. Los comentarios *dentro* del root sí se conservan. Decisión
  pendiente: escribir el documento entero (si `File.SaveXml` acepta un nodo
  documento) o aceptarlo y documentarlo.
- **La forma canónica** (indentación de dos, un newline final) reescribe el
  archivo entero; es invisible en el informe `touched` y está en los goldens.

## B. Campos modelados en su default (deliberado en `SaveXml`)

`SaveXml` borra un elemento modelado cuyo valor es el default del campo. En el
corpus eso toca: `IsNull=false`, `Type=0` (tarea y `PredecessorLink`),
`LinkLag=0`, `OutlineLevel=0`, `PercentComplete=0`, `<Name></Name>` vacío y
`UID`/`ID` 0 de la tarea resumen. Cada uno aparece en `touched` como
`removed`.

¿Project los tolera? Es la pregunta que contesta el archivo real. Salvo por
`UID=0` (ver C), son defaults del esquema y la ausencia debería ser
equivalente; queda pendiente medirlo.

## C. Bug de runtime: la clave en default reemplaza el elemento (Bintana)

En `rad.js`, `Record.#xmlKeyText` (línea ~2532) devuelve `null` cuando el valor
de la clave está en su default. `#xmlSaveList` usa ese `null` como "sin clave",
no matchea el elemento existente y crea uno nuevo; después borra el viejo. Con
`UID=0` (la tarea resumen, un UID **real**) el `<Task>` se reemplaza y con él
se pierden todos los hijos no modelados: `CreateDate`, `ActualStart`,
`ActualFinish`. Por eso 01 y 07 bajan un `problem` cada uno.

Repro: `tests/run.sh 01-minimal.xml` y mirar el primer `<Task>` de
`01-minimal.out.xml`: no tiene `CreateDate`, y los otros dos sí. El golden
actual **codifica el bug**; cuando se arregle en Bintana hay que correr
`--update` y actualizar la tabla de arriba (los problems vuelven a 26 y 21).

Arreglo propuesto en Bintana: una clave nunca es "default" -- su texto se
escribe aunque valga 0. Con eso el match por `UID` encuentra el elemento y solo
se tocan los campos modelados.

## D. Lo que sí se conserva

Todo lo no modelado sobrevive fuera del caso C: header de Project, `WeekDays`
y `Exceptions` de calendarios, `Baseline`, `TimephasedData`, `ActualStart/Finish`,
`Hyperlink`, `Estimated`, `OvertimeRate`, `SecondaryPID`/`AutoRollDown`/`Ltuid`.
Los `problem-in` y `problem-out` son idénticos en los ocho (salvo el
`CreateDate` que C se lleva).

## Qué sigue

1. Reportar C a Bintana con este repro (es el primer hallazgo del corpus).
2. Decidir A: ¿escribir el documento entero para conservar el comentario?
3. Conseguir el `Save As → XML` real y abrirlo en Project: eso convierte estos
   fixtures en dorado y contesta B.
