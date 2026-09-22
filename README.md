# bintana-project

MSPDI (MS Project XML) in Bintana: read a Project XML file, show its tasks on
a Gantt, and write it back without touching what the model does not own. The
long-term aim is an editor, not a viewer -- `ROADMAP.md` says in which order.

## Run it

```sh
/home/matias/Proyectos/bintana/build/bintana /home/matias/Proyectos/bintana-project   # window, opens tests/corpus/01-minimal.xml
/home/matias/Proyectos/bintana-project/tests/run.sh                                   # the fidelity harness, headless
```

## The rule that makes it an interchange

`SaveXml` writes into the tree it was handed and touches only what the shapes
model. Everything else -- the Project header, calendars' working times,
baselines, timephased data, comments -- is reported in the log (`Problems`) and
kept in the tree exactly where it was. That is the whole of what makes a round
trip an interchange and not a rewrite; `Mspdi.js` carries the argument.

## What is modelled (cut 1)

Tasks (identity, dates, durations as text, milestone/summary/critical flags,
predecessor links, custom-field values), resources, assignments, calendars as
UID/Name, and the `ExtendedAttribute` definitions and values -- custom fields
are generic here, nothing in the app assumes what a file puts in them.
UID/WBS/OutlineNumber are display, never identity: Project reassigns UIDs when
appending/merging and WBS is positional.

## The corpus

`tests/corpus/` holds seven synthetic files covering relations, resources,
calendars, durations, timephased data and custom fields, plus an eighth for the
`/2007` namespace the official XSD declares. They are **not** a golden set:
acceptance is a real `Save As → XML` from MS Project, opened back by Project.
`tests/corpus/README.md` says what each one covers.

`tests/run.sh` is the harness: it round-trips every fixture and holds the saved
output and the `touched` report against the goldens in `tests/expected/`
(`--update` rewrites them after a deliberate change). `tests/FIDELITY.md`
classifies what they measure -- including the first upstream bug the corpus
found; `tests/run.sh <name>` runs one file.

## What is not here yet

Recalculation (CPM over dependencies + calendars) and anything `.mpp`: the
binary format is deliberately out of scope (partial knowledge reads it, only
Microsoft writes it) -- exchange goes through XML. The corpus measures the road
to it; see `ROADMAP.md`.

## Configuration (planned, not implemented)

Nothing here reads a setting yet; every choice below is a constant in the code
(`GUTTER`, `HEADER`, `ROW_H`, the corpus path). When a caller arrives -- the
second project file that wants something different -- they move, in this order,
and not before:

- **Where**: `Settings`, under `bintana-project.*`, so one project never reads
  another's. No file in the project directory: a project tree may be installed
  read-only, and a password next to the schedule would land in version control.
- **What**: the default folder to open from; the timescale (`Day`/`Week`/
  `Month`, today `Auto` by pixel width); which custom field, if any, the list
  shows (today the first one); whether summaries draw as Span bars (today they
  are skipped).
- **UI**: a single settings dialog off the menu bar, editing the same keys the
  code reads -- no second spelling of a default, in code or in a form.

What is deliberately **not** planned: per-file settings inside the XML (foreign
elements in an interchange file are somebody else's data), and credentials of
any kind (a secret is the host's secret store's, not a field's).
