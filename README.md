# bintana-project

MSPDI (MS Project XML) in Bintana: open a Project XML file, edit its tasks in a
tree beside a Gantt, and write it back without touching what the model does not
own. The plan is a real scheduler one phase at a time -- `ROADMAP.md` says in
which order.

[`MANUAL.md`](MANUAL.md) is the user's manual, in Spanish, and this file is for
whoever works on it.

## Run it

```sh
/home/matias/Proyectos/bintana/build/bintana /home/matias/Proyectos/bintana-project           # window, opens a copy of the sample
/home/matias/Proyectos/bintana/build/bintana /home/matias/Proyectos/bintana-project plan.xml  # or a file of your own
/home/matias/Proyectos/bintana/build/bintana /home/matias/Proyectos/bintana-project \
    examples/desarrollo-bintana.xml                                                          # this project's own plan
/home/matias/Proyectos/bintana-project/tests/run.sh                                           # the fidelity harness, headless
```

`examples/desarrollo-bintana.xml` is the plan for building this application --
phases, milestones, resources with dated rates, costs, a manual task and the
round trip to Project -- made with the app itself and scheduled by its own
engine (33 tasks, 7 milestones, 35 links). It is also the demo: open it and
press F5, nothing moves.

The window is a menu bar (File/Edit/View/Tools/Help), an icon toolbar with the
commands that matter while editing, the WBS and the chart, the properties panel
and a status bar. Every command is declared once as an `Action`, so the toolbar
button, the menu item and its key are one command with one `Enabled` and one
label. The panel is four tabs -- **Task**, **Links**, **Resources**,
**Project** -- and the log starts hidden: **View → Show log** brings it back. A
Project XML dragged onto the window opens too.

The list is the WBS as a tree
keyed by UID -- summaries fold, IsNull rows are skipped, durations read in the
unit the file's `DurationFormat` says -- and the field in the toolbar filters
it: a task whose name matches, and the ancestors that give it its place, with
the magnifier clearing the filter. Selecting a row marks the same task in the
chart, which draws summaries as brackets and critical tasks in red.

