# Corpus MSPDI sintético

Generado el 2026-09-22; copiado de `/tmp/opencode/mspdi-corpus/` al proyecto
el mismo día. Sintético, no escrito por MS Project: sirve para diseñar el
parser/modelo y para el harness de ida y vuelta, **no** como dorado de
aceptación (ese debe ser un `Save As → XML` de Project real, abierto de vuelta
por Project).

## Ficheros

| Fichero | Cubre |
|---|---|
| `01-minimal.xml` | Proyecto mínimo válido: resumen + 2 tareas + 1 dependencia FS |
| `02-relations.xml` | Los 4 tipos (FF=0, FS=1, SF=2, SS=3) + lag positivo y lead negativo |
| `03-resources-assignments.xml` | Recursos work (unidades 1 y 0.5) + material, 3 asignaciones |
| `04-calendars.xml` | Calendario base, excepción (feriado 25-dic), calendario de recurso nocturno |
| `05-durations.xml` | Duraciones min/h/d/w/mo, estimada (`43`), hito, resumen, tarea nula (`IsNull`) |
| `06-timephased-custom.xml` | `TimephasedData` en tarea y asignación, `ExtendedAttribute` Text1, baseline |
| `07-extended-attrs.xml` | Campos extendidos + `HyperlinkAddress`: 2 tareas con Text1 (`External_ID`), 1 sin valor (creada en Project) |
| `08-namespace-2007.xml` | El namespace que declara el XSD oficial (`/2007`), que Project no escribe; el lector debe aceptar ambos |
| `09-defaults.xml` | Los defaults del XSD que no se pueden borrar: `ScheduleFromStart=false`, `DefaultTaskType=0`, `Type=0` de tarea y de vínculo (FF), `MaxUnits` ausente |
| `10-rates.xml` | Tablas de tasas por fecha: dos períodos en la tabla A y uno en la B, asignaciones sin `Cost` y la B elegida por `CostRateTable` |

## Convenciones usadas

- Namespace `http://schemas.microsoft.com/project`, `SaveVersion=14` (Project 2010+, generación vigente). `08` usa `/2007` a propósito.
- `dateTime` ISO `YYYY-MM-DDTHH:MM:SS`, duraciones `xsd:duration`. El corpus usa la forma `PT…S` y `P8D` (`04`); evita `P2W`/`P1M`, que el tipo `xsd:duration` de libxml2 rechaza.
- `DurationFormat`: 3=m, 5=h, 7=d, 9=w, 11=mo, 43=mo estimada. `Type` tarea: 0=Fixed Units, 1=Fixed Duration.
- `Type` dependencia: 0=FF, 1=FS, 2=SF, 3=SS (el XSD de MSPDI, verificado
  2026-09-23). `LinkLag` en décimas de minuto con `LagFormat`.

## Validación

- Bien-formado XML: sí (python `xml.dom.minidom`, 2026-09-22).
- Conformidad XSD: **los 6 validan contra `mspdi_pj12.xsd`** (xmllint, 2026-09-22)
  **con una salvedad**: el XSD oficial declara
  `targetNamespace="http://schemas.microsoft.com/project/2007"` pero los
  ficheros usan `xmlns="http://schemas.microsoft.com/project"`, que es lo que
  Project escribe de verdad. La validación se hizo remapeando el namespace;
  un lector (MPXJ hace lo mismo) debe aceptar ambos o ignorar el namespace.
- Lecciones del XSD que el corpus ya respeta: es `xsd:sequence` (el orden de
  los elementos importa: `CurrencyCode` —obligatorio— antes de `CalendarUID`,
  `MaxUnits` antes de `StandardRate`, `TimePeriod` segundo en `Exception`,
  baselines como elemento `Baseline` y no como `BaselineWork` plano,
  `TimephasedData` siempre último).
- Apertura en Project real — pendiente, el paso que convierte un fixture en dorado.

## Origen de `mspdi_pj12.xsd`

Descargado de `http://schemas.microsoft.com/project/2007/mspdi_pj12.xsd`
(esquema oficial Project 2007, rev. 2007-11-28, 239 KB, © Microsoft). **No se
vendorea**: es de Microsoft y el runtime no valida contra él; queda como
referencia en la máquina donde se escribe el formato. Si hiciera falta, el
`mspdi_pj14.xsd` está espejado en `nasa/CertWare`.
