# bintana-project

MSPDI (MS Project XML) in Bintana: open a Project XML file, edit its tasks in a
tree beside a Gantt, and write it back without touching what the model does not
own. The plan is a real scheduler one phase at a time -- `ROADMAP.md` says in
which order.

## Run it

```sh
/home/matias/Proyectos/bintana/build/bintana /home/matias/Proyectos/bintana-project           # window, opens tests/corpus/01-minimal.xml
/home/matias/Proyectos/bintana/build/bintana /home/matias/Proyectos/bintana-project plan.xml  # or a file of your own
/home/matias/Proyectos/bintana-project/tests/run.sh                                           # the fidelity harness, headless
```

The window is a menu bar (File/Edit/View/Tools/Help), an icon toolbar with the
commands that matter while editing, the WBS and the chart, the properties panel
and a status bar. Every command is declared once as an `Action`, so the toolbar
button, the menu item and its key are one command with one `Enabled` and one
label. The panel is three tabs -- **Task**, **Links**, **Resources** -- and the
log starts hidden: **View → Show log** brings it back. A Project XML dragged
onto the window opens too.

The list is the WBS as a tree
keyed by UID -- summaries fold, IsNull rows are skipped, durations read in the
unit the file's `DurationFormat` says. Selecting a row marks the same task in
the chart, which draws summaries as brackets and critical tasks in red.

The chart owns its size: as tall as its rows and as wide as the **Timescale**
combo asks -- `Auto` fits the view, `Day`/`Week`/`Month` set a day width and the
scroller beside them shows what does not fit. The table and the chart scroll
independently, which is the same simplification as their geometry. **Export**
writes the chart at its own size as a PNG or a PDF, which is how it reaches
somebody who does not run the app.