**View → Columns…** (or the row's context menu) chooses what the table shows
beside the name, which is the tree and never goes: duration, start, finish,
percent complete, critical, milestone, work, cost, WBS, priority, constraint,
deadline, calendar, task type, notes and the file's custom field -- added and
removed with a tick. The choice is a view setting, like the timescale: it
survives the window and never touches the file. **A secondary click on a column
heading** is the gesture Project has for it, and reaches the same place: hide
the column under the pointer (the name cannot go), show every column again, or
open the dialog.

**The two panes are the same rows, and folding is where that is decided.**
`chartRows()` is the one call both the drawing and the hit-test read, and it
returns `visibleTasks()` **with the branches the list has closed taken out**.
Nothing in the runtime reports a fold -- there is no event for the disclosure
arrow and a tree answers `Row` and `Cell` by key, so nothing enumerates what it
is showing -- which is why the branch is asked directly, per frame, and not
kept. For the same reason a fold is **noticed by looking**: the chart remembers
the rows it last drew and a timer asks, every 150 ms, whether those are still
the rows, redrawing only when they are not (`startFoldWatch`). Skipping it was a
broken promise rather than a missing feature, and a costly one -- the chart kept
drawing all forty-one rows while the list showed thirty-seven, so thirty-five of
the rows a reader could see carried another task's bar, and clicking one
selected that other task. The timescale is the plan's (`chartRange()`), not the
rows a fold left showing, so folding never moves a bar sideways. `check-view`
folds a nested branch without moving the scroll, so no `Scroll` redraws it, and
asserts that what the chart drew and row `i` are the same task on both sides.

**The chart sits beside the table, in the same view, with one scroll between
them.** The two are on the same ground because they are the same kind of node: the chart
wears the theme's `view` class, which is the class a theme paints a surface with
and the one a `GtkColumnView` wears itself -- a theme writes the list as
`columnview.view`. So the ground *and* the ink are the theme's, there is no value
copied into a form that can go stale, and a theme change costs nothing. (A
control paints no background of its own, which is why a `Background` set on a
drawing area does nothing at all; and GTK 4 removed the resolver that would have
answered *what colour is that list*.) A chart *written to a file* carries a
ground of its own, because a file has none to inherit. Their headings are one strip: the list's heading row has a
floor of 34 pixels (`TableView.HeaderMinHeight`, which exists because the heading
does not follow the list's font) and the chart fills exactly that band with the
timescale -- a week over a month -- under a rule the list's own header has. The days the project's calendar does not work are shaded behind the
rows, dependencies are drawn under the bars rather than over them, the heading
carries a week over a month in a smaller type, and every colour is either the
theme's own ink or an `rgba()` shade over whatever ground the theme has -- so the
chart follows a light or a dark theme instead of carrying one of its own. The two panes are in a `Split` you can drag, and the chart is drawn in
the list's own coordinates: row *i* of the chart is where row *i* of the table
is, at the height the table's rows are (the theme's, not a constant of this
program). The list is the only thing that scrolls down -- its scrollbar, the
wheel over either pane and the keyboard all move both -- and the chart's own
scroller is horizontal, because what does not fit in a chart is the timescale.
The divider between the panes' heading row and the rows is the **timescale**:
weeks over months, the way Project reads it.

What a wider window buys is timescale: the panel of properties has a width of its
own and the list keeps the one it has, so the chart is the elastic pane. Both
dividers can be dragged and nothing moves them back. The window can always be
made smaller again, maximized or not: the chart is given a *floor* rather than a
width -- a width would be a minimum request to the toolkit, and every resize
would feed itself back -- and a floor on the axis that scrolls stays inside the
scroller, which is what shows the timescale that does not fit.

A filter narrows both panes: the chart draws the rows the list is showing, so a
bar stays beside the name it belongs to and the timescale closes around what is
left. **Export Chart…** writes the same rows.

The chart's width is what the **Timescale** combo asks -- `Auto` fits the view,
`Day`/`Week`/`Month` set a day width. **Export Chart…** writes the whole plan
as a PNG or a PDF, from its first row and with the task names in a gutter, since
a file has no list beside it; **Report…** (File menu, over `lib/report`) writes
the plan as a banded document -- tasks with dates, duration, progress and cost,
totalled -- which is how any of it reaches somebody who does not run the app.

The pointer edits too: click a bar to select it, **drag** it to move the task,
drag its **end** to resize (the duration follows, measured in working time on
the task's own calendar), and **Ctrl-drag** from one bar to another to draw an
FS dependency. Nothing is written until the button is let go, so one gesture is
one undo; a task with no dates is only reachable from the table.

## Editing

The panel on the right is a view of the selected row: type a name, a moment
(`2026-10-01 08:00`), a duration (`2d`, `8h`, `30m`, `2ed` for elapsed, or a
bare number in the task's own unit), a percentage, the milestone, estimated and
effort-driven ticks, the task type (Fixed Units/Duration/Work), a constraint
(`ASAP` through `FNLT`, with its date), a deadline, notes, or the value of a
custom field the file defines -- the same
`FieldID` the list's column can be pointed at -- and Apply writes them as one
command -- one undo. **Add** puts a new task after the selected one and its
subtree, **Delete** takes that subtree and every link into it, and
**Indent**/**Outdent** move a task a level, recomputing which tasks are
summaries, and **Up**/**Down** swap it with its sibling, subtree and all.
The **Project** tab edits the header the schedule hangs from -- start date,
default calendar, minutes a day/week, days a month, default task type, week
start and currency -- and lists the calendars, where **Edit…** opens one whole:
its week days (each with its working times as prose, `08:00-12:00
13:00-17:00`, because a day may have more than one span) and its exceptions.
The minutes a day is not decoration: it is what a typed `1d` means.

**Recent** drops the last eight files. The **Resources** tab lists the plan's
resources with their rate, the cost of their assignments -- a work resource by
the hours, a material by the units, the file's own `Cost` where it wrote one
-- and **Peak**: the most units assigned at once, which is over the maximum
when two tasks overlap. Recalculate says how many resources are over. The tab
edits them too: **New**/**Apply**/**Delete** for a resource (deleting one
takes its assignments with it), and below, the selected task's assignments,
where **Assign** joins a resource at some units and computes the work from the
task's duration. One resource per task is one assignment: assigning it again
updates the units. What the units do to the duration is the task's `Type` and
its effort-driven flag: an effort-driven task keeps its work and shortens as
units add up (one that already carries a unit takes half the time when a second
arrives), Fixed Duration ignores the flag, and any other type keeps the
duration and lets the work grow. Recalculate applies the same identity to the
whole plan -- a task with work resources is scheduled at `Work / Units`, or
has its work derived from the duration when it is Fixed Duration -- while a
duration typed by hand stays the user's number.

**Predecessors** lists the selected task's links: pick a task, a
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
against the project finish is zero. `SNLT` and `FNLT` are the soft half: they
never pin anything -- the task is scheduled as early as its links allow, and
the log counts the dates it passed. `ALAP` needs Project's own backward
scheduling, so a task carrying one keeps the dates the file wrote. A `Deadline`
is a target and never schedules anything, but the log counts the tasks past
theirs. It is one undo, like any other command; the
chart paints critical tasks red and shows completion as a band inside the bar,
so neither hides the other. `CriticalSlackLimit` is not modelled, so the limit
is zero. A task past its deadline gets a small red arrow over its bar where the
deadline was promised, and the log counts them.

**Save Baseline** (Edit menu) keeps the plan as it stands -- every task's dates
and work into its own `Baseline` -- and the chart draws that baseline as a thin
gray bar under the task's own, which is what a slip is read against. The
percentage in the panel moves the actual dates the way Project reads them:
above zero the task has an `ActualStart`, at a hundred it has an
`ActualFinish`, and back at zero it has neither.

**Project → Statistics…** reads the plan as a number, in four sheets: cost
(total, by resource kind, baseline and variance, over-allocated), dates (start,
finish, status date, duration in working days, calendar days, elapsed,
remaining), progress (work-weighted percent, and the split into done, in
progress and not started) and behind (past a deadline, past a baseline, worst
slip, constraints not met, days the plan is past its own finish), with the list
of the tasks that missed their date and what each costs. **It is a reading and
not an edit**, and that is why it has no OK: opening it is not a command, it
writes nothing, and **it does not recalculate** either -- a plan that was never
scheduled is shown as it stands. The arithmetic is `projectStats` in `Stats.js`,
one pass over the shape, and it says in its own header what it counts and what
it leaves out. A slip is measured against **the promise the file made** (a
baseline finish, or a deadline) in calendar days without looking at the
holidays in between -- the same reading `recalculate` counts for the log, so
the dialog and the log cannot disagree. `check-stats` asserts the numbers.

## The rule that makes it an interchange

`SaveXml` writes into the tree it was handed and touches only what the shapes
model. Everything else -- the Project header, calendars' working times,
baselines, timephased data, comments -- is reported in the log (`Problems`) and
kept in the tree exactly where it was. That is the whole of what makes a round
trip an interchange and not a rewrite; `Mspdi.js` carries the argument.

## What is modelled (cut 1)

Tasks (identity, dates, durations as text, the milestone/summary/critical/
estimated/effort-driven flags, actual dates and baselines, constraints and
deadline, notes, predecessor links, custom-field values), resources with their
rates and costs, assignments
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

Eight things are remembered, all under `bintana-project.*` in `Settings` (the
per-project file in the config directory, never beside the schedule): the
folder the last file came from, the timescale, which custom field the list
shows (by `FieldID`, empty for the first), which columns the list shows (chosen
in View → Columns…, the name always among them), the unit a bare duration is
read in, the recent list, whether the plan is recalculated after each change
(off by default: a date typed by hand is the user's until they ask), and
whether the recovery copy is kept.

**The autosave is a copy, not a save**: while there is unsaved work the app
writes it every minute to the config directory -- never beside the schedule,
which may be read-only -- and a copy newer than the file is offered at open
time rather than taken. Saving deletes it. It is closed again by the same
switch in Settings. **Settings…** in the Tools menu is the one dialog that
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