The pointer edits too: click a bar to select it, **drag** it to move the task,
drag its **end** to resize (the duration follows, measured in working time on
the task's own calendar), and **Ctrl-drag** from one bar to another to draw an
FS dependency. Nothing is written until the button is let go, so one gesture is
one undo; a task with no dates is only reachable from the table.

## Editing

The panel on the right is a view of the selected row: type a name, a moment
(`2026-10-01 08:00`), a duration (`2d`, `8h`, `30m`, `2ed` for elapsed, or a
bare number in the task's own unit), a percentage, the milestone, estimated and
effort-driven ticks, a constraint (`ASAP` through `FNLT`, with its date), a
deadline or notes, and Apply writes them as one command -- one undo. **Add** puts a new task after the selected one and its
subtree, **Delete** takes that subtree and every link into it, and
**Indent**/**Outdent** move a task a level, recomputing which tasks are
summaries, and **Up**/**Down** swap it with its sibling, subtree and all.
**Recent** drops the last eight files. The **Resources** tab lists the plan's
resources with their rate and the cost of their assignments -- a work resource
by the hours, a material by the units, the file's own `Cost` where it wrote
one -- and edits them: **New**/**Apply**/**Delete** for a resource (deleting
one takes its assignments with it), and below, the selected task's
assignments, where **Assign** joins a resource at some units and computes the
work from the task's duration. One resource per task is one assignment:
assigning it again updates the units. **Predecessors** lists the selected task's links: pick a task, a
type (FS/SS/FF/SF) and a lag in minutes, **Link** adds or updates it, and
picking a row and **Unlink** takes it out -- which is what Recalculate then
schedules. `Ctrl+Z`/`Ctrl+Shift+Z` walk the history, `Ctrl+S` saves in place
and `Ctrl+Shift+S` asks where; closing with unsaved work asks first, and the
title carries a `•` while there is any.

The history is a stack of snapshots of the record tree, not a set of inverse
commands: a deletion that another task linked to comes back whole. Nothing is
written until Save, and what Save writes is still `SaveXml` into the tree the
file was read from -- an edit cannot touch what the shapes do not model.
`OutlineNumber` and `WBS` are left as they were; Project derives them.

**Recalculate** (`F5`) runs the scheduling pass: every task with no predecessor
starts at the project start, every other one as soon as its links allow -- FS,
SS, FF and SF, with the lag in working time on the task's own calendar -- the
hard constraints are applied (`MSO` pins the start, `MFO` the finish, `SNET`
and `FNET` put a floor under each), a summary becomes the span of its
children, and a backward pass marks as `Critical` every task whose slack
against the project finish is zero. `ALAP`, `SNLT` and `FNLT` need Project's
own backward scheduling, so a task carrying one keeps the dates the file
wrote; a `Deadline` is a target and never schedules anything, but the log
counts the tasks past theirs. It is one undo, like any other command; the
chart paints critical tasks red and shows completion as a band inside the bar,
so neither hides the other. `CriticalSlackLimit` is not modelled, so the limit
is zero.

## The rule that makes it an interchange

`SaveXml` writes into the tree it was handed and touches only what the shapes
model. Everything else -- the Project header, calendars' working times,
baselines, timephased data, comments -- is reported in the log (`Problems`) and
kept in the tree exactly where it was. That is the whole of what makes a round
trip an interchange and not a rewrite; `Mspdi.js` carries the argument.

## What is modelled (cut 1)

Tasks (identity, dates, durations as text, the milestone/summary/critical/
estimated/effort-driven flags, constraints and deadline, notes, predecessor
links, custom-field values), resources with their rates and costs, assignments
with their work and cost, the Project header, full calendars, and the
`ExtendedAttribute` definitions and values -- custom fields are generic here,
nothing in the app assumes what a file puts in them.
UID/WBS/OutlineNumber are display, never identity: Project reassigns UIDs when
appending/merging and WBS is positional.

## The corpus

`tests/corpus/` holds seven synthetic files covering relations, resources,
calendars, durations, timephased data and custom fields, plus an eighth for the
`/2007` namespace the official XSD declares. They are **not** a golden set:
acceptance is a real `Save As → XML` from MS Project, opened back by Project.
`tests/corpus/README.md` says what each one covers.

`tests/run.sh` is the harness: it round-trips every fixture, and on a full run
also plays one scripted round of the editing commands over `01-minimal`, holding
each saved output and its `touched` report against the goldens in
`tests/expected/` (`--update` rewrites them after a deliberate change).
`tests/FIDELITY.md` classifies what they measure -- including the first upstream
bug the corpus found; `tests/run.sh <name>` runs one file.

## What is not here yet

Slack, the critical path, constraints, deadlines, task types and resource
calendars -- and anything `.mpp`: the binary format is deliberately out of
scope (partial knowledge reads it, only Microsoft writes it) -- exchange goes
through XML. The corpus measures the road to it; see `ROADMAP.md`.

## Settings and translation

Five things are remembered, all under `bintana-project.*` in `Settings` (the
per-project file in the config directory, never beside the schedule): the
folder the last file came from, the timescale, which custom field the list
shows (by `FieldID`, empty for the first), the unit a bare duration is read in,
and the recent list. **Settings…** in the Tools menu is the one dialog that
edits them, and it edits the same keys the code reads -- what it writes takes
effect on Save, and a headless check never touches any of it.

The interface is translated: form texts when the form is built, the strings
the code composes through `Locale.Text(...)`, and `Message.*`'s first argument.
`po/es.po` is the catalogue that ships, and `LANGUAGE=es` picks it:

```sh
LANGUAGE=es /home/matias/Proyectos/bintana/build/bintana /home/matias/Proyectos/bintana-project
```

The harness pins `LANGUAGE=en`: a golden written under one catalogue is not the
golden of another. The log's diagnostics stay in English on purpose -- they
name elements of the format.

What is deliberately **not** planned: per-file settings inside the XML (foreign
elements in an interchange file are somebody else's data), and credentials of
any kind (a secret is the host's secret store's, not a field's).
