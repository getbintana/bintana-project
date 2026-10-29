/*
 * bintana-project: MSPDI in a window.
 *
 * Open a Project XML file -- from the command line, the file manager, the Open
 * button or the bundled sample -- show its tasks as a tree with their durations
 * and custom-field values, edit them through the panel beside the chart, and
 * write it back without touching what the model does not own (see Mspdi.js).
 * Selecting a row marks the same task in the chart, which is the only coupling
 * the two views have; every change goes through `Edit`, which is what Undo and
 * Redo walk back (see Edit.js).
 *
 * With `check [file] [outdir]` on the command line
 * (`bintana/tests/try.sh bintana-project check tests/corpus/01-minimal.xml`
 * from anywhere, with the project dir in place of `bintana-project`) it runs
 * headless instead: loads the file, round-trips it through a scratch file,
 * re-reads it, prints what it found and what SaveXml touched, and quits with
 * 0/1. `check-corpus [dir] [outdir]` does that for every `*.xml` in the
 * folder, and `check-edit [file] [outdir]` runs one scripted round of the
 * editing commands. Those are the shapes that let a virtual display verify
 * what a window would show; `tests/run.sh` drives all of them.
 */
"use strict";

/*
 * The two things the window can be, as pages of `Pages` -- a `Switcher` with no
 * strip, which is a bare stack: one of them on screen and nothing to click
 * between them.
 *
 * **A window with nothing open is the whole workspace with nothing in it** -- an
 * empty tree, a dead toolbar, a panel whose every field edits a task that is not
 * there -- and what it should show instead is what it can *do*: start one, open
 * one, or go back to one. The list of recents is beside the application's own
 * icon rather than under a menu nobody has opened yet, so the way back into the
 * last plan is where the eye already is.
 */
const PAGE_WELCOME = 0;
const PAGE_WORK    = 1;

export class MainForm extends Form {

    /* What was read, and the document it came out of -- SaveXml writes into
     * that tree, so both travel together (see Mspdi.js). */
    holder = null;
    path   = "";

    /* The commands and their history, one per loaded file. */
    edit = null;

    /* The table is a tree keyed by UID, so the record behind a row is a lookup
     * and not a position, and the chart can be told which task it is without
     * either view knowing the other's geometry. */
    byUID       = {};
    selectedUID = null;

    /* The chart's timescale: `dayW` is pixels a day and `step` the header's
     * step in days, both null/0 for Auto -- fit the view. `drag` is the
     * gesture in flight: the model is not touched until the button is up. */
    dayW = null;
    step = 0;
    drag = null;
    selLink = null;   // the chosen link: { pred, succ } UIDs

    /* The selected task's links, parallel to the `Links` table by index, and
     * the predecessors the combo offers in the same order. */
    linkRows    = [];
    predChoices = [];

    /* Set when the window is closing on purpose, so `Form_Close` stops asking
     * and the confirm dialog's own `Close()` does not loop. */
    forceClose = false;

    /* Settings are read and written only on the window's road: a headless
     * check must not touch what the user chose. `unit` is the unit a bare
     * duration is read in (empty is the task's own). */
    settingsReady = false;
    unit    = "";

    /* The files the menu offers, parallel to its entries by index, and the
     * timer that keeps the recovery copy. */
    recentPaths   = [];
    autosaveTimer = null;

    /* Which rows the chart last drew, and the timer that notices a fold made
     * them stale -- see `startFoldWatch`. */
    drawnRows = null;
    foldTimer = null;

    /* The Resources page: the resources the assignment editor offers and the
     * assignments of the selected task, each parallel to its control. The
     * resources themselves are edited in their own dialog. */
    resChoices    = [];
    assignRows    = [];

    /* The custom fields the Task page offers, by FieldID, the one it is
     * showing -- it follows the selection from task to task -- and what the
     * table is filtered to. */
    attrChoices = [];
    attrShown   = "";
    valueItems  = [];
    filter = "";
    tableShape = null;   // the rows' order, parents and columns, as `fill` last built them
    rowUri     = {};     // each row's link, as the table was last told it
    scrollHeld = null;   // the scroll a rebuild is keeping (`holdScroll`)
    scrollTimer = null;
    zoomSync = false;
    status = 0;      // the status filter's choice, an index into STATUS_FILTERS
    clip   = null;   // what Copy kept: { tasks, assignments, text }
    cell   = null;   // the entry bar's cell: { key, id }, the last one opened
    format = ganttFormat(null);
    tipText = "";
    cursorName = "Auto";
    columns = ["id", "name", "duration", "start", "finish", "predecessors",
               "resources"];
    /* The project summary's row: hidden by default on the window's road, as
     * Project hides it (`applySettings`); shown here so a headless check sees
     * the plan whole. */
    projectSummary = true;

    Form_Open() {
        /* **Several rows at once**, as Project's sheet takes them: Shift and
         * Ctrl with the click or the arrows, for the commands that act on a
         * selection (indent, outdent, the summary over them). A runtime
         * older than the tree's MultiSelect refuses it, and the list is then
         * the one-row list it was. */
        try { this.Tasks.MultiSelect = true; } catch (e) { /* one row at a time */ }
        /* **A heading dragged elsewhere**, as in Project; a runtime without
         * it leaves the heading's menu to move them. */
        try { this.Tasks.Reorderable = true; } catch (e) { /* the menu moves them */ }
        this.startFoldWatch();
        this.MnuProps.Value = true;
        this.ToolProps.Active = true;
        this.MnuTasks.Value = this.MnuChart.Value = true;
        this.ToolTasks.Active = this.ToolChart.Active = true;
        try {
            if (Application.Arguments.indexOf("check-corpus") >= 0) {
                this.checkCorpus();
                return;
            }
            if (Application.Arguments.indexOf("check-cpm") >= 0) {
                this.checkCpm();
                return;
            }
            if (Application.Arguments.indexOf("check-drag") >= 0) {
                this.checkDrag();
                return;
            }
            if (Application.Arguments.indexOf("check-view") >= 0) {
                this.checkView();
                return;
            }
            if (Application.Arguments.indexOf("check-edit") >= 0) {
                this.checkEdit();
                return;
            }
            if (Application.Arguments.indexOf("check-xsd") >= 0) {
                this.checkXsd();
                return;
            }
            if (Application.Arguments.indexOf("check-oracle") >= 0) {
                this.checkOracle();
                return;
            }
            if (Application.Arguments.indexOf("check-report") >= 0) {
                this.checkReport();
                return;
            }
            if (Application.Arguments.indexOf("check-stats") >= 0) {
                this.checkStats();
                return;
            }
            if (Application.Arguments.indexOf("check-commands") >= 0) {
                this.checkCommands();
                return;
            }
            if (Application.Arguments.indexOf("check-welcome") >= 0) {
                this.checkWelcome();
                return;
            }
            if (Application.Arguments.indexOf("check") >= 0) {
                this.check();
                return;
            }
            this.openStartup();
        } catch (e) {
            Message.Error("Cannot open the sample: {0}", e.message);
        }
    }

    /* A path on the command line wins over the welcome page: the window opens the
     * file it was pointed at, which is how a real Project file gets looked at
     * without a dialog. With nothing named, the window offers the ways in
     * instead of picking one. */
    openStartup() {
        /* The form is built, so the window owns the settings now -- and they
         * are read **before** a plan is, so the first fill already has the
         * columns and the scale the last run left. Read after it, the table
         * came out with the defaults until the next edit. */
        this.settingsReady = true;
        this.applySettings();

        const given = Application.Arguments[0];
        if (given) {
            try {
                this.load(given);
            } catch (e) {
                Message.Error("Cannot open {0}: {1}", given, e.message);
                this.openSample();
            }
        } else {
            /* **Nothing was named, so nothing is open**, and the welcome page is
             * the answer rather than the sample: a window that opened a plan of
             * its own would be showing a file nobody asked for, and a Save on it
             * would write to the config directory. What is offered instead is the
             * way in -- New, Open and the recents -- and the sample is one click
             * away, beside the rest of the doors. */
            this.Pages.Current = PAGE_WELCOME;
            this.documentCommands(false);
        }
        this.startAutosave();
    }

    /* The workspace, which is where the window goes back to as soon as there is
     * a document to show. Nothing returns to the welcome page, because nothing
     * closes a project. */
    showWork() { this.Pages.Current = PAGE_WORK; }

    /* **The menu bar is on the window, not on the workspace page**, so with no
     * plan open Edit and Project are still there -- and a command that found no
     * document would be a crash rather than a grey line. This is the one place
     * that lists the commands that need a plan, so a new one is greyed here as
     * well as everywhere else.
     *
     * It only opens and closes the door: **Undo and Redo follow the history and
     * the row commands follow the selection**, and both are answered where they
     * are (`updateTitle` and `showTask`) -- which is why `load` calls this
     * before `fill` and not after it. */
    documentCommands(on) {
        for (const act of [this.ActSave, this.ActSaveAs, this.ActExport,
                           this.ActReport, this.ActUndo, this.ActRedo,
                           this.ActAdd, this.ActAddMilestone, this.ActAddSummary,
                           this.ActLink, this.ActUnlink, this.ActPct0, this.ActPct25,
                           this.ActPct50, this.ActPct75, this.ActPct100,
                           this.ActDelete, this.ActIndent,
                           this.ActOutdent, this.ActUp, this.ActDown,
                           this.ActPaste, this.ActZoomIn, this.ActZoomOut,
                           this.ActZoomFit, this.ActScrollToTask,
                           this.ActExpandAll, this.ActCollapseAll,
                           this.ActLevel1, this.ActLevel2, this.ActLevel3,
                           this.ActRecalc, this.ActBaseline, this.ActProjData,
                           this.ActProjOptions, this.ActCalendar, this.ActResources, this.ActFields, this.ActFormat,
                           this.ActStats])
            act.Enabled = on;
        this.SldZoom.Enabled = on;
    }

    /* What the last run left. The folder is read where the dialog opens and
     * written when a file does; these three are read here. */
    applySettings() {
        const scale  = Math.min(Number(Settings.Get("bintana-project.timescale", 0)) || 0,
                                SCALES.length - 1);
        /* **An empty list is a choice**: with every column but the name ticked
         * off, `[]` is what was saved, and it used to be read as "nothing was
         * saved" -- so the usual ones came back at the next start. Only a list
         * that was never written (`null`) leaves the defaults. */
        const stored = Settings.Get("bintana-project.columns", null);
        /* **The defaults are declared too**: the form's own headings are a
         * sketch for the designer, and a first start that kept them showed
         * the cells of `columns` under headings that were not theirs. */
        this.setColumns(Array.isArray(stored)
                        ? stored.filter((id) => isColumnId(id)) : this.columns);
        this.format  = loadFormat();
        this.unit    = Settings.Get("bintana-project.unit", "");
        /* **The entry bar: hidden until asked for, like Project 2013's**, and
         * then the way it was left -- a strip a reader put away and that came
         * back at the next window would be a switch that does not switch. */
        const entry  = Settings.Get("bintana-project.entrybar", false);
        this.MnuEntry.Value   = entry;
        this.EntryBar.Visible = entry;
        this.projectSummary = Settings.Get("bintana-project.projectsummary", false);
        this.MnuSummaryTask.Value = this.projectSummary;
        /* **The properties panel: closed until asked for**, and then the way
         * it was left. The grid edits every field in its cell and a double
         * click opens Task Information whole, as in Project; the panel is a
         * second editor with its own Apply, and the chart's width is what it
         * costs. (A headless check keeps it open: it drives the panel.) */
        this.showProps(Settings.Get("bintana-project.props", false));
        if (this.edit) {
            /* **Project's own default**: the plan is recalculated after every
             * accepted command -- so a duration typed by hand moves the finish
             * and the chain with it -- and a date typed by hand leaves the
             * constraint that keeps it. Turning it off in Settings leaves the
             * dates as typed until F5 asks, which is Project's manual mode. */
            this.edit.auto = Settings.Get("bintana-project.autorecalc", true);
            this.edit.newManual = Settings.Get("bintana-project.newmanual", false);
        }
        if (this.CmbScale.Index !== scale) {
            this.CmbScale.Index = scale;
            this.CmbScale_Select();
        }
        this.showRecent(Settings.Get("bintana-project.recent", []));
    }

    /* The recent list: the file just opened goes to the front, the list is
     * trimmed, and the menu follows it. */
    rememberRecent(path) {
        const kept = Settings.Get("bintana-project.recent", [])
                           .filter((p) => p !== path);
        kept.unshift(path);
        const recent = kept.slice(0, 8);
        Settings.Set("bintana-project.recent", recent);
        this.showRecent(recent);
    }

    /* The menu bar's Open Recent and the welcome page's list, one decision:
     * **a window with no file open is the only place either of them is wrong**,
     * so one place answers whether there is anything to open at all -- and the
     * folder is shown beside the name, because two plans called `plan.xml` are
     * two plans and the menu's column of names does not say which. */
    showRecent(recent) {
        this.recentPaths = recent;
        this.MnuRecent.Items   = recent.map((p) => File.Name(p));
        this.MnuRecent.Enabled = recent.length > 0;

        const empty = recent.length === 0;
        this.WelcomeRecent.Items    = empty
            ? [Locale.Text("(none yet)")]
            : recent.map((p) => `${File.Name(p)}  —  ${File.Directory(p)}`);
        this.LblWelcomeRecent.Visible = !empty;
        this.WelcomeRecent.Enabled    = !empty;
    }

    openRecent(i) {
        const path = this.recentPaths[i];
        if (path) this.openFile(path);
    }

    MnuRecent_Click(index) { this.openRecent(index); }

    /* A row of the welcome page's list is the menu's entry of the same index, so
     * it is opened the same way. The selection is dropped afterwards: choosing
     * the plan that is already chosen is not a change, and GTK rightly does not
     * report one -- so the same row twice would do nothing the second time. */
    WelcomeRecent_Select() {
        const index = this.WelcomeRecent.Index;
        this.WelcomeRecent.Index = -1;
        if (index >= 0) this.openRecent(index);
    }

    /* The View menu's tick, and the Help menu's one line. */
    MnuLog_Click(on) { this.Log.Visible = on; }

    /* **The entry bar can go**, and stays gone: Project 2013 on hide it by
     * default, and a reader who puts it away should not have it back at the
     * next window -- so the choice is remembered with the columns and the
     * timescale. */
    MnuEntry_Click(on) {
        this.EntryBar.Visible = on;
        if (this.settingsReady) Settings.Set("bintana-project.entrybar", on);
    }

    /* **The project summary task**, Project's Format -> *Project Summary
     * Task*: a view of the plan's task 0, remembered like the entry bar. A
     * plan without one -- a file that never had it -- gets it the first time
     * it is asked for, as one undoable command. */
    MnuSummaryTask_Click(on) {
        this.projectSummary = on;
        if (this.settingsReady) Settings.Set("bintana-project.projectsummary", on);
        if (!this.edit) return;
        const made = on ? this.edit.addProjectSummary() : null;
        this.fill(made ? made.UID : this.selectedUID);
    }

    /* The panel of properties, out of the way: the chart gets the room. The
     * button and the menu tick are one switch seen twice, and assigning either
     * one's state from here raises nothing on the menu -- on the button it
     * raises `Click`, which is why the guard. The divider is remembered, so the
     * panel comes back the width it left with. */
    MnuProps_Click(on) { this.showProps(on); }
    ToolProps_Click()  { if (this.ToolProps) this.showProps(this.ToolProps.Active); }

    /* The list and the chart: either can go, but never both -- a plan with
     * neither is an empty window. The one that would be the last is put back
     * where it was, so the switch the user pressed simply does not move. */
    MnuTasks_Click(on) { this.showPlanPart("Tasks", on); }
    MnuChart_Click(on) { this.showPlanPart("ChartCol", on); }
    ToolTasks_Click()  { if (this.ToolTasks) this.showPlanPart("Tasks", this.ToolTasks.Active); }
    ToolChart_Click()  { if (this.ToolChart) this.showPlanPart("ChartCol", this.ToolChart.Active); }

    showPlanPart(name, on) {
        const part  = this[name];
        const other = this[name === "Tasks" ? "ChartCol" : "Tasks"];
        const menu  = name === "Tasks" ? this.MnuTasks : this.MnuChart;
        const tool  = name === "Tasks" ? this.ToolTasks : this.ToolChart;
        const sync  = (v) => {
            menu.Value = v;
            if (tool.Active !== v) tool.Active = v;
        };
        if (part.Visible === on) return;
        if (!on && !other.Visible) { sync(true); return; }
        if (!on) this.planPosition = this.PlanSplit.Position;
        part.Visible = on;
        sync(on);
        Timer.After(0, () => {
            if (on && other.Visible && this.planPosition > 0)
                this.PlanSplit.Position = this.planPosition;
            this.syncGanttSize();
            this.redrawChart();
        });
    }

    showProps(on) {
        if (this.settingsReady) Settings.Set("bintana-project.props", on);
        if (this.PropsCol.Visible === on) return;
        if (!on) this.propsPosition = this.BodySplit.Position;
        this.PropsCol.Visible = on;
        this.MnuProps.Value = on;
        if (this.ToolProps.Active !== on) this.ToolProps.Active = on;
        Timer.After(0, () => {
            if (on && this.propsPosition > 0) this.BodySplit.Position = this.propsPosition;
            this.syncGanttSize();
            this.redrawChart();
        });
    }

    MnuAbout_Click() {
        Message.Info("bintana-project {0} — MSPDI (MS Project XML) in Bintana",
                     Application.Version);
    }

    /* The bundled sample, which is one of the welcome page's three doors and the
     * fallback for a file on the command line that cannot be read. */
    /* The sample is a template, not a file of the user's: it is copied into
     * the config directory and that copy is what the window opens, so a Save
     * writes the copy and never the fixture the repo ships -- which is one of
     * the files the harness is measured against. */
    openSample() {
        const source = File.Join(Application.Directory, "tests", "corpus",
                                 "01-minimal.xml");
        const copy = File.Join(Application.ConfigDirectory,
                               "sample-01-minimal.xml");
        try {
            writeMspdi(copy, readMspdi(source));
        } catch (e) {
            /* Without the copy the sample is still worth opening; it is read
             * until somebody saves it somewhere else. */
        }
        this.load(File.Exists(copy) ? copy : source);
    }

    /* **A new plan is a file before it is a document**, so it asks first -- what
     * the plan is called and where it goes, which is `NewProjectForm` and not
     * the save dialog: Save As names a file that already exists in memory, and
     * this one has no document to save yet.
     *
     * The folder it opens on is the last one a file came from, which is where a
     * new plan belongs until somebody says otherwise. */
    ActNew_Execute() {
        this.confirmDiscard(() =>
            NewProjectForm.ask(Settings.Get("bintana-project.folder",
                                            Environment.HomeDirectory),
                               (values) => this.newProject(values)));
    }

    /* The plan is written and then **read back**, so what the window shows is
     * the file and not the tree it was built from: a blank document that does
     * not survive its own round trip is a New Project that opens broken. */
    newProject(values) {
        const path = File.Join(values.Folder, values.File);
        try {
            writeMspdi(path, newMspdi(values));
            this.load(path);
        } catch (e) {
            Message.Error("Cannot create {0}: {1}", path, e.message);
        }
    }

    /* The welcome page's third door: the demo this app ships with, which is
     * where a first run looks if it would rather see something than make
     * something. It is here and not in the list of recents because it is not
     * something the user opened -- the recents are theirs, and the sample is
     * ours. */
    BtnWelcomeSample_Click() { this.confirmDiscard(() => this.openSample()); }

    /* A file dragged from the file manager, anywhere on the window. */
    Form_FileDrop(paths) {
        const xml = paths.find((p) => File.IsExtension(p, "xml"));
        if (xml) this.openFile(xml);
    }

    /* **Every door that replaces the document goes through here**: a plan
     * with unsaved work is asked about first, the way closing the window asks,
     * and a file that cannot be read says so and leaves the one on screen. */
    openFile(path) {
        this.confirmDiscard(() => {
            try {
                this.load(path);
            } catch (e) {
                Message.Error("Cannot open {0}: {1}", path, e.message);
            }
        });
    }

    /* Unsaved work is Save, Discard or Cancel before anything takes its place.
     * Discard drops the autosave as well: the copy is the work the user just
     * chose not to keep, and offering it back on the next open would be
     * asking the same question twice. */
    confirmDiscard(then) {
        if (!this.edit || !this.edit.dirty) { then(); return; }
        ConfirmForm.ask(Locale.Text("Unsaved changes"),
            Locale.Text("Save changes to {0} first?", File.Name(this.path)),
            Locale.Text("Discard"),
            () => { this.dropAutosave(); then(); },
            { Text: Locale.Text("Save"), Run: () => { if (this.save()) then(); } });
    }

    /* `keepPath` is the file the document is *called* while its bytes came
     * from somewhere else, which is what recovering an autosave is. */
    load(path, keepPath, recovering) {
        this.holder = readMspdi(path);
        this.path   = keepPath || path;
        this.edit   = new Edit(this.holder);
        this.edit.auto = Settings.Get("bintana-project.autorecalc", true);
        this.edit.newManual = Settings.Get("bintana-project.newmanual", false);
        this.forceClose = false;
        this.documentCommands(true);
        this.fill();
        /* **A document is what puts the workspace on screen**, so the page is
         * switched here rather than by each of the doors: opening a file from a
         * dialog, from the welcome page, from a drag or from a recovery are four
         * calls into this one road, and a fourth one that forgot would leave a
         * plan open behind the welcome page. */
        this.showWork();
        if (this.settingsReady) {
            Settings.Set("bintana-project.folder", File.Directory(this.path));
            this.rememberRecent(this.path);
            if (!recovering && path !== this.autosavePath()) this.offerRecovery();
        }
    }

    /* --- the autosave --------------------------------------------------- */

    /* A copy in the config directory, refreshed while there is unsaved work.
     * It is never beside the schedule: a project tree may be read-only, and
     * somebody else's copy of a plan is not theirs to find. */
    /* **Named by the whole path, not the file's name**: `a/plan.xml` and
     * `b/plan.xml` are two plans, and one copy for both would offer the work
     * of one as the recovery of the other -- and a Save would then write it
     * over the wrong file. The name stays readable; the hash tells them apart. */
    autosavePath(path = this.path) {
        return File.Join(Application.ConfigDirectory,
                         `autosave-${File.BaseName(path)}-${pathHash(path)}.xml`);
    }

    dropAutosave(path = this.path) {
        const copy = this.autosavePath(path);
        if (File.Exists(copy)) File.Delete(copy);
    }

    startAutosave() {
        if (this.autosaveTimer) this.autosaveTimer.Stop();
        this.autosaveTimer = Timer.Every(60000, () => this.autosave());
    }

    autosave() {
        if (!Settings.Get("bintana-project.autosave", true)) return;
        if (!this.settingsReady || !this.edit || !this.edit.dirty || !this.path)
            return;
        try {
            writeMspdi(this.autosavePath(), this.holder);
        } catch (e) {
            /* A recovery copy that cannot be written is not worth a dialog:
             * the file the user asked for is still theirs to save. */
        }
    }

    /* A newer copy than the file means the last session ended with unsaved
     * work, and it is offered rather than taken. The question waits for the
     * window: a dialog shown from `Form_Open` can be mapped under it. */
    offerRecovery() {
        Timer.After(150, () => this.askRecovery());
    }

    askRecovery() {
        if (!Settings.Get("bintana-project.autosave", true)) return;

        const copy = this.autosavePath();
        const made = File.Info(copy);
        if (!made) return;

        const file = File.Info(this.path);
        if (file && made.Modified <= file.Modified) {
            if (File.Exists(copy)) File.Delete(copy);   // the file is newer
            return;
        }

        ConfirmForm.ask(Locale.Text("Unsaved changes"),
            Locale.Text("There is a newer autosave of {0}. Open it?",
                        File.Name(this.path)),
            Locale.Text("Open"), () => {
                /* **Recovered work is unsaved work**: the file on disk is still
                 * the old one, so the window is dirty and the copy stays until a
                 * Save or a Discard -- it is the only place that work exists. */
                try {
                    this.load(copy, this.path, true);
                    this.edit.markUnsaved();
                    this.updateTitle();
                    this.log(`Recovered ${copy}.`);
                } catch (e) {
                    Message.Error("Cannot open {0}: {1}", copy, e.message);
                }
            }, null, "suggested-action");
    }

    /* The table as the WBS it is: a tree keyed by UID, summaries included and
     * IsNull rows skipped -- one is structure, the other a blank row. The
     * parent is the nearest task before it that is one level shallower, which
     * is the outline MSPDI writes. `keep` is the UID to stay selected across
     * the rebuild, when it is still there. */
    fill(keep) {
        const project = this.holder.project;
        this.byUID = {};
        this.selectedUID = null;
        /* The calendar the chart shades its idle days with: the project's own,
         * which is what Project shades. Built here because a calendar is of the
         * plan, and a plan that changed is one that was filled. */
        this.chartCal = new WorkCalendar(project, -1);

        /* The cell the reader was on, kept across the rebuild by the column's
         * id: the table's columns are declared again, so an index would name
         * another field the moment one is hidden or moved. */
        const cur = this.cell;

        /* La columna del enlace, si está a la vista: la tabla la declara
         * `Link: true` y el destino va por fila -- el texto es la etiqueta (o
         * la dirección) y la dirección es a donde va. `""` deja la celda sin
         * link, que es una tarea con etiqueta y sin dirección. */
        const cols   = this.tableColumns();
        const linkAt = cols.indexOf("link");

        /* The rows as the tree holds them: each under the nearest task before
         * it that is one level shallower. */
        const rows = [], stack = [];
        for (const task of this.visibleTasks(project)) {
            const key = String(task.UID);
            this.byUID[key] = task;
            while (stack.length && stack[stack.length - 1].level >= task.OutlineLevel)
                stack.pop();
            rows.push({ task, key, parent: stack.length ? stack[stack.length - 1].key : null });
            stack.push({ level: task.OutlineLevel, key: key });
        }

        /*
         * **An edit that moved no row is written into the rows the table has.**
         * Progress, a date, a name, a whole reschedule: the same rows in the
         * same places, with other text in some cells. `SetCell` changes those
         * cells and nothing else -- the scroll, the folds and the selection are
         * the table's and stay -- where `Clear` and the rows again threw the
         * view back to the top on every keystroke. The shape is the columns,
         * the order, each row's parent and whether it is a summary (whose
         * cells are shut); anything else that differs is a cell.
         */
        const shape = cols.join(",") + "|" + rows.map((r) =>
            `${r.key}<${r.parent || ""}${r.task.Summary ? "+" : ""}`).join(",");
        if (shape === this.tableShape && rows.every((r) => this.Tasks.Exists(r.key))) {
            for (const r of rows) {
                const now = this.cells(r.task), was = this.Tasks.Row(r.key) || [];
                for (let c = 0; c < now.length; c++)
                    if (was[c] !== now[c]) this.Tasks.SetCell(r.key, c, now[c]);
                const uri = r.task.HyperlinkAddress || "";
                if (linkAt >= 0 && this.rowUri[r.key] !== uri) {
                    this.Tasks.SetUri(r.key, linkAt, uri);
                    this.rowUri[r.key] = uri;
                }
            }
        } else {
            this.rebuildRows(rows, cols, linkAt);
            this.tableShape = shape;
        }
        const s = summarize(project);
        const problems = this.holder.problems.length;
        /* **One plural to a count**: the line was a single sentence with four
         * numbers in it, and "1 tasks" is what a single sentence says. Each count
         * is its own phrase, so each takes the form its number asks for in the
         * catalogue's own language. */
        const counts = [
            Locale.Plural("{0} task", "{0} tasks", s.tasks),
            Locale.Plural("{0} milestone", "{0} milestones", s.milestones),
            Locale.Text("{0} with attributes", s.withAttrs),
            Locale.Plural("{0} link", "{0} links", s.links),
        ];
        this.LblStatus.Text = counts.join(", ") +
            (problems ? " -- " + Locale.Text("{0} not modelled (see log)", problems) : "");

        this.Log.Clear();
        this.log(`Opened ${File.Name(this.path)}: ${s.tasks} tasks, ` +
                 `${s.milestones} milestones, ${s.links} dependencies.`);
        for (const p of this.holder.problems) this.log(`not modelled: ${p}`);

        this.fillResources();

        /* The data changed: the chart is a frame behind until asked, and its
         * own size depends on how many rows there now are. */
        this.syncGanttSize();

        /* **The cell the reader was on comes back with the rows**, by the
         * column's id, and the selection restore below puts the frame and the
         * entry bar back on the row -- `Tasks_Select` is what places it. A row
         * the filter left out, or a column the view does not show, is no cell:
         * it is dropped rather than pointed at something else. */
        if (cur && this.byUID[cur.key] && this.entryColumn(cur.id) >= 0)
            this.cell = { key: cur.key, id: cur.id };
        else
            this.cell = null;

        if (keep !== undefined && keep !== null && this.Tasks.Exists(String(keep))) {
            this.Tasks.Key = String(keep);
            this.Tasks_Select();
        } else {
            this.cell = null;
            this.Tasks.CurrentCell = null;
            this.showEntry();
            this.showTask(null);
        }
        this.updateTitle();
    }

    /*
     * The rows again, from nothing: what an edit that moved a row needs -- a
     * task added, taken out, indented, a filter. **The scroll is the other
     * half of the selection and is kept with it.** A rebuild is a redraw of
     * the same view, not a move within it, and the table does not know that:
     * `Clear` empties it and the rows go in at the top. Handing the number
     * back once the rows are in is not enough either -- GTK lays the new rows
     * out on the next frame and puts the list back at its first row as it
     * does (measured: 200 after `fill`, 0 a frame later) -- so the number is
     * also *held* for a moment, and `Tasks_Scroll` puts it back when the
     * layout moves it.
     */
    rebuildRows(rows, cols, linkAt) {
        const at = this.Tasks.ScrollY;
        this.Tasks.Clear();
        this.rowUri = {};

        /* **The cells a summary does not edit**: what Project derives from its
         * children. Shut where they are drawn rather than refused after the
         * typing, so a summary's dates read dim and open nothing -- the same
         * bargain the panel makes greying its controls. */
        const shut = [];
        for (const id of SUMMARY_SHUT) {
            const i = cols.indexOf(id);
            if (i >= 0) shut.push(i);
        }

        for (const r of rows) {
            const options = { Key: r.key };
            if (r.parent) options.Parent = r.parent;
            this.Tasks.Add(this.cells(r.task), options);
            if (linkAt >= 0) {
                this.rowUri[r.key] = r.task.HyperlinkAddress || "";
                this.Tasks.SetUri(r.key, linkAt, this.rowUri[r.key]);
            }
            if (r.task.Summary)
                for (const i of shut)
                    this.Tasks.SetEditable(r.key, i, false);
        }

        /* Clamped to what the new plan can show: a filter that leaves three
         * rows has nothing to scroll to, and where it lands is the end of it. */
        this.Tasks.ScrollY = Math.min(at, Math.max(this.Tasks.ScrollMaxY, 0));
        this.holdScroll(this.Tasks.ScrollY);
    }

    /* The scroll a rebuild keeps, for as long as the new rows take to be laid
     * out. Nothing to hold at the top, which is where the layout goes anyway. */
    holdScroll(y) {
        if (this.scrollTimer) this.scrollTimer.Stop();
        this.scrollHeld = y > 0 ? y : null;
        this.scrollTimer = this.scrollHeld === null ? null
            : Timer.After(SCROLL_HOLD_MS, () => {
                this.scrollHeld = null;
                this.scrollTimer = null;
            });
    }

    /* What the filter lets through: the tasks whose name matches it and the
     * ancestors that give them their place in the outline. An empty filter is
     * the whole plan. */
    visibleTasks(project) {
        const tasks = [];
        for (const task of project.Tasks)
            if (!task.IsNull && (this.projectSummary || task.OutlineLevel > 0))
                tasks.push(task);
        if (!this.filter && !this.status) return tasks;

        const shown = {};
        const ancestors = [];
        for (const task of tasks) {
            while (ancestors.length &&
                   ancestors[ancestors.length - 1].OutlineLevel >= task.OutlineLevel)
                ancestors.pop();
            ancestors.push(task);
            if ((!this.filter || Locale.Matches(task.Name, this.filter)) &&
                taskHasStatus(task, this.status))
                for (const a of ancestors) shown[a.UID] = true;
        }
        return tasks.filter((task) => shown[task.UID]);
    }

    /* The status filter: one choice, and it composes with the name's. */
    CmbStatus_Select() {
        if (!this.CmbStatus) return;     // the event fires while the form is built
        this.status = this.CmbStatus.Index;
        this.fill(this.selectedUID);
    }

    /* One keystroke, one rebuilt table; the magnifier in the field clears. */
    TxtFilter_Change() {
        this.filter = this.TxtFilter.Text;
        this.fill(this.selectedUID);
    }

    TxtFilter_IconClick() {
        this.TxtFilter.Text = "";
        this.TxtFilter_Change();
    }

    /* One value per column of the table, in the order `columns` says: the
     * name among them, wherever it was put. */
    cells(task) {
        return this.tableColumns().map((id) => id !== "name"
            ? this.columnValue(id, task)
            : task.Milestone ? `◆ ${task.Name}` : task.Name);
    }

    columnValue(id, task) {
        const project = this.holder.project;
        if (id.slice(0, FIELD_COLUMN.length) === FIELD_COLUMN)
            return attrOf(task, id.slice(FIELD_COLUMN.length));
        switch (id) {
        case "duration":   return durationText(task, project);
        case "predecessors": return linksText(task, project, "ID");
        case "wbspreds":     return linksText(task, project, "WBS");
        case "resources":    return resourcesText(task, project);
        case "id":           return String(task.ID);
        case "start":      return shortDate(task.Start);
        case "finish":     return shortDate(task.Finish);
        case "percent":    return `${task.PercentComplete || 0}%`;
        case "critical":   return task.Critical ? "◆" : "";
        case "slack":      return slackText(task, project);
        case "variance":    return varianceText(task, project);
        case "milestone":  return task.Milestone ? "◆" : "";
        case "work":       return durationText({ Duration: task.Work,
                                                 DurationFormat: 5 }, project);
        case "cost": {
            const cost = taskCost(project, task);
            return cost ? Locale.Number(cost, 2) : "";
        }
        case "wbs":        return task.WBS;
        case "priority":   return String(task.Priority);
        case "constraint": return this.CmbConstraint.Items[task.ConstraintType || 0] || "";
        case "deadline":   return shortDate(task.Deadline);
        case "calendar":   return this.calendarName(task.CalendarUID);
        case "type":       return this.CmbTaskType.Items[taskKind(project, task)] || "";
        case "notes":      return task.Notes;
        case "link":       return task.Hyperlink || task.HyperlinkAddress || "";
        }
        return "";
    }

    /* The definition a custom-field column names, or null: its id is
     * `attr:` plus the `FieldID`, and a field the plan does not define is a
     * column the plan cannot show. */
    columnField(id) {
        if (id.slice(0, FIELD_COLUMN.length) !== FIELD_COLUMN) return null;
        const fieldID = id.slice(FIELD_COLUMN.length);
        if (!this.holder) return null;
        for (const def of this.holder.project.FieldDefs)
            if (def.FieldID === fieldID) return def;
        return null;
    }

    /* **What the table is showing, the name included**: the chosen columns
     * the plan can put up, in the order `columns` says. The name is a column
     * like the rest -- it can go after the Id, as Project has it -- but it is
     * the tree and never goes, so a list without it (a view saved before it
     * could move) shows it first. The table's headings, its cells and the
     * heading's menu all walk this one list, and an index into the table is
     * an index into it, so they cannot disagree. */
    tableColumns() {
        const ids = this.columns.filter((id) => id === "name" ||
            COLUMNS.some((c) => c.id === id) || this.columnField(id));
        if (ids.indexOf("name") < 0) ids.unshift("name");
        return ids;
    }

    /* The table's columns but the name: the data ones. */
    visibleColumns() {
        return this.tableColumns().filter((id) => id !== "name");
    }

    /* Everything the table could show -- the catalog's columns and one per
     * custom field the plan defines; what *Show every column* means. */
    allColumnIds() {
        const ids = COLUMNS.map((c) => c.id);
        if (this.holder)
            for (const def of this.holder.project.FieldDefs)
                ids.push(fieldColumnID(def.FieldID));
        return ids;
    }

    /* The table's declaration, rebuilt whole: the rows come from `cells`, so
     * both move together and a column that is not shown is not read. **The
     * name is always a field** -- it is the tree and never goes, and renaming
     * in the row is the first thing a reader asks of it. A custom field's
     * heading is the name the plan gives it -- the file's own words, not a
     * catalog entry -- so it does not go through `Locale`, and its kind is a
     * field unless the file says the values are a list (`Tasks_CellEditor`
     * answers the combo). */
    applyColumns() {
        /* **The name has a width of its own**, not "size yourself": a column
         * that sizes itself is measured again on every rebuild, and every
         * command rebuilds the rows -- so it shrank to whatever GTK had bound
         * at that moment and the names were cut. A width asked for is kept
         * across rebuilds, and a drag moves it for as long as the columns
         * are not declared again. */
        const specs = [];
        for (const id of this.tableColumns()) {
            /* **The name carries the outline** -- the arrow and the indent --
             * wherever it stands: `Tree` says which column that is. */
            if (id === "name") {
                specs.push({ Text: Locale.Text("Task"), Width: NAME_WIDTH,
                             Editor: "Text", Tree: true });
                continue;
            }
            const column = COLUMNS.find((c) => c.id === id);
            if (column) {
                const spec = { Text: Locale.Text(column.Text), Width: column.Width };
                if (column.Alignment) spec.Alignment = column.Alignment;
                if (column.Link) spec.Link = true;
                if (column.Editor) spec.Editor = column.Editor;
                specs.push(spec);
                continue;
            }
            specs.push({ Text: fieldLabel(this.columnField(id)),
                         Width: 90, Alignment: "Right", Editor: "Text" });
        }
        this.Tasks.Columns = specs;
    }

    calendarName(uid) {
        if (!(uid > 0)) return Locale.Text("Project default");
        const calendar = this.edit.calendar(uid);
        return calendar ? calendar.Name : `UID ${uid}`;
    }

    /* The columns the table shows, in their own dialog; the choice is a view
     * setting, like the timescale, and survives the window. */
    ActColumns_Execute() {
        ColumnsForm.open(COLUMNS, this.columns,
                         (chosen) => this.showColumns(chosen));
    }

    /* One road for the three ways of choosing: the dialog, the heading's menu
     * and the menu item are the same decision, so they are the same code. The
     * columns are applied to the table whatever is open and the rows are
     * rebuilt only when there are any -- a welcome page has a list to dress
     * and no plan to fill. */
    setColumns(chosen) {
        this.columns = chosen;
        this.applyColumns();
        if (this.holder) this.fill(this.selectedUID);
    }

    /* Choosing is a view, and a view is remembered; reading one back is not
     * a choice, so it does not go through here. */
    showColumns(chosen) {
        this.setColumns(chosen);
        Settings.Set("bintana-project.columns", chosen);
    }

    /* The gesture of Project: the secondary click on a heading, and the menu
     * it opens is built for that click -- the name is the tree and cannot go,
     * so its item is greyed rather than missing, though it moves like any
     * other; and *Show every column* only means something while one is
     * hidden. The runtime builds the array and tells each handler which
     * column the click was over. */
    Tasks_HeaderClick(column, button, ctrl, shift) {
        if (button !== 3) return;

        const shown = this.tableColumns();
        return [
            { name: "MnuColInsert", text: Locale.Text("Insert column…"),
              enabled: this.missingColumns().length > 0 },
            { name: "MnuColHide", text: Locale.Text("Hide this column"),
              enabled: column >= 0 && column < shown.length &&
                       shown[column] !== "name" },
            { separator: true },
            { name: "MnuColLeft", text: Locale.Text("Move left"),
              enabled: column > 0 && column < shown.length },
            { name: "MnuColRight", text: Locale.Text("Move right"),
              enabled: column >= 0 && column < shown.length - 1 },
            { separator: true },
            { name: "MnuColShowAll", text: Locale.Text("Show every column"),
              enabled: this.missingColumns().length > 0 },
            { name: "MnuColDialog", text: Locale.Text("Columns…") },
        ];
    }

    /* What the table could show and does not: the catalog's columns and the
     * plan's custom fields, labelled as their headings are. */
    missingColumns() {
        const shown = this.visibleColumns();
        return this.allColumnIds()
            .filter((id) => shown.indexOf(id) < 0)
            .map((id) => {
                const column = COLUMNS.find((c) => c.id === id);
                return { id, text: column ? Locale.Text(column.Text)
                                          : fieldLabel(this.columnField(id)) };
            });
    }

    /* The table's columns in a new order, the name among them. The ones the
     * plan cannot show (a field it no longer defines) are not in the table but
     * are in the choice, and they stay where they are -- after the rest --
     * rather than vanish. */
    arrangeColumns(visible) {
        const kept = this.columns.filter((id) => visible.indexOf(id) < 0);
        this.showColumns(visible.concat(kept));
    }

    /* Left of the heading that was clicked, like Project -- the name's
     * included. */
    MnuColInsert_Click(column) {
        const choices = this.missingColumns();
        if (!choices.length) return null;
        return InsertColumnForm.open(choices, (id) => {
            const shown = this.tableColumns();
            shown.splice(Math.min(Math.max(column, 0), shown.length), 0, id);
            this.arrangeColumns(shown);
        });
    }

    /* **A heading dropped somewhere else** is the same choice as the menu's
     * Move: the order is kept and remembered, and the columns are declared
     * again in it -- so the table's index and its place are one number once
     * more, which is what every other road here reads. */
    Tasks_ColumnMove(column, position) {
        const shown = this.tableColumns();
        if (column < 0 || column >= shown.length) return;
        const [id] = shown.splice(column, 1);
        shown.splice(Math.min(Math.max(position, 0), shown.length), 0, id);
        this.arrangeColumns(shown);
    }

    MnuColLeft_Click(column) { this.moveColumn(column, -1); }
    MnuColRight_Click(column) { this.moveColumn(column, 1); }

    moveColumn(column, by) {
        const shown = this.tableColumns();
        const to = column + by;
        if (column < 0 || column >= shown.length || to < 0 || to >= shown.length) return;
        [shown[column], shown[to]] = [shown[to], shown[column]];
        this.arrangeColumns(shown);
    }

    /* The heading's own index into what the table is showing. The name's
     * item was greyed; this is the guard. */
    MnuColHide_Click(column) {
        const gone = this.tableColumns()[column];
        if (!gone || gone === "name") return;
        this.showColumns(this.columns.filter((id) => id !== gone));
    }

    /* The hidden ones after the ones shown, which keep their order -- the
     * name's place included. */
    MnuColShowAll_Click() {
        const shown = this.tableColumns();
        this.showColumns(shown.concat(
            this.allColumnIds().filter((id) => shown.indexOf(id) < 0)));
    }

    MnuColDialog_Click() {
        this.ActColumns_Execute();
    }

    /* The resources the assignment editor offers: one description of the list
     * (`resourceNames`), which the dialog's Resources page uses too. */
    fillResources() {
        const project = this.holder ? this.holder.project : null;
        if (!project) return;

        const res = resourceNames(project);
        this.resChoices = res.choices;
        this.CmbAssignRes.Items = res.items;
        this.CmbAssignRes.Index = res.items.length ? 0 : -1;

        /* The calendars a task may name, with the plan's own in
         * front. **The plan's own is chosen in the project dialog** -- it is a
         * property of the file, and a tab of the side panel for it was a tab
         * that took space to say something the menu already says. */
        const work = workCalendarNames(project);
        this.workCalChoices = work.choices;
        this.CmbTaskCalendar.Items = work.items;
    }

    /* The project's data -- the document's metadata, the scheduling settings
     * and the currency -- in its own dialog; the values come back whole and
     * are one undo like any edit. */
    /* The dialog hands the values back whole and they are applied as one undo,
     * like any other edit. **A method and not a lambda inside the click**,
     * because this is the road the check drives too: a check that copied it
     * would be testing the copy. */
    applyProject(values) {
        if (!this.edit.setProject(values)) return false;
        this.fill(this.selectedUID);
        return true;
    }

    ActProjData_Execute() {
        ProjectForm.open(this.holder.project, (values) => {
            if (!this.applyProject(values)) return;
            this.log(Locale.Text("Project data saved."));
        });
    }

    /* The plan's custom fields themselves: their own dialog in the project's
     * menu, beside the calendars -- they are the file's, like them. The
     * dialog calls back here, so every definition is a command with its own
     * undo, and showing one in the table is the same view choice the columns
     * are -- more than one at a time, remembered with them. */
    ActFields_Execute() {
        if (!this.holder) return;
        FieldsForm.open(this.holder.project, this.fieldActions());
    }

    /* The plan's custom fields as commands, the road the calendars walk: the
     * dialog calls back here, so nothing edits the file but `Edit`. */
    fieldActions() {
        return {
            set: (values) => {
                if (!this.edit.setFieldDef(values)) return false;
                this.fill(this.selectedUID);
                return true;
            },
            remove: (fieldID) => {
                if (!this.edit.removeFieldDef(fieldID)) return false;
                this.fill(this.selectedUID);
                return true;
            },
            shown: (fieldID) => this.columns.indexOf(fieldColumnID(fieldID)) >= 0,
            show: (fieldID, on) => {
                const id = fieldColumnID(fieldID);
                const kept = this.columns.filter((c) => c !== id);
                if (on) kept.push(id);
                this.showColumns(kept);
            },
        };
    }

    /* The file's own preferences -- the defaults for new tasks, the
     * calculation switches, the earned-value method -- in their dialog and
     * as one undo, like any other edit. */
    ActProjOptions_Execute() {
        OptionsForm.open(this.holder.project, (values) => {
            if (!this.edit.setProject(values)) return;
            this.fill(this.selectedUID);
            this.log(Locale.Text("Project options saved."));
        });
    }

    /* The calendar's own dialog: it hands the whole shape back, and the edit
     * is one undo like any other. */
    openCalendar(uid, done, cancelled) {
        const calendar = uid === null ? null : this.edit.calendar(uid);
        if (!calendar) return;
        CalendarForm.open(this.holder.project, calendar, (values) => {
            this.edit.setCalendar(calendar.UID, values);
            this.fill(this.selectedUID);
            if (done) done();
        }, cancelled);
    }

    /* From the menu: the calendars themselves -- new, edit, delete -- and not
     * the one assigned to anything. The dialog calls back here so every
     * change is a command with its own undo. */
    ActCalendar_Execute() {
        CalendarsForm.open(this.holder.project, {
            add: (fromUID) => {
                let maxUID = 0;
                for (const calendar of this.holder.project.Calendars)
                    if (calendar.UID > maxUID) maxUID = calendar.UID;
                const calendar = this.edit.addCalendar(
                    Locale.Text("Calendar {0}", maxUID + 1), fromUID);
                this.fill(this.selectedUID);
                return calendar.UID;
            },
            remove: (uid) => {
                const done = this.edit.removeCalendar(uid);
                this.fill(this.selectedUID);
                return done;
            },
            edit: (uid, done, cancelled) => this.openCalendar(uid, done, cancelled),
            /* New... cancelled: the copy it made is taken back with its own
             * undo step, so the plan is as it was before the button. */
            drop: () => {
                this.edit.undo();
                this.fill(this.selectedUID);
            },
        });
    }

    /* The plan read back: what it costs, how long it runs, how far along it
     * is and what it is late on. It is a reading and not an edit, so it is not
     * a command and there is nothing to undo -- and **it does not recalculate
     * either**, or opening a window about the plan would quietly move it and
     * a dialog nobody asked to edit would be the one edit nobody could take
     * back. A plan that was never scheduled is shown as it stands. */
    ActStats_Execute() {
        if (!this.holder) return;
        StatsForm.open(this.holder.project);
    }

    /* From the menu: the resources themselves -- new, edit, rates, delete --
     * and not the ones assigned to the task. The dialog calls back here so
     * every change is a command with its own undo. */
    ActResources_Execute() {
        if (!this.holder) return;
        ResourcesForm.open(this.holder.project, this.resourceActions());
    }

    resourceActions() {
        return {
            add: (values) => {
                const resource = this.edit.addResource(values);
                this.fill(this.selectedUID);
                return resource;
            },
            set: (uid, values) => {
                this.edit.setResource(uid, values);
                this.fill(this.selectedUID);
                return this.edit.resource(uid);
            },
            remove: (uid) => {
                this.edit.removeResource(uid);
                this.fill(this.selectedUID);
            },
            setRates: (uid, rates) => {
                if (!this.edit.setResourceRates(uid, rates)) return false;
                this.fill(this.selectedUID);
                this.log(Locale.Text("Rates saved."));
                return true;
            },
        };
    }

    BtnResManage_Click() { this.ActResources_Execute(); }

    /* The assignments of the selected task, with the cost each one adds. */
    fillAssignments(task) {
        this.Assignments.Clear();
        this.assignRows = [];
        this.BtnAssignDel.Enabled   = false;
        this.BtnAssignApply.Enabled = false;
        if (!task) return;

        const project = this.holder.project;
        for (const assignment of project.Assignments) {
            if (assignment.TaskUID !== task.UID) continue;
            const resource = resourceOf(project, assignment.ResourceUID);
            this.assignRows.push(assignment);
            this.Assignments.Add([
                resource ? resource.Name
                         : assignment.ResourceUID > 0
                           ? `UID ${assignment.ResourceUID}`
                           : Locale.Text("No resource"),
                String(assignment.Units),
                durationText({ Duration: assignment.Work, DurationFormat: 5 },
                             project),
                Locale.Number(assignmentCost(project, assignment), 2),
                /* **The budget beside the cost**, because the two are the same
                 * money read two ways and a row that showed only what the plan
                 * derives would hide what it promised. */
                assignment.BudgetCost
                    ? Locale.Number(assignment.BudgetCost, 2) : "",
            ]);
        }
    }

    /* The selected assignment in the fields, and whether there is one: the
     * budget belongs to an assignment and not to the task, so this is the only
     * place that can answer whether it can be written at all. */
    selectedAssignment() {
        return this.Assignments.Index >= 0
             ? this.assignRows[this.Assignments.Index] || null : null;
    }

    Assignments_Select() {
        const assignment = this.selectedAssignment();
        this.BtnAssignDel.Enabled = !!assignment;
        this.BtnAssignApply.Enabled = !!assignment;
        if (!assignment) return;
        const at = this.resChoices.indexOf(assignment.ResourceUID);
        if (at >= 0) this.CmbAssignRes.Index = at;
        this.TxtAssignUnits.Text = String(assignment.Units);
        this.TxtAssignBudget.Text = Locale.Number(assignment.BudgetCost || 0, 2);
    }

    /* **The budget, as its own button** rather than a field Apply, because an
     * assignment has no Apply of its own -- it is written where it is made, and
     * the two numbers a budget means (money and work) live in different places
     * in the file. One press, one undo, and the button is grey without a
     * selected assignment because there is nothing to budget money *for*. */
    BtnAssignApply_Click() {
        const assignment = this.selectedAssignment();
        if (!assignment) return;

        const budget = resourceNumber(this.TxtAssignBudget.Text);
        if (isNaN(budget) || budget < 0) {
            Message.Error("The budget must be a number, or nothing.");
            return;
        }
        this.edit.setAssignmentBudget(assignment.UID, budget);
        this.fill(this.selectedUID);
    }

    BtnAssignAdd_Click() {
        const task = this.selectedTask();
        if (!task) return;
        const at = this.CmbAssignRes.Index;
        const resourceUID = at >= 0 ? this.resChoices[at] : null;
        if (resourceUID === null || resourceUID === undefined) {
            Message.Warning("Add a resource first.");
            return;
        }
        const units = resourceNumber(this.TxtAssignUnits.Text);
        if (isNaN(units) || units <= 0) {
            Message.Error("Units must be a positive number.");
            return;
        }
        this.edit.addAssignment(task.UID, resourceUID, units);
        this.fill(task.UID);
    }

    BtnAssignDel_Click() {
        const assignment = this.selectedAssignment();
        if (!assignment) return;
        this.edit.removeAssignment(assignment.UID);
        this.fill(this.selectedUID);
    }

    selectedTask() {
        return this.selectedUID === null ? null
             : (this.byUID[String(this.selectedUID)] || null);
    }

    /* Every selected task's UID, in the plan's order -- the one the reader
     * is on when there is only that one. */
    selectedUIDs() {
        const keys = this.Tasks.SelectedKeys || [];
        const uids = keys.filter((k) => this.byUID[k]).map(Number);
        return uids.length ? uids
             : (this.selectedUID === null ? [] : [this.selectedUID]);
    }

    /* After a rebuild, the same rows selected again, with the reader on the
     * one they were on. */
    reselect(uids) {
        const keys = uids.map(String).filter((k) => this.byUID[k]);
        if (keys.length > 1) this.Tasks.SelectedKeys = keys;
    }

    /* The panel is a view of the selected record, not a copy: it is written
     * when the selection moves and read only by Apply. */
    showTask(task) {
        const has = task !== null && task !== undefined;

        this.LblTask.Text = has ? task.Name : Locale.Text("No task selected");
        /* The fields -- values and the summary locks -- are filled by the same
         * function the dialog uses; what is the panel's own is below. */
        fillTaskForm(this, task, this.holder.project);

        /* The commands the toolbar, the menu and the panel share are one
         * `Enabled`: assigning the button's would be refused, and rightly. */
        for (const act of [this.ActDelete, this.ActIndent, this.ActOutdent,
                           this.ActUp, this.ActDown, this.ActCopy, this.ActCut,
                           this.ActTaskInfo, this.ActLink, this.ActUnlink,
                           this.ActPct0, this.ActPct25, this.ActPct50,
                           this.ActPct75, this.ActPct100, this.ActScrollToTask])
            act.Enabled = has;
        for (const w of [this.BtnApply, this.TxtNotes,
                         this.TxtLinkText, this.TxtLinkAddress, this.TxtLinkSub,
                         this.CmbPred, this.CmbType, this.SpinLag,
                         this.BtnLinkAdd])
            w.Enabled = has;

        for (const w of [this.CmbAssignRes, this.TxtAssignUnits,
                         this.TxtAssignBudget, this.BtnAssignAdd])
            w.Enabled = has;

        this.fillLinks(has ? task : null);
        this.fillAssignments(has ? task : null);
    }

    /* The open button is the desktop's opener (`LinkButton`): the address it
     * holds follows the box, so a link can be tried before Apply, and with
     * nothing to open it is grey. */
    TxtLinkAddress_Change() { updateLinkUri(this); }

    CmbAttr_Select() {
        selectTaskAttr(this, this.selectedTask(), this.holder.project);
    }

    /* The chosen row is the value: the text box keeps it, so Apply -- and the
     * undo of an Apply -- move as one. */
    CmbAttrValue_Select() { selectTaskAttrValue(this); }

    /* The links of the selected task, as the panel's own table: `linkRows`
     * holds the records the strings came from, and `predChoices` the UIDs the
     * combo offers, both parallel to their control by index. */
    fillLinks(task) {
        this.Links.Clear();
        this.linkRows = [];
        this.predChoices = [null];   // the combo's placeholder
        this.BtnLinkDel.Enabled = false;

        if (task) {
            for (const link of task.Links) {
                /* The whole plan's, not the filter's: a predecessor the
                 * filter hides is still that task. */
                const pred = this.edit.task(link.PredecessorUID);
                this.linkRows.push(link);
                this.Links.Add([
                    pred ? pred.Name : `UID ${link.PredecessorUID}`,
                    linkName(linkKind(link)),
                    String(linkLagMinutes(this.holder.project, link)),
                ]);
            }
            /* A placeholder first, so nothing is chosen until the user says
             * so; summaries are out because the engine links to their dates
             * as the file wrote them (see Schedule.js). */
            const items = [Locale.Text("Choose…")];
            for (const other of this.holder.project.Tasks) {
                if (other.IsNull || other.Summary || other.UID === task.UID) continue;
                this.predChoices.push(other.UID);
                items.push(`${other.ID}  ${other.Name}`);
            }
            this.CmbPred.Items = items;
            this.CmbPred.Index = 0;
        }
    }

    /* The row moved: mark the same task in the chart. The two views share
     * identity and never geometry. */
    Tasks_Select() {
        const key = this.Tasks.Key;
        this.selectedUID = key === "" ? null : Number(key);
        /* **The cell follows the row**: moving the selection down the list --
         * an arrow, a click, the restore after a command -- keeps the column,
         * which is what a cell cursor does. The runtime's current cell is what
         * draws the frame, so it moves with it, and the entry bar goes after. */
        if (this.cell && this.selectedUID !== null) {
            this.cell.key = String(this.selectedUID);
            this.placeCell();
        } else if (this.selectedUID === null) {
            this.cell = null;
            this.Tasks.CurrentCell = null;
        }
        this.showEntry();
        this.showTask(this.selectedTask());
        this.redrawChart();
    }

    /* **The runtime's current cell, from `this.cell`**: the frame the reader
     * sees and the address the keys move from. A column the view does not show
     * is no cell, and neither is a row the table does not hold. */
    placeCell() {
        const at = this.cell ? this.entryColumn(this.cell.id) : -1;
        this.Tasks.CurrentCell = at < 0 || !this.byUID || !this.byUID[this.cell.key]
            ? null
            : { Row: this.cell.key, Column: at };
    }

    /* **The cell moved**, whichever way it moved: a press, `EditCell`, an
     * assignment from a key, a rebuild. The bar follows it, and the cell is
     * remembered by the column's id -- never by its index, which a hidden or
     * moved column changes under it. */
    Tasks_CellChange(row, column) {
        if (row === null || row === undefined) {
            this.cell = null;
            this.showEntry();
            return;
        }
        this.rememberCell(String(row), column);
    }

    /* **The cell one step away**, as the grid's keys mean it: Enter down, Tab
     * right, Shift+Tab left, wrapping at the ends of a row. The rows are the
     * ones the list is showing -- a folded branch is not a row to land on --
     * and the address is the row's key, which a rebuild cannot move. */
    moveCell(where) {
        const cell = this.cell;
        if (!cell || !this.holder || !this.Tasks) return;

        const rows  = this.chartRows();
        const keys  = rows.map((t) => String(t.UID));
        const cols  = this.Tasks.Columns.length;
        let   rowAt = keys.indexOf(cell.key);
        let   colAt = this.entryColumn(cell.id);
        if (rowAt < 0 || colAt < 0 || cols <= 0) return;

        if (where === "down") {
            rowAt++;
        } else if (where === "right") {
            if (++colAt >= cols) { colAt = 0; rowAt++; }
        } else if (where === "left") {
            if (--colAt < 0) { colAt = cols - 1; rowAt--; }
        }
        if (rowAt < 0 || rowAt >= keys.length) return;

        /* Assigning moves the frame, selects the row and says so; the bar
         * follows through `Tasks_CellChange`. */
        this.Tasks.CurrentCell = { Row: keys[rowAt], Column: colAt };
    }

    /* Ctrl+F: the filter field takes the keyboard. */
    ActFilter_Execute() {
        this.TxtFilter.SetFocus();
    }

    /* **A double click on a row -- or Enter -- where the cell is not a field
     * opens Información de la tarea**, which is what Project's double click
     * means. **An editable cell keeps the gesture**: the press is claimed to
     * open the field, so a double click on a name or a date stays in the
     * cell, and this road is what is left for the columns that are not
     * fields. */
    Tasks_Activate() {
        return this.ActTaskInfo_Execute();
    }

    /* --- the chart's pointer ------------------------------------------- */

    ganttWidth()  { const b = this.Gantt.Bounds(); return b.Width  || this.Gantt.Width; }
    ganttHeight() { const b = this.Gantt.Bounds(); return b.Height || this.Gantt.Height; }

    /* How tall a row is, how tall the heading is, and how far down the list
     * is: the table's own numbers, read every time rather than cached. A row
     * added in this turn has no height yet, so the first frames after opening
     * a plan fall back and the next one has the real value. */
    rowHeight() {
        const h = this.Tasks ? this.Tasks.RowHeight : 0;
        return h > 0 ? h : ROW_H;
    }

    headHeight() {
        const h = this.Tasks ? this.Tasks.HeaderHeight : 0;
        return h > 0 ? h : HEADER;
    }

    /* The rows the chart draws, and **the rows the list drew them from**: the
     * same call, on the same plan, at the same moment -- so a filter that takes
     * rows out of one takes them out of the other and the two cannot disagree
     * about what row `i` is.
     *
     * **And the branches the list has closed come out too**, which is what
     * folding a summary means: it takes rows away from both panes, and the two
     * are one view. Without this the chart kept drawing the whole plan while
     * the list showed thirty-seven of forty-one rows, and thirty-five of the
     * rows the reader could see had a bar that belonged to another task --
     * `ganttHit` reads the same rows, so a click on it selected that other
     * task. That is the manual's promise broken in the one place it is
     * visible.
     *
     * **Asked again every time rather than kept.** A command replaces the task
     * records (the undo does, and so does `setDates`), and a chart holding the
     * objects it was handed an edit ago would draw the plan as it was before
     * that edit -- which is what a cached list did, and `check-drag` caught it
     * the moment the resize stopped moving anything. The walk is the same one
     * `fill` does to build the list, so a frame that draws 4000 bars already
     * pays for it. **Nor is the fold state kept**, and for a sharper reason:
     * nothing in the runtime reports a fold -- there is no event for the
     * disclosure arrow and no way to enumerate what a tree is showing -- so the
     * branch's own answer is the only truth there is. It is cheap: measured on
     * a plan of a thousand rows with two hundred branches, a pass over every
     * branch is 0.4 ms, two per cent of a frame, and a branch under a closed
     * one is never asked because its rows are already out.
     */
    chartRows() {
        const all = this.holder ? this.visibleTasks(this.holder.project) : [];
        if (!this.Tasks) return all;

        /* A branch is a task the next row is deeper than -- the shape `fill`
         * gives the tree, and not the `Summary` flag, which a file can carry
         * wrong. Inside a closed one every row is skipped until the outline
         * comes back to its depth, so nothing under it is asked. */
        const rows = [];
        let closed = null;
        for (let i = 0; i < all.length; i++) {
            const task = all[i];
            const level = task.OutlineLevel || 0;
            if (closed !== null) {
                if (level > closed) continue;
                closed = null;
            }
            rows.push(task);
            const branch = i + 1 < all.length &&
                           (all[i + 1].OutlineLevel || 0) > level;
            if (branch && !this.branchOpen(task)) closed = level;
        }
        return rows;
    }

    /* The time the chart spans: the **plan's** as the list has it filtered,
     * not the rows a fold left showing. A filter is a different plan to look
     * at; a fold is the same one with less of it open, and its timescale does
     * not move. */
    chartRange() {
        return this.holder ? ganttRange(this.visibleTasks(this.holder.project))
                           : null;
    }

    /* Whether the list has this branch open. A node the table does not have
     * reads as open: that is a rebuild in flight, and the answer that keeps the
     * rows is the safer one -- `Expanded` refuses a key that is not there. */
    branchOpen(task) {
        const key = String(task.UID);
        if (!this.Tasks.Exists(key)) return true;
        return this.Tasks.Expanded(key);
    }

    /* The chart is drawn in the list's coordinates: row `i` at
     * `head + i * row - scroll`, which is where the table draws it. The plot
     * starts at the pane's edge -- the names are in the list beside it -- and
     * the gutter comes back only for a chart that travels on its own. */
    /* The chart's own frame: **no heading**, because the heading is a control
     * above it (`Header`) and the rows start at the top of the pane -- one row's
     * height lower than before, and so level with the list's first row, which
     * starts under its own headings. */
    planGeom() {
        return { plotX: PAD, rowH: this.rowHeight(), headH: 0,
                 scrollY: this.ganttY || 0, calendar: this.chartCal || null,
                 selLink: this.selLink || null,
                 format: this.format, labelOf: this.labelOf(),
                 range: this.chartRange() };
    }

    /* What the chart writes beside a bar, as a function of the task and the
     * field the format chose: the same values the columns show, and the
     * resources a column does not. The assignments are indexed the first time
     * a frame asks, so a plan is walked once for all its rows and not once per
     * row. */
    labelOf() {
        let names = null;
        return (task, what) => {
            if (!this.holder) return "";
            const project = this.holder.project;
            switch (what) {
            case "name":      return task.Name;
            case "resources": {
                if (!names) {
                    names = {};
                    for (const a of project.Assignments) {
                        const r = resourceOf(project, a.ResourceUID);
                        if (!r || !r.Name) continue;
                        (names[a.TaskUID] = names[a.TaskUID] || []).push(r.Name);
                    }
                }
                return (names[task.UID] || []).join(", ");
            }
            case "percent":   return task.Summary || task.PercentComplete
                                   ? this.columnValue("percent", task) : "";
            case "dates":     return `${shortDate(task.Start)} – ${shortDate(task.Finish)}`;
            case "duration":
            case "work":
            case "cost":
            case "wbs":       return this.columnValue(what, task);
            }
            return "";
        };
    }

    /* The chart's own look, in its dialog: a view setting that is remembered,
     * and one the exported chart wears too. */
    ActFormat_Execute() {
        FormatForm.open(this.format, (fmt) => this.setFormat(fmt));
    }

    setFormat(fmt) {
        this.format = ganttFormat(fmt);
        this.redrawChart();
    }

    /* The strip's frame: the heading's height is the list's, so the marks in it
     * sit where the list's own headings do, and `strip` tells the ruler the band
     * is painted for it. */
    rulerGeom() {
        return { plotX: PAD, rowH: this.rowHeight(), headH: this.headHeight(),
                 scrollY: 0, calendar: this.chartCal || null, strip: true,
                 range: this.chartRange() };
    }

    /* Which task, and which part of its bar, is under the pointer. */
    Gantt_MouseLeave() { this.showTip(""); this.setCursor("Auto"); }

    setCursor(name) {
        if (name === this.cursorName) return;
        this.cursorName = name;
        this.Gantt.Cursor = name;
    }

    /* **What the pointer says it can do here**, before anything is pressed: a
     * bar moves (the hand that holds it), its right edge resizes, a bar with
     * Ctrl held starts a dependency, the line of a dependency can be picked up
     * and the dots of the chosen one can be grabbed. Where there is nothing, the
     * plain arrow. It is the same hit-testing the press uses, so the pointer
     * never promises what the click will not do. */
    hoverCursor(x, y, ctrl) {
        const hit = this.ganttHit(x, y);
        if (hit) {
            if (ctrl) return "Crosshair";
            return hit.zone === "end" ? "ResizeHorizontal" : "Grab";
        }
        const g = ganttGeometry(this.chartRows(), this.ganttWidth(),
                                this.ganttHeight(), this.step, this.planGeom());
        if (this.selLink && !ctrl) {
            const shape = ganttLinkOf(g, this.selLink.pred, this.selLink.succ);
            if (shape) {
                const n = shape.pts.length;
                if (Math.min(Math.hypot(x - shape.pts[0], y - shape.pts[1]),
                             Math.hypot(x - shape.pts[n - 2], y - shape.pts[n - 1])) <= 6)
                    return "Grab";
            }
        }
        return ganttLinkAt(g, x, y) ? "Hand" : "Auto";
    }

    showTip(text) {
        if (text === this.tipText) return;
        this.tipText = text;
        this.Gantt.Tooltip = text;
    }

    /* The words for a point of the chart, or "" where there is nothing. Unlike
     * `ganttHit` -- which is what can be *dragged* -- a summary answers here:
     * it is an item all the same. */
    tipAt(x, y) {
        const project = this.holder ? this.holder.project : null;
        if (!project) return "";
        const g = ganttGeometry(this.chartRows(), this.ganttWidth(),
                                this.ganttHeight(), this.step, this.planGeom());
        const i = g.rowAt(y);
        if (i < 0 || x < g.plotX) return "";

        const task = g.rows[i];
        const s = whenMs(task.Start), f = whenMs(task.Finish);
        if (s !== null && f !== null) {
            const x0 = g.x(Math.min(s, f)), x1 = g.x(Math.max(s, f));
            const edge = task.Milestone ? 9 : 4;
            if (x >= x0 - edge && x <= x1 + edge) return this.taskTip(task);
        }
        const link = ganttLinkAt(g, x, y);
        return link ? this.linkTip(link.edge, link.task) : "";
    }

    /* What a reader hovering a bar asks: which task, when, how long, how far
     * along, who does it, what it costs and whether it can slip. A line is only
     * there when it has something to say -- a task with no resources has no
     * "Resources" line. */
    taskTip(task) {
        const project = this.holder.project;
        const lines = [task.WBS ? `${task.WBS}  ${task.Name}` : task.Name];
        const add = (label, value) => { if (value) lines.push(`${Locale.Text(label)}: ${value}`); };

        if (task.Milestone) {
            lines.push(shortDate(task.Start));
        } else {
            lines.push(`${shortDate(task.Start)} → ${shortDate(task.Finish)}`);
            add("Duration", durationText(task, project));
        }
        add("Percent complete", `${task.PercentComplete || 0}%`);
        add("Resources", this.labelOf()(task, "resources"));
        add("Work", this.columnValue("work", task));
        add("Cost", this.columnValue("cost", task));
        if (task.Critical) lines.push(Locale.Text("Critical"));
        else add("Slack", slackText(task, project));
        add("Deadline", task.Deadline ? shortDate(task.Deadline) : "");
        return lines.join("\n");
    }

    /* A dependency: who it joins, the kind, and the lag when there is one. */
    linkTip(edge, succ) {
        const project = this.holder.project;
        const pred = this.byUID[String(edge.PredecessorUID)];
        const kind = linkName(linkKind(edge));
        const lag = edge.LinkLag ? ` ${edge.LinkLag > 0 ? "+" : "-"}` +
            (isPercentLagFormat(edge.LagFormat)
                ? `${Math.abs(edge.LinkLag)}%`
                : minutesText(Math.abs(edge.LinkLag) / TENTHS, succ, project)) : "";
        return `${pred ? pred.Name : `UID ${edge.PredecessorUID}`} → ${succ.Name}\n${kind}${lag}`;
    }

    ganttHit(x, y) {
        const project = this.holder ? this.holder.project : null;
        if (!project) return null;

        const g = ganttGeometry(this.chartRows(), this.ganttWidth(),
                                this.ganttHeight(), this.step, this.planGeom());
        const i = g.rowAt(y);
        if (i < 0 || x < g.plotX) return null;

        /* A summary's dates are its children's span (the panel greys them
         * for the same reason), so its bracket is not something to drag. */
        const task = g.rows[i];
        if (task.Summary) return null;
        const s = whenMs(task.Start), f = whenMs(task.Finish);
        if (s === null || f === null) return null;

        const x0 = g.x(Math.min(s, f)), x1 = g.x(Math.max(s, f));
        const edge = task.Milestone ? 9 : 5;
        if (x < x0 - edge || x > x1 + edge) return null;
        /* **The grip is a part of the bar, not the bar**: five pixels of a bar
         * ten pixels wide is half of it, and a bar of three was nothing but
         * grip -- a short task could not be picked up to be moved. So the grip
         * is at most a third of the bar. */
        const grip = Math.min(5, (x1 - x0) / 3);
        return { task, zone: !task.Milestone && x >= x1 - grip ? "end" : "bar" };
    }

    /* The button goes down: a drag starts. Ctrl draws a dependency; otherwise
     * the bar moves, and its last pixels resize. Nothing is written until the
     * button is let go, so one gesture is one undo. */
    Gantt_MouseDown(x, y, button, ctrl, shift) {
        const hit = this.ganttHit(x, y);
        if (hit && button === 3) {
            if (this.Tasks.Exists(String(hit.task.UID))) {
                this.Tasks.Key = String(hit.task.UID);
                this.Tasks_Select();
            }
            return;
        }
        /* **A link is picked by clicking its line**, where no bar is: it is
         * chosen -- drawn heavier, with a dot at each end -- and **Delete**
         * removes it. Pressing within a few pixels of either end picks the end
         * up instead, and letting go over another task moves it there. */
        /* **The dots of a chosen link are handles, and a handle wins over the bar
         * under it**: a finish-to-start link ends on the very edge of the
         * successor's bar, where a press would otherwise start a resize. */
        if (button === 1 && this.selLink && !ctrl) {
            const g = ganttGeometry(this.chartRows(), this.ganttWidth(),
                                    this.ganttHeight(), this.step, this.planGeom());
            const shape = ganttLinkOf(g, this.selLink.pred, this.selLink.succ);
            if (shape) {
                const n = shape.pts.length;
                const toPred = Math.hypot(x - shape.pts[0], y - shape.pts[1]);
                const toSucc = Math.hypot(x - shape.pts[n - 2], y - shape.pts[n - 1]);
                if (Math.min(toPred, toSucc) <= 6) {
                    const moving = toSucc <= toPred ? "succ" : "pred";
                    const { pred, succ } = this.selLink;
                    this.drag = { mode: "link", uid: moving === "succ" ? pred : succ,
                                  px: x, py: y, to: null, forced: shape.type,
                                  srcEnd: moving === "succ" ? shape.ends.from
                                                            : shape.ends.to,
                                  relink: { pred, succ, moving } };
                    this.redrawChart();
                    return;
                }
            }
        }
        if (!hit && button === 1) {
            const g  = ganttGeometry(this.chartRows(), this.ganttWidth(),
                                     this.ganttHeight(), this.step, this.planGeom());
            const lk = ganttLinkAt(g, x, y);
            if (lk) {
                const pred = lk.edge.PredecessorUID, succ = lk.task.UID;
                this.selLink = { succ, pred };
                /* The keyboard goes to the chart, away from wherever it was --
                 * the panel's name field, usually -- or Delete would be typed
                 * there. The chart has to be `Focusable` for this to land. */
                this.Gantt.SetFocus();
                this.redrawChart();
                return;
            }
            if (this.selLink) { this.selLink = null; this.redrawChart(); }
        }
        if (!hit || button !== 1) return;
        this.selLink = null;

        if (ctrl) {
            /* **Ctrl draws a link, and the bar's halves say which ends**: where
             * the button went down is the end it leaves by (left half the start,
             * right half the finish) and where it comes up is the end it joins.
             * Ctrl+Shift ignores the halves and draws finish to start -- the
             * way to get one for a milestone, which has none. The other types
             * are the Links list's to choose. */
            const g = ganttGeometry(this.chartRows(), this.ganttWidth(),
                                    this.ganttHeight(), this.step, this.planGeom());
            const forced = shift ? LINK_ORDER[0] : null;
            this.drag = { mode: "link", uid: hit.task.UID, px: x, py: y, to: null,
                          forced,
                          srcEnd: forced !== null ? linkEndsOf(forced).from
                                                  : linkEndAt(hit.task, g, x, "from") };
            return;
        }
        const start = whenMs(hit.task.Start), finish = whenMs(hit.task.Finish);
        if (start === null || finish === null) return;

        this.drag = { mode: hit.zone === "end" ? "resize" : "move",
                      uid: hit.task.UID, x0: x, px: x, py: y,
                      originStart: start, originFinish: finish,
                      start, finish };

        /* The chart selects too, so the panel follows the bar. */
        if (this.Tasks.Exists(String(hit.task.UID))) {
            this.Tasks.Key = String(hit.task.UID);
            this.Tasks_Select();
        }
        this.redrawChart();
    }

    /* **Delete takes the chosen link out**, and Escape lets it go. The key
     * comes to the chart only when the chart has the focus -- which clicking a
     * link gives it -- so a Delete typed in the panel's fields is theirs. */
    Gantt_KeyPress(key, ctrl, shift, alt) {
        if (this.rowKey(key, ctrl)) return true;
        if (!this.selLink) return false;
        if (key === "Escape") {
            this.selLink = null;
            this.redrawChart();
            return true;
        }
        if (key !== "Delete" && key !== "BackSpace") return false;

        const task = this.edit ? this.edit.task(this.selLink.succ) : null;
        const pred = this.selLink.pred;
        this.selLink = null;
        if (!task) { this.redrawChart(); return true; }
        if (this.edit.setLinks(task.UID, task.Links.filter((l) => l.PredecessorUID !== pred)))
            this.fill(task.UID);
        else this.redrawChart();
        return true;
    }

    Gantt_DblClick(x, y, button, ctrl, shift) {
        if (button !== 1 || !this.selectedTask()) return;
        this.ActTaskInfo_Execute();
    }

    /* **What the chart says about what is under the pointer**: the task of a
     * bar, a summary or a milestone, or the line of a dependency. It is a
     * property of the chart set while the pointer moves -- the runtime shows it
     * after the pause -- and only when the words change, so a pointer crossing
     * a bar does not ask the toolkit to rebuild the balloon at every pixel.
     * Nothing is said while something is being dragged: the outline is the
     * feedback then. */
    Gantt_MouseMove(x, y, button, ctrl, shift) {
        const drag = this.drag;
        if (!drag) {
            this.showTip(this.tipAt(x, y));
            this.setCursor(this.hoverCursor(x, y, ctrl));
            return;
        }
        this.showTip("");
        if (drag.mode !== "link")
            this.setCursor(drag.mode === "resize" ? "ResizeHorizontal" : "Grabbing");
        drag.px = x;
        drag.py = y;

        const g = ganttGeometry(this.chartRows(), this.ganttWidth(),
                                this.ganttHeight(), this.step, this.planGeom());

        if (drag.mode === "link") {
            const hit = this.ganttHit(x, y);
            drag.to = hit && hit.task.UID !== drag.uid ? hit.task.UID : null;
            drag.type = null; drag.dstEnd = null; drag.problem = ""; drag.label = "";
            if (drag.to !== null && drag.relink) {
                /* An end being moved keeps the link's own type: only the task it
                 * hangs from changes. */
                const r = drag.relink, ends = linkEndsOf(drag.forced);
                drag.type   = drag.forced;
                drag.dstEnd = r.moving === "succ" ? ends.to : ends.from;
                drag.problem = r.moving === "succ"
                    ? this.edit.linkProblem(r.pred, drag.to, drag.type)
                    : this.edit.linkProblem(drag.to, r.succ, drag.type);
                drag.label = drag.problem ? Locale.Text(drag.problem)
                                          : linkName(drag.type);
            } else if (drag.to !== null) {
                /* The ends it joins: the halves, or the combo's type when it was
                 * forced -- and whether that may be drawn at all. */
                drag.dstEnd = drag.forced !== null ? linkEndsOf(drag.forced).to
                                                   : linkEndAt(hit.task, g, x, "to");
                drag.type = drag.forced !== null ? drag.forced
                                                 : linkTypeOf(drag.srcEnd, drag.dstEnd);
                drag.problem = this.edit.linkProblem(drag.uid, drag.to, drag.type);
                drag.label = drag.problem ? Locale.Text(drag.problem)
                                          : linkName(drag.type);
            }
            this.setCursor(drag.problem ? "NotAllowed" : "Crosshair");
            this.redrawChart();
            return;
        }

        if (!g.dayW) return;
        const days = Math.round((x - drag.x0) / g.dayW);
        const task = this.edit.task(drag.uid);
        if (!task) return;

        /* **The gesture lands on the task's own calendar**, as the engine
         * does: a plain `+ days * 24h` put a Friday start on a Saturday -- or,
         * across a clock change, an hour off -- and left the duration for the
         * next recalculation to contradict. The day count is the pointer's;
         * where it lands is the calendar's. An elapsed task counts clock time,
         * so for it the shift is the plain one. */
        const shifted = (ms) => {
            const d = new Date(ms);
            d.setDate(d.getDate() + days);
            return d.getTime();
        };
        const elapsed = isElapsed(task.DurationFormat);
        const work = new WorkCalendar(this.holder.project, task.CalendarUID);
        if (drag.mode === "move") {
            const minutes = work.between(drag.originStart, drag.originFinish);
            const from = shifted(drag.originStart);
            if (elapsed) {
                drag.start  = from;
                drag.finish = shifted(drag.originFinish);
            } else if (minutes > 0) {
                drag.start  = work.startAfter(from);
                drag.finish = work.add(drag.start, minutes);
            } else {
                drag.start  = work.add(from, 0);
                drag.finish = drag.start;
            }
        } else {
            const to = shifted(drag.originFinish);
            drag.finish = Math.max(drag.originStart,
                                   elapsed ? to : work.finishAt(to));
        }
        this.redrawChart();
    }

    /* The pointer is where it was, and it says what it is over now -- after the
     * gesture was applied, so a bar that moved under it is the bar it is over --
     * and not what the gesture that just ended said. */
    Gantt_MouseUp() {
        const drag = this.drag;
        this.endDrag();
        if (drag) this.setCursor(this.hoverCursor(drag.px, drag.py, false));
    }

    endDrag() {
        const drag = this.drag;
        this.drag = null;
        if (!drag) return;

        if (drag.mode === "link") {
            if (drag.to !== null && drag.to !== undefined) {
                /* A link that may not be made says why and is not made. */
                if (drag.problem) {
                    this.log(Locale.Text(drag.problem));
                    this.redrawChart();
                    return;
                }
                if (drag.relink) {
                    const r = drag.relink;
                    const next = r.moving === "succ" ? { pred: r.pred, succ: drag.to }
                                                     : { pred: drag.to, succ: r.succ };
                    if (this.edit.relink({ pred: r.pred, succ: r.succ }, next)) {
                        this.selLink = next;
                        this.fill(next.succ);
                    } else this.redrawChart();
                    return;
                }
                const succ = this.edit.task(drag.to);
                if (this.putLink(succ, drag.uid, LINK_ORDER.indexOf(drag.type), 0))
                    this.fill(succ.UID);
                else this.redrawChart();
            } else {
                this.redrawChart();
            }
            return;
        }

        const task = this.edit.task(drag.uid);
        if (!task) { this.redrawChart(); return; }

        const values = { Start: isoLocal(drag.start),
                         Finish: isoLocal(drag.finish) };
        if (drag.mode === "resize") {
            values.Duration = mspdiDuration(
                this.workingMinutes(task, drag.start, drag.finish));
        } else if (values.Start !== task.Start) {
            /* **Moving the bar is writing the start by hand**, and in Project
             * that leaves the constraint a typed start leaves: the pass keeps
             * the task where the pointer dropped it. A stretch is the
             * duration's own gesture and pins nothing. */
            values.ConstraintType = CONSTRAINT_SNET;
            values.ConstraintDate = values.Start;
        }
        /* **A gesture that moved nothing is not an edit**, and a click on a
         * bar is exactly that: the button goes down and comes up with the
         * pointer where it was. Rebuilding the table for it would cost the
         * reader where in the plan they were and every branch they had folded
         * -- `fill` brings the rows back open -- to say nothing that changed.
         * The link branch above is the same shape for the same reason. */
        if (this.edit.setFields(task.UID, values)) this.fill(task.UID);
        else this.redrawChart();
    }

    /* The working time between two dates on the task's own calendar, which is
     * the duration a resize leaves. */
    workingMinutes(task, start, finish) {
        const calendar = new WorkCalendar(this.holder.project, task.CalendarUID);
        return Math.round(calendar.between(start, finish));
    }

    log(line) {
        this.Log.Append(line + "\n");
    }

    /* Every frame is drawn from the data; there is nothing to keep. */
    /*
     * The heading: the same marks, in a strip the theme paints.
     *
     * **The height is asked for here and not in the sizing pass**, because a size
     * request assigned *during* an allocation is a request for the next one --
     * and nothing was asking for one: the pane's own size had not changed, so
     * the strip kept the theme's natural and the two headings disagreed by
     * however much that was. Measured, with the request set and read back at 34:
     * the strip was given 24. A draw is outside that pass, so the number lands,
     * and the guard makes it land once. The rule is the same one
     * `placePanels` follows -- a child given a rectangle has not measured yet --
     * and it is worth having in both places because it costs nothing to obey.
     */
    Header_Draw(p, width, height) {
        const headH = this.headHeight();
        if (this.Header.Height !== headH) {
            this.Header.Height = headH;
            return;   /* the box has no height for these marks yet */
        }
        /* **The ruler is as wide as the chart and travels with it.** With a
         * fixed scale the chart is wider than its pane and the scroller shows
         * the difference; the strip is outside that scroller, so drawn with its
         * own width it squeezed the whole range into the pane and stood still
         * while the bars moved. */
        const { full, shift } = this.rulerFrame(width);
        const g = ganttGeometry(this.chartRows(), full, height, this.step,
                                this.rulerGeom());
        p.Push();
        p.Translate(-shift, 0);
        drawGanttRuler(p, full, g, ganttPalette(p));
        p.Pop();
    }

    /* The width the marks are laid out over -- the chart's, when it is wider
     * than the strip -- and how far across the chart is scrolled. */
    rulerFrame(width) {
        const full  = Math.max(width, this.Gantt ? this.ganttWidth() : 0);
        const shift = this.GanttScroll ? this.GanttScroll.ScrollX : 0;
        return { full, shift: Math.min(Math.max(shift, 0), Math.max(full - width, 0)) };
    }

    /* The chart scrolled sideways: the strip above it is a separate control, so
     * it has to be told to follow. (Vertical moves are the list's, above.) */
    GanttScroll_Scroll(x, y) {
        if (this.Header) this.Header.Redraw();
    }

    Gantt_Draw(p, width, height) {
        const rows = this.chartRows();
        if (!this.chartFile) this.drawnRows = rowsKey(rows);
        drawGantt(p, width, height, rows, this.selectedUID,
                  this.step, this.drag, BASELINE,
                  this.chartFile ? this.fileGeom() : this.planGeom());
    }

    /*
     * **A fold is noticed by looking, because nothing says one happened.** The
     * disclosure arrow raises no event, and a fold only moves the scroll when
     * it has to clamp it -- folding with the list scrolled anywhere else, which
     * is where a reader folds, leaves `ScrollY` where it was and no `Scroll`
     * comes. So the chart kept the frame it had: the rows were right the next
     * time it was asked and nothing asked, and the reader saw the wrong bars
     * until a click happened to redraw them.
     *
     * The chart remembers which rows it last drew and this asks, a few times a
     * second, whether those are still the rows. The walk is `chartRows`'s own,
     * 0.4 ms on a thousand rows, and a frame is only asked for when the answer
     * changed -- which a fold is, and a redraw already on its way is not.
     */
    startFoldWatch() {
        if (this.foldTimer) this.foldTimer.Stop();
        this.foldTimer = Timer.Every(FOLD_POLL_MS, () => {
            if (!this.Gantt || this.drawnRows === null) return;
            if (rowsKey(this.chartRows()) !== this.drawnRows) this.redrawChart();
        });
    }

    /*
     * The list scrolled -- the wheel, its scrollbar, the keyboard or an
     * assignment -- and the chart is the rows the list is showing, so this is
     * what moves it. The chart's own scroller is horizontal only: the timescale
     * is what does not fit, and a vertical one would take the rows' alignment
     * with them.
     */
    Tasks_Scroll(x, y) {
        /* A rebuild's rows being laid out, not the reader: back where they
         * were (`rebuildRows`). The assignment raises this again, with the
         * held number, and that one moves the chart. */
        if (this.scrollHeld !== null && this.scrollHeld !== undefined && y !== this.scrollHeld) {
            this.Tasks.ScrollY = this.scrollHeld;
            if (this.Tasks.ScrollY !== y) return;
        }
        this.ganttY = y;
        this.redrawChart();
    }

    /* The wheel over the chart belongs to the list, which is the only thing
     * here that scrolls down: a notch moves three rows. The answer is false on
     * purpose, so the scroller around the chart still gets the other half. */
    Gantt_MouseWheel(dx, dy) {
        if (!dy || !this.Tasks) return false;
        this.Tasks.ScrollY = this.Tasks.ScrollY + Math.round(dy) * 3 * this.rowHeight();
        return false;
    }

    /* A chart that travels on its own: the whole plan, from its first row, with
     * the names in a gutter -- a file has no list beside it to carry them. */
    fileGeom() {
        return { plotX: GUTTER, rowH: this.rowHeight(), headH: this.headHeight(),
                 scrollY: 0, rows: this.chartRows().length,
                 calendar: this.chartCal || null, paper: true,
                 format: this.format, labelOf: this.labelOf(),
                 range: this.chartRange() };
    }

    fileHeight() {
        const g = this.fileGeom();
        return g.headH + (g.rows || 0) * g.rowH + 8;
    }

    /*
     * The chart's own size: as tall as the pane it shares with the list -- the
     * rows are the list's rows, so the chart is the list's height -- and as wide
     * as the timescale asks, with the horizontal scroller showing the
     * difference. Auto fits the view, which is why a window resize recomputes
     * it.
     */
    syncGanttSize() {
        if (!this.Gantt || !this.Tasks) return;   // the form is still being built
        const range = this.chartRange();

        /* **The chart is not sized, it is floored.** `Width` and `Height` on a
         * control are a *minimum request* to GTK when the control is not
         * stretched, and the app had been assigning the pane's own width and
         * height to it -- so every resize fed itself back: the window grows, the
         * chart is drawn wider, its request grows, and the window can never be
         * made narrower than it had been. That is the whole of "after maximizing
         * it I could not shrink it".
         *
         * What is left is the one number that has to be a size: the timescale's
         * own width, as a floor. The scroller around the chart is arranged, so
         * its slot is a box, and a box stretches an expanding child across the
         * view -- that is `Auto`, fitting the window -- and lets it grow past the
         * view along the axis that scrolls, which is Day/Week/Month. A floor on
         * the axis that scrolls stays inside the scroller: measured, a child
         * floored at 2000 in a 640-wide window leaves a scroller with 1956 to
         * scroll and a window that never moved.
         */
        let wanted = 0;
        if (this.dayW && range) {
            const days = (range.to - range.from) / DAY_MS;
            wanted = Math.round(PAD + days * this.dayW + 8);
        }
        this.Gantt.MinWidth = wanted;

        /* **One number for a heading, and the chart's is the list's.** The strip
         * is floored to the height the table's own heading has, and then read
         * back: a `Height` is a floor and a box gives a child that does not
         * expand at least its floor, so a theme whose `button` is *taller* than
         * that floor -- which is what the theme decides, not a number written
         * here -- would leave the strip taller than the list's heading and the
         * plan a pixel or two out of true. So when the strip turns out taller,
         * the table's heading is told to match it, and the two agree whichever
         * of the two is the larger.
         *
         * The alignment is then true by construction rather than by agreement:
         * the chart's pane begins one strip below the list's and its rows start
         * at the top of it, while the list's rows start one heading below its
         * own -- and those are the same number, so the first row on either side
         * of the divider is on one line whatever the theme does. */
        const headH = this.headHeight();
        const strip = Math.round(this.Header ? this.Header.Bounds().Height : 0);
        if (strip > headH) this.Tasks.HeaderMinHeight = strip;

        /* **The chart is floored to one row, not to the pane.** Flooring it to
         * the scroller's own height fed the window's minimum back into itself:
         * the floor was read from a pane that was not on screen yet, and opening
         * a plan from the welcome page grew the window by the heading's height.
         * The chart expands to fill the pane anyway, so it takes whatever there
         * is, and the log's strip comes out of it rather than out of the window. */
        this.Gantt.MinHeight = this.rowHeight();

        this.syncZoom();
        this.redrawChart();
    }

    /* The chart and its heading are one thing on screen, so they are redrawn
     * together: a scroll that moves the rows has to move the marks that label
     * them, and a resize that changes the range has to redraw both. */
    redrawChart() {
        if (this.Header) this.Header.Redraw();
        if (this.Gantt) this.Gantt.Redraw();
    }

    /* The first real rectangle: `Form_Open` is reliably too early for one, and
     * a pane that has never been measured is not the height the chart has to
     * draw into. */
    PlanSplit_Allocated(box) {
        this.syncGanttSize();
        this.placePanels();
    }

    BodySplit_Allocated(box) { this.placePanels(); }

    /*
     * The panel of properties is a form, not a space: it is given a width of
     * its own and the plan takes whatever the window has left, which is what
     * `Grows: "Start"` then keeps. **A `Split`'s `Position` is a count of
     * pixels from the start**, so the 660 a `.form` declares would hand the
     * panel everything past it on a wide screen -- 1236 pixels of panel on a
     * 1920 one, with a chart of 139. So the divider is put where the panel ends
     * the first time the body is measured, once: after that the user drags it
     * wherever they want it and nothing moves it back.
     */
    placePanels() {
        const body = this.Body.Bounds().Width;
        if (!(body > 0) || this.panelsPlaced) return;
        this.panelsPlaced = true;

        /* One turn later, and this is the rule the whole runtime measures by: a
         * pane that has just been given a rectangle has not measured its
         * children yet, and the paned's own minimums are still the ones it had
         * a frame ago. A divider put now is a divider the paned puts back. */
        Timer.After(0, () => {
            const wide = this.Body.Bounds().Width;
            this.BodySplit.Position = Math.max(MIN_PLAN_W, wide - PANEL_W);
        });
    }

    /* The window changed size: Auto means the chart fits it again. */
    Form_Resize() { this.syncGanttSize(); }

    /* The one dialog that edits the settings the app reads; what it writes is
     * re-read here, so nothing needs a restart. The rows are rebuilt only when
     * there is a plan to rebuild -- the settings are also the app's, and Tools
     * is a menu that a window with nothing open still has. */
    ActSettings_Execute() {
        SettingsForm.open(() => {
            this.applySettings();
            if (this.holder) this.fill(this.selectedUID);
        });
    }

    /* The chart as a file to send: PNG by the dialog's filter, PDF when the
     * name says so, at the chart's own size so nothing is cropped. */
    ActExport_Execute() {
        const base = File.BaseName(this.path) || "gantt";
        Dialog.SaveFile(Locale.Text("Export the chart"),
            { Folder: Settings.Get("bintana-project.folder", File.Directory(this.path)),
              Name: `${base}-gantt.png`,
              Filters: [[Locale.Text("PNG image"), "*.png"],
                        [Locale.Text("PDF document"), "*.pdf"]] },
            (path) => {
                try {
                    this.saveChart(path, File.IsExtension(path, "pdf"));
                    this.log(`Exported ${path}.`);
                } catch (e) {
                    Message.Error("Cannot save {0}: {1}", path, e.message);
                }
            });
    }

    /* The chart as a file: the whole plan from its first row, and the names in
     * a gutter, because what the user gets is a picture and not a window with
     * a list in it. The flag is around the `Save`, which runs the same `Draw`
     * synchronously -- so the pane on screen is not the thing being written. */
    saveChart(path, pdf) {
        const width  = Math.max(Math.round(this.Gantt.Width), GUTTER + 64);
        const height = this.fileHeight();
        const was    = this.chartFile;
        this.chartFile = true;
        try {
            if (pdf) this.Gantt.SavePdf(path, width, height);
            else this.Gantt.Save(path, width, height);
        } finally {
            this.chartFile = was;
            this.redrawChart();
        }
    }


    /* Auto fits the view; the rest set a day width and let the scroller show
     * what does not fit. */
    CmbScale_Select() {
        const combo = this.CmbScale;
        if (!combo) return;        // the event fires while the form is built
        /* "Custom" is what the zoom slider leaves: the width it set stays. */
        if (combo.Index >= SCALES.length) return;
        /* By index, not by text: the combo's items are translated. */
        const scale = SCALES[combo.Index] || null;
        this.dayW = scale ? scale.dayW : null;
        this.step = scale ? scale.step : 0;
        this.syncGanttSize();
        if (this.settingsReady)
            Settings.Set("bintana-project.timescale", combo.Index);
    }

    /* --- copy and paste -------------------------------------------------- */

    /* Ctrl+C, Ctrl+X and Ctrl+V on the list or the chart, which is where the
     * key comes from: a key typed in a field of the panel is the field's own. */
    rowKey(key, ctrl) {
        if (!ctrl || !this.holder) return false;
        const k = String(key).toLowerCase();
        if (k === "c") { this.ActCopy_Execute(); return true; }
        if (k === "x") { this.ActCut_Execute(); return true; }
        if (k === "v") { this.ActPaste_Execute(); return true; }
        return false;
    }

    Tasks_KeyPress(key, ctrl, shift, alt) {
        if (this.rowKey(key, ctrl)) return true;
        if (!this.holder || !this.Tasks) return false;

        /* **The grid's keys, as Project answers them in the sheet**: Enter
         * down, Tab right, Shift+Tab left, Insert a task above this one and
         * Delete the selected one. The move keys are the same the cell's own
         * commit reports, so the bar and the cell move the same way. */
        const k = String(key);
        if (k === "Return" || k === "KP_Enter" || k === "ISO_Enter") {
            this.moveCell("down");
            return true;
        }
        if (k === "Tab" || k === "KP_Tab" || k === "ISO_Left_Tab") {
            this.moveCell(k === "ISO_Left_Tab" || shift ? "left" : "right");
            return true;
        }
        if (k === "Insert") { this.ActAdd_Execute(); return true; }
        if (k === "Delete") { this.ActDelete_Execute(); return true; }
        return false;
    }

    /* The selected task and what hangs from it, twice: as data kept here, for a
     * paste that is exact -- links, assignments, outline -- and as tab-separated
     * text on the clipboard, which is what a spreadsheet takes. */
    ActCopy_Execute() {
        const task = this.selectedTask();
        if (!task || !this.edit) return;
        const clip = this.edit.copyTasks(this.selectedUIDs());
        if (!clip) {
            Message.Warning("The project summary cannot be copied.");
            return;
        }
        const lines = [];
        for (const data of clip.tasks) {
            const live = this.byUID[String(data.UID)];
            if (live) lines.push(this.cells(live).join("\t"));
        }
        clip.text = lines.join("\n");
        this.clip = clip;
        Clipboard.Copy(clip.text);
        this.log(Locale.Text("Copied {0} tasks.", clip.tasks.length));
    }

    /* **Cut**: the copy, and the tasks gone in the same breath -- one undo,
     * and Paste puts them back above the row chosen next, which is how a
     * block is moved in Project. The links between the cut tasks travel
     * with them; the ones to the rest of the plan go, as a deletion's do. */
    ActCut_Execute() {
        const task = this.selectedTask();
        if (!task || !this.edit) return;
        /* A copy refused (only the project summary) must not delete what an
         * older copy named. */
        this.clip = null;
        this.ActCopy_Execute();
        if (!this.clip) return;
        this.edit.removeTask(this.selectedUIDs());
        this.fill(null);
        this.log(Locale.Text("Cut {0} tasks.", this.clip.tasks.length));
    }

    /* What is on the clipboard goes in above the selected task: this window's
     * own copy when the text is the one it put there, otherwise one task a line
     * -- the name first and, when the list shows a duration column, a duration
     * from the same place. */
    ActPaste_Execute() {
        if (!this.edit) return;
        Clipboard.Paste((text) => {
            if (!this.edit || !text) return;
            const after = this.selectedUID;
            const first = this.clip && text === this.clip.text
                ? this.edit.pasteTasks(this.clip, after)
                : this.edit.pasteLines(this.linesOf(text), after);
            if (first) this.fill(first.UID);
        });
    }

    linesOf(text) {
        const cols   = this.tableColumns();
        const nameAt = cols.indexOf("name");
        const at     = cols.indexOf("duration");
        const items = [];
        for (const line of String(text).split(/\r?\n/)) {
            const cells = line.split("\t");
            /* A whole row of the table is read in its order; a shorter line
             * -- typed, or from a sheet -- starts at the name. */
            const from = cells.length >= cols.length ? 0 : nameAt;
            const name = (cells[nameAt - from] || "").trim();
            if (!name) continue;
            const item = { Name: name };
            const typed = at - from >= 0 ? (cells[at - from] || "").trim() : "";
            const duration = typed
                ? parseDuration(typed, 7, this.unit, this.holder.project) : null;
            if (duration) {
                item.Duration = mspdiDuration(duration.minutes);
                item.DurationFormat = duration.format;
                item.Estimated = duration.estimated;
            }
            items.push(item);
        }
        return items;
    }

    /* --- the outline and the timescale ---------------------------------- */

    ActExpandAll_Execute()   { this.Tasks.ExpandAll();   this.redrawChart(); }
    ActCollapseAll_Execute() { this.showLevel(1); }
    ActLevel1_Execute()      { this.showLevel(1); }
    ActLevel2_Execute()      { this.showLevel(2); }
    ActLevel3_Execute()      { this.showLevel(3); }

    /* The outline shown down to a level: the project summary open, every
     * summary at that level or deeper closed, the ones above it open. The
     * chart follows by the same road a fold by hand does. */
    showLevel(level) {
        if (!this.holder) return;
        this.Tasks.ExpandAll();
        for (const task of this.holder.project.Tasks) {
            const key = String(task.UID);
            if (task.IsNull || !task.Summary || !this.Tasks.Exists(key)) continue;
            if (task.OutlineLevel >= level) this.Tasks.CollapseNode(key);
        }
        this.redrawChart();
    }

    /* The width a day has when the chart fits the window. */
    fitDayW() {
        const range = this.chartRange();
        if (!range) return null;
        const view = this.GanttScroll ? this.GanttScroll.Bounds().Width : 0;
        const days = (range.to - range.from) / DAY_MS;
        return days > 0 && view > PAD + 8 ? (view - PAD - 8) / days : 10;
    }

    /* The slider is the zoom on a log scale, so the same stretch of it is the
     * same factor anywhere. It follows whatever sets the width -- a preset, a
     * step, the window -- and `zoomSync` keeps that from being heard as the
     * user moving it. */
    syncZoom() {
        if (!this.SldZoom) return;
        const dayW = this.dayW || this.fitDayW();
        if (!dayW) return;
        const at = 100 * Math.log(dayW / ZOOM_MIN) / Math.log(ZOOM_MAX / ZOOM_MIN);
        this.zoomSync = true;
        try { this.SldZoom.Value = Math.round(Math.min(Math.max(at, 0), 100)); }
        finally { this.zoomSync = false; }
    }

    SldZoom_Change() {
        if (this.zoomSync || !this.holder) return;
        this.setZoom(ZOOM_MIN * Math.pow(ZOOM_MAX / ZOOM_MIN, this.SldZoom.Value / 100));
    }

    /* A width of the user's own: the combo says so rather than keep a preset
     * that is no longer true. */
    setZoom(dayW) {
        this.dayW = Math.min(Math.max(dayW, ZOOM_MIN), ZOOM_MAX);
        this.step = 0;
        this.CmbScale.Index = SCALES.length;
        this.syncGanttSize();
    }

    /* A step of zoom is a factor, so the same number of presses goes the same
     * distance at any scale. From Fit to window it starts from the width a day
     * has there. */
    zoom(factor) {
        const from = this.dayW || this.fitDayW();
        if (from) this.setZoom(from * factor);
    }

    ActZoomIn_Execute()  { this.zoom(1.5); }
    ActZoomOut_Execute() { this.zoom(1 / 1.5); }

    ActZoomFit_Execute() {
        this.CmbScale.Index = 0;
        this.CmbScale_Select();
    }

    /*
     * **Scroll to Task**, as Project has it (Ctrl+Shift+F5): the chart moves
     * sideways to where the chosen task starts. Choosing a row does not do it
     * by itself -- a chart that jumped at every arrow key would take away the
     * dates the reader was comparing against -- so it is a command, asked for.
     * The bar lands a little in from the left edge, a day's width at most, so
     * it is seen to start rather than cut by the edge; a task longer than the
     * pane shows its start. A task with no dates has nowhere to go to.
     */
    ActScrollToTask_Execute() {
        const task = this.byUID && this.selectedUID !== null
                   ? this.byUID[String(this.selectedUID)] : null;
        const start = task ? whenMs(task.Start) : null;
        if (start === null || !this.GanttScroll) return false;
        const g = ganttGeometry(this.chartRows(), this.ganttWidth(),
                                this.ganttHeight(), this.step, this.planGeom());
        if (!g.range) return false;
        const view = this.GanttScroll.Bounds().Width || 0;
        const margin = Math.min(Math.max(g.dayW, 16), 48, view / 3);
        const left = g.x(start) - (task.Milestone ? g.msR : 0) - margin;
        this.GanttScroll.ScrollX = Math.max(0, Math.round(left));
        return true;
    }

    /* --- editing ------------------------------------------------------- */

    /* **One cell, typed**: what the table's `CellEdit` is answered with. The
     * column is read by its index in the table -- 0 is the name, which the
     * tree does not list among the columns -- and the text is what the cell's
     * own gesture produced: what was typed, the item a combo picked, the day a
     * calendar chose, or what a tick turned into. What comes back is either
     * the fields the command writes -- with `answer`, the spelling the cell
     * should keep when that is not the text -- or the sentence that refuses
     * them. A refusal answers `false` to the runtime, which puts the cell
     * back: nothing is written and nothing is remembered.
     *
     * The fields are the panel's own and so are the parsers. A summary takes
     * its dates and duration from its children: its cells are shut in `fill`,
     * and this refuses the same list if a text arrives anyway. The `◆` a
     * milestone wears is the row's decoration and comes off the name; a bare
     * day -- what the calendar beside a `Date` cell picks -- takes the plan's
     * own default time for what it is; and a custom field goes through
     * `setFieldValue`, whose business the `FieldID` and the `ValueGUID`
     * pointer are -- not a cell's.
     */
    cellValues(task, id, text) {
        if (id === "name") {
            const name = task.Milestone && text.indexOf("◆ ") === 0
                       ? text.slice(2) : text;
            return { values: { Name: name } };
        }

        if (id.indexOf(FIELD_COLUMN) === 0)
            /* A list field's combo offers `None` to take the value out, as the
             * panel's does; a text one never shows it. */
            return { field: id.slice(FIELD_COLUMN.length),
                     value: text === Locale.Text("None") ? "" : text };

        if (task.Summary && SUMMARY_SHUT.indexOf(id) >= 0)
            return { refused: Locale.Text("A summary takes its dates, duration and completion from its children.") };

        switch (id) {
        case "duration": {
            const duration = parseDuration(text, task.DurationFormat, this.unit,
                                            this.holder.project);
            if (duration === null)
                return { refused: Locale.Text("{0} is not a duration -- try 2d, 8h or 30m", text) };
            const values = { Duration: mspdiDuration(duration.minutes),
                             DurationFormat: duration.format,
                             Estimated: duration.estimated };
            /* The finish follows from the start, as a pass would put it. */
            const slid = task.Start ? typedDates(this.holder.project, task, "Start",
                task.Start, duration.minutes, duration.format) : null;
            if (slid) values.Finish = slid.Finish;
            return { values, answer: durationText(values, this.holder.project) };
        }
        case "start":
            return this.momentPin("Start", CONSTRAINT_SNET, text, task,
                this.holder.project.DefaultStartTime || "08:00:00");
        case "finish":
            return this.momentPin("Finish", CONSTRAINT_FNET, text, task,
                this.holder.project.DefaultFinishTime || "17:00:00");
        case "deadline":
            return this.momentValues("Deadline", text,
                this.holder.project.DefaultFinishTime || "17:00:00");
        case "predecessors":
            return this.linkValues(task, text, "ID");
        case "wbspreds":
            return this.linkValues(task, text, "WBS");
        case "resources": {
            const parsed = parseResourceNames(text);
            if (parsed.refused)
                return { refused: Locale.Text("{0} is not a resource -- try Ana; Bruno[50%]",
                                              parsed.refused) };
            return { resources: parsed.resources };
        }
        case "percent": {
            const m = /^\s*(\d+(?:[.,]\d+)?)\s*%?\s*$/.exec(String(text || ""));
            const percent = m ? Math.round(Number(m[1].replace(",", "."))) : NaN;
            if (!m || !(percent >= 0 && percent <= 100))
                return { refused: Locale.Text("{0} is not a percentage -- 0 to 100", text) };

            /* The percentage moves the actual dates the way the progress
             * buttons move them (`percentValues`). */
            return { values: percentValues(task, percent), answer: `${percent}%` };
        }
        case "priority": {
            const m = /^\s*(\d+)\s*$/.exec(String(text || ""));
            const priority = m ? Number(m[1]) : NaN;
            if (!m || priority > 1000)
                return { refused: Locale.Text("{0} is not a priority -- 0 to 1000", text) };
            return { values: { Priority: priority } };
        }
        case "milestone": {
            const on = text === "◆";
            return { values: { Milestone: on }, answer: on ? "◆" : "" };
        }
        case "calendar":
            if (text === Locale.Text("Project default"))
                return { values: { CalendarUID: -1 } };
            for (const calendar of this.holder.project.Calendars)
                if (calendar.Name === text)
                    return { values: { CalendarUID: calendar.UID } };
            return { refused: Locale.Text("{0} is not a calendar of the plan", text) };
        case "type": {
            const at = this.CmbTaskType.Items.indexOf(text);
            if (at < 0)
                return { refused: Locale.Text("{0} is not a task type", text) };
            return { values: { Type: at } };
        }
        case "notes": return { values: { Notes: text } };
        }
        return null;
    }

    /* A typed moment, or the sentence that refuses it: `parseMoment` keeps
     * anything it does not know as text for the field to refuse, and a cell
     * wants the sentence where the reader is looking instead of a value that
     * throws somewhere else. **A bare day takes `time`** -- the plan's default
     * for the field -- because that is what the calendar beside a `Date` cell
     * hands over, and a start at midnight would be an invented moment. */
    momentValues(field, text, time) {
        const moment = parseMoment(text, time);
        if (moment !== "" &&
            !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/.test(moment))
            return { refused: Locale.Text("{0} is not a date -- try 2026-10-01 08:00", text) };

        const values = {};
        values[field] = moment;
        return { values, answer: shortDate(moment) };
    }

    /* **A date typed by hand is a constraint**, as it is in Project: writing a
     * start leaves a Start No Earlier Than and writing a finish a Finish No
     * Earlier Than, dated at what was typed (a finish on a day off, at the
     * working day before it) -- so the pass puts the task where the hand did
     * and not back where its links had it. A manual task is not
     * pinned: no pass moves it. **What follows is `typedDates`'s**: the other
     * end, or the duration and the percentage, so the three agree whether or
     * not a pass runs after. A value the task already had pins nothing, and
     * clearing a date is not a date to pin. */
    momentPin(field, type, text, task, time) {
        const written = this.momentValues(field, text, time);
        if (!written.values || written.values[field] === task[field] ||
            written.values[field] === "")
            return written;

        const minutes = mspdiMinutes(task.Duration) || 0;
        const dates = typedDates(this.holder.project, task, field,
                                 written.values[field], minutes,
                                 task.DurationFormat);
        if (!dates) return written;
        if (dates.refused) return { refused: Locale.Text(dates.refused) };

        const values = written.values;
        if (dates.pin) {
            values.ConstraintType = type;
            values.ConstraintDate = dates.pinAt;
        }
        values.Start  = dates.Start;
        values.Finish = dates.Finish;
        if (dates.minutes !== minutes) values.Duration = mspdiDuration(dates.minutes);
        if (dates.ActualStart !== undefined) values.ActualStart = dates.ActualStart;
        if (dates.firm) values.Estimated = false;
        if (dates.percent !== undefined) {
            const moved = percentValues({ Start: dates.Start, Finish: dates.Finish,
                                          ActualStart: task.ActualStart,
                                          ActualFinish: task.ActualFinish },
                                        dates.percent);
            for (const name in moved) values[name] = moved[name];
        }
        return { values, answer: shortDate(dates[field]) };
    }

    /* **The Predecessors cell, parsed whole**: `UID[TYPE][+/-lag]`, several
     * separated by commas -- `3FS+2d, 7SS`. A link with no letters is
     * finish-to-start, and a bare lag is in days; what is typed replaces the
     * task's links in one command. Anything the engine refuses -- a task that
     * is not there, a loop, a summary and its own branch -- refuses the cell
     * with the reason, and the cell goes back to what it said. */
    linkValues(task, text, by) {
        const links = [];

        for (const part of String(text || "").split(",")) {
            const item = part.trim();
            if (!item) continue;

            const found = this.predecessorIn(item, by);
            if (found.missing === null)
                return { refused: Locale.Text('"{0}" is not a predecessor -- try 3FS+2d', item) };
            if (found.missing !== undefined)
                return { refused: Locale.Text("There is no task {0}.", found.missing) };
            const { pred, m } = found;
            const uid = pred.UID;

            const type = m[1] ? linkLetters()[m[1].toUpperCase()] : 1;
            const old  = task.Links.find((l) => l.PredecessorUID === uid);

            let lag = 0, format = old && old.LagFormat && !isPercentLagFormat(old.LagFormat)
                                ? old.LagFormat : 7;
            let linkLag = null;
            if (m[3] && /%$/.test(m[4] || "")) {
                /* A share of the predecessor, kept as the percentage
                 * itself -- what Project writes for `+50%`. */
                linkLag = (m[2] === "-" ? -1 : 1) * Math.round(Number(m[3].replace(",", ".")));
                format  = /^e/i.test(m[4]) ? 20 : 19;
            } else if (m[3]) {
                const duration = parseDuration(m[3] + (m[4] || "").toLowerCase(), format, "", this.holder.project);
                if (duration === null)
                    return { refused: Locale.Text("{0} is not a duration -- try 2d, 8h or 30m", m[3]) };
                lag    = (m[2] === "-" ? -1 : 1) * duration.minutes;
                format = duration.format;
            }

            const problem = this.edit.linkProblem(uid, task.UID, type);
            if (problem) return { refused: Locale.Text(problem) };

            const link = new MspLink({ PredecessorUID: uid, Type: type,
                                       LinkLag: linkLag !== null ? linkLag
                                                                 : Math.round(lag * 10),
                                       LagFormat: format });
            const kept = links.findIndex((l) => l.PredecessorUID === uid);
            if (kept >= 0) links[kept] = link; else links.push(link);
        }
        return { links };
    }

    /* **One predecessor as typed, named the way the column names it**: by
     * `ID` (the row, Project's *Predecessors*) or by `WBS` (its *WBS
     * Predecessors*). A code is not split on its shape -- `B-7` is a code
     * and `3-1d` a lag -- but looked up: the longest number or code of the
     * plan the text starts with whose remainder reads as a type and a lag.
     * Answers `{ pred, m }` (m: type, sign, amount, unit), or `missing` with
     * what was named, or `missing: null` when it does not read at all. */
    predecessorIn(item, by) {
        const keyOf = (t) => (t[by] === undefined || t[by] === null) ? "" : String(t[by]);
        const candidates = this.holder.project.Tasks
            .filter((t) => !t.IsNull && keyOf(t) && item.indexOf(keyOf(t)) === 0)
            .sort((a, b) => keyOf(b).length - keyOf(a).length);
        for (const pred of candidates) {
            const m = linkRest(item.slice(keyOf(pred).length));
            if (m) return { pred, m };
        }

        if (by === "ID") {
            const m = /^(\d+)(.*)$/.exec(item);
            return { missing: m && linkRest(m[2]) ? m[1] : null };
        }
        /* An unknown code ends where a type or a lag with its unit begins. */
        for (let end = 1; end <= item.length; end++) {
            const rest = item.slice(end);
            const m = linkRest(rest);
            if (m && (!rest || m[1] || /^\s*([+]|-\s*\d+(?:[.,]\d+)?\s*e?(mo|m|h|d|w|%)\s*$)/i.test(rest)))
                return { missing: item.slice(0, end).trim() };
        }
        return { missing: null };
    }

    /* The cell left its editing state -- Enter, the focus moving away, a day
     * or an item picked, a tick turned. **The entry bar follows the cell**: it
     * is recorded here and in `Tasks_CellEditor`, so the bar shows what was
     * edited even when the edit is refused. **And the move-on keys move the
     * cell**, which is why the runtime says how the edit ended: Enter down, Tab
     * right, Shift+Tab left. A refusal stays where it was -- that is the cell
     * the reader has to fix -- and so does a day or an item picked. */
    Tasks_CellEdit(key, column, text, how) {
        this.rememberCell(key, column);
        const answer = this.applyCell(String(key), column, text);

        if (answer !== false) {
            if (how === "enter") this.moveCell("down");
            else if (how === "tab") this.moveCell("right");
            else if (how === "shift-tab") this.moveCell("left");
        }
        return answer;
    }

    /* One cell, one command -- what the table's commit and the entry bar both
     * call: the same `setFields` the panel's Apply uses, so an edit is one undo
     * wherever it is typed, and the recalculation setting is the one `commit`
     * already reads. **`written.answer` is what the cell keeps** when it is
     * there -- the canonical spelling, so a percent stays a percent and a
     * duration keeps its unit. */
    applyCell(key, column, text) {
        const task = this.byUID ? this.byUID[key] : null;
        if (!task || !this.edit) return false;

        const id = this.tableColumns()[column];
        const written = id ? this.cellValues(task, id, text) : null;
        if (!written) return false;

        if (written.refused) {
            Message.Error(written.refused);
            return false;
        }

        /* A whole list of links is its own command: `setLinks` is the one the
         * panel's Link button and the chart's drag call. */
        if (written.links !== undefined) {
            if (this.edit.setLinks(task.UID, written.links))
                this.fill(task.UID);
            return true;
        }

        /* So is the list of resources: `setTaskResources` makes the ones the
         * plan does not have and assigns the rest, as one step. */
        if (written.resources !== undefined) {
            if (this.edit.setTaskResources(task.UID, written.resources))
                this.fill(task.UID);
            return true;
        }

        if (written.field !== undefined) {
            if (this.edit.setFieldValue(task.UID, written.field, written.value))
                this.fill(task.UID);
            return true;
        }

        /* The setters validate; a bad value throws before anything is
         * committed -- the same probe the panel's Apply makes, on the same
         * fields. */
        try {
            const probe = new MspTask();
            for (const name in written.values) probe[name] = written.values[name];
        } catch (e) {
            Message.Error("Cannot apply: {0}", e.message);
            return false;
        }

        if (this.edit.setFields(task.UID, written.values))
            this.fill(task.UID);
        return written.answer !== undefined ? written.answer : true;
    }

    /* The current cell, as the entry bar knows it: the row's key and the
     * column's **id**, which survives a column being hidden or moved -- an
     * index would name another column the moment the view changes. */
    rememberCell(key, column) {
        const id = this.tableColumns()[column];

        if (id && this.byUID && this.byUID[String(key)])
            this.cell = { key: String(key), id };
        this.showEntry();
    }

    /* Where the bar's column is in the table *now*: -1 when it is not shown,
     * which is a cell there is nothing to edit. */
    entryColumn(id) {
        return this.tableColumns().indexOf(id);
    }

    /* **The cell's value in the bar Project keeps above the sheet**: the whole
     * text of the cell the last edit opened -- a long name, a list of links --
     * as the spelling an edit of it parses, so what is typed here goes through
     * the same one command. A cell the plan derives in a summary is shown and
     * not edited, as the cell itself is. */
    showEntry() {
        const cell = this.cell;
        const task = cell && this.byUID ? this.byUID[cell.key] : null;
        const at   = cell ? this.entryColumn(cell.id) : -1;

        if (!task || at < 0) {
            this.LblEntry.Text    = "";
            this.TxtEntry.Text    = "";
            this.TxtEntry.Enabled = false;
            return;
        }

        const column  = COLUMNS.find((c) => c.id === cell.id);
        const heading = cell.id === "name" ? Locale.Text("Task")
                      : column ? Locale.Text(column.Text)
                      : fieldLabel(this.columnField(cell.id));

        this.LblEntry.Text    = heading;
        this.TxtEntry.Text    = this.Tasks.Cell(cell.key, at);
        this.TxtEntry.Enabled = !(task.Summary && SUMMARY_SHUT.indexOf(cell.id) >= 0);
    }

    /* Enter in the bar: the same parse and the same command as the cell, and
     * the bar comes back with what the cell says now. */
    TxtEntry_Activate() {
        const cell = this.cell;
        if (!cell || !this.TxtEntry.Enabled) return false;
        return this.applyCell(cell.key, this.entryColumn(cell.id), this.TxtEntry.Text);
    }

    /* Escape puts the cell's value back, as it does in a cell. */
    TxtEntry_KeyPress(key, ctrl, shift, alt) {
        if (String(key).toLowerCase() !== "escape") return false;
        this.showEntry();
        return true;
    }

    /* **An edit is about to begin**: the items of a cell that is a choice, or
     * the dialog a `Custom` cell opens. Every other kind is the column's own
     * and the answer is nothing -- which is what "the declaration decides"
     * means. The lists are the plan's, built per edit so a calendar added
     * since the table was drawn is in the combo. */
    Tasks_CellEditor(key, column) {
        const task = this.byUID ? this.byUID[String(key)] : null;
        const id   = this.tableColumns()[column];
        if (!task || !id) return false;

        /* An edit is about to begin: this is the cell the bar shows. */
        this.rememberCell(key, column);

        if (id === "calendar") return { Items: this.calendarItems() };
        if (id === "type")     return { Items: this.CmbTaskType.Items };

        if (id.indexOf(FIELD_COLUMN) === 0) {
            const def  = this.edit.fieldDef(id.slice(FIELD_COLUMN.length));
            const list = def ? def.ValueList || [] : [];
            if (list.length)
                return { Kind: "Combo",
                         Items: [Locale.Text("None")].concat(list.map((e) => e.Value)) };
            return undefined;
        }

        if (id === "constraint") {
            this.openConstraint(task);
            return undefined;
        }
        return undefined;
    }

    /* The calendars a task may name, with the plan's own in front: the same
     * list the panel's combo offers, so the two cannot disagree. */
    calendarItems() {
        const items = [Locale.Text("Project default")];
        for (const calendar of this.holder.project.Calendars)
            items.push(calendar.Name);
        return items;
    }

    /* The constraint's two halves -- the type and, for the six that need one,
     * the date -- in one dialog, because one cell cannot hold both. Its OK is
     * one command like any other edit, and the check it runs before closing is
     * the date's shape: what the runtime refuses is the dialog's, not a second
     * copy of it here. */
    openConstraint(task) {
        const startTime = () => this.holder.project.DefaultStartTime || "08:00:00";

        ConstraintForm.open(
            this.CmbConstraint.Items,
            task.ConstraintType > 0 ? task.ConstraintType : 0,
            shortDate(task.ConstraintDate),
            (type, text) => {
                const date = type > 1 ? parseMoment(text, startTime()) : "";
                if (this.edit.setFields(task.UID,
                                        { ConstraintType: type, ConstraintDate: date }))
                    this.fill(task.UID);
            },
            (type, text) => {
                if (type <= 1) return "";
                if (String(text || "").trim() === "")
                    return Locale.Text("A constraint of that type needs a date.");
                const moment = parseMoment(text, startTime());
                return /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/.test(moment)
                     ? "" : Locale.Text("{0} is not a date -- try 2026-10-01 08:00", text);
            });
    }

    /* Read the panel, validate against a scratch record so a bad value cannot
     * half-apply, then one command -- one undo for one Apply. */
    applyFields() {
        const task = this.selectedTask();
        if (!task) return false;

        /* One read for the panel and the dialog: the same controls by name,
         * the same refusals, the same values. */
        const values = taskFormValues(this, task, this.holder.project, this.unit);
        if (!values) return false;

        this.edit.setFields(task.UID, values);
        this.fill(task.UID);
        return true;
    }

    BtnApply_Click() { this.applyFields(); }

    /* **Información de la tarea**, the door Project opens with a double click:
     * the panel's Task and Advanced pages over the window, OK writing them as
     * one command like Apply. Links and assignments stay in the panel. */
    ActTaskInfo_Execute() {
        const task = this.selectedTask();
        if (!task) return null;

        return TaskForm.open(this.holder.project, task, this.unit,
                             (values, links, ops) => {
            if (this.edit.applyTask(task.UID, values, links, ops))
                this.fill(task.UID);
        });
    }

    /* **Apply is the panel's and not a page's**: it sits under the tabs, out
     * of what scrolls, and means something only for the two pages that edit
     * the task's fields -- links and assignments are written where they are
     * made -- so it goes away on the others. */
    PropsTabs_Switch(index) {
        /* The switcher announces its first page while the form is still being
         * built, before the bar below it exists; that page shows Apply anyway. */
        if (!this.ApplyBar) return;
        this.ApplyBar.Visible = index === 0 || index === 1;
    }

    ActAdd_Execute() {
        const added = this.edit.addTask(this.selectedUID);
        this.fill(added.UID);
    }

    ActAddMilestone_Execute() {
        const added = this.edit.addMilestone(this.selectedUID);
        this.fill(added.UID);
    }

    /* The summary goes over the selected tasks, which end up under it. */
    ActAddSummary_Execute() {
        const added = this.edit.addSummary(this.selectedUIDs());
        this.fill(added.UID);
    }

    ActDelete_Execute() {
        const task = this.selectedTask();
        if (!task) return;
        /* The project summary is the whole plan; `removeTask` refuses it,
         * and asking first would promise something it will not do. */
        const uids = this.selectedUIDs().filter((uid) => this.byUID[String(uid)].OutlineLevel > 0);
        if (!uids.length) {
            Message.Warning("The project summary cannot be deleted.");
            return;
        }
        const question = uids.length === 1
            ? Locale.Text('Delete "{0}"?', this.byUID[String(uids[0])].Name)
            : Locale.Text("Delete the {0} selected tasks?", uids.length);
        ConfirmForm.ask(Locale.Text("Delete task"), question,
            Locale.Text("Delete"), () => {
                this.edit.removeTask(uids);
                this.fill(null);
            });
    }

    /* **Link and Unlink over the selection**, Project's Ctrl+F2 and
     * Ctrl+Shift+F2: a chain finish-to-start in plan order, and the links
     * the selection has (or between its tasks, when there are several). */
    ActLink_Execute() {
        const uids = this.selectedUIDs();
        if (uids.length < 2) {
            Message.Warning("Select two or more tasks to link them.");
            return;
        }
        const drawn = this.edit.linkTasks(uids);
        this.fill(this.selectedUID);
        this.reselect(uids);
        this.log(Locale.Plural("{0} link drawn.", "{0} links drawn.", drawn));
    }

    ActUnlink_Execute() {
        const uids = this.selectedUIDs();
        if (!uids.length) return;
        const gone = this.edit.unlinkTasks(uids);
        this.fill(this.selectedUID);
        this.reselect(uids);
        this.log(Locale.Plural("{0} link removed.", "{0} links removed.", gone));
    }

    /* The progress buttons: every selected task (a summary, every task in
     * it) at that percentage, in one step. */
    setProgress(percent) {
        const uids = this.selectedUIDs();
        if (!uids.length || !this.edit.setPercent(uids, percent)) return;
        this.fill(this.selectedUID);
        this.reselect(uids);
    }
    ActPct0_Execute()   { this.setProgress(0); }
    ActPct25_Execute()  { this.setProgress(25); }
    ActPct50_Execute()  { this.setProgress(50); }
    ActPct75_Execute()  { this.setProgress(75); }
    ActPct100_Execute() { this.setProgress(100); }

    ActIndent_Execute()  { this.nudge(1); }
    ActOutdent_Execute() { this.nudge(-1); }

    nudge(delta) {
        const task = this.selectedTask();
        if (!task) return;
        const uids = this.selectedUIDs();
        if (!this.edit.indent(uids, delta)) return;
        this.fill(task.UID);
        this.reselect(uids);
    }

    /* Up and Down swap the task with its sibling, subtree and all. */
    ActUp_Execute()   { this.move(-1); }
    ActDown_Execute() { this.move(1); }

    move(delta) {
        const task = this.selectedTask();
        if (!task) return;
        const uids = this.selectedUIDs();
        if (!this.edit.moveTask(uids, delta)) return;
        this.fill(task.UID);
        this.reselect(uids);
    }

    /* The plan-wide command: place every task from its links. It is one undo
     * and it says how many it placed. */
    ActRecalc_Execute() {
        const result = this.edit.recalculate();
        if (!result.placed) {
            Message.Warning("Nothing to schedule: the project has no start date.");
            return;
        }
        const project = this.holder.project;
        const tasks = project.Tasks;
        const critical = tasks.filter((t) => !t.IsNull && t.Critical).length;
        const over = project.Resources.filter(
            (r) => !r.IsNull && r.UID !== 0 && r.MaxUnits > 0 &&
                   resourcePeak(project, r) > r.MaxUnits).length;
        const late = tasks.filter((t) => {
            const deadline = t.Deadline ? whenMs(t.Deadline) : null;
            const finish   = t.Finish ? whenMs(t.Finish) : null;
            return deadline !== null && finish !== null && finish > deadline;
        }).length;
        this.fill(this.selectedUID);
        if (!result.changed) {
            this.log(Locale.Text("Recalculated: nothing moved."));
            return;
        }
        this.log(`Recalculated ${result.placed} tasks, ${critical} critical` +
                 (late ? `, ${late} past deadline` : "") +
                 (over ? `, ${over} over-allocated` : "") +
                 (result.notMet
                    ? `, ${result.notMet} constraints not met` : "") +
                 (result.skipped
                    ? `, ${result.skipped} kept (ALAP)`
                    : "") + ".");
    }

    /* A link picked in the table: its values go into the fields, so Link
     * updates that predecessor instead of adding a second link to it. */
    Links_Select() {
        const link = this.Links.Index >= 0 ? this.linkRows[this.Links.Index] : null;
        this.BtnLinkDel.Enabled = !!link;
        if (!link) return;
        const at = this.predChoices.indexOf(link.PredecessorUID);
        /* A predecessor the combo does not offer (a summary) leaves it on the
         * placeholder, not on the last row's, so Link cannot rewrite that one. */
        this.CmbPred.Index = Math.max(at, 0);
        this.CmbType.Index = LINK_INDEX[linkKind(link)];
        this.SpinLag.Value = linkLagMinutes(this.holder.project, link);
    }

    /* Link adds or updates the chosen predecessor; Unlink takes the selected
     * row's link out. Both are one undo through `setLinks`. */
    BtnLinkAdd_Click() {
        const task = this.selectedTask();
        if (!task) return;
        const at = this.CmbPred.Index;
        const predUID = at >= 0 ? this.predChoices[at] : null;
        if (predUID === null || predUID === undefined) {
            Message.Warning("Pick a predecessor first.");
            return;
        }
        if (this.putLink(task, predUID, this.CmbType.Index,
                         Math.round(this.SpinLag.Value * 10)))   // tenths of a minute
            this.fill(task.UID);
    }

    /* **One link per predecessor, added or updated**, for the panel and the
     * chart alike. The type is the combo's index, and index 2 is MSPDI's 0
     * (FF) -- so no `|| 1`, which made every FF link an FS. An update keeps
     * the unit the lag was shown in (`LagFormat`): the lag itself is always
     * tenths of a minute, and a 2-day lag must not come back as "960m". A
     * lag in percent is not kept as one: the field is minutes, and what it
     * holds now is the minutes the percentage came to. */
    putLink(task, predUID, index, lag) {
        const old = task.Links.find((l) => l.PredecessorUID === predUID);
        const links = task.Links.filter((l) => l.PredecessorUID !== predUID);
        links.push(new MspLink({
            PredecessorUID: predUID,
            Type: index >= 0 ? LINK_ORDER[index] : 1,
            LinkLag: lag,
            LagFormat: old && old.LagFormat && !isPercentLagFormat(old.LagFormat)
                     ? old.LagFormat : 3,
        }));
        return this.edit.setLinks(task.UID, links);
    }

    BtnLinkDel_Click() {
        const task = this.selectedTask();
        const link = this.Links.Index >= 0 ? this.linkRows[this.Links.Index] : null;
        if (!task || !link) return;
        const links = task.Links.filter((l) => l.PredecessorUID !== link.PredecessorUID);
        if (this.edit.setLinks(task.UID, links)) this.fill(task.UID);
    }

    /*
     * The plan as a document: a banded report of the tasks -- dates, duration,
     * progress, cost -- seen before it leaves, as a PDF or on paper. What it
     * carries and how is the dialog's (ReportForm), and the bands are
     * `planReport`'s (PlanReport.js).
     */
    ActReport_Execute() {
        if (!this.holder) return;
        this.reportForm = ReportForm.open(this.holder.project, this.path,
                                          (text) => this.log(text),
                                          { format: this.format, labelOf: this.labelOf(),
                                            calendar: this.chartCal || null });
    }

    /* The plan as it stands, kept so a later date can be compared with it: one
     * undo like any other command.
     *
     * **The number is an argument and the menu passes the current one.** It was
     * a combo in the side panel, next to a button that duplicated the menu item
     * beside it -- two controls for one line of work, on a tab that existed for
     * them. `setBaseline` was always ready to take any number; the dialog that
     * would ask for a different one is not here, and a parameter nobody passes
     * is not a control. */
    saveBaseline(number = 0) {
        this.edit.setBaseline(number);
        this.fill(this.selectedUID);
        this.log(Locale.Text("Baseline {0} saved.", number));
    }

    ActBaseline_Execute() {
        this.saveBaseline();
    }

    ActUndo_Execute() {
        const keep = this.selectedUID;
        if (this.edit.undo()) this.fill(keep);
    }

    ActRedo_Execute() {
        const keep = this.selectedUID;
        if (this.edit.redo()) this.fill(keep);
    }

    /* --- opening, saving and closing ------------------------------------ */

    ActOpen_Execute() {
        const folder = Settings.Get("bintana-project.folder",
                                    this.path ? File.Directory(this.path)
                                              : File.Join(Application.Directory,
                                                          "tests", "corpus"));
        Dialog.OpenFile(Locale.Text("Open Project XML"),
            { Folder: folder,
              Filters: [[Locale.Text("Project XML"), "*.xml"],
                        [Locale.Text("All files"), "*"]] },
            (path) => this.openFile(path));
    }

    ActQuit_Execute() { this.Close(); }

    ActSave_Execute() { this.save(); }

    ActSaveAs_Execute() {
        Dialog.SaveFile(Locale.Text("Save Project XML"),
            { Folder: File.Directory(this.path), Name: File.Name(this.path),
              Filters: [[Locale.Text("Project XML"), "*.xml"]] },
            (path) => this.save(path));
    }

    /* The one road that writes. It answers whether it wrote, so the close
     * question can keep the window when it did not.
     *
     * **A new name is the document's only once the file is written**: a Save
     * As that failed leaves the title, the next Ctrl+S and the autosave on the
     * file that still holds the plan. One that worked takes the old name's
     * autosave with it -- that work is saved now, under the new name -- and
     * goes to the recents like any file opened. */
    save(path = this.path) {
        try {
            writeMspdi(path, this.holder);
        } catch (e) {
            Message.Error("Cannot save {0}: {1}", path, e.message);
            return false;
        }
        this.dropAutosave();
        if (path !== this.path) {
            this.path = path;
            this.dropAutosave();
            if (this.settingsReady) {
                Settings.Set("bintana-project.folder", File.Directory(path));
                this.rememberRecent(path);
            }
        }
        this.edit.markSaved();
        this.updateTitle();
        this.log(`Saved ${this.path}.`);
        return true;
    }

    updateTitle() {
        const dirty = this.edit ? this.edit.dirty : false;
        this.Text = `${File.Name(this.path)}${dirty ? " •" : ""} — bintana-project`;
        this.ActUndo.Enabled = this.edit ? this.edit.canUndo : false;
        this.ActRedo.Enabled = this.edit ? this.edit.canRedo : false;
    }

    /* Closing with unsaved work asks first. The answer may be Save, Discard or
     * Cancel, which is why it is a form and not a `Message`. Returning `true`
     * keeps the window open while the question is answered. */
    Form_Close() {
        if (this.forceClose || !this.edit || !this.edit.dirty) return false;

        const name = File.Name(this.path);
        ConfirmForm.ask(Locale.Text("Unsaved changes"),
            Locale.Text("Save changes to {0} before closing?", name), Locale.Text("Discard"),
            () => { this.dropAutosave(); this.forceClose = true; this.Close(); },
            { Text: Locale.Text("Save"), Run: () => {
                if (this.save()) { this.forceClose = true; this.Close(); }
            } });
        return true;
    }

    /* --- the headless roads -------------------------------------------- */

    check() {
        const args = Application.Arguments;
        const i    = args.indexOf("check");
        const path = this.resolve(args[i + 1] ||
                                  File.Join("tests", "corpus", "01-minimal.xml"));
        const out  = args[i + 2] ? this.resolve(args[i + 2]) : Environment.TempDirectory;
        const ok   = this.checkFile(path, out);
        print(ok ? "CHECK-OK" : "CHECK-FAILED");
        Application.Quit(ok ? 0 : 1);
    }

    /*
     * The scheduling road, headless: a calendar and a handful of tasks whose
     * dates are worked out by hand, so the engine is held to arithmetic and
     * not to itself. Every line it prints is the assertion.
     */
    checkCpm() {
        let ok = true;
        const eq = (what, got, want) => {
            const same = got === want;
            print(`cpm ${what}: ${got}${same ? "" : ` (want ${want})`} ` +
                  `${same ? "ok" : "FAILED"}`);
            return same;
        };
        try {
            const week = [];
            for (let day = 1; day <= 7; day++) {
                const working = day >= 2 && day <= 6;
                week.push(new MspWeekDay({
                    DayType: day, DayWorking: working,
                    WorkingTimes: working ? [
                        new MspWorkingTime({ FromTime: "08:00:00", ToTime: "12:00:00" }),
                        new MspWorkingTime({ FromTime: "13:00:00", ToTime: "17:00:00" }),
                    ] : [],
                }));
            }
            const calendar = new MspCalendar({
                UID: 1, Name: "Test", IsBaseCalendar: true, WeekDays: week,
                Exceptions: [new MspException({
                    TimePeriod: new MspTimePeriod({
                        FromDate: "2026-09-08T00:00:00",
                        ToDate:   "2026-09-08T23:59:00" }),
                    Name: "Holiday", Type: 1, DayWorking: false,
                })],
            });
            const projectOf = (tasks) => new MspProject({
                StartDate: "2026-09-07T08:00:00", CalendarUID: 1,
                Calendars: [calendar], Tasks: tasks,
            });
            const task = (uid, duration, links, extra) => {
                const t = new MspTask({
                    UID: uid, ID: uid, Name: `T${uid}`, IsNull: false,
                    OutlineLevel: 1, Duration: duration, DurationFormat: 7,
                    CalendarUID: 1, Links: links || [],
                });
                for (const name in extra || {}) t[name] = extra[name];
                return t;
            };
            const link = (pred, type, lag) => new MspLink({
                PredecessorUID: pred, Type: type, LinkLag: lag || 0, LagFormat: 7 });

            /* **The calendar arithmetic does not care what day the clocks
             * change.** Each window crosses one zone's change -- New York falls
             * back on Nov 1, Madrid on Oct 25, Santiago springs forward on Sep 6
             * at midnight -- and the answers are the same in every zone, which
             * is why the harness runs this check under all three. A day stepped
             * as 24 hours spun on the 25-hour one and finished in 1970. */
            const wc = new WorkCalendar(projectOf([]), 1);
            const crossing = (from, want) => {
                const t0 = whenMs(from), t1 = wc.add(t0, 2400);
                return eq(`40h from ${from} in ${Environment.Get("TZ") || "local"}`,
                          [isoLocal(t1), wc.between(t0, t1), isoLocal(wc.subtract(t1, 2400))].join(" "),
                          `${want} 2400 ${from}`);
            };
            ok = crossing("2026-10-29T08:00:00", "2026-11-04T17:00:00") && ok;
            ok = crossing("2026-10-22T08:00:00", "2026-10-28T17:00:00") && ok;
            ok = crossing("2026-09-03T08:00:00", "2026-09-10T17:00:00") && ok;   // the 8th is a holiday

            /* **A lead is working time too**: 8h before Monday 10:00 is
             * Friday 10:00, where it used to be Monday 02:00. */
            ok = eq("a lead walks back over the weekend",
                    isoLocal(wc.add(whenMs("2026-09-14T10:00:00"), -480)),
                    "2026-09-11T10:00:00") && ok;

            /* The links' own arithmetic: a lead of a day, and an elapsed lag
             * of two days (`LagFormat` 8, "ed") that runs through the night
             * and the holiday instead of six working days. */
            const lead = projectOf([
                task(1, "PT16H0M0S"),                          // Mon + Wed
                task(2, "PT8H0M0S", [link(1, 1, -4800)]),      // a day early
            ]);
            recalculate(lead);
            ok = eq("an FS lead of a day", lead.Tasks[1].Start,
                    "2026-09-09T08:00:00") && ok;
            const ed = projectOf([
                task(1, "PT8H0M0S"),
                task(2, "PT8H0M0S", [new MspLink({ PredecessorUID: 1, Type: 1,
                                                   LinkLag: 28800, LagFormat: 8 })]),
            ]);
            recalculate(ed);
            ok = eq("an elapsed lag is clock time", ed.Tasks[1].Start,
                    "2026-09-10T08:00:00") && ok;

            /* **Both ends of the late dates bound each other**: C hangs off
             * A's start and is the longest thing in the plan, so A is
             * critical through its start even though B, after its finish,
             * has room. */
            const both = projectOf([
                task(1, "PT40H0M0S"),                          // A
                task(2, "PT8H0M0S",  [link(1, 1)]),            // B, FS
                task(3, "PT80H0M0S", [link(1, 3)]),            // C, SS
            ]);
            recalculate(both);
            ok = eq("an SS successor makes A critical",
                    [both.Tasks[0].Critical, both.Tasks[0].TotalSlack].join(" "),
                    "true 0") && ok;

            /* **Links to and from a summary.** A holds S back, so the leaves of
             * S start after A; B follows S, so it starts after the last leaf
             * -- in the same pass, not the one after: the summary is rolled up
             * when its leaves are placed, not at the end. A leaf's link to its
             * own summary is a loop and is ignored. */
            const level = (t, n, summary) => {
                t.OutlineLevel = n; t.Summary = !!summary; return t;
            };
            const nest = projectOf([
                level(task(1, "PT8H0M0S"), 1),                         // A, Mon
                level(task(2, "PT0S", [link(1, 1)]), 1, true),         // S after A
                level(task(3, "PT16H0M0S"), 2),                        // S1
                level(task(4, "PT8H0M0S", [link(2, 1)]), 2),           // S2, loop
                level(task(5, "PT8H0M0S", [link(2, 1)]), 1),           // B after S
            ]);
            recalculate(nest);
            ok = eq("a link into a summary holds its leaves back",
                    [nest.Tasks[2].Start, nest.Tasks[3].Start].join(" "),
                    "2026-09-09T08:00:00 2026-09-09T08:00:00") && ok;
            ok = eq("a link from a summary reads its span, the same pass",
                    nest.Tasks[4].Start, "2026-09-11T08:00:00") && ok;
            nest.Tasks[2].Duration = "PT24H0M0S";
            recalculate(nest);
            ok = eq("a longer leaf moves the successor of its summary at once",
                    nest.Tasks[4].Start, "2026-09-14T08:00:00") && ok;
            ok = eq("the summary's own finish and the critical path",
                    [nest.Tasks[1].Finish, nest.Tasks[2].Critical,
                     nest.Tasks[3].Critical, nest.Tasks[4].Critical].join(" "),
                    "2026-09-11T17:00:00 true false true") && ok;

            /* **A manual successor bounds the total slack like any other**
             * -- measured in Project: M's late start is the plan's Friday, so
             * A has until Thursday -- and the free slack stops at M's own
             * dates. A finished task is history: late dates are the ones it
             * had, no slack, never critical. */
            const fixed = projectOf([
                task(1, "PT8H0M0S"),                                   // A, Mon
                task(2, "PT8H0M0S", [link(1, 1)],                      // M, Thu
                     { Manual: true, Start: "2026-09-10T08:00:00",
                       Finish: "2026-09-10T17:00:00" }),
                task(3, "PT8H0M0S", [], { ConstraintType: CONSTRAINT_SNET,
                     ConstraintDate: "2026-09-11T08:00:00" }),         // D, Fri
                task(4, "PT8H0M0S", [], { Start: "2026-09-07T08:00:00",
                     Finish: "2026-09-07T17:00:00",
                     ActualFinish: "2026-09-07T17:00:00" }),
            ]);
            recalculate(fixed);
            ok = eq("a manual successor bounds the total slack",
                    [fixed.Tasks[0].TotalSlack, fixed.Tasks[0].FreeSlack].join("/"),
                    "9600/4800") && ok;

            /* **No late finish after the plan's**, also for a task whose
             * only successor holds its start (SS): Project caps it there. */
            const capped = projectOf([
                task(1, "PT16H0M0S"),                                  // A, 2d
                task(2, "PT8H0M0S", [link(1, 3)]),                     // B SS A
            ]);
            recalculate(capped);
            ok = eq("an SS predecessor ends no later than the plan",
                    `${capped.Tasks[0].TotalSlack} ${capped.Tasks[0].LateFinish}`,
                    "0 2026-09-09T17:00:00") && ok;

            /* **A date that beats a link is negative slack**: B must start
             * the plan's first day, A takes two working days -- Project
             * shows -2d on both (measured, with "Continue" on the
             * conflict). */
            const clash = projectOf([
                task(1, "PT16H0M0S"),
                task(2, "PT8H0M0S", [link(1, 1)], { ConstraintType: CONSTRAINT_MSO,
                     ConstraintDate: "2026-09-07T08:00:00" }),
            ]);
            recalculate(clash);
            ok = eq("an MSO before its predecessor ends: -2d on both",
                    `${clash.Tasks[1].Start} ${clash.Tasks[0].TotalSlack} ` +
                    `${clash.Tasks[1].TotalSlack}`,
                    "2026-09-07T08:00:00 -9600 -9600") && ok;

            /* **A summary's duration and slack are its branch's**: 2d of
             * span, and the least slack of its leaves. */
            const branch = projectOf([
                level(task(1, "PT0S"), 1, true),
                level(task(2, "PT8H0M0S"), 2),
                level(task(3, "PT16H0M0S"), 2),
                level(task(4, "PT24H0M0S"), 1),
            ]);
            recalculate(branch);
            ok = eq("a summary's duration and slack",
                    `${branch.Tasks[0].Duration} ${branch.Tasks[0].TotalSlack} ` +
                    `${branch.Tasks[2].TotalSlack}`,
                    "PT16H0M0S 4800 4800") && ok;
            ok = eq("a finished task: no slack, not critical",
                    [fixed.Tasks[3].TotalSlack, fixed.Tasks[3].FreeSlack,
                     fixed.Tasks[3].Critical, fixed.Tasks[3].LateFinish].join(" "),
                    "0 0 false 2026-09-07T17:00:00") && ok;

            /* **A lag in percent is a share of the predecessor**, and its
             * `LinkLag` is the percentage: Project saved `FC+50%` after a 2d
             * task as 50, format 19, and put the successor a day later. */
            const pct = projectOf([
                task(1, "PT16H0M0S"),
                task(2, "PT8H0M0S", [new MspLink({ PredecessorUID: 1, Type: 1,
                                                   LinkLag: 50, LagFormat: 19 })]),
            ]);
            recalculate(pct);
            ok = eq("a 50% lag after 2d is a day",
                    `${pct.Tasks[0].Finish} ${pct.Tasks[1].Start}`,
                    "2026-09-09T17:00:00 2026-09-11T08:00:00") && ok;

            /* **An FF does not start a task before the plan.** A is a day
             * long on the project's first day; B (3 days) finishes with A, so
             * the link alone would start it two days before the plan. It
             * starts with the plan and ends later. An SF may start early. */
            const early = projectOf([
                task(1, "PT8H0M0S"),                                   // A, Mon
                task(2, "PT24H0M0S", [link(1, 0)]),                    // B, FF from A
                task(3, "PT24H0M0S", [link(1, 2)]),                    // C, SF from A
            ]);
            recalculate(early);
            ok = eq("an FF successor starts no earlier than the plan",
                    early.Tasks[1].Start, "2026-09-07T08:00:00") && ok;
            ok = eq("an SF successor still may", early.Tasks[2].Start <
                    early.StartDate, true) && ok;

            /* **A task that has started started when it did**: a predecessor
             * that slipped moves what is left of B, not the day B began. */
            const begun = projectOf([
                task(1, "PT16H0M0S"),                                  // A, Mon + Wed
                task(2, "PT8H0M0S", [link(1, 1)],                      // B, FS from A
                     { ActualStart: "2026-09-07T08:00:00",
                       Start: "2026-09-07T08:00:00" }),
                task(3, "PT8H0M0S", [link(1, 1)]),                     // C, same link, not begun
            ]);
            recalculate(begun);
            ok = eq("a begun task keeps its actual start",
                    `${begun.Tasks[1].Start}..${begun.Tasks[1].Finish}`,
                    "2026-09-07T08:00:00..2026-09-07T17:00:00") && ok;
            ok = eq("and one that has not begun still waits for its link",
                    begun.Tasks[2].Start, "2026-09-10T08:00:00") && ok;

            /* **Free slack by the end each link joins.** A is tied to B's
             * finish (FF) and E to F's start (SS); B and F were pushed to
             * Friday and Thursday by another task, which is the room A and E
             * have -- three days and two, where the FF one used to lose A's
             * own duration as clock time and the SS one was always zero. */
            const free = projectOf([
                task(1, "PT8H0M0S"),                                   // A
                task(2, "PT24H0M0S"),                                  // D
                task(3, "PT8H0M0S", [link(1, 0), link(2, 1)]),         // B
                task(4, "PT8H0M0S"),                                   // E
                task(5, "PT16H0M0S"),                                  // G
                task(6, "PT8H0M0S", [link(4, 3), link(5, 1)]),         // F
            ]);
            recalculate(free);
            ok = eq("FF free slack is to the successor's finish",
                    free.Tasks[0].FreeSlack, 14400) && ok;
            ok = eq("SS free slack is to the successor's start",
                    free.Tasks[3].FreeSlack, 9600) && ok;
            ok = crossing("2026-04-02T08:00:00", "2026-04-08T17:00:00") && ok;

            /* Two spans that touch are one stretch of work, and a `ToTime` of
             * midnight is the end of the day -- the "24 Hours" calendar. */
            const oneDay = (spans) => {
                const days = [];
                for (let day = 1; day <= 7; day++)
                    days.push(new MspWeekDay({ DayType: day, DayWorking: true,
                        WorkingTimes: spans.map(([f, t]) =>
                            new MspWorkingTime({ FromTime: f, ToTime: t })) }));
                return new WorkCalendar(new MspProject({ CalendarUID: 9,
                    Calendars: [new MspCalendar({ UID: 9, IsBaseCalendar: true,
                                                  WeekDays: days })] }), 9);
            };
            const touching = oneDay([["08:00:00", "12:00:00"], ["12:00:00", "17:00:00"]]);
            ok = eq("spans that touch lose no minute",
                    isoLocal(touching.add(whenMs("2026-09-07T08:00:00"), 540)),
                    "2026-09-07T17:00:00") && ok;
            const allDay = oneDay([["00:00:00", "00:00:00"]]);
            ok = eq("a day to midnight is a whole day",
                    isoLocal(allDay.add(whenMs("2026-09-07T00:00:00"), 1440 * 3)),
                    "2026-09-10T00:00:00") && ok;
            /* **Midnight ends yesterday's span** as well: a day back from
             * Tuesday noon stood still on Tuesday 00:00 until the guard ran
             * out. */
            ok = eq("a day back on 24 hours crosses midnight",
                    isoLocal(allDay.subtract(whenMs("2026-09-15T12:00:00"), 1440)),
                    "2026-09-14T12:00:00") && ok;

            /* Where the shapes start, taken from the XSD: the two `Type`
             * fields have no default and start below every real value, so a
             * file's own 0 is kept; the project's default task type and a
             * resource's units are the schema's 1; and a missing Type reads
             * as the project says (FS for a link). The slack starts at
             * `NO_MINUTES` for the same reason and for one more: **zero is an
             * answer**, so a sentinel that was also zero would write the file
             * out without an element it came in with. */
            const fresh = new MspProject({ Name: "Fresh" });
            ok = eq("fresh defaults",
                    [fresh.ScheduleFromStart, fresh.DefaultTaskType,
                     fresh.WeekStartDay, new MspTask({}).Type,
                     new MspTask({}).EffortDriven, new MspTask({}).Estimated,
                     new MspLink({}).Type, new MspResource({}).MaxUnits,
                     new MspTask({}).TotalSlack, new MspTask({}).FreeSlack,
                     new MspTask({}).LateStart].join(","),
                    "true,1,-1,-1,false,true,-1,1,-1,-1,") && ok;
            ok = eq("a plan in yen keeps its zero decimals, one that says nothing has none",
                    [new MspProject({ CurrencyDigits: 0 }).CurrencyDigits,
                     fresh.CurrencyDigits].join("/"), "0/-1") && ok;
            ok = eq("a missing link type is FS", linkKind(new MspLink({})), 1) && ok;
            ok = eq("a missing task type inherits",
                    taskKind(new MspProject({ DefaultTaskType: 0 }),
                             new MspTask({})), 0) && ok;

            /* A task may carry several baselines side by side; the number
             * picks one and an absent one is null. */
            const bl = new MspTask({ Baselines: [
                new MspBaseline({ Number: 0, Start: "2026-09-07T08:00:00" }),
                new MspBaseline({ Number: 1, Start: "2026-09-09T08:00:00" }),
            ] });
            ok = eq("baseline 0", baselineOf(bl, 0).Start, "2026-09-07T08:00:00") && ok;
            ok = eq("baseline 1", baselineOf(bl, 1).Start, "2026-09-09T08:00:00") && ok;
            ok = eq("baseline absent", baselineOf(bl, 2), null) && ok;

            /* 2026-09-07 is a Monday and the 8th is the holiday. */
            const p = projectOf([
                task(1, "PT8H0M0S"),                // A
                task(2, "PT8H0M0S", [link(1, 1)]),  // B: FS from A
                task(3, "PT8H0M0S", [link(1, 3)]),  // C: SS from A
                task(4, "PT8H0M0S", [link(2, 0)]),  // D: FF from B
                task(5, "PT0H0M0S", [link(2, 1)]),  // M: milestone FS from B
                task(6, "PT8H0M0S", [link(1, 2)]),  // E: SF from A
            ]);
            const work = new WorkCalendar(p, 1);
            const mon = whenMs("2026-09-07T08:00:00");
            ok = eq("add 8h", isoLocal(work.add(mon, 480)), "2026-09-07T17:00:00") && ok;
            ok = eq("add 16h across the holiday",
                    isoLocal(work.add(mon, 960)), "2026-09-09T17:00:00") && ok;
            ok = eq("0 minutes at an end",
                    isoLocal(work.add(whenMs("2026-09-07T17:00:00"), 0)),
                    "2026-09-07T17:00:00") && ok;
            ok = eq("a start after an end",
                    isoLocal(work.startAfter(whenMs("2026-09-07T17:00:00"))),
                    "2026-09-09T08:00:00") && ok;
            ok = eq("Friday plus a day",
                    isoLocal(work.add(whenMs("2026-09-11T17:00:00"), 480)),
                    "2026-09-14T17:00:00") && ok;
            ok = eq("subtract 8h",
                    isoLocal(work.subtract(whenMs("2026-09-09T08:00:00"), 480)),
                    "2026-09-07T08:00:00") && ok;
            ok = eq("between", work.between(mon, whenMs("2026-09-09T17:00:00")), 960) && ok;

            ok = eq("placed", recalculate(p).placed, 6) && ok;
            const at = (i) => `${p.Tasks[i].Start}..${p.Tasks[i].Finish}`;
            ok = eq("A", at(0), "2026-09-07T08:00:00..2026-09-07T17:00:00") && ok;
            ok = eq("B (FS)", at(1), "2026-09-09T08:00:00..2026-09-09T17:00:00") && ok;
            ok = eq("C (SS)", at(2), "2026-09-07T08:00:00..2026-09-07T17:00:00") && ok;
            ok = eq("D (FF)", at(3), "2026-09-09T08:00:00..2026-09-09T17:00:00") && ok;
            ok = eq("M (milestone FS)", at(4),
                    "2026-09-09T17:00:00..2026-09-09T17:00:00") && ok;
            ok = eq("E (SF)", at(5),
                    "2026-09-04T08:00:00..2026-09-07T08:00:00") && ok;

            /* The hard constraints, each on its own task and all landing on
             * the same Wednesday 13:00 -- the afternoon of the 9th and the
             * morning of the 10th are one working day across the lunch. */
            const c = projectOf([
                task(1, "PT8H0M0S", [], { ConstraintType: 2,
                                          ConstraintDate: "2026-09-09T13:00:00" }),
                task(2, "PT8H0M0S", [], { ConstraintType: 3,
                                          ConstraintDate: "2026-09-10T12:00:00" }),
                task(3, "PT8H0M0S", [], { ConstraintType: 4,
                                          ConstraintDate: "2026-09-09T13:00:00" }),
                task(4, "PT8H0M0S", [], { ConstraintType: 6,
                                          ConstraintDate: "2026-09-10T12:00:00" }),
                task(5, "PT8H0M0S", [], { ConstraintType: 1 }),   // ALAP: kept
            ]);
            const constrained = recalculate(c);
            ok = eq("constraints placed", constrained.placed, 4) && ok;
            ok = eq("constraints kept", constrained.skipped, 1) && ok;
            ok = eq("MSO", `${c.Tasks[0].Start}..${c.Tasks[0].Finish}`,
                    "2026-09-09T13:00:00..2026-09-10T12:00:00") && ok;
            ok = eq("MFO", `${c.Tasks[1].Start}..${c.Tasks[1].Finish}`,
                    "2026-09-09T13:00:00..2026-09-10T12:00:00") && ok;
            ok = eq("SNET", `${c.Tasks[2].Start}..${c.Tasks[2].Finish}`,
                    "2026-09-09T13:00:00..2026-09-10T12:00:00") && ok;
            ok = eq("FNET", `${c.Tasks[3].Start}..${c.Tasks[3].Finish}`,
                    "2026-09-09T13:00:00..2026-09-10T12:00:00") && ok;
            ok = eq("ALAP kept", c.Tasks[4].Start, "") && ok;
            ok = eq("nothing violated", constrained.notMet, 0) && ok;

            /* A manually scheduled task keeps the dates the file gave it --
             * a link does not move it -- and its successor is placed from
             * those dates. */
            const man = projectOf([
                task(1, "PT8H0M0S", [], { Manual: true,
                                          Start: "2026-09-16T08:00:00",
                                          Finish: "2026-09-16T17:00:00" }),
                task(2, "PT8H0M0S", [link(1, 1)]),
            ]);
            const manRun = recalculate(man);
            ok = eq("manual kept", `${man.Tasks[0].Start}..${man.Tasks[0].Finish}`,
                    "2026-09-16T08:00:00..2026-09-16T17:00:00") && ok;
            ok = eq("manual successor", man.Tasks[1].Start,
                    "2026-09-17T08:00:00") && ok;
            ok = eq("manual skipped", manRun.skipped, 1) && ok;

            /* The soft constraints never pin: the task is scheduled as early
             * as its links allow, and the date it passed is a violation. */
            const c2 = projectOf([
                task(1, "PT8H0M0S"),
                task(2, "PT8H0M0S", [link(1, 1)],
                     { ConstraintType: 5,
                       ConstraintDate: "2026-09-08T08:00:00" }),
            ]);
            const late2 = recalculate(c2);
            ok = eq("SNLT not met", late2.notMet, 1) && ok;
            ok = eq("SNLT scheduled ASAP", c2.Tasks[1].Start,
                    "2026-09-09T08:00:00") && ok;

            const c3 = projectOf([task(1, "PT8H0M0S", [],
                     { ConstraintType: 7,
                       ConstraintDate: "2026-09-07T12:00:00" })]);
            ok = eq("FNLT not met", recalculate(c3).notMet, 1) && ok;

            /* An elapsed duration counts calendar time: two elapsed days from
             * Monday 08:00 is Wednesday 08:00, the holiday in between and
             * all. Working time would have put it six days out. */
            const e = projectOf([
                task(1, "PT48H0M0S", [], { DurationFormat: 8 }),
            ]);
            recalculate(e);
            ok = eq("elapsed", `${e.Tasks[0].Start}..${e.Tasks[0].Finish}`,
                    "2026-09-07T08:00:00..2026-09-09T08:00:00") && ok;

            /* **A duration is read by the side of the T an M is on.** */
            ok = eq("P1M is a month, not a minute", mspdiMinutes("P1M"), 9600) && ok;
            ok = eq("PT30M0S is half an hour", mspdiMinutes("PT30M0S"), 30) && ok;
            ok = eq("P1W and P2D", [mspdiMinutes("P1W"), mspdiMinutes("P2D")].join("/"),
                    "2400/960") && ok;
            ok = eq("a day and its hours", mspdiMinutes("P1DT4H"), 720) && ok;
            ok = eq("years and negatives are nothing",
                    [mspdiMinutes("P1Y"), mspdiMinutes("-PT8H0M0S"), mspdiMinutes("PT")].join("/"),
                    "//") && ok;

            /* The cost of an assignment: a work resource by the hours, a
             * material by the units plus its cost per use, and the file's own
             * number when it wrote one. */
            const r = projectOf([task(1, "PT8H0M0S")]);
            r.Resources = [
                new MspResource({ UID: 1, Name: "Ana", Type: 1,
                                  MaxUnits: 1, StandardRate: 50 }),
                new MspResource({ UID: 2, Name: "Bricks", Type: 0,
                                  MaxUnits: 1, StandardRate: 120, CostPerUse: 10 }),
            ];
            r.Assignments = [
                new MspAssignment({ UID: 1, TaskUID: 1, ResourceUID: 1,
                                    Units: 1, Work: "PT8H0M0S" }),
                new MspAssignment({ UID: 2, TaskUID: 1, ResourceUID: 2,
                                    Units: 2, Work: "PT0H0M0S" }),
                new MspAssignment({ UID: 3, TaskUID: 1, ResourceUID: 1,
                                    Units: 1, Work: "PT8H0M0S", Cost: 123 }),
            ];
            /* A cost resource carries no work, so no hours: only what is typed. */
            r.Resources.push(new MspResource({ UID: 3, Name: "Travel", Type: 2,
                                               StandardRate: 99, CostPerUse: 7 }));
            const travel = new MspAssignment({ UID: 4, TaskUID: 1, ResourceUID: 3,
                                               Units: 1, Work: "PT8H0M0S" });
            ok = eq("a cost resource is not hours by a rate",
                    assignmentCost(r, travel), 0) && ok;
            travel.Cost = 55;
            ok = eq("only what is typed on it", assignmentCost(r, travel), 55) && ok;
            ok = eq("work cost", assignmentCost(r, r.Assignments[0]), 400) && ok;
            ok = eq("material cost", assignmentCost(r, r.Assignments[1]), 250) && ok;
            ok = eq("file cost", assignmentCost(r, r.Assignments[2]), 123) && ok;
            ok = eq("resource total", resourceCost(r, r.Resources[0]), 523) && ok;
            ok = eq("task total", taskCost(r, r.Tasks[0]), 773) && ok;
            ok = eq("plan total", projectCost(r), 773) && ok;

            /* A rate table: the work is spread over the assignment's working
             * time and each period takes the share that happens inside it,
             * plus the cost per use of the period the work starts in. Table B
             * is picked by the assignment's `CostRateTable` (1).
             *
             * Task 1 runs Monday to Wednesday, 16h across three working days,
             * with the rate changing at Wednesday midnight: two thirds of the
             * work at 50 and one third at 70, and the raise's cost per use is
             * not the one that applies -- the work starts under the old row. */
            const tb = projectOf([task(1, "PT16H0M0S")]);
            recalculate(tb);
            tb.Resources = [new MspResource({
                UID: 1, Name: "Ana", Type: 1, MaxUnits: 1, StandardRate: 50,
                CostPerUse: 5,
                Rates: [
                    new MspRate({ RatesFrom: "2026-01-01T00:00:00",
                                  RatesTo: "2026-09-08T23:59:00", RateTable: 0,
                                  StandardRate: 50, CostPerUse: 10 }),
                    new MspRate({ RatesFrom: "2026-09-09T00:00:00",
                                  RatesTo: "2026-12-31T23:59:00", RateTable: 0,
                                  StandardRate: 70, CostPerUse: 20 }),
                    new MspRate({ RatesFrom: "2026-01-01T00:00:00",
                                  RatesTo: "2026-12-31T23:59:00", RateTable: 1,
                                  StandardRate: 100, CostPerUse: 1 }),
                ] })];
            tb.Assignments = [new MspAssignment({
                UID: 1, TaskUID: 1, ResourceUID: 1, Units: 1,
                Work: "PT16H0M0S", Start: tb.Tasks[0].Start,
                Finish: tb.Tasks[0].Finish })];
            ok = eq("rate table split",
                    Math.round(assignmentCost(tb, tb.Assignments[0])), 970) && ok;
            tb.Assignments[0].CostRateTable = 1;
            ok = eq("rate table B",
                    Math.round(assignmentCost(tb, tb.Assignments[0])), 1601) && ok;

            /* Two tasks that overlap add their units at the overlap: that is
             * what the Peak column shows and the log counts. */
            const o = projectOf([task(1, "PT8H0M0S"), task(2, "PT8H0M0S")]);
            o.Resources   = [new MspResource({ UID: 1, Name: "Ana", Type: 1,
                                               MaxUnits: 1, StandardRate: 50 })];
            o.Assignments = [
                new MspAssignment({ UID: 1, TaskUID: 1, ResourceUID: 1,
                                    Units: 1, Work: "PT8H0M0S" }),
                new MspAssignment({ UID: 2, TaskUID: 2, ResourceUID: 1,
                                    Units: 1, Work: "PT8H0M0S" }),
            ];
            recalculate(o);
            ok = eq("peak units", resourcePeak(o, o.Resources[0]), 2) && ok;

            /* The work identity: effort-driven halves the duration when the
             * units double, Fixed Duration ignores the flag, and without it
             * the duration stands and the work grows. */
            ok = eq("effort driven", assignmentDuration(null,
                    { Duration: "PT8H0M0S", EffortDriven: true, Type: 0 }, 1, 2),
                    240) && ok;
            ok = eq("effort, two already", assignmentDuration(null,
                    { Duration: "PT8H0M0S", EffortDriven: true, Type: 0 }, 2, 3),
                    320) && ok;
            ok = eq("fixed duration", assignmentDuration(null,
                    { Duration: "PT8H0M0S", EffortDriven: true, Type: 1 }, 1, 2),
                    480) && ok;
            ok = eq("not effort driven", assignmentDuration(null,
                    { Duration: "PT8H0M0S", EffortDriven: false, Type: 0 }, 1, 2),
                    480) && ok;

            /* And the direction the pass keeps: **the duration is the input**
             * -- two units at a hundred per cent over a sixteen-hour task
             * make thirty-two hours of work -- while Fixed Work is the one
             * that keeps the work and derives the duration. */
            const w = projectOf([task(1, "PT16H0M0S")]);
            w.Resources = [
                new MspResource({ UID: 1, Name: "Ana", Type: 1,
                                  MaxUnits: 1, StandardRate: 50 }),
                new MspResource({ UID: 2, Name: "Bruno", Type: 1,
                                  MaxUnits: 1, StandardRate: 40 }),
            ];
            w.Assignments = [
                new MspAssignment({ UID: 1, TaskUID: 1, ResourceUID: 1,
                                    Units: 1, Work: "PT8H0M0S" }),
                new MspAssignment({ UID: 2, TaskUID: 1, ResourceUID: 2,
                                    Units: 1, Work: "PT8H0M0S" }),
            ];
            w.Tasks[0].Type = 0;
            ok = eq("the duration keeps its own",
                    workDuration(w, w.Tasks[0], 960), 960) && ok;
            ok = eq("...and the work grows to match",
                    w.Tasks[0].Work, "PT32H0M0S") && ok;
            w.Tasks[0].Type = 1;
            ok = eq("fixed duration keeps it too",
                    workDuration(w, w.Tasks[0], 240), 240) && ok;
            ok = eq("...and derives the work", w.Tasks[0].Work, "PT8H0M0S") && ok;
            w.Tasks[0].Type = 2;
            ok = eq("fixed work pins the duration",
                    workDuration(w, w.Tasks[0], 120), 240) && ok;

            /* The backward pass: the chain is critical and the parallel task
             * has the Wednesday to slip -- the Tuesday is the holiday. */
            const q = projectOf([
                task(1, "PT8H0M0S"),                // A: Monday
                task(2, "PT8H0M0S", [link(1, 1)]),  // B: Wednesday
                task(3, "PT8H0M0S"),                // C: parallel
                task(4, "PT0H0M0S", [link(2, 1)]),  // M: milestone on B
            ]);
            recalculate(q);
            ok = eq("critical A", q.Tasks[0].Critical, true) && ok;
            ok = eq("critical B", q.Tasks[1].Critical, true) && ok;
            ok = eq("slack C", q.Tasks[2].Critical, false) && ok;
            ok = eq("critical M", q.Tasks[3].Critical, true) && ok;

            /* **The backward pass's answer is kept**, which is the whole of what
             * these four fields are: the dates the task could still take without
             * moving the plan, and the room it has. C is the interesting one --
             * the chain is critical and C has Wednesday to slip, measured in
             * **working** minutes, and the Tuesday in between is the holiday. */
            const slackOf = (t) => [t.LateStart, t.LateFinish, t.TotalSlack,
                                    t.FreeSlack].join(" ");
            ok = eq("A late dates and slack", slackOf(q.Tasks[0]),
                    "2026-09-07T08:00:00 2026-09-07T17:00:00 0 0") && ok;   // the 8th is a holiday: Wednesday 08:00 is Monday's end
            ok = eq("B late dates and slack", slackOf(q.Tasks[1]),
                    "2026-09-09T08:00:00 2026-09-09T17:00:00 0 0") && ok;
            ok = eq("C has the Wednesday", slackOf(q.Tasks[2]),
                    "2026-09-09T08:00:00 2026-09-09T17:00:00 4800 4800") && ok;
            ok = eq("M late dates and slack", slackOf(q.Tasks[3]),
                    "2026-09-09T17:00:00 2026-09-09T17:00:00 0 0") && ok;

            /* **Total and free are two numbers and not one**, which is the claim
             * this fixture exists for. The plan finishes on a Friday, so
             * every task has room before the *plan* ends -- and A has none
             * before its successor starts: it can slip a whole day before the
             * finish moves, and not an hour before B is late. */
            const sl = projectOf([
                task(1, "PT8H0M0S"),                // A: Wednesday
                task(2, "PT8H0M0S", [link(1, 1)]),  // B: Thursday, FS from A
                task(3, "PT8H0M0S"),                // C: Wednesday, nothing after
                task(4, "PT8H0M0S", [], { ConstraintType: CONSTRAINT_SNET,
                    ConstraintDate: "2026-09-11T08:00:00" }),   // D: Friday
            ]);
            sl.StartDate  = "2026-09-09T08:00:00";
            /* **The file's `FinishDate` is not read**: a stale one says the plan
             * ends at month's end -- an edit shortened it -- and the pass
             * answers with the Friday D sets, and writes it back as Project
             * recalculates it. */
            sl.FinishDate = "2026-09-30T17:00:00";
            recalculate(sl);
            ok = eq("the plan's finish is the latest finish, not the file's",
                    sl.FinishDate, "2026-09-11T17:00:00") && ok;
            /* **Tenths of a minute, the file's unit**: a day of 480 minutes is
             * `<TotalSlack>4800`, which is what Project writes for it. */
            ok = eq("A total is a day of room, in tenths",
                    [sl.Tasks[0].TotalSlack, sl.Tasks[0].FreeSlack].join("/"),
                    "4800/0") && ok;
            ok = eq("and A is not critical for it", sl.Tasks[0].Critical,
                    false) && ok;
            /* **And the column reads it**, in the unit the task's own durations
             * are in -- which is the reading, and not the minutes underneath.
             * `sl`'s tasks carry no `DurationFormat`, so the project's 7 (days)
             * is what a row shows: a day of room as `1d`, none as `0d`. */
            ok = eq("a day of room reads as a day", slackText(sl.Tasks[0], sl),
                    "1d") && ok;
            ok = eq("no room reads as zero", slackText(q.Tasks[0], q),
                    "0d") && ok;
            ok = eq("and no answer reads as nothing",
                    slackText(c.Tasks[4], c), "") && ok;
            ok = eq("A's room is before the plan's finish",
                    `${sl.Tasks[0].LateStart}..${sl.Tasks[0].LateFinish}`,
                    "2026-09-10T08:00:00..2026-09-10T17:00:00") && ok;
            ok = eq("B can slip to Friday",
                    [sl.Tasks[1].TotalSlack, sl.Tasks[1].FreeSlack].join("/"),
                    "4800/4800") && ok;
            ok = eq("C can slip to Friday too, and nothing waits on it",
                    [sl.Tasks[2].TotalSlack, sl.Tasks[2].FreeSlack].join("/"),
                    "9600/9600") && ok;

            /* **A task the pass never placed keeps the sentinel**, which
             * is not zero: nothing was worked out, and a plan that reads "no
             * room" for every task is a plan whose slack is a lie. ALAP is the
             * case -- the backward pass is the one that places it late and this
             * pass does not, so there is no answer to write. */
            ok = eq("a task the pass skipped has no slack",
                    [c.Tasks[4].TotalSlack, c.Tasks[4].FreeSlack,
                     c.Tasks[4].LateStart, c.Tasks[4].LateFinish].join("/"),
                    "-1/-1//") && ok;
            ok = eq("while a manual task is placed and has an answer",
                    man.Tasks[0].TotalSlack >= 0, true) && ok;

            /* **The variance**, which is the other half of a baseline: how far
             * the dates are from the ones it caught, signed, in working minutes.
             * A is held back to Wednesday by a constraint against a Monday
             * baseline and is therefore **late by a day**, B is on its own
             * baseline, and the Tuesday in between is the holiday -- which is
             * why a day of slip is 480 minutes and not 1440. */
            const vb = projectOf([
                task(1, "PT8H0M0S", [], { ConstraintType: 4,
                                          ConstraintDate: "2026-09-09T08:00:00" }),
                task(2, "PT8H0M0S", [link(1, 1)]),  // B: Thursday
            ]);
            vb.Tasks[0].Baselines = [new MspBaseline({
                Number: BASELINE, Start: "2026-09-07T08:00:00",
                Finish: "2026-09-07T17:00:00" })];
            vb.Tasks[1].Baselines = [new MspBaseline({
                Number: BASELINE, Start: "2026-09-10T08:00:00",
                Finish: "2026-09-10T17:00:00" })];
            recalculate(vb);
            ok = eq("late against the baseline", vb.Tasks[0].FinishVariance,
                    4800) && ok;
            ok = eq("and so is its start", vb.Tasks[0].StartVariance, 4800) && ok;
            ok = eq("on the baseline is zero, not nothing",
                    vb.Tasks[1].FinishVariance, 0) && ok;
            ok = eq("the column reads the sign",
                    varianceText(vb.Tasks[0], vb), "1d") && ok;
            ok = eq("and a zero reads as a zero",
                    varianceText(vb.Tasks[1], vb), "0d") && ok;

            /* **A task with no baseline has no variance**, which is not the same
             * as one that is exactly on it: a plan that never took a baseline
             * cannot be on it. */
            const nov = projectOf([task(1, "PT8H0M0S")]);
            recalculate(nov);
            ok = eq("no baseline, no variance",
                    [nov.Tasks[0].StartVariance,
                     nov.Tasks[0].FinishVariance].join("/"),
                    "-1/-1") && ok;
            ok = eq("and the column says nothing",
                    varianceText(nov.Tasks[0], nov), "") && ok;
            /* The other baseline: a file can carry several, and "the baseline"
             * is the one `Set Baseline` writes. A task baselined only as number
             * 1 is not baselined as far as this is concerned. */
            const other = projectOf([task(1, "PT8H0M0S")]);
            other.Tasks[0].Baselines = [new MspBaseline({
                Number: 1, Start: "2026-09-01T08:00:00",
                Finish: "2026-09-01T17:00:00" })];
            recalculate(other);
            ok = eq("another baseline is another question",
                    other.Tasks[0].FinishVariance, NO_MINUTES) && ok;

            /* **The same question, one level down.** An assignment has no
             * baseline of its own, so it is measured against its task's -- and
             * that is not the task's answer said twice. Here A's task starts a
             * day late while the assignment on it did not: a resource that got
             * to work when it was supposed to. B's assignment is exactly on.
             * Writing the task's number on the assignment instead would have
             * made the first `480` and lost the distinction entirely. */
            const asg = projectOf([
                task(1, "PT8H0M0S", [], { ConstraintType: 4,
                                          ConstraintDate: "2026-09-09T08:00:00" }),
                task(2, "PT8H0M0S", [link(1, 1)]),
            ]);
            asg.Tasks[0].Baselines = [new MspBaseline({
                Number: BASELINE, Start: "2026-09-07T08:00:00",
                Finish: "2026-09-07T17:00:00" })];
            asg.Tasks[1].Baselines = [new MspBaseline({
                Number: BASELINE, Start: "2026-09-10T08:00:00",
                Finish: "2026-09-10T17:00:00" })];
            asg.Assignments = [
                new MspAssignment({ UID: 1, TaskUID: 1, ResourceUID: 1,
                                    Start:  "2026-09-07T08:00:00",
                                    Finish: "2026-09-07T17:00:00" }),
                new MspAssignment({ UID: 2, TaskUID: 2, ResourceUID: 1,
                                    Start:  "2026-09-10T08:00:00",
                                    Finish: "2026-09-10T17:00:00" }),
            ];
            recalculate(asg);
            ok = eq("la asignacion se mide contra la tarea, no contra si misma",
                    asg.Assignments[0].StartVariance, 0) && ok;
            ok = eq("mientras la tarea sigue tarde",
                    asg.Tasks[0].StartVariance, 4800) && ok;
            ok = eq("y en su propio calendario: un dia, no 1440",
                    asg.Assignments[1].FinishVariance, 0) && ok;
            /* **No baseline, no answer**, at this level too -- and it is the
             * sentinel rather than a zero that says so. */
            const asgNone = projectOf([task(1, "PT8H0M0S")]);
            asgNone.Assignments = [new MspAssignment({
                UID: 1, TaskUID: 1, ResourceUID: 1,
                Start: "2026-09-07T08:00:00", Finish: "2026-09-07T17:00:00" })];
            recalculate(asgNone);
            ok = eq("sin linea base la asignacion tampoco responde",
                    [asgNone.Assignments[0].StartVariance,
                     asgNone.Assignments[0].FinishVariance].join("/"),
                    "-1/-1") && ok;

            /* **And it survives the file**, which is the whole claim: a number
             * nobody can read back is a number in memory. The claim is
             * **written equals what the pass held**, not a date -- the shape of
             * the round trip, not the arithmetic, which is what the fixture
             * above is for. Including the `0` of a task on its baseline,
             * **which is the case a shape whose default were zero would have
             * dropped on the way out**, and that no fixture in the corpus covers
             * because none of them is baselined. */
            const held = newMspdi({ Name: "Variance" });
            const late1 = task(1, "PT8H0M0S");
            late1.Baselines = [new MspBaseline({
                Number: BASELINE, Start: "2026-09-01T08:00:00",
                Finish: "2026-09-01T17:00:00" })];
            const on1 = task(2, "PT8H0M0S", [link(1, 1)]);
            on1.Baselines = [new MspBaseline({
                Number: BASELINE, Start: "2026-09-01T08:00:00",
                Finish: "2026-09-01T17:00:00" })];
            const bare1 = task(3, "PT8H0M0S", [link(2, 1)]);
            held.project.Tasks = [late1, on1, bare1];
            recalculate(held.project);

            const kept = File.Join(Environment.TempDirectory, "check-variance.xml");
            writeMspdi(kept, held);
            const again = readMspdi(kept);
            const got = [];
            for (const t of again.project.Tasks) got.push(`${t.UID}:${t.FinishVariance}`);
            ok = eq("what the file carries is what the pass held", got.join(" "),
                    held.project.Tasks
                        .map((t) => `${t.UID}:${t.FinishVariance}`).join(" ")) && ok;
            ok = eq("a late task keeps a number, not nothing",
                    again.project.Tasks[0].FinishVariance > NO_MINUTES, true) && ok;
            /* And the one with no baseline wrote nothing at all: `NO_MINUTES` is
             * the omission, and an element there would be a claim nobody made. */
            ok = eq("a task with no baseline wrote no variance",
                    String(again.project.Tasks[2].FinishVariance),
                    String(NO_MINUTES)) && ok;
            if (File.Exists(kept)) File.Delete(kept);

            /* A summary is the span of its children. */
            const s = projectOf([
                new MspTask({ UID: 0, ID: 0, Name: "All", IsNull: false,
                              Summary: true, OutlineLevel: 0,
                              Duration: "PT16H0M0S" }),
                task(1, "PT8H0M0S"),
                task(2, "PT8H0M0S", [link(1, 1)]),
            ]);
            recalculate(s);
            ok = eq("summary", `${s.Tasks[0].Start}..${s.Tasks[0].Finish}`,
                    "2026-09-07T08:00:00..2026-09-09T17:00:00") && ok;

            print(ok ? "CHECK-OK" : "CHECK-FAILED");
            Application.Quit(ok ? 0 : 1);
        } catch (e) {
            print(`cpm ERROR ${e.message}`);
            print("CHECK-FAILED");
            Application.Quit(1);
        }
    }

    /*
     * The statistics the Project menu shows, asserted as numbers: what the
     * plan costs, how far along it is and which tasks broke which promise.
     * There is no golden for this one -- the values *are* the assertion, the
     * way they are for `check-cpm`.
     */
    /*
     * The report: what `planReport` puts on the page for each option, and the
     * dialog that shows it. Values asserted rather than a golden, like
     * `check-stats` -- the rows are the arithmetic, and the PDF's bytes are
     * Pango's and cairo's.
     */
    checkReport() {
        let ok = true;
        const eq = (what, got, want) => {
            const same = got === want;
            print(`report ${what}: ${got}${same ? "" : ` (want ${want})`} ` +
                  `${same ? "ok" : "FAILED"}`);
            return same;
        };
        /* Settings are the user's: put back whatever the dialog wrote -- and
         * the dialog starts from none of them, so what it is asked below is the
         * defaults and not whatever the last real report was. */
        const kept = {};
        for (const key of ["path", "summaries", "stripes", "paper", "orientation",
                           "margins", "tasks", "columns", "zoom", "kind", "wide", "repeat",
                           "tall", "table", "phases", "pack", "legend", "mural", "overlap", "guide"]) {
            if (Settings.Has(REPORT_KEY + key)) kept[key] = Settings.Get(REPORT_KEY + key);
            Settings.Delete(REPORT_KEY + key);
        }

        try {
            const task = (uid, name, level, more) => new MspTask({
                UID: uid, ID: uid, Name: name, IsNull: false, OutlineLevel: level,
                Start: "2026-09-07T08:00:00", Finish: "2026-09-08T17:00:00",
                ...(more || {}),
            });
            const project = new MspProject({
                Name: "Obra", StartDate: "2026-09-07T08:00:00",
                Tasks: [
                    task(0, "Obra", 0, { Summary: true }),
                    task(1, "Diseño", 1, { Summary: true }),
                    task(2, "Planos", 2, { PercentComplete: 100 }),
                    task(3, "Permisos", 2, { Critical: true }),
                    task(4, "Construcción", 1, { Summary: true }),
                    task(5, "Cimientos", 2, { PercentComplete: 100 }),
                    task(6, "Muros", 2),
                    new MspTask({ UID: 7, ID: 7, IsNull: true }),
                ],
                Resources: [new MspResource({ UID: 1, Name: "Ana", Type: 1,
                                              MaxUnits: 1, StandardRate: 50 })],
                Assignments: [2, 3, 5, 6].map((t) => new MspAssignment({
                    UID: t, TaskUID: t, ResourceUID: 1, Units: 1,
                    Work: `PT${t * 4}H0M0S` })),
            });
            const costOf = (uid) => taskCost(project, project.Tasks.find((t) => t.UID === uid));
            const names  = (rows) => rows.map((r) => r.Task.trim()).join(",");

            /* --- the rows ---------------------------------------------------- */

            const plain = planReport(project, "/x/obra.xml", {});
            ok = eq("tasks, and not summaries or blanks", names(plain.Data),
                    "Planos,Permisos,Cimientos,Muros") && ok;

            const sums = planReport(project, "", { summaries: true }).Data;
            ok = eq("with the summaries, in the plan's order", names(sums),
                    "Obra,Diseño,Planos,Permisos,Construcción,Cimientos,Muros") && ok;
            ok = eq("indented by level", sums[2].Task, "    Planos") && ok;
            ok = eq("a summary is marked", sums[1].Summary, true) && ok;
            ok = eq("a summary costs its tasks", sums[1].RollCost, costOf(2) + costOf(3)) && ok;
            ok = eq("the top one, all of them", sums[0].RollCost,
                    costOf(2) + costOf(3) + costOf(5) + costOf(6)) && ok;
            ok = eq("and adds nothing to the total", sums[0].Cost, 0) && ok;
            ok = eq("costs are not nothing", costOf(6) > 0, true) && ok;

            ok = eq("only the critical, and what holds them",
                    names(planReport(project, "", { tasks: "critical", summaries: true }).Data),
                    "Obra,Diseño,Permisos") && ok;
            ok = eq("only the unfinished",
                    names(planReport(project, "", { tasks: "open" }).Data),
                    "Permisos,Muros") && ok;

            /* --- the bands --------------------------------------------------- */

            ok = eq("the cost column brings the total",
                    !!plain.Sections.ReportFooter, true) && ok;
            const noCost = planReport(project, "", { columns: ["start", "finish"] });
            ok = eq("and without it there is none", noCost.Sections.ReportFooter, undefined) && ok;
            ok = eq("a heading per column, the task's included",
                    noCost.Sections.PageHeader.Elements
                        .filter((e) => e.Kind === "Text" && e.Font === "Sans Bold 9").length, 3) && ok;

            /* Portrait A4 with every column is narrower than they are wide, so
             * they shrink together and the line still ends inside the margins. */
            const narrow = planReport(project, "", { orientation: "Portrait" });
            const rule   = narrow.Sections.PageHeader.Elements.find((e) => e.Kind === "Line");
            ok = eq("every column fits the paper",
                    rule.X2 <= Printer.Papers.A4.Width - 2 * 40, true) && ok;
            ok = eq("stripes are a shaded box on odd rows",
                    planReport(project, "", { stripes: true }).Sections.Detail.Elements[0].When,
                    "@Odd") && ok;

            /* --- the dialog -------------------------------------------------- */

            const said = [];
            const dlg  = ReportForm.open(project, "/x/obra.xml", (t) => said.push(t));
            ok = eq("the dialog shows a report", dlg.Preview.PageCount >= 1, true) && ok;
            ok = eq("and says which page", dlg.LblPage.Text, `1 / ${dlg.Preview.PageCount}`) && ok;
            ok = eq("the title stands behind an empty field", dlg.TxtTitle.Placeholder, "Obra") && ok;

            dlg.ChkColCost.Active = false;
            ok = eq("a column taken out takes its total", dlg.Preview.Sections.ReportFooter,
                    undefined) && ok;
            dlg.ChkSummaries.Active = true;
            ok = eq("an option reaches the rows", dlg.Preview.Data.length, 7) && ok;
            dlg.CmbOrientation.Index = 0;
            ok = eq("and the paper", dlg.Preview.Orientation, "Portrait") && ok;
            dlg.SpnMargins.Value = 20;
            ok = eq("margins in millimetres, kept in points",
                    dlg.Preview.Margins, Math.round(20 * 72 / 25.4)) && ok;

            dlg.CmbZoom.Index = 4;
            ok = eq("100% is the paper at the screen's size",
                    dlg.Preview.Width, Math.round(Printer.Papers.A4.Width * 96 / 72)) && ok;
            dlg.CmbZoom.Index = 0;
            ok = eq("the whole page fills the view", dlg.Preview.Expand, true) && ok;

            const pdf = File.Join(Environment.TempDirectory, "bintana-project-report-check.pdf");
            dlg.Preview.SavePdf(pdf);
            const info = File.Info(pdf);
            ok = eq("what is previewed is what is saved", !!info && info.Size > 0, true) && ok;
            File.Delete(pdf);

            /* --- the Gantt on paper ------------------------------------------ */

            /* Across: the plan's span spread over the sheets asked for, each
             * sheet's slice starting where the one before it ended, and as many
             * sheets down as the rows need. */
            const one   = ganttPrint(project, "", { kind: "gantt", summaries: true });
            ok = eq("a short plan is one sheet", one.pages, 1) && ok;
            const three = ganttPrint(project, "", { kind: "gantt", summaries: true, wide: 3 });
            ok = eq("three across is three sheets", three.pages, 3) && ok;
            ok = eq("the slices meet", three.slice(0).to === three.slice(1).from &&
                                       three.slice(1).to === three.slice(2).from, true) && ok;
            ok = eq("and cover the plan", three.slice(0).from === three.range.from &&
                                          Math.abs(three.slice(2).to - three.range.to) < 1,
                    true) && ok;
            const bare  = ganttPrint(project, "", { kind: "gantt", wide: 3, repeat: false });
            ok = eq("without the table repeated, later sheets give its room to the chart",
                    bare.slice(1).to - bare.slice(1).from >
                    bare.slice(0).to - bare.slice(0).from, true) && ok;
            const many = new MspProject({
                Name: "Larga", StartDate: "2026-09-07T08:00:00",
                Tasks: Array.from({ length: 80 }, (_, i) => task(i + 1, `T${i + 1}`, 1)),
            });
            const tall = ganttPrint(many, "", { kind: "gantt", wide: 2 });
            ok = eq("down, as many sheets as the rows need",
                    tall.tall, Math.ceil(80 / tall.perPage)) && ok;
            ok = eq("across times down", tall.pages, tall.tall * 2) && ok;

            /* Down: the rows shared out evenly, a summary never left alone at
             * the foot of a sheet, and a sheet per phase when asked. */
            const span = (sheets) => sheets.map(([a, b]) => b - a).join(",");
            const flat = Array.from({ length: 44 }, (_, i) => ({ Summary: false, OutlineLevel: 1 }));
            ok = eq("44 rows at 40 a sheet are two of 22", span(ganttSheets(flat, 40, false)),
                    "22,22") && ok;
            const orphan = Array.from({ length: 10 }, (_, i) =>
                ({ Summary: i === 4, OutlineLevel: i === 4 ? 1 : 2 }));
            ok = eq("a summary is not the last row of a sheet",
                    span(ganttSheets(orphan, 6, false)), "4,6") && ok;
            const phased = [
                { Summary: true, OutlineLevel: 0 },
                { Summary: true, OutlineLevel: 1 }, { Summary: false, OutlineLevel: 2 },
                { Summary: false, OutlineLevel: 2 },
                { Summary: true, OutlineLevel: 1 }, { Summary: false, OutlineLevel: 2 },
            ];
            ok = eq("a sheet per phase, the project's summary with the first",
                    span(ganttSheets(phased, 40, true)), "4,2") && ok;
            ok = eq("and one sheet without", span(ganttSheets(phased, 40, false)), "6") && ok;
            /* Joined: phases that fit whole share a sheet, and one that does
             * not still starts its own. */
            const trio = [
                { Summary: true, OutlineLevel: 1 }, { Summary: false, OutlineLevel: 2 },
                { Summary: false, OutlineLevel: 2 },
                { Summary: true, OutlineLevel: 1 }, { Summary: false, OutlineLevel: 2 },
                { Summary: true, OutlineLevel: 1 }, { Summary: false, OutlineLevel: 2 },
                { Summary: false, OutlineLevel: 2 }, { Summary: false, OutlineLevel: 2 },
            ];
            ok = eq("short phases joined on one sheet",
                    span(ganttSheets(trio, 5, true, true)), "5,4") && ok;
            ok = eq("but not when not asked", span(ganttSheets(trio, 5, true, false)),
                    "3,2,4") && ok;

            /* Fit to sheets tall: the rows get shorter until they fit. */
            const fit = ganttPrint(many, "", { kind: "gantt", tall: 2 });
            ok = eq("fit to two sheets tall", fit.tall, 2) && ok;
            ok = eq("by shorter rows", fit.rowH < 18, true) && ok;
            const tiny = ganttPrint(new MspProject({ Name: "Enorme",
                Tasks: Array.from({ length: 400 }, (_, i) => task(i + 1, `T${i + 1}`, 1)) }),
                "", { kind: "gantt", tall: 1 });
            ok = eq("but not shorter than can be read", tiny.rowH, 9) && ok;
            ok = eq("so more sheets are the answer", tiny.tall > 1, true) && ok;

            /* The dates printed: each end on its own, the other the plan's. */
            const dated = ganttPrint(project, "", { kind: "gantt", from: "2026-09-08" });
            ok = eq("a range starts where it was asked",
                    dated.range.from, localMs(2026, 8, 8)) && ok;
            ok = eq("and ends where the plan does", dated.range.to, one.range.to) && ok;
            const wrong = ganttPrint(project, "", { kind: "gantt", from: "2026-09-10",
                                                     to: "2026-09-01" });
            ok = eq("a range backwards is the plan's", wrong.range.from, one.range.from) && ok;

            /* The mural: one picture, cut into tiles that overlap, with a guide
             * first; the picture is as wide as the tiles across less what they
             * share. */
            const mural = ganttPrint(many, "", { kind: "gantt", mural: true, wide: 3 });
            ok = eq("a mural is its tiles and a guide",
                    mural.pages, mural.wide * mural.tall + 1) && ok;
            ok = eq("tiles share the overlap",
                    mural.mural.W, 3 * mural.mural.stepW + mural.mural.lap) && ok;
            ok = eq("and no guide when not asked",
                    ganttPrint(many, "", { kind: "gantt", mural: true, wide: 3, guide: false })
                        .pages, mural.wide * mural.tall) && ok;
            ok = eq("nor for a mural of one sheet",
                    ganttPrint(project, "", { kind: "gantt", mural: true }).pages, 1) && ok;
            const muralText = (n) => {
                const log = new CallLog();
                mural.draw(log, n, mural.width, mural.height, false);
                return log.calls.filter((c) => c.name === "Text")
                                .map((c) => String(c.args[0]).trim());
            };
            ok = eq("the guide comes first",
                    muralText(1).some((t) => t.endsWith(Locale.Text("Assembly guide"))), true) && ok;
            /* The table is drawn once, at the mural's left: the first tile has
             * the names and the second one across has none. */
            ok = eq("the names are on the first tile", muralText(2).includes("T1"), true) && ok;
            ok = eq("and not repeated on the next", muralText(3).includes("T1"), false) && ok;
            ok = eq("a tile says where it goes",
                    muralText(3).some((t) => t.startsWith(Locale.Text("Row {0}, column {1}", 1, 2))),
                    true) && ok;

            /* The legend names what is there and nothing else. */
            ok = eq("the legend has the critical bar and summaries, no milestone",
                    ["critical", "summary"].every((k) => one.legend.includes(k)) &&
                    !one.legend.includes("milestone"), true) && ok;
            ok = eq("and none when it is not wanted",
                    ganttPrint(project, "", { kind: "gantt", legend: false }).legend.length,
                    0) && ok;

            /* Every sheet carries the table and the ruler: the name of a row
             * is on the second sheet across as well as on the first. */
            const sheetLog = (lay, n) => {
                const log = new CallLog();
                lay.draw(log, n, lay.width, lay.height, false);
                return log.calls.filter((c) => c.name === "Text").map((c) => String(c.args[0]).trim());
            };
            ok = eq("the table is on the second sheet too",
                    sheetLog(three, 2).includes("Planos"), true) && ok;
            ok = eq("but not when it is not repeated",
                    sheetLog(bare, 2).includes("Planos"), false) && ok;
            ok = eq("a sheet says where it sits in the mural",
                    sheetLog(three, 2).includes(Locale.Text("Row {0}, column {1}", 1, 2)),
                    true) && ok;

            dlg.CmbKind.Index = 1;
            ok = eq("the dialog previews the chart", dlg.Sheet.Visible && !dlg.Preview.Visible,
                    true) && ok;
            dlg.SpnWide.Value = 2;
            ok = eq("and counts its sheets", dlg.LblPage.Text, `1 / ${dlg.layout.pages}`) && ok;
            dlg.DateFrom.Value = "2026-09-08";
            ok = eq("a date picked reaches the chart", dlg.layout.range.from,
                    localMs(2026, 8, 8)) && ok;
            dlg.BtnWholePlan_Click();
            ok = eq("and the whole plan is one button away", dlg.DateFrom.Value, "") && ok;
            const gpdf = File.Join(Environment.TempDirectory, "bintana-project-gantt-check.pdf");
            dlg.savePdf(gpdf);
            const ginfo = File.Info(gpdf);
            ok = eq("the chart's sheets are saved", !!ginfo && ginfo.Size > 0, true) && ok;
            File.Delete(gpdf);
            dlg.CmbKind.Index = 0;
            ok = eq("and the table comes back", dlg.Preview.Visible && !dlg.Sheet.Visible,
                    true) && ok;

            dlg.BtnClose_Click();
            ok = eq("the choices are kept", Settings.Get(REPORT_KEY + "orientation", ""),
                    "Portrait") && ok;
        } catch (e) {
            print(`report threw: ${e.message}\n${e.stack}`);
            ok = false;
        } finally {
            for (const key of ["path", "summaries", "stripes", "paper", "orientation",
                               "margins", "tasks", "columns", "zoom", "kind", "wide",
                               "repeat", "tall", "table", "phases", "pack", "legend", "mural", "overlap", "guide"]) {
                if (Dictionary.Has(kept, key)) Settings.Set(REPORT_KEY + key, kept[key]);
                else                           Settings.Delete(REPORT_KEY + key);
            }
        }

        print(ok ? "report ok" : "report FAILED");
        Application.Quit(ok ? 0 : 1);
    }

    checkStats() {
        let ok = true;
        const eq = (what, got, want) => {
            const same = got === want;
            print(`stats ${what}: ${got}${same ? "" : ` (want ${want})`} ` +
                  `${same ? "ok" : "FAILED"}`);
            return same;
        };
        try {
            /* A Monday-to-Friday week, the same shape `check-cpm` builds, and
             * four working days across the plan's own span. */
            const week = [];
            for (let day = 1; day <= 7; day++) {
                const working = day >= 2 && day <= 6;
                week.push(new MspWeekDay({
                    DayType: day, DayWorking: working,
                    WorkingTimes: working ? [
                        new MspWorkingTime({ FromTime: "08:00:00", ToTime: "12:00:00" }),
                        new MspWorkingTime({ FromTime: "13:00:00", ToTime: "17:00:00" }),
                    ] : [],
                }));
            }
            const calendar = new MspCalendar({
                UID: 1, Name: "Test", IsBaseCalendar: true, WeekDays: week,
            });
            const project = new MspProject({
                StartDate: "2026-09-07T08:00:00",
                StatusDate: "2026-09-09T08:00:00",
                CalendarUID: 1, Calendars: [calendar], CurrencyCode: "EUR",
                Tasks: [
                    /* A summary is structure, not a task: it is counted apart
                     * and weighs nothing in the percentage. */
                    new MspTask({ UID: 0, ID: 0, Name: "Plan", IsNull: false,
                                  Summary: true, OutlineLevel: 0 }),
                    new MspTask({ UID: 1, ID: 1, Name: "Design", IsNull: false,
                                  OutlineLevel: 1, Start: "2026-09-07T08:00:00",
                                  Finish: "2026-09-07T17:00:00",
                                  Work: "PT16H0M0S", PercentComplete: 100 }),
                    new MspTask({ UID: 2, ID: 2, Name: "Build", IsNull: false,
                                  OutlineLevel: 1, Start: "2026-09-08T08:00:00",
                                  Finish: "2026-09-10T17:00:00",
                                  Work: "PT16H0M0S", PercentComplete: 50,
                                  Deadline: "2026-09-09T08:00:00",
                                  Critical: true,
                                  Baselines: [new MspBaseline({
                                      Number: BASELINE, Finish: "2026-09-09T08:00:00",
                                      Work: "PT16H0M0S", Cost: 300 })] }),
                    new MspTask({ UID: 3, ID: 3, Name: "Ship", IsNull: false,
                                  OutlineLevel: 1, Milestone: true,
                                  Start: "2026-09-10T17:00:00",
                                  Finish: "2026-09-10T17:00:00" }),
                    /* A blank row is structure too, and is left out. */
                    new MspTask({ UID: 4, ID: 4, IsNull: true }),
                ],
                Resources: [
                    new MspResource({ UID: 1, Name: "Ana", Type: 1,
                                      MaxUnits: 1, StandardRate: 50 }),
                    new MspResource({ UID: 2, Name: "Bricks", Type: 0,
                                      MaxUnits: 1, StandardRate: 120 }),
                ],
                Assignments: [
                    new MspAssignment({ UID: 1, TaskUID: 1, ResourceUID: 1,
                                        Units: 1, Work: "PT8H0M0S" }),
                    /* Both of Design's tasks overlap on the Tuesday, so Ana is
                     * at two units where her maximum is one. */
                    new MspAssignment({ UID: 2, TaskUID: 2, ResourceUID: 1,
                                        Units: 1, Work: "PT8H0M0S" }),
                    new MspAssignment({ UID: 3, TaskUID: 2, ResourceUID: 2,
                                        Units: 10, Work: "PT0H0M0S" }),
                ],
            });

            const s = projectStats(project);

            /* The span: Monday to Friday is five calendar days and four
             * working ones, and the reading sits on the Wednesday, which is
             * two working days in and three out -- the Tuesday's holiday is
             * why. */
            ok = eq("tasks", s.tasks, 3) && ok;
            ok = eq("summaries are not tasks", s.summaries, 1) && ok;
            ok = eq("milestones", s.milestones, 1) && ok;
            ok = eq("critical", s.critical, 1) && ok;
            ok = eq("done", s.done, 1) && ok;
            ok = eq("in progress", s.running, 1) && ok;
            ok = eq("not started", s.waiting, 1) && ok;
            /* Weighed by work: 16h at a hundred and 16h at fifty is 75 per
             * cent, and the milestone with no work weighs nothing at all. */
            ok = eq("complete", `${Math.round(s.percent * 1000) / 1000}%`, "75%") && ok;
            ok = eq("calendar days", s.calendarDays, 4) && ok;
            ok = eq("working days", s.workingDays, 4) && ok;
            ok = eq("elapsed", s.elapsed, 2) && ok;
            ok = eq("remaining", s.remaining, 2) && ok;
            ok = eq("not behind", s.behind, 0) && ok;

            /* The cost: Ana's two assignments at 8h and 50 are 800,
             * and ten units of brick at 120 are 1200 -- the material is by
             * units, not by hours. */
            ok = eq("total cost", s.cost, 2000) && ok;
            ok = eq("work resources", s.kindWork, 800) && ok;
            ok = eq("material resources", s.kindMaterial, 1200) && ok;
            ok = eq("cost resources", s.kindCost, 0) && ok;
            ok = eq("baseline cost", s.baselineCost, 300) && ok;
            ok = eq("cost variance", s.cost - s.baselineCost, 1700) && ok;
            ok = eq("work", s.work, "PT32H0M0S") && ok;

            /* The delay: Build finishes on the Thursday against a Wednesday
             * deadline and a Wednesday baseline finish -- **one** day late,
             * because a delay counts the days between and not the day it
             * landed in as well. */
            ok = eq("tasks late", s.late.length, 1) && ok;
            ok = eq("worst slip", s.worstLate, 1) && ok;
            ok = eq("past deadline", s.lateDeadline, 1) && ok;
            ok = eq("past baseline", s.lateBaseline, 1) && ok;
            ok = eq("the late task", s.late[0].Name, "Build") && ok;
            ok = eq("its promise", s.late[0].Promised,
                    whenMs("2026-09-09T08:00:00")) && ok;
            ok = eq("and its finish", s.late[0].Finished,
                    whenMs("2026-09-10T17:00:00")) && ok;
            ok = eq("constraints not met", s.notMet, 0) && ok;

            /* Over-allocation is read here as it is in the Peak column and in
             * the log: two units where the maximum is one. */
            ok = eq("over-allocated", s.overAllocated, 1) && ok;

            /* A plan the file never scheduled has no dates and no promises:
             * nothing is late, and no date is invented to say so. */
            const empty = projectStats(new MspProject({
                Calendars: [calendar],
                Tasks: [new MspTask({ UID: 1, ID: 1, Name: "T", IsNull: false })],
            }));
            ok = eq("an unscheduled plan has no start", empty.start, null) && ok;
            ok = eq("and is not behind", empty.behind, 0) && ok;
            ok = eq("and nothing is late", empty.late.length, 0) && ok;

            /* **The schedule variance at the plan's own size**, which is
             * the span the baseline caught against the one the plan has now.
             *
             * This fixture's Build is the one task with a baseline and Project
             * wrote only its finish, which is a real shape: **so the variance is
             * an answer and the span is not.** A variance needs one date from
             * each side; a span needs both from the baseline, and half a
             * baseline is not a plan to compare a plan against.
             */
            ok = eq("no baseline, no variance", empty.variance, null) && ok;
            ok = eq("and no baseline span", empty.baselineFinish, null) && ok;
            ok = eq("half a baseline still varies", s.variance, 1) && ok;
            ok = eq("from the one date it wrote",
                    statsDateText(s.baselineFinish), "2026-09-09 08:00") && ok;
            ok = eq("but it is no span", s.baselineStart, null) && ok;
            ok = eq("so there are no baseline working days",
                    s.baselineWorkingDays, null) && ok;

            /* **And with a whole baseline** -- start and finish on two tasks --
             * the span is there to be compared, and the reading is calendar
             * days on purpose: this is the question a reader asks out loud
             * ("how late are we?"), while the per-task `FinishVariance` in
             * `check-cpm` is the one that belongs on the task's own calendar. */
            const moved = projectStats(new MspProject({
                StartDate: "2026-09-07T08:00:00", CalendarUID: 1,
                Calendars: [calendar],
                Tasks: [
                    new MspTask({ UID: 1, ID: 1, Name: "A", IsNull: false,
                                  Start: "2026-09-07T08:00:00",
                                  Finish: "2026-09-07T17:00:00",
                                  Baselines: [new MspBaseline({
                                      Number: BASELINE,
                                      Start: "2026-09-07T08:00:00",
                                      Finish: "2026-09-07T17:00:00" })] }),
                    new MspTask({ UID: 2, ID: 2, Name: "B", IsNull: false,
                                  Start: "2026-09-09T08:00:00",
                                  Finish: "2026-09-09T17:00:00",
                                  Baselines: [new MspBaseline({
                                      Number: BASELINE,
                                      Start: "2026-09-07T08:00:00",
                                      Finish: "2026-09-07T17:00:00" })] }),
                ] }));
            ok = eq("the baseline started", statsDateText(moved.baselineStart),
                    "2026-09-07 08:00") && ok;
            ok = eq("and ended", statsDateText(moved.baselineFinish),
                    "2026-09-07 17:00") && ok;
            ok = eq("covering one working day", moved.baselineWorkingDays,
                    1) && ok;
            ok = eq("and the plan is two calendar days late", moved.variance,
                    2) && ok;

            /* **A plan that finished early says so**, with a minus: the sign is
             * the whole of it, and a zero that could mean either would be the
             * same ambiguity the sentinel avoids per task. */
            const ahead = projectStats(new MspProject({
                StartDate: "2026-09-07T08:00:00", CalendarUID: 1,
                Calendars: [calendar],
                Tasks: [new MspTask({
                    UID: 1, ID: 1, Name: "T", IsNull: false,
                    Start: "2026-09-07T08:00:00", Finish: "2026-09-07T17:00:00",
                    Baselines: [new MspBaseline({
                        Number: BASELINE, Start: "2026-09-08T08:00:00",
                        Finish: "2026-09-09T17:00:00" })] })] }));
            ok = eq("early is negative", ahead.variance, -2) && ok;

            /* **The budget**, which lives on the assignment and not on the
             * plan -- the shape of the file decided where the number comes
             * from, so a budget entered as a project total would have nowhere
             * to be written. The plan's is the sum, and a plan that took none
             * has no variance to speak of: **zero is not "exactly on
             * budget"**, it is "no budget". */
            const money = projectStats(new MspProject({
                Calendars: [calendar],
                Resources: [
                    new MspResource({ UID: 1, Name: "Ana", Type: 1,
                                      MaxUnits: 1, StandardRate: 50 }),
                    new MspResource({ UID: 2, Name: "Bruno", Type: 1,
                                      MaxUnits: 1, StandardRate: 40 }),
                ],
                Assignments: [
                    new MspAssignment({ UID: 1, TaskUID: 1, ResourceUID: 1,
                                        Units: 1, Work: "PT8H0M0S",
                                        BudgetCost: 300 }),
                    new MspAssignment({ UID: 2, TaskUID: 2, ResourceUID: 2,
                                        Units: 1, Work: "PT8H0M0S",
                                        BudgetCost: 500 }),
                    new MspAssignment({ UID: 3, TaskUID: 3, ResourceUID: 1,
                                        Units: 1, Work: "PT8H0M0S" }),
                ] }));
            /* Two budgets against three assignments, so the sum is a sum and not
             * the only number there -- and the third was never budgeted, which
             * is the shape that makes the reading interesting: 8h at 50 twice
             * and 8h at 40 is 1120 of cost against 800 budgeted, so the plan is
             * **over** by 320, and the overage is exactly the assignment that
             * has no promise behind it. */
            ok = eq("the plan's budget is the sum", money.budget, 800) && ok;
            ok = eq("and the cost is what the engine derives", money.cost, 1120) && ok;
            ok = eq("so the variance is over", money.budgetVariance, 320) && ok;
            ok = eq("and the share of the budget is a percentage",
                    `${Math.round(money.budgetPercent)}%`, "140%") && ok;
            const unbudgeted = projectStats(new MspProject({
                Calendars: [calendar],
                Assignments: [new MspAssignment({
                    UID: 1, TaskUID: 1, ResourceUID: 1, Units: 1,
                    Work: "PT8H0M0S" })] }));
            ok = eq("no budget says none", unbudgeted.budget, 0) && ok;
            ok = eq("and has no variance to give",
                    unbudgeted.budgetVariance, null) && ok;
            ok = eq("nor a share", unbudgeted.budgetPercent, null) && ok;

            /* **And it survives the file**, like the variance: the sum is only
             * real if the numbers it adds are in the document. `BudgetWork` is
             * the other half and it is a duration as text, so a real file's
             * `PT0H0M0S` has to come back as it was written. */
            const held = newMspdi({ Name: "Budget" });
            held.project.Assignments = [new MspAssignment({
                UID: 1, TaskUID: 1, ResourceUID: 1, Units: 1,
                Work: "PT8H0M0S", BudgetCost: 742.5,
                BudgetWork: "PT0H0M0S" })];
            const file = File.Join(Environment.TempDirectory, "check-budget.xml");
            writeMspdi(file, held);
            const back = readMspdi(file);
            ok = eq("a budget is in the file",
                    back.project.Assignments[0].BudgetCost, 742.5) && ok;
            ok = eq("and the work beside it survives",
                    back.project.Assignments[0].BudgetWork, "PT0H0M0S") && ok;
            ok = eq("and the plan reads it back", projectStats(back.project).budget,
                    742.5) && ok;
            if (File.Exists(file)) File.Delete(file);

            print(ok ? "CHECK-OK" : "CHECK-FAILED");
            Application.Quit(ok ? 0 : 1);
        } catch (e) {
            print(`stats ERROR ${e.message}`);
            print("CHECK-FAILED");
            Application.Quit(1);
        }
    }

    /* **A blank plan is a frame the chart has to survive**, and the ruler is the
     * part of it that used to throw: it asks its own geometry for a span and a
     * plan with no task has none. Drawing is not reachable from here -- a
     * `Painter` is a runtime object, and a draw that throws is caught by the
     * runtime rather than raised -- so what this holds is the decision the draw
     * is made from, built from the same two calls `Header_Draw` builds it from,
     * which is the whole of the fix. */
    drawsEmpty() {
        return rulerHasRange(ganttGeometry(this.chartRows(), this.ganttWidth(),
                                          this.ganttHeight(), this.step,
                                          this.rulerGeom()));
    }

    /*
     * The welcome page: the window with nothing open, and what it offers.
     *
     * **It is asserted rather than looked at** because almost everything about it
     * is a decision rather than a drawing: which page a bare start lands on, what
     * the list of recents says when it is empty, that a row of it opens the same
     * file the menu's entry of that index opens, and that a blank plan survives
     * its own round trip -- which is the whole of what "New Project" is.
     */
    checkWelcome() {
        let ok = true;
        const eq = (what, got, want) => {
            const same = got === want;
            print(`welcome ${what}: ${got}${same ? "" : ` (want ${want})`} ` +
                  `${same ? "ok" : "FAILED"}`);
            return same;
        };
        try {
            /* A bare stack, not a notebook: there is nothing to click between a
             * plan and no plan, and a strip of two tabs over an empty workspace
             * would be a tab strip with nothing in it. */
            ok = eq("the pages are a bare stack", this.Pages.Strip, "None") && ok;
            ok = eq("with two of them", this.Pages.Count, 2) && ok;

            /* **A start with nothing named leaves nothing open**, which is the
             * one thing the page exists to say. `edit` is the document: null is
             * what "no file" is here, and it is what every command on the
             * workspace asks before it touches anything. */
            this.settingsReady = true;
            this.Pages.Current = PAGE_WELCOME;
            this.documentCommands(false);
            ok = eq("no document is loaded", this.edit, null) && ok;
            ok = eq("and the page is the welcome one", this.Pages.Current,
                    PAGE_WELCOME) && ok;

            /* **The menu bar is on the window, not on the workspace page**, so
             * the commands that need a plan have to be greyed here or they would
             * be a crash rather than a grey line. */
            ok = eq("Add Task is greyed", this.ActAdd.Enabled, false) && ok;
            ok = eq("Recalculate", this.ActRecalc.Enabled, false) && ok;
            ok = eq("the project's own data", this.ActProjData.Enabled,
                    false) && ok;
            ok = eq("Save", this.ActSave.Enabled, false) && ok;
            ok = eq("Save As", this.ActSaveAs.Enabled, false) && ok;
            ok = eq("Export", this.ActExport.Enabled, false) && ok;
            ok = eq("and Report", this.ActReport.Enabled, false) && ok;
            ok = eq("while New", this.ActNew.Enabled, true) && ok;
            ok = eq("and Open", this.ActOpen.Enabled, true) && ok;

            /* The list, empty and not: **one place decides whether there is
             * anything to open**, so the menu and the page cannot disagree. */
            this.showRecent([]);
            ok = eq("an empty list says so", this.WelcomeRecent.Items[0],
                    Locale.Text("(none yet)")) && ok;
            ok = eq("the menu is out of reach", this.MnuRecent.Enabled, false) && ok;
            ok = eq("and so is the page's", this.WelcomeRecent.Enabled, false) && ok;
            ok = eq("with no heading over it", this.LblWelcomeRecent.Visible, false) && ok;

            /* Two files, so the folder beside the name is what tells them apart
             * -- two plans called `plan.xml` are two plans. */
            const one = this.resolve(File.Join("tests", "corpus", "01-minimal.xml"));
            const two = this.resolve(File.Join("examples", "desarrollo-bintana.xml"));
            this.showRecent([one, two]);
            ok = eq("both are listed", this.WelcomeRecent.Count, 2) && ok;
            ok = eq("with the folder beside the name",
                    this.WelcomeRecent.Items[0],
                    `${File.Name(one)}  —  ${File.Directory(one)}`) && ok;
            ok = eq("and the heading is there", this.LblWelcomeRecent.Visible, true) && ok;
            ok = eq("and the list can be chosen from", this.WelcomeRecent.Enabled,
                    true) && ok;
            ok = eq("parallel to the menu's", this.recentPaths.join(","),
                    `${one},${two}`) && ok;

            /* A row opens what it names, and the selection is dropped so the same
             * row can be opened twice. */
            this.WelcomeRecent.Index = 1;
            this.WelcomeRecent_Select();
            ok = eq("a row opens the plan it names", this.path, two) && ok;
            ok = eq("which brings the workspace up", this.Pages.Current,
                    PAGE_WORK) && ok;
            ok = eq("and takes the row back", this.WelcomeRecent.Index, -1) && ok;

            /* And the workspace has nothing to hide now, so the panels were not
             * standing in for an empty screen -- and the door is open again. */
            ok = eq("the window is on the workspace", this.Tasks.Count > 0, true) && ok;
            ok = eq("and the commands that need a plan are back",
                    this.ActAdd.Enabled, true) && ok;

            /* **A new plan is a plan that already schedules**: a Standard
             * calendar of two shifts over a working week, no tasks, and no
             * complaint from the shape about any of it. The four values are the
             * dialog's, and the currency is none of them -- see `newMspdi`. */
            const made = File.Join(Environment.TempDirectory, "check-welcome.xml");
            const fresh = newMspdi({ Name: "Bienvenida",
                                     Title: "Un plan en blanco",
                                     Start: "2026-10-05",
                                     Folder: Environment.TempDirectory,
                                     File: "check-welcome.xml" });
            const p = fresh.project;
            ok = eq("a new plan is named after it", p.Name, "Bienvenida") && ok;
            ok = eq("and carries its title", p.Title,
                    "Un plan en blanco") && ok;
            ok = eq("starts when it was told", p.StartDate,
                    "2026-10-05T08:00:00") && ok;
            ok = eq("with the status date reading the same", p.StatusDate,
                    "2026-10-05T08:00:00") && ok;
            ok = eq("and no currency it was never told", p.CurrencyCode, "") && ok;
            ok = eq("and holds only the project summary",
                    p.Tasks.map((t) => `${t.UID}:${t.OutlineLevel}:${t.Name}`).join(" "),
                    "0:0:Bienvenida") && ok;
            ok = eq("with one calendar", p.Calendars.length, 1) && ok;
            ok = eq("named Standard", p.Calendars[0].Name, "Standard") && ok;
            ok = eq("which is the plan's own", p.CalendarUID,
                    p.Calendars[0].UID) && ok;
            ok = eq("of a five-day week", p.Calendars[0].WeekDays.length, 7) && ok;
            ok = eq("Monday works", p.Calendars[0].WeekDays[1].DayWorking, true) && ok;
            ok = eq("in two shifts", p.Calendars[0].WeekDays[1].WorkingTimes.length,
                    2) && ok;
            ok = eq("Saturday does not", p.Calendars[0].WeekDays[5].DayWorking,
                    false) && ok;
            ok = eq("and the shape modelled all of it", fresh.problems.length, 0) && ok;

            /* **It has to survive being written and read back**, or New Project
             * opens a file this app cannot show: that is what the road a blank
             * plan takes is, and it is the same one every corpus fixture walks. */
            writeMspdi(made, fresh);
            const back = readMspdi(made);
            ok = eq("and comes back with its name", back.project.Name,
                    "Bienvenida") && ok;
            ok = eq("its title", back.project.Title,
                    "Un plan en blanco") && ok;
            ok = eq("its calendar", back.project.Calendars.length, 1) && ok;
            ok = eq("and Monday's two shifts",
                    back.project.Calendars[0].WeekDays[1].WorkingTimes.length,
                    2) && ok;
            ok = eq("with nothing not modelled", back.problems.length, 0) && ok;

            /* **The dialog is what writes it**, so the dialog is what is
             * asserted: its own gates -- no name, a file that is taken, a name
             * that is a path, a folder that is not there, a start the shape will
             * not take -- and then the four fields read back as the values the
             * plan above was built from. The form parses and opens in this one
             * call, which is the other reason it is here: a `.form` that does
             * not load is a New Project that throws instead of opening. */
            let asked = null;
            const dlg = NewProjectForm.ask(Environment.TempDirectory,
                                           (values) => { asked = values; });
            ok = eq("Create is off with no name", dlg.BtnCreate.Enabled,
                    false) && ok;

            dlg.TxtName.Text  = "Bienvenida";
            dlg.TxtTitle.Text = "Un plan en blanco";
            dlg.TxtStart.Text = "2026-10-05";
            dlg.TxtFile.Text  = "check-welcome.xml";

            /* The file the round trip above just wrote is the one that says no:
             * **a new project never replaces what is there**, and it says which
             * before Create is pressed rather than after. */
            dlg.updateHint();
            ok = eq("a file that is there says so", dlg.LblHint.Text,
                    Locale.Text("There is already a file there.")) && ok;
            ok = eq("so Create is off", dlg.BtnCreate.Enabled, false) && ok;
            if (File.Exists(made)) File.Delete(made);
            dlg.updateHint();
            ok = eq("and with the path free the hint is the path", dlg.LblHint.Text,
                    made) && ok;

            dlg.TxtFile.Text = "no/name.xml";
            dlg.updateHint();
            ok = eq("a name that is a path is not one", dlg.BtnCreate.Enabled,
                    false) && ok;
            dlg.TxtFile.Text = "en un lugar que no existe";
            dlg.TxtFolder.Text = File.Join(Environment.TempDirectory, "nope");
            dlg.updateHint();
            ok = eq("and neither is a folder that is not there",
                    dlg.BtnCreate.Enabled, false) && ok;

            dlg.TxtFolder.Text = Environment.TempDirectory;
            dlg.TxtFile.Text = "check-welcome.xml";
            dlg.TxtStart.Text = "el martes que viene";
            dlg.updateHint();
            ok = eq("nor a start the shape will not take",
                    dlg.BtnCreate.Enabled, false) && ok;

            dlg.TxtStart.Text = "2026-10-05";
            dlg.TxtFile.Text = "check-welcome-new.xml";
            dlg.updateHint();
            ok = eq("with all four filled Create is on", dlg.BtnCreate.Enabled,
                    true) && ok;
            dlg.BtnCreate_Click();
            ok = eq("and the dialog hands back what it holds", asked.Name,
                    "Bienvenida") && ok;
            ok = eq("its title", asked.Title, "Un plan en blanco") && ok;
            ok = eq("its start", asked.Start, "2026-10-05") && ok;
            ok = eq("its folder", asked.Folder,
                    Environment.TempDirectory) && ok;
            ok = eq("and its file", asked.File,
                    "check-welcome-new.xml") && ok;

            /* **And it is what the window is opened with**, which is the part
             * that is not a round trip: an empty table, a panel with no task in
             * it, and a chart with no rows and no dates to scale. The last is
             * the one that used to throw, so what it has no is asserted. The
             * project summary is there and hidden, as a window shows it. */
            this.settingsReady = false;   // a check writes nothing to Settings
            this.projectSummary = false;
            this.newProject(asked);
            ok = eq("the workspace comes up", this.Pages.Current, PAGE_WORK) && ok;
            ok = eq("on the file the dialog named", this.path,
                    File.Join(asked.Folder, asked.File)) && ok;
            ok = eq("with an empty list", this.Tasks.Count, 0) && ok;
            ok = eq("and no timescale", this.chartRange(), null) && ok;
            ok = eq("so the ruler has no band to draw", this.drawsEmpty(),
                    false) && ok;
            this.MnuSummaryTask_Click(true);
            ok = eq("and the summary task is one tick away", this.Tasks.Count, 1) && ok;
            ok = eq("with no undo spent on a plan that had it", this.edit.dirty, false) && ok;
            this.projectSummary = true;
            if (File.Exists(made)) File.Delete(made);
            if (File.Exists(File.Join(Environment.TempDirectory,
                                      "check-welcome-new.xml")))
                File.Delete(File.Join(Environment.TempDirectory,
                                      "check-welcome-new.xml"));

            print(ok ? "CHECK-OK" : "CHECK-FAILED");
            Application.Quit(ok ? 0 : 1);
        } catch (e) {
            print(`welcome ERROR ${e.message}`);
            print("CHECK-FAILED");
            Application.Quit(1);
        }
    }

    /* The commands, pressed as commands.
     *
     * `checkWiring` asks whether a handler exists. This asks whether the command
     * **does something**: `Action.Execute()` is the same road the menu, the toolbar
     * and the keyboard take, so what is asserted here is what a reader presses and
     * not a method call.
     *
     * **Only the commands that edit the plan.** The rest open a dialog -- Open,
     * Save As, Export, Report, Settings, Columns, Calendar, Statistics, New
     * project -- and from here there is nobody to close it, because a modal
     * window is a modal window. Those keep `checkWiring`'s question, which is all
     * that can honestly be asked of them.
     */
    checkCommands() {
        let ok = true;
        const eq = (what, got, want) => {
            const same = got === want;
            print(`commands ${what}: ${got}${same ? "" : ` (want ${want})`} ` +
                  `${same ? "ok" : "FAILED"}`);
            return same;
        };
        try {
            /* **A grey command refuses, and says so.** `Action.Execute()` on a
             * disabled one throws `TypeError`, which is a better answer than
             * doing nothing quietly -- and it is the only thing that makes the
             * gate of `documentCommands` observable from here. */
            let ran = 0;
            const realDelete = this.ActDelete_Execute;
            this.ActDelete_Execute = () => { ran++; };
            this.ActDelete.Enabled = false;
            try {
                this.ActDelete.Execute();
                ok = eq("a grey command no se aprieta", ran, 0) && ok;
            } catch (e) {
                ok = eq("y lo dice", e.message, "ActDelete is disabled") && ok;
            }
            this.ActDelete_Execute = realDelete;

            /* The fixture the fidelity corpus uses: tasks in a chain, so a
             * command has something to move.
             *
             * **Picked by UID, not by row.** Every command rebuilds the table,
             * and the row an index named a moment ago is a different task by the
             * time the next command runs -- which is the whole of what a scripted
             * round of editing has to get right, and the reason the row is looked
             * up again each time instead of once at the start. */
            this.settingsReady = false;
            this.load(this.resolve(File.Join("tests", "corpus", "01-minimal.xml")));
            /* **Este check corre en el modo manual de Project a propósito**:
             * es sobre los comandos, y sus aserciones se escribieron donde nada
             * se recalcula solo. El recálculo tiene su bloque en `checkEdit`,
             * que prende el automático alrededor de sus propias ediciones. */
            this.edit.auto = false;
            const tasks = () => this.holder.project.Tasks.length;
            const level = (uid) => taskOf(this.holder.project, uid).OutlineLevel;
            const pick  = (uid) => {
                const rows = this.visibleTasks(this.holder.project);
                this.Tasks.DeselectAll();   // a pick is one row, as a plain click is
                this.Tasks.Select(rows.findIndex((t) => t.UID === uid));
                this.Tasks_Select();
            };

            /* A task that is not the summary, with room to be indented. */
            pick(1);
            ok = eq("hay una fila elegida", this.selectedUID === null, false) && ok;

            const before = tasks();
            this.ActAdd.Execute();
            ok = eq("agregar una tarea es una de mas", tasks(), before + 1) && ok;
            ok = eq("y es un undo", this.edit.canUndo, true) && ok;
            this.edit.undo();
            this.fill();
            ok = eq("deshecha vuelve al numero", tasks(), before) && ok;

            /* **Uid 2, not 1.** Both are level 1, and a first child cannot be
             * indented -- there is no sibling above it to become the parent --
             * so the command refuses, correctly. Asking for the second task is
             * what makes the assertion mean something. */
            pick(2);
            const was = level(2);
            this.ActIndent.Execute();
            ok = eq("indentar baja un nivel", level(2), was + 1) && ok;
            this.ActOutdent.Execute();
            ok = eq("y desindentar lo devuelve", level(2), was) && ok;

            /* Move down and back: the order is what the reader sees. */
            const order = () => this.holder.project.Tasks.map((t) => t.UID).join(",");
            pick(1);
            const first = order();
            this.ActDown.Execute();
            const moved = order();
            ok = eq("mover abajo cambia el orden", moved !== first, true) && ok;
            this.ActUp.Execute();
            ok = eq("y mover arriba lo devuelve", order(), first) && ok;

            /* Recalculate is the one that has no visible effect on a plan that
             * is already scheduled, so what it is asserted on is the log: it
             * says what it did either way. */
            const said = this.Log.Text;
            this.ActRecalc.Execute();
            ok = eq("recalcular dice que hizo", this.Log.Text !== said, true) && ok;

            /* Set Baseline touches every task, and it is the road that gives the
             * variance something to compare against. */
            this.ActBaseline.Execute();
            let baselined = 0;
            for (const t of this.holder.project.Tasks)
                if (t.Baselines.length) baselined++;
            ok = eq("la linea base alcanza a todas", baselined, tasks()) && ok;
            this.ActBaseline.Execute();
            ok = eq("y volver a guardarla reemplaza, no apila",
                    taskOf(this.holder.project, 1).Baselines.length, 1) && ok;

            this.ActFilter.Execute();
            ok = eq("el filtro toma el foco", this.TxtFilter.Focused, true) && ok;

            /* Copy and paste, at the layer that does the work (the clipboard
             * answers later, and a check cannot wait for it). */
            pick(1);
            const tasksBefore = tasks();
            this.ActCopy.Execute();
            ok = eq("copiar guarda la tarea", !!this.clip && this.clip.tasks.length >= 1,
                    true) && ok;
            const pasted = this.edit.pasteTasks(this.clip, 1);
            this.fill(pasted.UID);
            ok = eq("pegar agrega las tareas copiadas", tasks(),
                    tasksBefore + this.clip.tasks.length) && ok;
            ok = eq("con un UID propio", pasted.UID !== 1 &&
                    this.holder.project.Tasks.filter((t) => t.UID === pasted.UID).length,
                    1) && ok;
            ok = eq("y el mismo nombre", pasted.Name, taskOf(this.holder.project, 1).Name) && ok;
            this.ActUndo.Execute();
            ok = eq("deshacer el pegado lo quita", tasks(), tasksBefore) && ok;
            const lines = this.linesOf("Uno\t2d\nDos\n\n");
            ok = eq("el texto pegado es una tarea por linea", lines.length, 2) && ok;
            this.edit.pasteLines(lines, 1);
            ok = eq("y pegar lineas las agrega", tasks(), tasksBefore + 2) && ok;
            this.ActUndo.Execute();

            /* The status filter composes with the name's. */
            const all = this.visibleTasks(this.holder.project).length;
            this.CmbStatus.Index = 6;
            this.CmbStatus_Select();
            ok = eq("el filtro de estado acota", this.visibleTasks(this.holder.project).length <= all,
                    true) && ok;
            this.CmbStatus.Index = 0;
            this.CmbStatus_Select();
            ok = eq("y Todas lo devuelve", this.visibleTasks(this.holder.project).length, all) && ok;

            /* The outline and the zoom. */
            this.ActLevel1.Execute();
            this.ActExpandAll.Execute();
            this.ActZoomIn.Execute();
            ok = eq("acercar fija un ancho de dia", this.dayW !== null && this.dayW > 0, true) && ok;
            this.ActZoomFit.Execute();
            ok = eq("ajustar vuelve a la ventana", this.dayW, null) && ok;

            /* **Lo guardado es un estado, no un número de paso.** Guardar,
             * deshacer dos y hacer dos ediciones vuelve al mismo índice con
             * otro plan; y una pila llena que se llevó el estado guardado no
             * puede volver a él. Las dos tienen que seguir sucias. */
            const history = new Edit(this.holder);
            const step = (name, on = history) => {
                taskOf(this.holder.project, 1).Name = name;
                on.commit();
            };
            step("a"); step("b"); step("c");
            history.markSaved();
            history.undo(); history.undo();
            step("x"); step("y");
            ok = eq("el mismo paso con otro plan sigue sucio", history.dirty, true) && ok;

            const full = new Edit(this.holder);
            full.markSaved();
            for (let k = 0; k <= Edit.LIMIT; k++) step(`n${k}`, full);
            while (full.canUndo) full.undo();
            ok = eq("con la pila llena el guardado no vuelve", full.dirty, true) && ok;

            const recovered = new Edit(this.holder);
            recovered.markUnsaved();
            ok = eq("lo recuperado nace sucio", recovered.dirty, true) && ok;

            /* Dos `plan.xml` son dos planes, y dos autoguardados. */
            ok = eq("el autoguardado distingue la carpeta",
                    this.autosavePath("/a/plan.xml") !== this.autosavePath("/b/plan.xml"),
                    true) && ok;
            ok = eq("y conserva el nombre",
                    File.Name(this.autosavePath("/a/plan.xml")).startsWith("autosave-plan-"),
                    true) && ok;

            /* **Borrar una tarea se lleva sus asignaciones**: un trabajo que
             * nadie hace igual costaría en `projectCost` y se escribiría para
             * una tarea que no está. */
            const doc = new Edit(this.holder);
            const p = this.holder.project;
            const top = p.Tasks.reduce((m, t) => Math.max(m, t.UID), 0);
            const who = doc.addResource({ Name: "Quien", Type: 1 });
            doc.addAssignment(top, who.UID, 1);
            const onTop = () => p.Assignments.filter((x) => x.TaskUID === top).length;
            ok = eq("la tarea tiene su asignacion", onTop(), 1) && ok;
            doc.removeTask(top);
            ok = eq("y borrarla se la lleva", this.holder.project.Assignments
                    .filter((x) => x.TaskUID === top).length, 0) && ok;

            /* **Un UID borrado no vuelve.** La tarea nueva que tomaba el número
             * de la borrada heredaba su elemento del documento, con lo no
             * modelado adentro; ni deshacer el borrado devuelve el número. */
            const fresh = doc.addTask(null);
            ok = eq("la nueva no reusa el UID borrado", fresh.UID > top, true) && ok;
            doc.undo(); doc.undo();
            const again = doc.addTask(null);
            ok = eq("ni despues de deshacer", again.UID > fresh.UID, true) && ok;

            /* **Indentar mueve la rama entera.** t3 es hija de t2; indentar t2
             * bajo t1 la lleva a ella un nivel más abajo también, y desindentar
             * la devuelve -- antes t3 quedaba hermana de t2, o a dos niveles. */
            const t1 = doc.addTask(null);
            const t2 = doc.addTask(null);
            const t3 = doc.addTask(null);
            doc.indent(t3.UID, 1);
            const lv = () => [t1, t2, t3].map((t) =>
                taskOf(this.holder.project, t.UID).OutlineLevel - t1.OutlineLevel).join(",");
            ok = eq("t3 es hija de t2", lv(), "0,0,1") && ok;
            doc.indent(t2.UID, 1);
            ok = eq("indentar t2 se lleva a t3", lv(), "0,1,2") && ok;
            doc.indent(t2.UID, -1);
            ok = eq("y desindentar la trae", lv(), "0,0,1") && ok;

            /* **Una fecha tipeada sale con segundos**, que es lo que
             * `xsd:dateTime` pide; una fecha sola toma la hora que el que
             * llama sabe, y sin una queda como está para que el campo la
             * rechace. */
            ok = eq("con hora", parseMoment("2026-10-01 8:30"), "2026-10-01T08:30:00") && ok;
            ok = eq("con segundos", parseMoment("2026-10-01T08:30:15"),
                    "2026-10-01T08:30:15") && ok;
            ok = eq("sola con la hora del que llama",
                    parseMoment("2026-12-25", "23:59:00"), "2026-12-25T23:59:00") && ok;
            ok = eq("sola sin hora no se inventa", parseMoment("2026-12-25"),
                    "2026-12-25") && ok;

            /* **Lo que un guardado borró vuelve con el undo.** El autoguardado
             * escribía en el árbol vivo, y `SaveXml` le sacaba el elemento de la
             * tarea borrada: deshacer devolvía el registro sin sus
             * TimephasedData. Cada escritura parte ahora del archivo leído. */
            const phased = readMspdi(this.resolve(File.Join("tests", "corpus",
                                                            "06-timephased-custom.xml")));
            const undoable = new Edit(phased);
            const scratch = File.Join(Environment.TempDirectory, "check-undo-saved.xml");
            const phasesOf = () => {
                const tasks = File.LoadXml(scratch).Root.Find("Tasks");
                const back = tasks && tasks.FindAll("Task")
                    .find((t) => t.Find("UID").Text === "1");
                return back ? back.FindAll("TimephasedData").length : -1;
            };
            undoable.removeTask(1);
            writeMspdi(scratch, phased);           // el autoguardado
            ok = eq("guardada sin la tarea", phasesOf(), -1) && ok;
            undoable.undo();
            writeMspdi(scratch, phased);
            ok = eq("y deshecha vuelve con lo no modelado", phasesOf(), 2) && ok;

            /* **Reasignar el mismo recurso actualiza la asignación**, no la
             * reemplaza: el UID y lo no modelado (las TimephasedData del 06)
             * son de la que ya estaba. */
            const asg = phased.project.Assignments[0];
            const keptUID = asg.UID;
            asg.Cost = 1280;                       // lo que el archivo costeó
            undoable.addAssignment(asg.TaskUID, asg.ResourceUID, 0.5);
            const now = phased.project.Assignments.filter(
                (x) => x.TaskUID === asg.TaskUID && x.ResourceUID === asg.ResourceUID);
            ok = eq("reasignar no duplica", now.length, 1) && ok;
            ok = eq("y conserva el UID", now[0].UID + ":" + now[0].Units, keptUID + ":0.5") && ok;
            ok = eq("y su costo viejo deja de mandar", now[0].Cost, 0) && ok;
            writeMspdi(scratch, phased);
            const asgEl = File.LoadXml(scratch).Root.Find("Assignments").FindAll("Assignment")
                .find((x) => x.Find("UID").Text === String(keptUID));
            ok = eq("ni lo no modelado", asgEl ? asgEl.FindAll("TimephasedData").length : -1,
                    2) && ok;
            File.Delete(scratch);

            /* **Renombrar una excepción recurrente no la vuelve un rango.** El
             * diálogo la rearmaba con los campos que muestra y perdía el tipo, el
             * período, los días de la semana y las ocurrencias: "cada lunes diez
             * semanas" quedaba como un rango diario. */
            const cal = new MspCalendar({ UID: 9, Name: "Con recurrente" });
            cal.Exceptions = [new MspException({
                Name: "Cada lunes", Type: 5, Period: 1, DaysOfWeek: 2,
                EnteredByOccurrences: true, Occurrences: 10, DayWorking: false,
                TimePeriod: new MspTimePeriod({ FromDate: "2026-09-07T00:00:00",
                                                ToDate: "2026-11-09T23:59:00" }) })];
            let saved = null;
            const rdlg = CalendarForm.open(this.holder.project, cal, (v) => { saved = v; });
            rdlg.Exc.Index = 0;
            rdlg.Exc_Select();
            rdlg.TxtExcName.Text = "Lunes sin trabajo";
            rdlg.BtnExcAdd_Click();
            const rex = rdlg.excRows[0];
            ok = eq("renombrada, sigue siendo recurrente",
                    [rex.Name, rex.Type, rex.Period, rex.DaysOfWeek,
                     rex.Occurrences, rex.EnteredByOccurrences].join("/"),
                    "Lunes sin trabajo/5/1/2/10/true") && ok;
            ok = eq("y conserva su período", rex.TimePeriod.ToDate,
                    "2026-11-09T23:59:00") && ok;
            rdlg.Close();

            /* **Un elemento nuevo cae donde el esquema lo pone**, aunque lo que
             * viene después no sea nuestro. La tarea 1 de este plan trae
             * `IsPublished` y `CommitmentType` -- que las formas no modelan -- y
             * ningún vínculo; el que se le agrega tiene que quedar antes de
             * ellos, que es lo que la `xsd:sequence` pide, y no al final. */
            const sequenced = readMspdi(this.resolve(File.Join("tests", "corpus",
                                        "11-unmodeled-order.xml")));
            const seqEdit = new Edit(sequenced);
            seqEdit.setLinks(1, [new MspLink({ PredecessorUID: 5, Type: 1 })]);
            const seqFile = File.Join(Environment.TempDirectory, "bintana-project-order.xml");
            writeMspdi(seqFile, sequenced);
            const seqTask = File.LoadXml(seqFile).Root.Find("Tasks").FindAll("Task")
                .find((t) => t.Find("UID").Text === "1");
            const seqNames = seqTask.Children.map((c) => c.Name);
            File.Delete(seqFile);
            ok = eq("el vínculo nuevo va antes de lo que no modelamos",
                    seqNames.indexOf("PredecessorLink") >= 0 &&
                    seqNames.indexOf("PredecessorLink") < seqNames.indexOf("IsPublished") &&
                    seqNames.indexOf("IsPublished") < seqNames.indexOf("CommitmentType"),
                    true) && ok;

            /* **Borrar una excepción no le pasa su recurrencia a la otra.** Sin
             * clave se emparejan por posición, y la segunda se escribía en el
             * elemento de la primera conservando su `Month`/`MonthDay`. */
            const yearly = (name, month, day) =>
                `<Exception><EnteredByOccurrences>true</EnteredByOccurrences>` +
                `<TimePeriod><FromDate>2026-01-01T00:00:00</FromDate>` +
                `<ToDate>2030-12-31T23:59:00</ToDate></TimePeriod>` +
                `<Occurrences>5</Occurrences><Name>${name}</Name><Type>5</Type>` +
                `<MonthDay>${day}</MonthDay><Month>${month}</Month>` +
                `<DayWorking>false</DayWorking></Exception>`;
            const calText = File.Load(this.resolve(File.Join("tests", "corpus",
                                                             "04-calendars.xml")))
                .replace(/<Exceptions>[\s\S]*?<\/Exceptions>/,
                         `<Exceptions>${yearly("Año nuevo", 0, 1)}` +
                         `${yearly("Navidad", 11, 25)}</Exceptions>`);
            const calFile = File.Join(Environment.TempDirectory, "check-exceptions.xml");
            File.Save(calFile, calText);
            const cals = readMspdi(calFile);
            const withTwo = cals.project.Calendars.find((c) => c.Exceptions.length === 2);
            withTwo.Exceptions = withTwo.Exceptions.slice(1);
            writeMspdi(calFile, cals);
            const left = File.LoadXml(calFile).Root.Find("Calendars").FindAll("Calendar")
                .map((c) => c.Find("Exceptions")).filter((x) => x)
                .flatMap((x) => x.FindAll("Exception"));
            ok = eq("queda la de Navidad, con su fecha",
                    left.map((x) => [x.Find("Name").Text, x.Find("Month").Text,
                                     x.Find("MonthDay").Text].join("/")).join(" "),
                    "Navidad/11/25") && ok;
            File.Delete(calFile);

            /* **Volver a guardar la línea base no deja la vieja al lado.** El
             * elemento se empareja por `Number`; lo que no se modelaba quedaba,
             * y la línea base nueva tenía fechas nuevas con la duración vieja. */
            const baseFile = File.Join(Environment.TempDirectory, "check-baseline.xml");
            File.Save(baseFile, File.Load(this.resolve(File.Join("tests", "corpus",
                                                             "06-timephased-custom.xml")))
                .replace("<Work>PT16H0M0S</Work>\n      </Baseline>",
                         "<Duration>PT8H0M0S</Duration><Work>PT16H0M0S</Work>" +
                         "<BCWS>99</BCWS>\n      </Baseline>"));
            const based = readMspdi(baseFile);
            new Edit(based).setBaseline(0);
            writeMspdi(baseFile, based);
            const baseEl = File.LoadXml(baseFile).Root.Find("Tasks").FindAll("Task")
                .find((t) => t.Find("UID").Text === "1").Find("Baseline");
            const textOf = (name) => (baseEl.Find(name) || { Text: "-" }).Text;
            ok = eq("la linea base nueva tiene su duracion y no la vieja",
                    [textOf("Duration"), textOf("BCWS")].join(" "), "PT16H0M0S -") && ok;
            File.Delete(baseFile);

            /* **Abrir otro plan con trabajo sin guardar pregunta**, y sin
             * trabajo no. La pregunta se intercepta: lo que se afirma es que
             * se hace y que el plan no se reemplaza antes de la respuesta. */
            const realAsk = ConfirmForm.ask;
            let asked = 0, accept = null;
            ConfirmForm.ask = (title, message, yes, onConfirm) => {
                asked++; accept = onConfirm;
            };
            try {
                this.edit = new Edit(this.holder);
                let opened = 0;
                this.confirmDiscard(() => { opened++; });
                ok = eq("sin cambios no pregunta", asked + ":" + opened, "0:1") && ok;
                taskOf(this.holder.project, 1).Name = "sin guardar";
                this.edit.commit();
                this.confirmDiscard(() => { opened++; });
                ok = eq("con cambios pregunta antes", asked + ":" + opened, "1:1") && ok;
                accept();
                ok = eq("y descartar abre", opened, 2) && ok;
            } finally {
                ConfirmForm.ask = realAsk;
            }

            /* **Un vínculo FF es FF.** El índice 2 del combo es el tipo 0 de
             * MSPDI, y `|| 1` lo volvía FS; actualizarlo conserva la unidad en
             * que el archivo mostraba el retraso. */
            this.load(this.resolve(File.Join("tests", "corpus", "01-minimal.xml")));
            const succ = taskOf(this.holder.project, 2);
            this.putLink(succ, 1, 2, 0);
            const ff = taskOf(this.holder.project, 2).Links.find((l) => l.PredecessorUID === 1);
            ok = eq("fin a fin se guarda como FF", ff.Type, 0) && ok;
            ff.LagFormat = 7;
            this.putLink(taskOf(this.holder.project, 2), 1, 0, 4800);
            const fs = taskOf(this.holder.project, 2).Links.find((l) => l.PredecessorUID === 1);
            ok = eq("actualizar conserva el formato del retraso",
                    [fs.Type, fs.LinkLag, fs.LagFormat].join(" "), "1 4800 7") && ok;

            /* **El resumen del proyecto no es una tarea más**: no se borra, y
             * agregar después de él es agregar al final, en el nivel 1. */
            const summary = this.holder.project.Tasks.find((t) => t.OutlineLevel === 0);
            if (summary) {
                ok = eq("el resumen del proyecto no se borra",
                        this.edit.removeTask(summary.UID), false) && ok;
                ok = eq("agregar tras el resumen es nivel 1",
                        this.edit.addTask(summary.UID).OutlineLevel, 1) && ok;
                this.edit.undo();
                this.fill();
            }

            /* **La EDT se renumera con cada edición**, como en Project: una
             * tarea indentada pasa a ser 1.1, la que sigue corre su número,
             * y un código que el archivo eligió (no el número de esquema) no
             * se toca. */
            {
                const numbers = () => this.holder.project.Tasks
                    .map((t) => `${t.OutlineNumber}/${t.WBS}`).join(" ");
                const build = taskOf(this.holder.project, 2);
                const added = this.edit.addTask(2);
                ok = eq("una tarea nueva toma su número", numbers(),
                        "0/0 1/1 2/2 3/3") && ok;
                this.edit.indent(added.UID, 1);
                ok = eq("indentar renumera la EDT", numbers(),
                        "0/0 1/1 1.1/1.1 2/2") && ok;
                build.WBS = "B-7";
                this.edit.indent(build.UID, 1);
                ok = eq("un código propio queda", numbers(),
                        "0/0 1/1 1.1/1.1 1.2/B-7") && ok;
                this.edit.undo(); this.edit.undo(); this.edit.undo();
                this.fill();
            }

            /* **Hitos y resúmenes en un paso**, como Insertar hito e
             * Insertar tarea de resumen de Project: el hito no dura y está
             * marcado; el resumen toma el lugar de la tarea y la deja debajo,
             * con lo que cuelga de ella; sin tarea, viene con una adentro. */
            {
                const shape = () => this.holder.project.Tasks
                    .map((t) => `${t.OutlineNumber}${t.Summary ? "S" : ""}${t.Milestone ? "M" : ""}`)
                    .join(" ");
                const hito = this.edit.addMilestone(2);
                ok = eq("el hito va tras la tarea, sin duración",
                        `${shape()} ${hito.Duration} ${durationText(hito, this.holder.project)}`,
                        "0S 1 2M 3 PT0H0M0S 0d") && ok;
                this.edit.undo();
                this.Tasks.Key = "2";
                this.Tasks_Select();
                this.ActAddSummary.Execute();
                const sum = this.selectedTask();
                ok = eq("el resumen va sobre la tarea seleccionada",
                        `${shape()} ${sum.Name === Locale.Text("New summary task")}`,
                        "0S 1 2S 2.1 true") && ok;
                ok = eq("y la tarea queda debajo con su vínculo",
                        taskOf(this.holder.project, 2).Links.length, 1) && ok;
                this.edit.undo();
                ok = eq("un solo deshacer", shape(), "0S 1 2") && ok;
                this.edit.addSummary(null);
                ok = eq("sin tarea, viene con una adentro", shape(), "0S 1 2 3S 3.1") && ok;
                this.edit.undo();

                /* **Sobre varias**: el resumen toma de la primera a la última
                 * y las deja debajo; indentar varias es un paso, y una que
                 * cuelga de otra elegida se mueve una sola vez, con ella. */
                this.edit.addSummary([1, 2]);
                ok = eq("un resumen sobre dos", shape(), "0S 1S 1.1 1.2") && ok;
                this.edit.undo();
                const c = this.edit.addTask(null).UID;  // 3, al final
                ok = eq("indentar dos de una", this.edit.indent([2, c], 1) &&
                        shape() === "0S 1S 1.1 1.2", true) && ok;
                this.edit.undo();
                this.edit.indent(c, 1);                 // c bajo 2
                ok = eq("la que cuelga de otra elegida va con ella",
                        this.edit.indent([2, c], 1) && shape(), "0S 1S 1.1S 1.1.1") && ok;
                ok = eq("y sacarlas de a dos también",
                        this.edit.indent([2, c], -1) && shape(), "0S 1 2S 2.1") && ok;
                this.edit.undo(); this.edit.undo(); this.edit.undo(); this.edit.undo();
                ok = eq("cada uno, un deshacer", shape(), "0S 1 2") && ok;
                this.fill();

                /* Lo mismo desde la tabla: dos filas elegidas, los comandos
                 * del menú, y la selección sigue siendo las dos. */
                this.Tasks.Key = "1";
                this.Tasks_Select();
                this.Tasks.SelectedKeys = ["1", "2"];
                ok = eq("la tabla toma dos filas", this.selectedUIDs().join(","), "1,2") && ok;
                this.ActAddSummary.Execute();
                ok = eq("el resumen sobre las elegidas", shape(), "0S 1S 1.1 1.2") && ok;
                this.edit.undo();
                this.fill(1);
                this.Tasks.SelectedKeys = ["1", "2"];
                this.ActIndent.Execute();
                ok = eq("indentar las elegidas", shape(), "0S 1S 1.1") && ok;
                ok = eq("y siguen elegidas", this.Tasks.SelectedKeys.join(","), "1,2") && ok;
                this.edit.undo();
                this.fill();
            }

            /* **Los comandos sobre la selección**: borrar, mover y copiar
             * varias en un paso; vincular en cadena y desvincular; y el
             * avance de varias, que en un resumen marca sus tareas. */
            {
                const plan = () => this.holder.project;
                const order = () => plan().Tasks.map((t) => t.UID).join(",");
                const links = () => plan().Tasks
                    .flatMap((t) => t.Links.map((l) => `${l.PredecessorUID}>${t.UID}`)).join(" ");
                const c = this.edit.addTask(null).UID;   // 0,1,2,c
                this.edit.unlinkTasks([2]);
                ok = eq("desvincular una le saca todos sus vínculos", links(), "") && ok;
                ok = eq("vincular tres en cadena", this.edit.linkTasks([1, 2, c]), 2) && ok;
                ok = eq("en el orden del plan", links(), `1>2 2>${c}`) && ok;
                ok = eq("vincular otra vez no repite", this.edit.linkTasks([1, 2]), 0) && ok;
                ok = eq("desvincular varias saca los de entre ellas",
                        this.edit.unlinkTasks([2, c]) && links(), "1>2") && ok;
                ok = eq("bajar dos juntas", this.edit.moveTask([1, 2], 1) && order(),
                        `0,${c},1,2`) && ok;
                ok = eq("la primera no sube y retiene a la otra",
                        this.edit.moveTask([c, 1], -1), false) && ok;
                ok = eq("subir dos juntas", this.edit.moveTask([1, 2], -1) && order(),
                        `0,1,2,${c}`) && ok;
                const clip = this.edit.copyTasks([1, c]);
                ok = eq("copiar varias", clip.tasks.map((t) => t.UID).join(","), `1,${c}`) && ok;
                this.edit.addSummary([2, c]);
                const sumUID = plan().Tasks[2].UID;
                ok = eq("el avance de un resumen marca sus tareas",
                        this.edit.setPercent([sumUID], 100) &&
                        [2, c].map((u) => taskOf(plan(), u).PercentComplete).join(","), "100,100") && ok;
                ok = eq("y les da fin real", taskOf(plan(), 2).ActualFinish !== "", true) && ok;
                ok = eq("volver a 50 saca el fin real",
                        this.edit.setPercent([2], 50) && taskOf(plan(), 2).ActualFinish, "") && ok;
                ok = eq("borrar varias de una", this.edit.removeTask([1, sumUID]) && order(), "0") && ok;
                this.edit.undo();
                ok = eq("y vuelven con un deshacer", order(), `0,1,${sumUID},2,${c}`) && ok;
                this.load(this.resolve(File.Join("tests", "corpus", "01-minimal.xml")));
            }

            /* **Como en Project**: una tarea nueva es `1d?` y va arriba de la
             * elegida, a su nivel; Cortar es copiar y borrar en un paso, y
             * pegar la deja arriba de la fila que se elija; y los atajos son
             * los de Project. */
            {
                const plan = () => this.holder.project;
                const order = () => plan().Tasks.map((t) => t.UID).join(",");
                const nueva = this.edit.addTask(2);
                ok = eq("una tarea nueva es 1d?, arriba de la elegida",
                        `${durationText(nueva, plan())} ${order()}`,
                        `1d? 0,1,${nueva.UID},2`) && ok;
                ok = eq("y al final sin elegida", this.edit.addTask(null) &&
                        order(), `0,1,${nueva.UID},2,${nueva.UID + 1}`) && ok;
                this.edit.undo(); this.edit.undo();
                this.fill(1);
                this.Tasks.Key = "1";
                this.Tasks_Select();
                ok = eq("Ctrl+X corta", this.rowKey("x", true) && order(), "0,2") && ok;
                ok = eq("y el corte sale con un deshacer",
                        this.edit.undo() && order(), "0,1,2") && ok;
                this.fill(2);
                this.Tasks.Key = "1";
                this.Tasks_Select();
                this.ActCut.Execute();
                this.fill(2);
                this.Tasks.Key = "2";
                this.Tasks_Select();
                const back = this.edit.pasteTasks(this.clip, 2);
                ok = eq("pegar arriba de la elegida", order(), `0,${back.UID},2`) && ok;
                const keys = {};
                for (const name of ["ActIndent", "ActOutdent", "ActUp", "ActDown", "ActTaskInfo", "ActCut"])
                    keys[name] = this[name] ? "ok" : "no";
                ok = eq("los comandos están", JSON.stringify(keys),
                        '{"ActIndent":"ok","ActOutdent":"ok","ActUp":"ok","ActDown":"ok","ActTaskInfo":"ok","ActCut":"ok"}') && ok;
                this.load(this.resolve(File.Join("tests", "corpus", "01-minimal.xml")));
            }

            /* **La tarea de resumen del proyecto**, como en Project: un plan
             * nuevo la trae, la vista la oculta o la muestra sin tocar el
             * archivo, y un plan sin ella la recibe al pedirla, en un paso
             * que se deshace. */
            {
                const blank = newMspdi({ Name: "Obra", Start: "2026-11-02" }).project;
                const zero = blank.Tasks[0];
                ok = eq("un plan nuevo trae la tarea 0",
                        `${blank.Tasks.length} ${zero.UID} ${zero.OutlineLevel} ${zero.Summary} ${zero.Name}`,
                        "1 0 0 true Obra") && ok;
                const project = this.holder.project;
                const rows = () => this.visibleTasks(project).map((t) => t.UID).join(",");
                this.projectSummary = false;
                ok = eq("oculta, la fila 0 no está", rows(), "1,2") && ok;
                this.projectSummary = true;
                ok = eq("visible, sí", rows(), "0,1,2") && ok;
                ok = eq("un plan que ya la tiene no recibe otra",
                        this.edit.addProjectSummary(), null) && ok;
                project.Tasks.shift();
                const made = this.edit.addProjectSummary();
                ok = eq("un plan sin ella la recibe primera",
                        `${project.Tasks[0] === made} ${made.UID} ${made.ID} ${made.Summary}`,
                        "true 0 0 true") && ok;
                this.edit.addTask(made.UID);
                ok = eq("y sigue siendo resumen", made.Summary, true) && ok;
                this.load(this.resolve(File.Join("tests", "corpus", "01-minimal.xml")));
            }

            /* **El `?` es la estimación**, como en Project: `2d` la deja
             * firme, `2d?` estimada, y un formato estimado del archivo (39)
             * no le devuelve el `?` a lo que se tipeó sin él. */
            {
                const project = this.holder.project;
                const task = taskOf(project, 1);
                const typed = (text) => {
                    const v = this.cellValues(task, "duration", text);
                    return `${v.values.Estimated} ${v.answer}`;
                };
                task.Estimated = true;
                task.DurationFormat = 39;
                ok = eq("2d es firme", typed("2d"), "false 2d") && ok;
                ok = eq("2d? es estimada", typed("2d?"), "true 2d?") && ok;
                ok = eq("un número solo conserva la unidad", typed("3"), "false 3d") && ok;
                ok = eq("el formato pierde su variante estimada",
                        parseDuration("2", 39, "", project).format, 7) && ok;
                this.load(this.resolve(File.Join("tests", "corpus", "01-minimal.xml")));
            }

            /* **Predecesoras por Id y por EDT**, como las dos columnas de
             * Project: el Id es la fila (no el UID), la EDT es el código, y
             * un código con guion no se confunde con un retraso. */
            {
                const project = this.holder.project;
                const build = taskOf(project, 2);
                const added = this.edit.addTask(2);   // arriba de Build: fila 2, Build pasa a la 3
                added.WBS = "B-7";
                ok = eq("Build es la fila 3", build.ID, 3) && ok;
                let got = this.linkValues(build, "1, 2FS+4h", "ID");
                ok = eq("por Id se nombra la fila",
                        got.links.map((l) => `${l.PredecessorUID}:${l.LinkLag}:${l.LagFormat}`).join(" "),
                        `1:0:7 ${added.UID}:2400:5`) && ok;
                build.Links = got.links;
                ok = eq("el texto por Id", linksText(build, project, "ID"), "1, 2FS+4h") && ok;
                ok = eq("el texto por EDT", linksText(build, project, "WBS"), "1, B-7FS+4h") && ok;
                got = this.linkValues(build, "B-7SS-1d", "WBS");
                ok = eq("un código con guion es el código",
                        got.links.map((l) => `${l.PredecessorUID}:${l.Type}:${l.LinkLag < 0}`).join(" "),
                        `${added.UID}:3:true`) && ok;
                ok = eq("una fila que no está",
                        this.linkValues(build, "9", "ID").refused,
                        Locale.Text("There is no task {0}.", "9")) && ok;
                ok = eq("un código que no está",
                        this.linkValues(build, "Z-1", "WBS").refused,
                        Locale.Text("There is no task {0}.", "Z-1")) && ok;
                this.edit.undo();
                this.fill();
            }

            /* **Los recursos se escriben en la celda**, como en la columna
             * Nombres de los recursos de Project: un nombre que el plan no
             * tiene se crea, otro escrito con otras mayúsculas es el mismo, las
             * unidades van entre corchetes y todo es un solo paso. */
            {
                const project = () => this.holder.project;
                const colsWere = this.columns.slice();
                this.setColumns(["resources"]);
                const atRes = this.tableColumns().indexOf("resources");
                const build = () => taskOf(project(), 2);
                const units = (name) => {
                    const r = project().Resources.find((x) => x.Name === name);
                    const a = r && project().Assignments.find(
                        (x) => x.TaskUID === 2 && x.ResourceUID === r.UID);
                    return a ? a.Units : null;
                };
                const stepWas = this.edit.at;
                const resWas  = project().Resources.length;

                ok = eq("dos nombres en la celda",
                        this.Tasks.Emit("CellEdit", "2", atRes, "Ana; Bruno[50%]") !== false,
                        true) && ok;
                ok = eq("crean los dos recursos", project().Resources.length, resWas + 2) && ok;
                ok = eq("y los asignan", `${units("Ana")} ${units("Bruno")}`, "1 0.5") && ok;
                ok = eq("en un solo paso", this.edit.at, stepWas + 1) && ok;
                ok = eq("la celda los nombra",
                        resourcesText(build(), project()), "Ana; Bruno[50%]") && ok;

                ok = eq("lo mismo otra vez no es un paso",
                        this.Tasks.Emit("CellEdit", "2", atRes, "Ana; Bruno[50]") !== false &&
                        this.edit.at, stepWas + 1) && ok;

                this.Tasks.Emit("CellEdit", "2", atRes, " ana [25%] ");
                ok = eq("otras mayúsculas son el mismo recurso",
                        project().Resources.length, resWas + 2) && ok;
                ok = eq("las unidades cambian y el que falta se va",
                        `${units("Ana")} ${units("Bruno")}`, "0.25 null") && ok;

                ok = eq("un corchete que no es un número se rechaza",
                        this.Tasks.Emit("CellEdit", "2", atRes, "Ana[mucho]"), false) && ok;
                ok = eq("y unas unidades sin nombre",
                        this.Tasks.Emit("CellEdit", "2", atRes, "[50%]"), false) && ok;
                ok = eq("la coma decimal dentro del corchete",
                        JSON.stringify(parseResourceNames("A[12,5%], B").resources),
                        '[{"Name":"A","Amount":12.5},{"Name":"B"}]') && ok;

                this.Tasks.Emit("CellEdit", "2", atRes, "");
                ok = eq("vaciarla desasigna", units("Ana"), null) && ok;

                /* Un material lleva su cantidad, no un porcentaje. */
                this.edit.addResource({ Name: "Cemento", Type: 0, MaterialLabel: "bolsas" });
                this.Tasks.Emit("CellEdit", "2", atRes, "Cemento[10]");
                ok = eq("un material lleva cantidad", units("Cemento"), 10) && ok;
                ok = eq("y su etiqueta",
                        resourcesText(build(), project()), "Cemento[10 bolsas]") && ok;

                while (this.edit.at > stepWas) this.edit.undo();
                this.fill();
                ok = eq("deshacer se lleva los recursos creados",
                        `${project().Resources.length} ${units("Ana")}`, `${resWas} null`) && ok;
                this.setColumns(colsWere);
            }

            /* Lo que el modelo escribe tiene que poder leerse: un minuto
             * partido va a los segundos, la medianoche es 00:00 y un nombre
             * con `$` es ese nombre. */
            ok = eq("medio minuto va a los segundos",
                    `${mspdiDuration(480.5)} ${mspdiMinutes(mspdiDuration(480.5))}`,
                    "PT8H0M30S 480.5") && ok;
            ok = eq("el fin del día es 00:00", clockText(1440), "00:00:00") && ok;
            ok = eq("un nombre con $ es ese nombre",
                    newMspdi({ Name: "A$'B $MADE $$" }).project.Name, "A$'B $MADE $$") && ok;
            const spans = parseSpans("8:00-12:00 13:00-24:00");
            ok = eq("los horarios se leen con o sin cero",
                    spans.map((wt) => `${wt.FromTime}-${wt.ToTime}`).join(" "),
                    "08:00:00-12:00:00 13:00:00-00:00:00") && ok;
            ok = eq("y lo que no se lee se dice", parseSpans("08-12"), null) && ok;

            print(ok ? "CHECK-OK" : "CHECK-FAILED");
            Application.Quit(ok ? 0 : 1);
        } catch (e) {
            print(`commands ERROR ${e.message}`);
            print("CHECK-FAILED");
            Application.Quit(1);
        }
    }

    /*
     * The chart's pointer, headless: the same handlers a drag calls, with the
     * coordinates the chart's own geometry gives, so a moved bar is a moved
     * date and a resize is a duration.
     */
    checkDrag() {
        let ok = true;
        const eq = (what, got, want) => {
            const same = got === want;
            print(`drag ${what}: ${got}${same ? "" : ` (want ${want})`} ` +
                  `${same ? "ok" : "FAILED"}`);
            return same;
        };
        try {
            this.load(this.resolve(File.Join("tests", "corpus", "01-minimal.xml")));
            const edit = this.edit;

            /* **La geometría se mide en el modo manual**: las fechas que este
             * check escribe son el fixture del puntero -- dónde cae una barra,
             * dónde el extremo de un vínculo -- y con el automático encendido el
             * pase las movería y los puntos medidos ya no serían los mismos. */
            edit.auto = false;

            /* Where the first task's bar is, from the chart's own geometry --
             * which is the table's row height and heading, so the y a pointer
             * is given and the y the table draws the row at are one number. */
            const g = ganttGeometry(this.chartRows(), this.ganttWidth(),
                                    this.ganttHeight(), this.step, this.planGeom());
            const at = (rows, task) =>
                g.headH + rows.indexOf(task) * g.rowH + g.rowH / 2 - g.scrollY;
            const task = edit.task(1);
            const y    = at(g.rows, task);
            const mid  = g.x((whenMs(task.Start) + whenMs(task.Finish)) / 2);
            const end  = g.x(whenMs(task.Finish));

            /* The tooltip: a bar says its task, an empty spot says nothing, and
             * what is told is set on the chart and not repeated while the words
             * do not change. */
            const tip = this.tipAt(mid, y);
            ok = tip.indexOf(task.Name) >= 0 && tip.indexOf("→") > 0 &&
                 this.tipAt(g.plotX - 4, y) === "" && ok;
            this.Gantt_MouseMove(mid, y);
            ok = this.tipText === tip && ok;
            this.Gantt_MouseLeave();
            ok = this.tipText === "" && ok;
            print(`edit tooltip=${tip.split("\n").length} lines`);

            /* The pointer says what it can do: a bar is held, its right edge
             * resizes, Ctrl on a bar starts a dependency, nothing is the arrow,
             * and a drag in progress says what it is doing. */
            ok = this.hoverCursor(mid, y, false) === "Grab" &&
                 this.hoverCursor(end - 1, y, false) === "ResizeHorizontal" &&
                 this.hoverCursor(mid, y, true) === "Crosshair" &&
                 this.hoverCursor(g.plotX - 4, y, false) === "Auto" && ok;
            this.Gantt_MouseMove(mid, y, 0, false, false);
            ok = this.cursorName === "Grab" && ok;
            this.Gantt_MouseDown(mid, y, 1, false, false);
            this.Gantt_MouseMove(mid + 2 * g.dayW, y, 1, false, false);
            ok = this.cursorName === "Grabbing" && ok;
            this.Gantt_MouseUp();
            /* Whatever it is over now, and not the hand of the gesture. */
            ok = this.cursorName !== "Grabbing" &&
                 this.cursorName === this.hoverCursor(mid + 2 * g.dayW, y, false) && ok;
            edit.undo();
            this.Gantt_MouseLeave();
            ok = this.cursorName === "Auto" && ok;
            print(`edit cursor=${this.cursorName}`);

            /* Move it two days: both dates travel, the duration does not. */
            this.Gantt_MouseDown(mid, y, 1, false, false);
            this.Gantt_MouseMove(mid + 2 * g.dayW, y);
            this.Gantt_MouseUp();
            ok = eq("move start", edit.task(1).Start, "2026-09-03T08:00:00") && ok;
            ok = eq("move finish", edit.task(1).Finish, "2026-09-04T17:00:00") && ok;
            ok = eq("move duration", edit.task(1).Duration, "PT8H0M0S") && ok;
            edit.undo();
            ok = eq("move undone", edit.task(1).Start, "2026-09-01T08:00:00") && ok;

            /* **A bar dropped on a weekend lands on the calendar's next
             * working moment**, keeping its working duration: four days from
             * Tuesday is a Saturday, and the task starts that Monday and runs
             * its two days from there. */
            this.Gantt_MouseDown(mid, y, 1, false, false);
            this.Gantt_MouseMove(mid + 4 * g.dayW, y);
            this.Gantt_MouseUp();
            ok = eq("move onto a weekend: start", edit.task(1).Start,
                    "2026-09-07T08:00:00") && ok;
            ok = eq("and the same working time", edit.task(1).Finish,
                    "2026-09-08T17:00:00") && ok;
            edit.undo();

            /* The end edge resizes: the duration follows the finish. The
             * fixture's calendar is Monday to Friday, so three calendar days
             * from Tuesday are three working ones. */
            this.Gantt_MouseDown(end, y, 1, false, false);
            this.Gantt_MouseMove(end + g.dayW, y);
            this.Gantt_MouseUp();
            ok = eq("resize finish", edit.task(1).Finish, "2026-09-03T17:00:00") && ok;
            ok = eq("resize duration", edit.task(1).Duration, "PT24H0M0S") && ok;
            edit.undo();

            /* **Ctrl from one bar to another draws a link**, and the halves of
             * the bars say which kind. The fixture has 2 after 1 already, so the
             * gestures here go from 1 to 2 and each one *replaces* that link --
             * which is what a second link between the same two tasks means. The
             * undo replaced the records, so the geometry is taken again. */
            const g2   = ganttGeometry(this.chartRows(), this.ganttWidth(),
                                       this.ganttHeight(), this.step, this.planGeom());
            const one  = edit.task(1), two = edit.task(2);
            const y1   = at(g2.rows, one), y2 = at(g2.rows, two);
            const bar  = (task) => ({ a: g2.x(whenMs(task.Start)),
                                      b: g2.x(whenMs(task.Finish)) });
            const b1 = bar(one), b2 = bar(two);
            const quarter = (b) => (b.b - b.a) / 4;
            const typeOf = () => edit.task(2).Links[0].Type;
            const draw = (fromX, toX, shift) => {
                this.Gantt_MouseDown(fromX, y1, 1, true, !!shift);
                this.Gantt_MouseMove(toX, y2);
                const made = this.drag ? this.drag.type : null;
                this.Gantt_MouseUp();
                return made;
            };

            /* Ctrl+Shift ignores the halves and draws finish to start, MSPDI's 1. */
            draw((b1.a + b1.b) / 2, (b2.a + b2.b) / 2, true);
            ok = eq("link count", edit.task(2).Links.length, 1) && ok;
            ok = eq("link predecessor", edit.task(2).Links[0].PredecessorUID, 1) && ok;
            ok = eq("link type", typeOf(), 1) && ok;
            edit.undo();

            ok = eq("right half to left half is FS",
                    draw(b1.b - quarter(b1), b2.a + quarter(b2)), 1) && ok;
            edit.undo();
            ok = eq("left half to left half is SS",
                    draw(b1.a + quarter(b1), b2.a + quarter(b2)), 3) && ok;
            ok = eq("and it is written", typeOf(), 3) && ok;
            edit.undo();
            ok = eq("right half to right half is FF",
                    draw(b1.b - quarter(b1), b2.b - quarter(b2)), 0) && ok;
            ok = eq("and it is written too", typeOf(), 0) && ok;
            edit.undo();
            ok = eq("left half to right half is SF",
                    draw(b1.a + quarter(b1), b2.b - quarter(b2)), 2) && ok;
            edit.undo();

            /* **What may not be drawn is refused with its reason**: 2 is already
             * after 1, so 1 after 2 would close a loop, and a task is not its
             * own predecessor. The gesture that tries says so beside the pointer
             * and writes nothing -- the engine used to take the loop silently. */
            ok = eq("a loop is refused", edit.linkProblem(2, 1, 1),
                    "That link would close a loop.") && ok;
            ok = eq("itself too", edit.linkProblem(1, 1, 1),
                    "A task cannot depend on itself.") && ok;
            ok = eq("an honest link is not", edit.linkProblem(1, 2, 1), "") && ok;
            ok = eq("a summary and its own tasks", edit.linkProblem(0, 1, 1),
                    "A summary and its own tasks cannot be linked.") && ok;
            const before = edit.task(1).Links.length;
            this.Gantt_MouseDown(b2.b - quarter(b2), y2, 1, true, false);
            this.Gantt_MouseMove(b1.a + quarter(b1), y1);
            const shown = this.drag ? this.drag.label : "";
            this.Gantt_MouseUp();
            ok = eq("the refusal is the label", shown,
                    "That link would close a loop.") && ok;
            ok = eq("and nothing is written", edit.task(1).Links.length, before) && ok;

            /* **A link is a thing on the chart**: a click on its line chooses it,
             * Delete takes it out as one undo, and a handle moves an end. The
             * point is on the vertical stretch of the elbow, level with the
             * predecessor and past its bar, where no bar is. */
            const geo = () => ganttGeometry(this.chartRows(), this.ganttWidth(),
                                            this.ganttHeight(), this.step, this.planGeom());
            const shapeOf = () => ganttLinkOf(geo(), 1, 2);
            const bar2 = (task, gg) => ({ a: gg.x(whenMs(task.Start)),
                                          b: gg.x(whenMs(task.Finish)) });
            let sh = shapeOf();
            this.TxtName.SetFocus();      // where the keyboard usually is
            this.Gantt_MouseDown(sh.pts[2], sh.pts[3] + 4, 1, false, false);
            this.Gantt_MouseUp();
            ok = eq("a click on a link chooses it", JSON.stringify(this.selLink),
                    '{"succ":2,"pred":1}') && ok;
            ok = eq("and the chart can hold the keyboard", this.Gantt.Focusable, true) && ok;
            ok = eq("and takes it from the name field",
                    `${this.Gantt.Focused}/${this.TxtName.Focused}`, "true/false") && ok;
            ok = eq("Delete takes it out", this.Gantt_KeyPress("Delete") + ":" +
                    edit.task(2).Links.length, "true:0") && ok;
            edit.undo();
            ok = eq("in one undo", edit.task(2).Links.length, 1) && ok;
            ok = eq("a click elsewhere chooses nothing", (() => {
                this.Gantt_MouseDown(2, 2, 1, false, false); this.Gantt_MouseUp();
                return this.selLink; })(), null) && ok;

            /* Moving an end: a third task, dated, to move the link to. */
            const three = edit.addTask(null);
            edit.setFields(three.UID, { Start: "2026-09-04T08:00:00",
                                        Finish: "2026-09-04T17:00:00" });
            sh = shapeOf();
            this.Gantt_MouseDown(sh.pts[2], sh.pts[3] + 4, 1, false, false);
            this.Gantt_MouseUp();
            const g4 = geo();
            sh = ganttLinkOf(g4, 1, 2);
            const yThree = at(g4.rows, edit.task(three.UID));
            const xThree = g4.x(whenMs(edit.task(three.UID).Start)) + 6;
            const n = sh.pts.length;
            this.Gantt_MouseDown(sh.pts[n - 2], sh.pts[n - 1], 1, false, false);
            ok = eq("the end of a chosen link is a handle", this.drag && !!this.drag.relink, true) && ok;
            this.Gantt_MouseMove(xThree, yThree);
            const kept = this.drag ? this.drag.label : "";
            this.Gantt_MouseUp();
            ok = eq("it keeps the link's own type while it moves", kept, "FS") && ok;
            ok = eq("and the link is now the third task's",
                    `${edit.task(2).Links.length}/${edit.task(three.UID).Links.length}/` +
                    `${edit.task(three.UID).Links[0].PredecessorUID}/${edit.task(three.UID).Links[0].Type}`,
                    "0/1/1/1") && ok;
            edit.undo();
            ok = eq("in one undo, back where it was",
                    `${edit.task(2).Links.length}/${edit.task(three.UID).Links.length}`, "1/0") && ok;
            edit.undo();
            edit.undo();
            this.selLink = null;

            /* **A short bar can still be picked up**: two hours is a few pixels
             * wide, and its grip used to be all of it. The middle moves it and
             * only the far end stretches it. */
            const brief = edit.addTask(null);
            edit.setFields(brief.UID, { Start: "2026-09-02T08:00:00",
                                        Finish: "2026-09-02T10:00:00" });
            const gb = geo();
            const bb = bar2(edit.task(brief.UID), gb);
            const by = at(gb.rows, edit.task(brief.UID));
            ok = eq("a bar of a few pixels moves from its middle",
                    (this.ganttHit((bb.a + bb.b) / 2, by) || {}).zone, "bar") && ok;
            ok = eq("and stretches from its far end",
                    (this.ganttHit(bb.b, by) || {}).zone, "end") && ok;
            edit.undo();
            edit.undo();

            /* **A link is drawn as the type it is**: a start-to-start one leaves
             * its predecessor's start and turns on the left of both bars, where
             * a finish-to-start one turns on the right. */
            const fsShape = shapeOf();
            edit.setLinks(2, [new MspLink({ PredecessorUID: 1, Type: 3 })]);
            const ssShape = shapeOf();
            ok = eq("a finish-to-start link turns on the right",
                    fsShape.pts[2] > Math.max(fsShape.x0, fsShape.x1), true) && ok;
            ok = eq("a start-to-start one on the left, from the start",
                    ssShape.pts[2] < Math.min(ssShape.x0, ssShape.x1) &&
                    ssShape.ends.from === "start", true) && ok;
            ok = eq("and it arrives, head first, at the successor's start",
                    ssShape.pts[ssShape.pts.length - 2] === ssShape.x1 &&
                    ssShape.pts[ssShape.pts.length - 4] < ssShape.x1, true) && ok;
            edit.undo();

            print(ok ? "CHECK-OK" : "CHECK-FAILED");
            Application.Quit(ok ? 0 : 1);
        } catch (e) {
            print(`drag ERROR ${e.message}`);
            print("CHECK-FAILED");
            Application.Quit(1);
        }
    }

    /*
     * The classic view: the plan on the left, the chart on the right, one
     * scroll between them. Nothing here asserts a pixel -- a row is as tall as
     * the theme says and the assertion would be the theme's. What is asserted is
     * the arithmetic the two panes stand on:
     *
     *   - the table's own numbers are there to be read (a row, a heading, and
     *     the rows' extent being the count of them times one, to the pixel);
     *   - the chart draws in the list's coordinates, so row `i` is at
     *     `head + i * row - scroll` in both;
     *   - the two panes are the same rectangle in the `Split`;
     *   - the list is the only thing that scrolls down, and the chart is where
     *     it is;
     *   - folding a branch does not make a row a different height, which is
     *     what would separate the panes the moment the user closed something.
     */
    checkView() {
        let ok = true;
        const eq = (what, got, want) => {
            const same = got === want;
            print(`view ${what}: ${got}${same ? "" : ` (want ${want})`} ` +
                  `${same ? "ok" : "FAILED"}`);
            return same;
        };
        const yes = (what, cond, got) => {
            const same = !!cond;
            print(`view ${what}: ${got === undefined ? "" : got} ` +
                  `${same ? "ok" : "FAILED"}`);
            return same;
        };
        /* The app's own sample, which is a plan of a real size: a scroll is
         * only a thing to assert when there is more of the plan than the pane
         * shows, and the fixtures are four tasks. */
        this.load(this.resolve(File.Join("examples", "desarrollo-bintana.xml")));

        /* A row added in this turn has no height yet, and a row's height is
         * asked of a measurement that a half-built window has not done: the
         * numbers are the next frames'. The same wait the runtime's own suite
         * writes for a measurement -- **on the allocation and not only on the
         * row**, because a row's height can be measured before the control that
         * draws it has been given a rectangle, and a check that read the first
         * and stopped there would be reading half of what it came for. */
        this.viewTries = 60;
        /* The strip is in the waiting too, and it is the newest number here: its
         * height is asked for in its own draw (the sizing pass would not take
         * it), so the first frames have it at nothing and the row alignment is
         * only true once it has been given a rectangle. */
        const ready = () => this.Tasks.Height > 0 && this.Tasks.HeaderHeight > 0 &&
                          this.Tasks.RowHeight > 0 &&
                          this.Header.Bounds().Height > 0;
        const wait = () => {
            if (ready() || this.viewTries-- <= 0) {
                if (!ready())
                    print(`view the table was never laid out ` +
                          `(${this.Tasks.Height}px, header ${this.Tasks.HeaderHeight}, ` +
                          `row ${this.Tasks.RowHeight})`);
                this.viewAssertions(eq, yes);
                return;
            }
            Timer.After(10, wait);
        };
        wait();
    }

    viewAssertions(eq, yes) {
        let ok = true;
        try {
            const t = this.Tasks;
            const rowH  = t.RowHeight, headH = t.HeaderHeight;
            const view  = t.Height - headH;
            const rows  = ganttRows(this.holder.project).length;
            ok = yes("the table says how tall a row is", rowH > 0, rowH) && ok;
            ok = yes("and how tall its heading is", headH > 0, headH) && ok;
            /* The rows' own height is the count of them times one. A plan that
             * fits its pane has no scroll and its `ScrollMaxY` is 0, so the
             * other side of the identity is the rows' natural height -- which
             * is what `RowHeight` reads, and what a viewport must not change. */
            const rowsH = rowH * t.Count;
            ok = eq("the rows are the count of them times one",
                    rowsH, Math.max(t.ScrollMaxY, 0) + Math.max(view, 0)) && ok;

            /* The two panes, in the Split's own coordinates: **the heading is a
             * control now**, so the table and the strip are what share a top,
             * and the strip's height is the table's own heading. That one number
             * is what keeps the first row on each side of the divider on the same
             * line -- the strip a pixel short and the whole plan is skewed by
             * one. */
            const tb = t.Bounds(this.PlanSplit), hb = this.Header.Bounds(this.PlanSplit);
            const gb = this.Gantt.Bounds(this.PlanSplit);
            ok = eq("the list and the strip share a top", tb.Y, hb.Y) && ok;
            ok = eq("the strip is as tall as the list's heading",
                    Math.round(hb.Height), headH) && ok;
            ok = eq("so the chart starts one heading lower",
                    Math.round(gb.Y - tb.Y), headH) && ok;
            ok = eq("and the two end on the same line",
                    Math.round(tb.Y + tb.Height), Math.round(gb.Y + gb.Height)) && ok;

            /* **A heading is a control, not a picture**, and it is a header the
             * way the list's is: the `button` class, which is what a column
             * view's own heading is. */
            ok = eq("the strip sits on the ground the list's heading does",
                    this.Header.Style, "view") && ok;

            /* The chart's geometry is the list's, in every part. */
            const g = this.planGeom();
            ok = eq("the chart's row is the list's row", g.rowH, rowH) && ok;
            ok = eq("and the chart carries no heading of its own", g.headH, 0) && ok;
            ok = eq("and it starts at the pane's edge, the names being in the list",
                    g.plotX, PAD) && ok;
            /* And the ruler's frame is the heading the list says it is. */
            const rg = this.rulerGeom();
            ok = eq("the ruler's frame is the list's heading", rg.headH, headH) && ok;
            ok = yes("and it is told the band is painted for it", rg.strip === true) && ok;

            /* One scroll: the list moves, the chart follows, and a pointer
             * over a row of the chart is a row of the list. */
            ok = yes("the plan is taller than the pane", t.ScrollMaxY > 0,
                     `${t.ScrollMaxY} of ${rows}px`) && ok;
            t.ScrollY = 0;
            ok = eq("the chart is at the top with it", this.planGeom().scrollY, 0) && ok;
            const down = Math.min(120, t.ScrollMaxY);
            t.ScrollY = down;
            ok = eq("and where the list went", this.planGeom().scrollY, down) && ok;

            /* The row a pointer is over is the row the chart drew, computed the
             * way the chart computed it -- the hit-test and the frame are one
             * geometry, and this is where that is said out loud. */
            const g5 = ganttGeometry(this.chartRows(), this.ganttWidth(),
                                     this.ganttHeight(), this.step, this.planGeom());
            const y5 = 5 * g5.rowH + g5.rowH / 2 - g5.scrollY;
            ok = eq("a pointer over the fifth row is the fifth row",
                    g5.rowAt(y5), 5) && ok;
            ok = eq("and over the strip above the chart, no row",
                    g5.rowAt(-4), -1) && ok;

            /* The wheel over the chart is the list's, since the chart cannot
             * scroll itself: a notch is three rows. `Emit` is what the runtime's
             * own suite installs a pointer event with. */
            const at = t.ScrollY;
            this.Gantt.Emit("MouseWheel", 0, 1);
            ok = eq("a notch over the chart moves the list by three rows",
                    t.ScrollY - at, 3 * rowH) && ok;
            this.Gantt.Emit("MouseWheel", 1, 0);
            ok = eq("and a horizontal notch leaves it alone", t.ScrollY - at,
                    3 * rowH) && ok;
            t.ScrollY = 0;

            /* And the other way round: the list's own scrollbar moves the
             * chart, which is the whole of one scroll between the two. */
            t.ScrollY = 200;
            ok = eq("the chart is where the list was scrolled to",
                    this.planGeom().scrollY, t.ScrollY) && ok;
            ok = yes("and a row moved off the top of the chart",
                     5 * g5.rowH - this.planGeom().scrollY < 0) && ok;

            /* **A rebuild is a redraw of the same view and not a move within
             * it**, so the list stays where the reader put it -- which it does
             * not do by itself: `Clear` empties it, an empty table has nowhere
             * to scroll to, and the adjustment is clamped to the top on the
             * way past. Every command ends in `fill`, so that one clamp was the
             * first keystroke of every edit throwing the reader back to the
             * first task. */
            t.ScrollY = Math.min(200, t.ScrollMaxY);
            const kept = t.ScrollY;
            this.fill(this.selectedUID);
            ok = eq("a rebuild keeps the scroll", t.ScrollY, kept) && ok;
            ok = eq("and the chart where it was", this.planGeom().scrollY, kept) && ok;

            /* And a click on a bar is not a command at all: a press and a
             * release with the pointer where it was has nothing to write, so
             * the table is not rebuilt. The log is the witness -- `fill` clears
             * it and writes the plan's summary back, and nothing else does. */
            const g6 = ganttGeometry(this.chartRows(), this.ganttWidth(),
                                     this.ganttHeight(), this.step, this.planGeom());
            let bar = null;
            for (let i = 0; i < g6.rows.length && !bar; i++) {
                const from = whenMs(g6.rows[i].Start), to = whenMs(g6.rows[i].Finish);
                const y = g6.headH + i * g6.rowH + g6.rowH / 2 - g6.scrollY;
                if (from === null || to === null || from === to) continue;
                if (y < g6.rowH || y > this.ganttHeight() - g6.rowH) continue;
                bar = { x: g6.x((from + to) / 2), y: y };
            }
            if (!bar) {
                print("view no bar on screen to click: the plan has none dated");
            } else {
                const said = this.Log.Text;
                this.Gantt_MouseDown(bar.x, bar.y, 1, false, false);
                this.Gantt_MouseUp();
                ok = yes("a click on a bar that moves nothing writes nothing",
                         this.Log.Text === said) && ok;
                ok = eq("and leaves the scroll alone", t.ScrollY, kept) && ok;
            }

            /* The scroll a frame later is the next phase's question. */
            this.viewRow = rowH;
            this.viewKeep(eq, yes, ok, kept);
        } catch (e) {
            print(`view ERROR ${e.message}`);
            print("CHECK-FAILED");
            Application.Quit(1);
        }
    }

    /*
     * **The scroll a frame later**, which is where it was lost: `fill` handed
     * it back and the assertion right after said so, and GTK laid the new
     * rows out on the next frame and put the list at its first row. So the
     * question is asked after the frame, twice: an edit that moves no row
     * (progress on a row on screen, the way the toolbar sets it), which is
     * written into the cells, and one that rebuilds the rows, which holds the
     * scroll against the layout.
     */
    viewKeep(eq, yes, ok, kept) {
        const t = this.Tasks;
        const plan = this.visibleTasks(this.holder.project);
        const first = Math.ceil(kept / this.viewRow) + 1;
        const task = plan.slice(first).find((x) => !x.Summary) || plan[first];
        const later = (then) => Timer.After(FOLD_POLL_MS * 2, then);
        const done = () => {
            t.ScrollY = 0;
            /* A branch closed is the next frame's arithmetic too, so it is
             * asked in the next phase. */
            t.ExpandAll();
            this.viewMax = t.ScrollMaxY;
            this.viewFilter = this.pickFilter();
            this.viewFold(eq, yes, ok);
        };
        if (!task) {
            print("view no row below the scroll to edit: the plan is short");
            done();
            return;
        }
        const was = task.PercentComplete || 0;
        this.edit.setFields(task.UID, { PercentComplete: was === 50 ? 60 : 50 });
        this.fill(task.UID);
        later(() => {
            try {
                ok = eq("an edit keeps the scroll after the layout too", t.ScrollY, kept) && ok;
                ok = eq("and the row says what was written",
                        t.Cell(String(task.UID), this.tableColumns().indexOf("percent")) ===
                        `${task.PercentComplete}%` || this.visibleColumns().indexOf("percent") < 0,
                        true) && ok;
                this.edit.undo();
                this.tableShape = null;          // as if a row had moved
                this.fill(task.UID);
                later(() => {
                    ok = eq("and so does a rebuild of the rows", t.ScrollY, kept) && ok;
                    done();
                });
            } catch (e) {
                print(`view ERROR ${e.message}`);
                print("CHECK-FAILED");
                Application.Quit(1);
            }
        });
    }

    /*
     * A branch closed: the rows that stay are the same rows, and the chart is
     * still lined up with them -- which is the case a row height is easy to get
     * wrong on, since a tree's `Count` does not move when a branch is folded
     * and the adjustment is a frame behind either way.
     */
    viewFold(eq, yes, ok) {
        const t = this.Tasks;
        /* A **nested** branch to fold: one with a few rows under it and rows
         * after it, which is the case where the two panes agree above the fold
         * and diverge below it. The root would fold to a single row and settle
         * nothing. */
        const plan = this.visibleTasks(this.holder.project);
        let key = null, fallback = null;
        for (let i = 0; i < plan.length && !key; i++) {
            if (!plan[i].Summary) continue;
            let below = 0;
            for (let k = i + 1;
                 k < plan.length && plan[k].OutlineLevel > plan[i].OutlineLevel; k++) below++;
            if (!below) continue;
            if (!fallback) fallback = String(plan[i].UID);
            if ((plan[i].OutlineLevel || 0) < 1) continue;
            if (below >= 2 && plan.length - i - 1 - below >= 3)
                key = String(plan[i].UID);
        }
        if (!key) key = fallback;
        if (!key || !t.Exists(key) || !t.Expanded(key)) {
            print("view no branch to fold: the plan is a flat list");
            this.viewFile(eq, yes, ok);
            return;
        }
        /* The fold is made with the first row selected and the list at the
         * top, so nothing has a reason to scroll: a selection further down is
         * one GTK keeps in view, and that scroll would raise the `Scroll` that
         * redraws the chart on its own. A frame is let through first, so the
         * chart has drawn the plan unfolded before it is folded. */
        const selected = this.selectedUID;
        t.Key = String(plan[0].UID);
        this.Tasks_Select();
        t.ScrollY = 0;
        Timer.After(FOLD_POLL_MS * 2, () => this.viewFoldNow(eq, yes, ok, key, selected));
    }

    viewFoldNow(eq, yes, ok, key, selected, tries = 0) {
        const t = this.Tasks;
        /* A reveal the earlier phases queued lands after the first tick and
         * takes the list to the end; once it has, the top is asked for again. */
        if (t.ScrollY !== 0 && tries < 3) {
            t.ScrollY = 0;
            Timer.After(FOLD_POLL_MS * 2,
                        () => this.viewFoldNow(eq, yes, ok, key, selected, tries + 1));
            return;
        }
        const span = this.chartRange();
        const scrolled = t.ScrollY;
        t.CollapseNode(key);
        /* Past one turn of the fold watch and the frame it asks for. */
        Timer.After(FOLD_POLL_MS * 3, () => {
            ok = yes("a folded branch does not change a row's height",
                     t.RowHeight === this.viewRow,
                     `${this.viewRow} -> ${t.RowHeight}`) && ok;
            ok = yes("and there is less of the plan to scroll",
                     t.ScrollMaxY < this.viewMax,
                     `${this.viewMax} -> ${t.ScrollMaxY}`) && ok;
            /* The fold is made where the list was scrolled, so no `Scroll`
             * came and nothing else asked for a frame: what the chart drew is
             * the watch's doing. Asked before `viewFoldRows`, whose walk of the
             * selection redraws on every row and would hide a stale frame. */
            ok = eq("the fold did not move the scroll, so nothing reported it",
                    t.ScrollY, scrolled) && ok;
            const drawn = this.drawnRows === null ? 0
                        : this.drawnRows.split(",").length;
            ok = yes("and the chart redrew with the rows the fold left",
                     this.drawnRows === rowsKey(this.chartRows()),
                     `drew ${drawn} of ${this.chartRows().length}`) && ok;
            /* A guard more than a witness: a summary's dates cover its
             * children's, so the rows left showing span the same time anyway,
             * and only a file whose summaries say otherwise would move. */
            const g = ganttGeometry(this.chartRows(), this.ganttWidth(),
                                    this.ganttHeight(), this.step, this.planGeom());
            ok = yes("a fold does not move the timescale",
                     !!span && !!g.range &&
                     g.range.from === span.from && g.range.to === span.to,
                     span ? `${new Date(span.from).toISOString().slice(0, 10)} .. ` +
                            `${new Date(span.to).toISOString().slice(0, 10)}` : "no range") && ok;
            /* And it is the plan's own span, worked out here from the tasks and
             * not asked of the same function twice: a day either side of the
             * earliest start and the latest finish. */
            let lo = null, hi = null;
            for (const task of this.holder.project.Tasks) {
                const a = whenMs(task.Start), b = whenMs(task.Finish);
                if (task.IsNull || a === null || b === null) continue;
                if (lo === null || a < lo) lo = a;
                if (hi === null || b > hi) hi = b;
            }
            ok = yes("and it is the plan's earliest start to its latest finish",
                     lo !== null && g.range.from === lo - DAY_MS &&
                     g.range.to === hi + DAY_MS,
                     `${g.range.from} .. ${g.range.to} against ${lo} .. ${hi}`) && ok;
            ok = this.viewFoldRows(eq, yes, ok, key);
            if (selected !== null && t.Exists(String(selected))) {
                t.Key = String(selected);
                this.Tasks_Select();
            }
            t.ExpandNode(key);
            Timer.After(30, () => this.viewFilterPhase(eq, yes, ok));
        });
    }

    /*
     * **The fold takes rows away from the chart too, and the two keep saying
     * which task each row is.** The chart reads its rows from the same call the
     * list is built from, so row `i` is one task on both sides of the divider;
     * that is the whole of this application, and a fold is where it broke --
     * the list showed thirty-seven of forty-one rows while the chart drew all
     * forty-one, so thirty-five of the rows the reader could see carried another
     * task's bar, and `ganttHit` reads those same rows, so clicking one
     * selected that other task.
     *
     * How the visible row is asked for is the only interesting part: on a tree
     * the table answers `Row` and `Cell` by **key**, and nothing enumerates what
     * it is showing, so the road is the selection's -- `Select(i)` takes a
     * visible position and answers whether it moved, and `Key` is the node that
     * landed there.
     */
    viewFoldRows(eq, yes, ok, key) {
        const t = this.Tasks;
        const chart = this.chartRows();
        const rows = this.visibleTasks(this.holder.project);
        let shown = 0, wrong = 0, first = null;

        for (let i = 0; i < rows.length; i++) {
            t.DeselectAll();   // the list takes several: one row at a time here
            if (!t.Select(i) || t.Index !== i) break;
            const uid = this.selectedUID;
            if (uid === null || uid === undefined) break;
            shown++;
            if (chart[i] && uid !== chart[i].UID) {
                wrong++;
                if (first === null) first = `row ${i}: list ` +
                    `${this.byUID[String(uid)].Name}, chart ${chart[i].Name}`;
            }
        }
        ok = yes("a fold takes rows away from the chart too",
                 chart.length < rows.length,
                 `${rows.length} -> ${chart.length}`) && ok;
        ok = eq("and the chart has exactly the rows the list is showing",
                chart.length, shown) && ok;
        ok = yes("every visible row is the same task on both sides",
                 wrong === 0, first || "none out of line") && ok;
        /* The branch itself is still there -- folding hides what is under it, not
         * the summary -- so what has to be gone is **its subtree**: the tasks
         * that follow it until one comes back at or above its own depth, which
         * is the walk the outline already defines. */
        const branch = this.byUID[key];
        const level = (branch ? branch.OutlineLevel : 0) || 0;
        const under = [];
        let inside = false;
        for (const task of rows) {
            if (String(task.UID) === key) { inside = true; continue; }
            if (inside && (task.OutlineLevel || 0) <= level) inside = false;
            if (inside) under.push(task);
        }
        const drawn = under.filter((task) =>
            chart.some((c) => c.UID === task.UID));
        ok = yes("the branch had rows to hide", under.length > 0,
                 `${under.length} under "${branch ? branch.Name : key}"`) && ok;
        ok = yes("and not one of them is on the chart", drawn.length === 0,
                 drawn.length ? drawn[0].Name : "none drawn") && ok;
        return ok;
    }

    /* A name the filter will match, and that has an ancestor to keep: a task
     * below a summary, so filtering brings three rows out of a plan of forty. */
    pickFilter() {
        for (const task of this.chartRows()) {
            if (task.OutlineLevel >= 2 && task.Name) return task.Name;
        }
        return "";
    }

    /*
     * A filtered list. The two panes are two views of the same rows, and a
     * filter takes rows out of both -- if the chart kept drawing the whole plan,
     * its row `i` would be another task's row and every bar would sit beside the
     * wrong name. What is asserted: the chart has the list's rows and not the
     * plan's, and the list it has is the filter's own rule -- a match, or an
     * ancestor that gives a match its place -- checked against the rows
     * themselves and not against the function that produced them.
     */
    viewFilterPhase(eq, yes, ok) {
        const t = this.Tasks;
        try {
            const whole = ganttRows(this.holder.project).length;
            const name = this.viewFilter;
            this.TxtFilter.Text = name;
            this.TxtFilter_Change();

            const drawn = this.chartRows();
            ok = yes("the filter leaves fewer rows in the chart than the plan has",
                     drawn.length < whole, `${drawn.length} of ${whole}`) && ok;
            ok = eq("and the chart has exactly the rows the list has",
                    drawn.length, t.Count) && ok;

            /* The rule, on the rows: every row that is not a match has a deeper
             * row after it that is one. */
            let placed = true;
            for (let i = 0; i < drawn.length; i++) {
                if (Locale.Matches(drawn[i].Name, name)) continue;
                placed = drawn.slice(i + 1)
                              .some((r) => r.OutlineLevel > drawn[i].OutlineLevel &&
                                           Locale.Matches(r.Name, name));
                if (!placed) break;
            }
            ok = yes("every row left is a match or an ancestor that gives it place",
                     placed, name) && ok;

            /* And the two are still one geometry: the chart's last row is where
             * the list's last row is. */
            const g = ganttGeometry(this.chartRows(), this.ganttWidth(),
                                    this.ganttHeight(), this.step, this.planGeom());
            const last = drawn.length - 1;
            ok = eq("the chart's last row is the list's last row",
                    g.rows[last].UID, drawn[last].UID) && ok;
            ok = eq("and it is a row of the table's height",
                    g.headH + last * g.rowH - g.scrollY,
                    g.headH + last * this.rowHeight() - g.scrollY) && ok;

            this.TxtFilter.Text = "";
            this.TxtFilter_Change();
            ok = eq("and the whole plan comes back to both",
                    this.chartRows().length, whole) && ok;
            this.viewFile(eq, yes, ok);
        } catch (e) {
            print(`view ERROR ${e.message}`);
            print("CHECK-FAILED");
            Application.Quit(1);
        }
    }
    viewFile(eq, yes, ok) {
        const t = this.Tasks;
        try {
            const rows = this.chartRows().length;
            const fg = this.fileGeom();
            ok = eq("a file is as tall as the plan's rows", this.fileHeight(),
                    fg.headH + rows * fg.rowH + 8) && ok;
            ok = eq("with the gutter the names need", fg.plotX, GUTTER) && ok;
            ok = yes("and no scroll of the pane's", fg.scrollY === 0) && ok;
            const png = File.Join(Environment.TempDirectory, "bintana-project-view.png");
            this.saveChart(png, false);
            const pic = new Picture();
            pic.File = png;
            ok = eq("and the picture is that tall", pic.SourceHeight,
                    this.fileHeight()) && ok;
            /* The pane is the list's again, and what the strip took off the top
             * is what the heading was: the rows' areas on the two sides are the
             * same area, which is the thing that has to be true for a row to be
             * on one line with its name. */
            const strip = Math.round(this.Header.Bounds(this.PlanSplit).Height);
            ok = yes("and the pane is back to the list's own height",
                     strip + Math.round(this.Gantt.Bounds(this.PlanSplit).Height) ===
                     Math.round(t.Bounds(this.PlanSplit).Height)) && ok;
            this.viewGrow(eq, yes, ok);
        } catch (e) {
            print(`view ERROR ${e.message}`);
            print("CHECK-FAILED");
            Application.Quit(1);
        }
    }

    /*
     * The style, with a painter that records. Two claims that need a plan with
     * a weekend in it, which the four-task fixtures are not: **the shade of a
     * day the calendar does not work is drawn, and it is drawn where the
     * calendar says**, under the row that is chosen and under everything else.
     */
    viewStyle() {
        let ok = true;
        const rows = this.chartRows();
        const log = this.checkGanttStyle(new CallLog(), 900, 320, rows,
                                        { plotX: PAD, rowH: this.rowHeight(),
                                          headH: this.headHeight() });
        const pal = ganttPalette(log);
        const geom = {
            plotX: PAD, rowH: this.rowHeight(), headH: this.headHeight(),
            scrollY: 0, calendar: this.chartCal,
        };
        const g = ganttGeometry(rows, 900, 320, 0, geom);
        const spans = ganttIdleDays(g.range, this.chartCal);
        const drawn = log.calls.filter((c) => c.name === "Rectangle" &&
                                            c.color === pal.idle);

        ok = this.styleYes("the plan has a day that is not worked",
                           spans.length > 0, `${spans.length} spans`) && ok;
        const one = spans[spans.length - 1];
        const x0 = g.x(one[0]), x1 = g.x(one[1]);
        const covers = drawn.some((c) => c.args[0] <= x0 + 1 &&
                                         c.args[0] + c.args[2] >= x1 - 1);
        ok = this.styleYes("and it is shaded where the calendar puts it", covers,
                           `${drawn.length} bands, ${Math.round(x0)}..${Math.round(x1)}`) && ok;
        /* The same, from the other side and in the calendar's own words rather
         * than the function that made the spans: every band drawn starts on a
         * weekend day, which is what the fixture's Monday-to-Friday week
         * leaves idle. */
        const weekend = (ms) => [0, 6].includes(new Date(Math.round(ms)).getDay());
        ok = this.styleYes("and every band starts on a weekend day",
                           drawn.length > 0 &&
                           drawn.every((c) => weekend(g.msAt(c.args[0] + 1))),
                           `${drawn.length} bands`) && ok;

        const bar = log.firstOf("Fill", pal.bar);
        const idle = log.firstOf("Rectangle", pal.idle);
        const select = log.firstOf("Rectangle", pal.select);
        ok = this.styleYes("the shade is under the row that is chosen",
                           idle >= 0 && select >= 0 && idle < select && select < bar,
                           `idle ${idle}, select ${select}, bar ${bar}`) && ok;

        /* No ground of its own: nothing in the frame covers all of it, which is
         * what leaves the chart on the surface the list is on. A file is the
         * other way round -- it has nothing behind it -- and is asked for it. */
        const whole = log.calls.find((c) => c.name === "Rectangle" &&
                                         c.args[0] === 0 &&
                                         c.args[2] >= 900 && c.args[3] >= 320);
        ok = this.styleYes("a chart on the screen paints no ground of its own",
                           !whole, whole ? JSON.stringify(whole.args) : "none") && ok;
        const file = this.checkGanttStyle(new CallLog(), 900, 320, rows,
                                          { plotX: GUTTER, rowH: this.rowHeight(),
                                            headH: this.headHeight(), paper: true });
        const covered = file.calls[0];
        ok = this.styleYes("and a chart written to a file carries one",
                           covered && covered.name === "Rectangle" &&
                           covered.args[2] >= 900 && covered.args[3] >= 320 &&
                           covered.color === ganttPalette(file).paper,
                           covered ? `${covered.color} ` +
                                     `${covered.args[2]}x${covered.args[3]}`
                                   : "nothing") && ok;

        /* And here, where the plan has forty-four links, the elbow is a real
         * one and its place under the bars is asserted rather than skipped. */
        const link = log.firstOf("Stroke", pal.link);
        ok = this.styleYes("with a dependency under the bars and not over them",
                           link >= 0 && link < bar, `link ${link}, bar ${bar}`) && ok;
        /* Its elbows are bends and not square turns, as Project draws them. */
        const bends = log.countOf("CurveTo", pal.link);
        ok = this.styleYes("and its elbows rounded", bends > 0, `${bends} bends`) && ok;

        /* The ruler is a week over a month, which is what was asked for: the two
         * bands are two label sets in the ruler's own (smaller) type, and they
         * are told apart by their shape -- the week carries a slash, the month
         * does not. Both are visible here because the frame is wide enough for
         * the type to give way rather than a band to go. */
        const ruler = log.calls.filter((c) => c.name === "Text" &&
                                            c.font !== log.Font);
        const week = ruler.filter((c) => /^\d+$/.test(String(c.args[0])));
        const month = ruler.filter((c) => !/^\d+$/.test(String(c.args[0])));
        ok = this.styleYes("the ruler carries a month over the days",
                           ruler.length > 0 && week.length > 0 && month.length > 0,
                           `${week.length} weeks, ${month.length} months, ` +
                           `type ${ruler.length ? ruler[0].font : "-"}`) && ok;

        /* A label that does not fit its cell is not drawn: a month squeezed into
         * six pixels is four labels on top of each other. The same frame 80
         * pixels narrower is asked for a second time, and it must say less. */
        const roomy = log.texts().length;
        const log2 = new CallLog();
        drawGantt(log2, 90, 320, rows, rows.length ? rows[0].UID : null, 0,
                  null, 0, { plotX: PAD, rowH: this.rowHeight(),
                             headH: this.headHeight(),
                             calendar: this.chartCal });
        ok = this.styleYes("a timescale too narrow to label says less of it",
                           log2.texts().length < roomy,
                           `${roomy} labels, ${log2.texts().length} in 90px`) && ok;
        /* The chart's format: a colour theme changes the bar's ink and only
         * that, a label writes beside the bar the field the view chose, and
         * switching a part off draws without it. */
        const forest = ganttPalette(log, "forest");
        const themed = new CallLog();
        drawGantt(themed, 600, 320, rows, null, 0, null, 0,
                  { plotX: PAD, rowH: this.rowHeight(), headH: this.headHeight(),
                    calendar: this.chartCal, format: { theme: "forest" } });
        ok = this.styleYes("a theme paints the bars in its own ink",
                           themed.hasColor(forest.bar) || themed.hasColor(forest.late),
                           `forest bar ${forest.bar}`) && ok;
        ok = this.styleYes("and the classic palette is not forest",
                           ganttPalette(log, "classic").bar !== forest.bar &&
                           ganttPalette(log).bar === ganttPalette(log, "classic").bar,
                           "classic differs") && ok;
        ok = this.styleYes("an unknown theme falls back to classic",
                           ganttFormat({ theme: "nope", size: 9 }).theme === "classic" &&
                           ganttFormat({ size: 9 }).size === 1, "fallback") && ok;
        /* A custom theme paints with the colours the view chose, and each
         * switch removes only its own part. */
        const mine = { theme: "custom", barColor: "#112233",
                       lateColor: "#445566", todayColor: "#778899" };
        const customLog = new CallLog();
        drawGantt(customLog, 600, 320, rows, null, 0, null, 0,
                  { plotX: PAD, rowH: this.rowHeight(), headH: this.headHeight(),
                    calendar: this.chartCal, format: mine });
        ok = this.styleYes("a custom theme paints the bars in the chosen colours",
                           customLog.hasColor("#112233") || customLog.hasColor("#445566"),
                           "custom bar #112233") && ok;
        ok = this.styleYes("the custom colours name today's line too",
                           ganttPalette(log, "custom", ganttFormat(mine)).today === "#778899",
                           "custom today") && ok;
        const noRows = new CallLog();
        drawGantt(noRows, 600, 320, rows, null, 0, null, 0,
                  { plotX: PAD, rowH: this.rowHeight(), headH: this.headHeight(),
                    calendar: this.chartCal,
                    format: { rows: false, grid: false, idle: false } });
        ok = this.styleYes("rows, grid and idle days switch off",
                           noRows.calls.length < themed.calls.length,
                           `${noRows.calls.length} < ${themed.calls.length}`) && ok;
        const plain = new CallLog();
        const labelled = new CallLog();
        const frame = (format) => ({ plotX: PAD, rowH: this.rowHeight(),
                                     headH: this.headHeight(),
                                     calendar: this.chartCal, format,
                                     labelOf: (t, what) => `L:${what}:${t.UID}` });
        drawGantt(plain, 600, 320, rows, null, 0, null, 0, frame({}));
        drawGantt(labelled, 600, 320, rows, null, 0, null, 0, frame({ label: "wbs" }));
        const written = labelled.texts().filter((t) => String(t).indexOf("L:wbs:") === 0);
        ok = this.styleYes("a label is written beside the bars, and none by default",
                           plain.texts().filter((t) => String(t).indexOf("L:") === 0).length === 0 &&
                           written.length > 0, `${written.length} labels`) && ok;
        const lean = new CallLog();
        drawGantt(lean, 600, 320, rows, null, 0, null, 0,
                  frame({ links: false, today: false, progress: false }));
        ok = this.styleYes("links, today and progress can be left out",
                           lean.calls.length <= plain.calls.length, "fewer calls") && ok;
        this.viewStyleOk = ok;
    }

    /*
     * Who takes the room when the window grows. A plan is read in a table of a
     * sensible width and a chart as wide as the timescale needs, and a panel of
     * properties is a form, not a space: so the *chart* is the elastic one and
     * the list and the panel keep the width they have. That is what `Grows` on
     * the two splits says -- the plan area is the start half of the body's and
     * the chart the end half of the plan's.
     *
     * **A wider window cannot be asked for here.** `Widget.Width` is a requested
     * minimum rather than a size, and a window that is mapped keeps the size it
     * was given, so `Resize` on the form is a no-op under a virtual display and
     * there is nothing to measure. What is measured is the rule: the
     * declarations, the invariant they make visible (each pane is its own half,
     * and the list's is the divider), and the mechanism -- move the divider and
     * the start half is what moves, which is the same paned the growth uses.
     */
    viewGrow(eq, yes, ok) {
        const width = (c) => c.Bounds(this.Body).Width;
        /* The style, with a painter that records: the claims that need a plan
         * with a weekend in it, which the four-task fixtures are not. */
        this.viewStyle();
        ok = this.viewStyleOk && ok;

        /* The heading is the room the ruler is drawn in, and it was bought with
         * a floor: two rows of 9-point type in a 25-pixel band is 7-point type,
         * and the band now holds both at the size an axis wants. */
        ok = eq("the list's heading is given a floor",
                this.Tasks.HeaderMinHeight, 34) && ok;
        ok = yes("and it reaches it", this.Tasks.HeaderHeight >= 34,
                 this.Tasks.HeaderHeight) && ok;
        ok = eq("and the chart draws its ruler in that height", this.headHeight(),
                this.Tasks.HeaderHeight) && ok;

        /* And the ground: the chart declares a transparent one, and what it
         * draws never covers the frame -- which is the whole of how the two
         * panes end up on the same surface. */
        /* The ground is the theme's **class**, not a value: a theme paints a
         * surface with `.view`, and a `GtkColumnView` wears that class itself
         * (`columnview.view` is how the theme writes it). The chart wears it
         * now, which is the whole of the fix -- and it is the class, not a
         * colour, because a colour set on the control is written into a
         * stylesheet above the theme's and would mask the class that works. */
        ok = eq("the chart wears the class a list wears", this.Gantt.Style,
                "view") && ok;
        ok = eq("and paints no ground of its own over it", this.Gantt.Background,
                "") && ok;
        ok = eq("nor the scroller around it", this.GanttScroll.Background,
                "") && ok;

        /* **The chart is floored, not sized.** `Auto` asks for no floor and the
         * chart is the pane's own width; a scale asks for the timescale's width
         * and the scroller shows the rest, while the window is never asked for
         * it. A floor is a size, and a size is the next frame's, so the scroller
         * is asked a turn later. */
        const pane = this.GanttScroll.Bounds();
        ok = eq("Auto is the pane's own width", this.Gantt.Bounds().Width,
                pane.Width) && ok;
        ok = eq("and there is nothing to scroll sideways",
                this.GanttScroll.ScrollMaxX, 0) && ok;

        this.CmbScale.Index = 1;   // Day: a day per 30 px
        this.CmbScale_Select();
        const span = this.chartRange();
        const days = span ? (span.to - span.from) / DAY_MS : 0;
        ok = eq("a scale asks the timescale's width as a floor",
                this.Gantt.MinWidth, Math.round(PAD + days * 30 + 8)) && ok;

        ok = eq("the plan area takes the room, not the panel",
                this.BodySplit.Grows, "Start") && ok;
        ok = eq("and inside it, the chart and not the list",
                this.PlanSplit.Grows, "End") && ok;

        const body  = this.Body.Bounds().Width;
        const panel = width(this.PropsScroll);
        ok = yes("the panel is a form of its own width and not the space the window has",
                 panel * 2 < body, `${panel} of ${body}`) && ok;
        ok = yes("and the divider is where the panel ends",
                 Math.abs(this.BodySplit.Position - (body - panel)) <= 1,
                 `${this.BodySplit.Position} against ${body - panel}`) && ok;

        const plan  = width(this.PlanSplit);
        const tasks = width(this.Tasks);
        const chart = width(this.GanttScroll);
        ok = eq("the list is the divider's half", tasks, this.PlanSplit.Position) && ok;
        ok = eq("and the chart is what is left of the plan",
                tasks + chart, plan - 1) && ok;

        /* The mechanism the growth uses, from the other side: the divider moved
         * from code, and the half in front of it is the one that moved. A
         * divider set from code is laid out on the next frame, so this is asked
         * a turn later -- the same rule every measurement in this app follows. */
        const at = this.PlanSplit.Position;
        this.PlanSplit.Position = at - 120;
        this.viewGrows = { eq, yes, ok, width, plan, at, tasks, pane };
        Timer.After(60, () => {
            const g = this.viewGrows;
            const chartW = this.Gantt.Bounds().Width;
            ok = yes("and the scroller is what shows the difference",
                     this.GanttScroll.ScrollMaxX > 0,
                     `maxX ${this.GanttScroll.ScrollMaxX}`) && ok;
            ok = yes("with the chart wider than the pane", chartW > g.pane.Width,
                     `${chartW} in ${g.pane.Width}`) && ok;
            ok = yes("while the window is never asked for it",
                     this.Bounds().Width < chartW,
                     `window ${this.Bounds().Width}`) && ok;
            /* The ruler is laid out over the chart's width and follows its
             * scroll, not squeezed into the pane. */
            const stripW = this.Header.Bounds().Width;
            ok = eq("the ruler spans the chart, not the pane",
                    this.rulerFrame(stripW).full, chartW) && ok;
            this.GanttScroll.ScrollX = 40;
            ok = eq("and travels with the chart's scroll",
                    this.rulerFrame(stripW).shift, this.GanttScroll.ScrollX) && ok;
            this.GanttScroll.ScrollX = 0;

            /* **Scroll to Task**: a task from the middle of the span, past the
             * pane's right edge and with chart enough after it, chosen; the
             * command brings its start into the pane -- a little in from the
             * left edge -- where choosing the row alone moved nothing. */
            const mid = span ? (span.from + span.to) / 2 : 0;
            const late = this.chartRows().filter((t) => whenMs(t.Start) !== null)
                .reduce((a, b) => (Math.abs(whenMs(b.Start) - mid) <
                                   Math.abs(whenMs(a.Start) - mid) ? b : a));
            this.Tasks.Key = String(late.UID);
            this.Tasks_Select();
            ok = eq("choosing a row does not move the chart", this.GanttScroll.ScrollX, 0) && ok;
            ok = eq("Scroll to Task is offered for it", this.ActScrollToTask.Enabled, true) && ok;
            this.ActScrollToTask_Execute();
            const gs = ganttGeometry(this.chartRows(), this.ganttWidth(), this.ganttHeight(),
                                     this.step, this.planGeom());
            const barAt = gs.x(whenMs(late.Start)) - this.GanttScroll.ScrollX;
            const paneW = this.GanttScroll.Bounds().Width;
            ok = yes("Scroll to Task brings its start into the pane, near the left",
                     this.GanttScroll.ScrollX > 0 && barAt > 0 && barAt < paneW / 2,
                     `start at ${Math.round(barAt)} of ${paneW}, scrolled ${this.GanttScroll.ScrollX}`) && ok;
            this.GanttScroll.ScrollX = 0;
            this.CmbScale.Index = 0;   // back to Auto
            this.CmbScale_Select();
            ok = eq("moving the divider moves the list with it", g.width(this.Tasks),
                    g.at - 120) && ok;
            ok = eq("and the chart takes the difference", g.width(this.GanttScroll),
                    g.plan - 1 - (g.at - 120)) && ok;
            this.PlanSplit.Position = g.at;
            Timer.After(60, () => {
                ok = eq("and it comes back", g.width(this.Tasks),
                        g.tasks) && ok;
                print(ok ? "CHECK-OK" : "CHECK-FAILED");
                Application.Quit(ok ? 0 : 1);
            });
        });
    }

    /*
     * The oracle: the file's own dates against what the pass makes of them.
     * Project wrote the file, so its Start/Finish/Critical are the answer --
     * this prints the differences instead of arguing them. Manual tasks and
     * summaries stay out: the first are the user's dates, the second are
     * derived. Not a golden; a measurement, run by hand.
     */
    checkOracle() {
        const args = Application.Arguments;
        const i    = args.indexOf("check-oracle");
        const path = this.resolve(args[i + 1] || "");
        this.load(path);

        const project = this.holder.project;
        const kept = [];
        for (const task of project.Tasks) {
            if (task.IsNull || task.Summary || task.Manual) continue;
            if (whenMs(task.Start) === null || whenMs(task.Finish) === null) continue;
            kept.push({ uid: task.UID, name: task.Name, start: task.Start,
                        finish: task.Finish, critical: !!task.Critical,
                        total: task.TotalSlack, free: task.FreeSlack,
                        lateFinish: task.LateFinish });
        }

        const run = recalculate(project);
        const days = (a, b) => a === null || b === null
                             ? null : Math.round((b - a) / DAY_MS);

        let same = 0, starts = 0, finishes = 0, criticals = 0, slacks = 0, lates = 0;
        for (const was of kept) {
            const task = taskOf(project, was.uid);
            if (!task) continue;
            const ds = days(whenMs(was.start), whenMs(task.Start));
            const df = days(whenMs(was.finish), whenMs(task.Finish));
            if (ds === 0 && df === 0) same++;
            if (ds !== 0) starts++;
            if (df !== 0) finishes++;
            if (was.critical !== !!task.Critical) {
                criticals++;
                print(`oracle ${task.UID} ${was.name}: critical ` +
                      `${was.critical} -> ${!!task.Critical}`);
            }
            /* **The slack, in the file's own unit.** Project writes tenths of a
             * minute; a pass that wrote minutes would agree on every date and
             * every critical flag and still be ten times off here. Only what
             * the file answered is compared. */
            const slackOff = (got, want) => want !== NO_MINUTES && got !== want;
            if (slackOff(task.TotalSlack, was.total) ||
                slackOff(task.FreeSlack, was.free)) {
                slacks++;
                print(`oracle ${task.UID} ${was.name}: slack ` +
                      `${was.total}/${was.free} -> ${task.TotalSlack}/${task.FreeSlack}`);
            }
            /* The latest finish as the file wrote it, to the minute. Reported
             * and not asserted: the in-progress ones follow a rule not yet
             * modelled (the remaining duration). */
            if (was.lateFinish && task.LateFinish !== was.lateFinish) {
                lates++;
                print(`oracle ${task.UID} ${was.name}: late finish ` +
                      `${was.lateFinish} -> ${task.LateFinish}`);
            }
            if (ds !== 0 || df !== 0)
                print(`oracle ${task.UID} ${was.name}: ` +
                      `${shortDate(was.start)}..${shortDate(was.finish)} -> ` +
                      `${shortDate(task.Start)}..${shortDate(task.Finish)} ` +
                      `(${ds}d/${df}d)`);
        }
        print(`oracle ${File.Name(path)}: ${kept.length} tasks, ` +
              `${run.placed} placed, ${run.skipped} kept, ${same} same, ` +
              `${starts} starts off, ${finishes} finishes off, ` +
              `${criticals} critical off, ${slacks} slack off, ` +
              `${lates} late finish off`);
        /* **And it fails when it disagrees.**
         *
         * This was a report: it printed the numbers and exited `0` whatever they
         * said, which meant a real plan whose dates the engine got wrong would
         * not have failed anything -- the corpus would have gone on being green
         * over synthetic fixtures. It is the only check in the harness that runs
         * against Project's own output on a real project, so it is the one that
         * has to be an assertion.
         *
         * Tasks the pass skipped are not counted as disagreements: a
         * manually-scheduled task keeps the dates the file gave it, and
         * comparing them would be asking the engine to do something it is
         * supposed to leave alone. */
        Application.Quit(starts + finishes + criticals === 0 ? 0 : 1);
    }

    /*
     * The schema, with the runtime's own validator: `check-xsd <xsd> <file>...`
     * prints `xsd <name>: valid` or `xsd <name>: N problems` and the first of
     * them, for every file. It judges nothing -- whether an output may be
     * invalid depends on its input, which is the harness's call. The official
     * schema declares `/2007` and Project writes the bare namespace, so the
     * schema text is remapped (the caller's two lines, as the runtime says).
     */
    checkXsd() {
        const args = Application.Arguments;
        const i    = args.indexOf("check-xsd");
        const URI  = "http://schemas.microsoft.com/project";
        const schema = Xml.Schema(File.Load(this.resolve(args[i + 1] || ""))
                                      .split(URI + "/2007").join(URI));
        for (const file of args.slice(i + 2)) {
            const problems = schema.Validate(File.LoadXml(this.resolve(file)));
            print(`xsd ${file}: ` + (problems.length === 0 ? "valid"
                  : `${problems.length} problems`));
            for (const p of problems.slice(0, 5))
                print(`xsd   line ${p.Line}: ${p.Message}`);
        }
        Application.Quit(0);
    }

    checkCorpus() {
        const args = Application.Arguments;
        const i    = args.indexOf("check-corpus");
        const dir  = this.resolve(args[i + 1] || File.Join("tests", "corpus"));
        const out  = args[i + 2] ? this.resolve(args[i + 2]) : Environment.TempDirectory;
        let ok = true, files = 0;
        for (const path of Directory.Files(dir, "*.xml")) {
            files++;
            if (!this.checkFile(path, out)) ok = false;
        }
        print(`corpus files=${files}`);
        print(ok && files > 0 ? "CHECK-OK" : "CHECK-FAILED");
        Application.Quit(ok && files > 0 ? 0 : 1);
    }

    /* A path from the command line may be relative to the project. */
    resolve(path) {
        return path.charAt(0) === "/" ? path : File.Join(Application.Directory, path);
    }

    /*
     * One file's whole trip. The file is read twice: one tree is left alone
     * as the "before", the other is handed to SaveXml, and the difference
     * between them is exactly what the round trip touched.
     */
    checkFile(path, outDir) {
        const name = File.Name(path);
        try {
            const pristine = readMspdi(path);
            this.load(path);
            const holder = this.holder;

            const before = summarize(holder.project);
            print(`file=${name} tasks=${before.tasks} milestones=${before.milestones} ` +
                  `withAttrs=${before.withAttrs} links=${before.links} ` +
                  `problems=${holder.problems.length}`);

            const out = File.Join(outDir, "bintana-project-check-" + name);
            writeMspdi(out, holder);
            print(`out=${out}`);

            const second  = readMspdi(out);
            const after   = summarize(second.project);
            const touched = treeDiff(pristine.doc.Root, second.doc.Root);
            print(`roundtrip tasks=${after.tasks} withAttrs=${after.withAttrs} ` +
                  `links=${after.links} problems=${second.problems.length} ` +
                  `touched=${touched.length}`);

            if (Application.Arguments.indexOf("dump-problems") >= 0) {
                for (const p of holder.problems) print(`problem-in: ${p}`);
                for (const p of second.problems) print(`problem-out: ${p}`);
            }
            if (Application.Arguments.indexOf("dump-touched") >= 0) {
                for (const t of touched) print(`touched: ${t}`);
            }

            const same = before.tasks === after.tasks &&
                         before.withAttrs === after.withAttrs &&
                         before.links === after.links;
            const ok = this.checkWiring() && same &&
                       this.checkTree() && this.checkGantt();
            print(`check ${name}: ${ok ? "ok" : "FAILED"}`);
            return ok;
        } catch (e) {
            print(`check ${name}: ERROR ${e.message}`);
            return false;
        }
    }

    /*
     * The editing road, headless: the same commands the buttons call, over the
     * smallest fixture, then saved and re-read. The output is held against a
     * golden like any other round trip; what is printed is the assertion.
     */
    checkEdit() {
        const args = Application.Arguments;
        const i    = args.indexOf("check-edit");
        const path = this.resolve(args[i + 1] || File.Join("tests", "corpus", "01-minimal.xml"));
        const out  = args[i + 2] ? this.resolve(args[i + 2]) : Environment.TempDirectory;
        const name = File.Name(path);
        try {
            const pristine = readMspdi(path);
            this.load(path);
            const edit = this.edit;
            let ok = this.checkWiring();

            /* The dialogs' forms parse and open: a broken `.form` would fail
             * here, not the first time somebody closes with unsaved work or
             * opens the settings. Nothing is clicked, so nothing runs. */
            ConfirmForm.ask("check-edit", "The dialog opens and closes.", "OK",
                            () => {}).Close();
            SettingsForm.open(() => {}).Close();

            /* **El check corre en el modo manual de Project a propósito**: es
             * sobre los comandos y el ida y vuelta -- y sus goldens se
             * escribieron donde una fecha tipeada se queda quieta --, así que
             * el automático se prende solo en el bloque del recálculo, que
             * deja el plan y el modo como estaban. */
            edit.auto = false;

            /* **El recálculo, que es lo que Project hace solo**: con el
             * automático encendido -- el modo con el que la app nace -- una
             * duración tipeada mueve el fin y la cadena con ella, y una fecha
             * tipeada deja la restricción que la sostiene; apagado, la fecha
             * queda como se tipeó hasta F5, que es el modo manual. */
            const colsWere  = this.columns.slice();
            const autoWasR  = edit.auto;
            const buildWas  = { Duration: edit.task(2).Duration,
                                Start: edit.task(2).Start,
                                Finish: edit.task(2).Finish,
                                ConstraintType: edit.task(2).ConstraintType || 0,
                                ConstraintDate: edit.task(2).ConstraintDate || "" };
            this.setColumns(["duration", "start", "finish"]);
            const atDurR    = this.tableColumns().indexOf("duration");
            const atStartR  = this.tableColumns().indexOf("start");
            const atFinishR = this.tableColumns().indexOf("finish");
            edit.auto = true;

            /* La duración por la puerta de la celda: Build espera a Analyse, el
             * comienzo no se mueve y el fin se corre tres días de trabajo. */
            ok = this.Tasks.Emit("CellEdit", "2", atDurR, "3d") !== false &&
                 edit.task(2).Duration === "PT24H0M0S" &&
                 edit.task(2).Start === buildWas.Start &&
                 edit.task(2).Finish === "2026-09-07T17:00:00" && ok;
            print(`edit recalc duration=PT24H0M0S ` +
                  `finish=${shortDate(edit.task(2).Finish)}`);
            edit.undo();
            this.fill(2);

            /* Una fecha tipeada queda -- Inicio no antes de, con su fecha -- y
             * el pase la respeta; un fin tipeado es Fin no antes de. */
            ok = this.Tasks.Emit("CellEdit", "2", atStartR, "2026-09-10") !== false &&
                 edit.task(2).ConstraintType === 4 &&
                 edit.task(2).ConstraintDate === "2026-09-10T08:00:00" &&
                 edit.task(2).Start === "2026-09-10T08:00:00" && ok;
            print(`edit recalc start pin=${edit.task(2).ConstraintType}`);
            edit.undo();
            this.fill(2);
            ok = this.Tasks.Emit("CellEdit", "2", atFinishR, "2026-09-30") !== false &&
                 edit.task(2).ConstraintType === 6 &&
                 edit.task(2).ConstraintDate === "2026-09-30T17:00:00" &&
                 edit.task(2).Finish === "2026-09-30T17:00:00" && ok;
            print(`edit recalc finish pin=${edit.task(2).ConstraintType} ` +
                  `finish=${shortDate(edit.task(2).Finish)}`);
            edit.undo();
            this.fill(2);

            /* Apagado -- el modo manual -- la tarea misma queda coherente: la
             * duración tipeada lleva su fin, y F5 es lo que mueve a las
             * demás. */
            edit.auto = false;
            ok = this.Tasks.Emit("CellEdit", "2", atDurR, "5d") !== false &&
                 edit.task(2).Duration === "PT40H0M0S" &&
                 edit.task(2).Finish === "2026-09-09T17:00:00" && ok;
            const recalcRun = edit.recalculate();
            ok = edit.task(2).Finish === "2026-09-09T17:00:00" && ok;
            print(`edit manual recalc changed=${recalcRun.changed} ` +
                  `finish=${shortDate(edit.task(2).Finish)}`);
            edit.undo();
            edit.undo();

            edit.auto = autoWasR;
            this.setColumns(colsWere);
            this.fill(2);
            ok = edit.task(2).Duration === buildWas.Duration &&
                 edit.task(2).Start === buildWas.Start &&
                 edit.task(2).Finish === buildWas.Finish &&
                 (edit.task(2).ConstraintType || 0) === buildWas.ConstraintType &&
                 (edit.task(2).ConstraintDate || "") === buildWas.ConstraintDate && ok;

            /* **The project dialog carries what the side panel's Project tab
             * carried** -- the plan's default calendar and its total -- so it is
             * opened here and read, because a control that moved is a control
             * that can be left behind: a combo whose items never arrive is empty
             * and writes nothing, and it looks exactly like one that works. */
            let applied = null;
            const pdlg = ProjectForm.open(this.holder.project, (values) => {
                applied = values;
                this.applyProject(values);
            });
            const cals = this.holder.project.Calendars;
            ok = pdlg.CmbProjCalendar.Items.length === cals.length &&
                 pdlg.CmbProjCalendar.Items[0] === cals[0].Name && ok;
            const shown = cals[pdlg.CmbProjCalendar.Index];
            ok = !!shown && shown.UID === this.holder.project.CalendarUID && ok;
            const total = projectCost(this.holder.project);
            ok = pdlg.TxtProjTotal.Text ===
                 (total ? Locale.Number(total, 2) : "") && ok;
            print(`edit project dialog calendar ${pdlg.CmbProjCalendar.Index}` +
                  ` of ${pdlg.CmbProjCalendar.Items.length}, ` +
                  `total ${pdlg.TxtProjTotal.Text || "(none)"}`);
            /* **Choosing another one is the edit, one undo like any other.** No
             * fixture carries two calendars -- the corpus is one plan with one
             * calendar, like most -- so the second is added here through the same
             * road the app has for adding one, the dialog is opened again over the
             * two, and the whole of the move is undone at the end with the rest. */
            const wasCalendar = this.holder.project.CalendarUID;
            /* **A day alone is a start**, with the plan's day start for its
             * time -- read through the dialog's own road and not applied. */
            pdlg.TxtProjStart.Text = "2026-10-01";
            const typed = projectFormValues(pdlg, this.holder.project, pdlg.tables);
            ok = !!typed && typed.StartDate ===
                 `2026-10-01T${this.holder.project.DefaultStartTime || "08:00:00"}` && ok;
            print(`edit project dialog start ${typed ? typed.StartDate : "(refused)"}`);
            pdlg.Close();
            let maxUID = 0;
            for (const calendar of cals)
                if (calendar.UID > maxUID) maxUID = calendar.UID;
            const newCal = this.edit.addCalendar(Locale.Text("Calendar {0}", maxUID + 1),
                                                 cals[0].UID);
            ok = !!newCal && newCal.UID > maxUID && ok;
            const two = this.holder.project.Calendars;
            let chosen = null;
            const overTwo = ProjectForm.open(this.holder.project, (values) => {
                chosen = values;
                this.applyProject(values);
            });
            ok = overTwo.CmbProjCalendar.Items.length === two.length &&
                 overTwo.CmbProjCalendar.Index === 0 && ok;
            overTwo.CmbProjCalendar.Index = 1;
            overTwo.BtnOk_Click();
            ok = this.holder.project.CalendarUID === two[1].UID &&
                 !!chosen && chosen.CalendarUID === two[1].UID && ok;
            print(`edit project dialog calendar 1 of ` +
                  `${overTwo.CmbProjCalendar.Items.length} -> ` +
                  `${this.holder.project.CalendarUID}`);
            ok = this.edit.undo() &&
                 this.holder.project.CalendarUID === wasCalendar && ok;
            ok = this.edit.undo() && ok;      /* and the calendar itself */
            print(`edit project dialog back to ${this.holder.project.CalendarUID}` +
                  ` of ${this.holder.project.Calendars.length}`);

            /* The columns dialog opens with the table's own ticks, refuses
             * nothing, and hands back what is ticked in the table's order. */
            let picked = null;
            const cols = ColumnsForm.open(COLUMNS, this.columns,
                                          (chosen) => { picked = chosen; });
            ok = cols.ChkColDuration.Active && !cols.ChkColNotes.Active && ok;
            cols.ChkColDuration.Active = false;
            cols.ChkColNotes.Active    = true;
            cols.BtnOk_Click();
            ok = picked.indexOf("notes") >= 0 &&
                 picked.indexOf("duration") < 0 &&
                 picked.indexOf("start") >= 0 && ok;

            /* The panel's own road: select UID 1, type, Apply. */
            this.Tasks.Key = "1";
            this.Tasks_Select();
            this.TxtName.Text      = "Analyse II";
            this.TxtStart.Text     = "2026-09-01 09:00";
            this.TxtDuration.Text  = "2d";
            this.SpinPercent.Value = 75;
            ok = this.applyFields() && ok;

            const task = edit.task(1);
            ok = task.Name === "Analyse II" && task.Duration === "PT16H0M0S" &&
                 task.Start === "2026-09-01T09:00:00" &&
                 task.PercentComplete === 75 &&
                 task.ActualStart === "2026-09-01T08:00:00" && ok;   // the file's own
            print(`edit fields name="${task.Name}" duration=${task.Duration} ` +
                  `start=${task.Start} percent=${task.PercentComplete} ` +
                  `actual=${task.ActualStart}`);

            /* The forward pass as one undo: UID 1 is at 75% -- in progress,
             * so the actual finish the file gave it at 100% went with the
             * percentage -- and starts where it actually started, as Project
             * puts it; UID 2 is placed after it. Before the indent, because a
             * summary is not scheduled -- it is the span of its children. */
            const recalc = edit.recalculate();
            ok = recalc.placed === 2 && recalc.skipped === 0 &&
                 edit.task(1).ActualFinish === "" &&
                 edit.task(1).Start === "2026-09-01T08:00:00" &&
                 edit.task(1).Finish === "2026-09-02T17:00:00" &&
                 edit.task(2).Start === "2026-09-03T08:00:00" && ok;
            print(`edit recalc placed=${recalc.placed} skipped=${recalc.skipped} ` +
                  `A=${edit.task(1).Start}..${edit.task(1).Finish} ` +
                  `B=${edit.task(2).Start}..${edit.task(2).Finish}`);
            edit.undo();
            ok = edit.task(1).Start === "2026-09-01T09:00:00" && ok;
            edit.redo();

            /* Recalculating a plan already where the pass puts it moves
             * nothing, so it costs no undo step. */
            const steps = edit.at;
            const again = edit.recalculate();
            ok = !again.changed && edit.at === steps && ok;
            print(`edit recalc again changed=${again.changed} steps=${edit.at}`);

            /* A task after it, indented under it: UID 1 becomes a summary. */
            const added = edit.addTask(2);
            ok = added.UID === 3 && added.OutlineLevel === 1 && ok;
            ok = edit.indent(added.UID, 1) && added.OutlineLevel === 2 && ok;
            ok = edit.task(1).Summary === true && ok;
            print(`edit add uid=${added.UID} level=${added.OutlineLevel} ` +
                  `summary=${edit.task(1).Summary}`);

            /* Remove takes the subtree and the link into it; undo brings both
             * back, redo takes them again, and the last undo leaves it there. */
            const before = edit.holder.project.Tasks.length;
            edit.removeTask(1);
            const removed = edit.holder.project.Tasks.length;
            const gone    = summarize(edit.holder.project).links;
            edit.undo();
            const undone  = summarize(edit.holder.project).links;
            edit.redo();
            const redone  = summarize(edit.holder.project).links;
            edit.undo();
            const final   = edit.holder.project.Tasks.length;
            ok = before === 4 && removed === 2 && gone === 0 &&
                 undone === 1 && redone === 0 && final === 4 && ok;
            ok = edit.dirty && edit.canUndo && edit.canRedo && ok;
            print(`edit remove before=${before} removed=${removed} links=${gone} ` +
                  `undoLinks=${undone} redoLinks=${redone} final=${final}`);

            /* Links through the command the panel calls: UID 3 gains a
             * predecessor, loses it, and gets it back. */
            const withLink = [new MspLink({ PredecessorUID: 2, Type: 1,
                                            LinkLag: 0, LagFormat: 7 })];
            ok = edit.setLinks(3, withLink) && edit.task(3).Links.length === 1 && ok;
            edit.undo();
            ok = edit.task(3).Links.length === 0 && ok;
            edit.redo();
            ok = edit.task(3).Links.length === 1 && ok;

            /* And the panel shows it: the table the row came from. */
            this.fill(3);
            ok = this.Tasks.Key === "3" && this.Links.Count === 1 && ok;
            print(`edit links uid=3 count=${edit.task(3).Links.length} ` +
                  `rows=${this.Links.Count}`);

            /* The constraint fields through the panel: a start-no-earlier-
             * than, written by Apply like any other field. */
            this.CmbConstraint.Index = 4;   // SNET
            this.TxtConstraint.Text  = "2026-09-04 08:00";
            ok = this.applyFields() &&
                 edit.task(3).ConstraintType === 4 &&
                 edit.task(3).ConstraintDate === "2026-09-04T08:00:00" && ok;
            print(`edit constraint type=${edit.task(3).ConstraintType} ` +
                  `date=${edit.task(3).ConstraintDate}`);

            /* Notes through the panel too: the last field, and a multi-line
             * one. */
            this.TxtNotes.Text = "Edited in the harness";
            ok = this.applyFields() &&
                 edit.task(3).Notes === "Edited in the harness" && ok;
            print(`edit notes="${edit.task(3).Notes}"`);

            /* The estimate flag through the panel: the duration field keeps
             * its value and the row shows the `?`. */
            this.ChkEstimated.Active = true;
            ok = this.applyFields() && edit.task(3).Estimated === true && ok;
            print(`edit estimated=${edit.task(3).Estimated}`);

            /* Reorder: UID 2 moves above UID 1 and comes back, so the order
             * is the outline's and the subtree travels with the task. */
            const order = () => edit.holder.project.Tasks.map((t) => t.UID).join(",");
            const was = order();
            ok = edit.moveTask(2, -1) && order() === "0,2,1,3" && ok;
            edit.undo();
            ok = order() === was && ok;
            print(`edit reorder ${was} -> ${order()}`);

            /* Nuevas tareas manuales, la preferencia: la tarea nace manual y
             * fechada en el comienzo del plan, con el fin a su duración --
             * el pase no la va a fechar. Apagada, nace automática y sin
             * fechas, como siempre. */
            edit.newManual = true;
            const manual = edit.addTask(null);
            ok = manual.Manual === true &&
                 manual.Start === "2026-09-01T08:00:00" &&
                 manual.Finish === "2026-09-01T17:00:00" && ok;
            print(`edit new manual start=${manual.Start} finish=${manual.Finish}`);
            edit.undo();
            edit.newManual = false;
            const automatic = edit.addTask(null);
            ok = automatic.Manual === false && automatic.Start === "" && ok;
            print(`edit new automatic manual=${automatic.Manual}`);
            edit.undo();
            ok = order() === was && ok;

            /* **Una fecha tipeada, como se probó en Project.** Manual: el fin
             * estira la duración, que deja de ser estimada (`2d?` a `4d`), y
             * el comienzo desliza la tarea, sin restricción. Iniciada al 50%:
             * el fin estira la duración y conserva el `?`, deja la
             * restricción y el porcentaje guarda lo hecho -- 3d a 6d es
             * 25%. */
            const colsWereT = this.columns.slice();
            this.setColumns(["duration", "start", "finish"]);
            const atStartT  = this.tableColumns().indexOf("start");
            const atFinishT = this.tableColumns().indexOf("finish");
            const typedOn = (values) => {
                const t = edit.addTask(null);
                edit.setFields(t.UID, values);
                this.fill(t.UID);
                return t.UID;
            };
            const hand = typedOn({ Manual: true, Start: "2026-09-07T08:00:00",
                                   Finish: "2026-09-08T17:00:00",
                                   Duration: "PT16H0M0S", Estimated: true });
            ok = this.Tasks.Emit("CellEdit", String(hand), atFinishT, "2026-09-10") !== false &&
                 edit.task(hand).Duration === "PT32H0M0S" &&
                 edit.task(hand).Start === "2026-09-07T08:00:00" &&
                 edit.task(hand).Finish === "2026-09-10T17:00:00" &&
                 edit.task(hand).Estimated === false &&
                 (edit.task(hand).ConstraintType || 0) === 0 && ok;
            print(`edit typed manual finish duration=${edit.task(hand).Duration} ` +
                  `start=${shortDate(edit.task(hand).Start)} ` +
                  `constraint=${edit.task(hand).ConstraintType || 0}`);
            ok = this.Tasks.Emit("CellEdit", String(hand), atStartT, "2026-09-14") !== false &&
                 edit.task(hand).Duration === "PT32H0M0S" &&
                 edit.task(hand).Finish === "2026-09-17T17:00:00" &&
                 (edit.task(hand).ConstraintType || 0) === 0 && ok;
            print(`edit typed manual start finish=${shortDate(edit.task(hand).Finish)}`);
            ok = this.Tasks.Emit("CellEdit", String(hand), atFinishT, "2026-09-11") === false &&
                 edit.task(hand).Finish === "2026-09-17T17:00:00" && ok;
            for (let k = 0; k < 4; k++) edit.undo();

            const autoWasT = edit.auto;
            edit.auto = true;
            const begun = typedOn({ Start: "2026-09-01T08:00:00",
                                    Finish: "2026-09-03T17:00:00",
                                    Duration: "PT24H0M0S", PercentComplete: 50,
                                    ActualStart: "2026-09-01T08:00:00",
                                    Estimated: true });
            ok = this.Tasks.Emit("CellEdit", String(begun), atFinishT, "2026-09-08") !== false &&
                 edit.task(begun).Duration === "PT48H0M0S" &&
                 edit.task(begun).Start === "2026-09-01T08:00:00" &&
                 edit.task(begun).Finish === "2026-09-08T17:00:00" &&
                 edit.task(begun).PercentComplete === 25 &&
                 edit.task(begun).Estimated === true &&
                 edit.task(begun).ConstraintType === 6 &&
                 edit.task(begun).ConstraintDate === "2026-09-08T17:00:00" && ok;
            print(`edit typed begun finish duration=${edit.task(begun).Duration} ` +
                  `percent=${edit.task(begun).PercentComplete} ` +
                  `constraint=${edit.task(begun).ConstraintType}`);
            for (let k = 0; k < 3; k++) edit.undo();

            /* Iniciada, el comienzo tipeado mueve el comienzo real: la tarea
             * entera se corre, duración y porcentaje quedan, sin restricción. */
            const moving = typedOn({ Start: "2026-09-01T08:00:00",
                                     Finish: "2026-09-03T17:00:00",
                                     Duration: "PT24H0M0S", PercentComplete: 50,
                                     ActualStart: "2026-09-01T08:00:00" });
            ok = this.Tasks.Emit("CellEdit", String(moving), atStartT, "2026-09-07") !== false &&
                 edit.task(moving).Start === "2026-09-07T08:00:00" &&
                 edit.task(moving).ActualStart === "2026-09-07T08:00:00" &&
                 edit.task(moving).Finish === "2026-09-09T17:00:00" &&
                 edit.task(moving).Duration === "PT24H0M0S" &&
                 edit.task(moving).PercentComplete === 50 &&
                 (edit.task(moving).ConstraintType || 0) === 0 && ok;
            print(`edit typed begun start ${shortDate(edit.task(moving).Start)}..` +
                  `${shortDate(edit.task(moving).Finish)} ` +
                  `actual=${shortDate(edit.task(moving).ActualStart)}`);
            for (let k = 0; k < 3; k++) edit.undo();

            /* Un fin en domingo va al día laborable anterior, como Project
             * propone por defecto, y la restricción lleva esa fecha. */
            const sunday = typedOn({ Duration: "PT16H0M0S" });
            ok = this.Tasks.Emit("CellEdit", String(sunday), atFinishT, "2026-09-20") !== false &&
                 edit.task(sunday).Start === "2026-09-17T08:00:00" &&
                 edit.task(sunday).Finish === "2026-09-18T17:00:00" &&
                 edit.task(sunday).ConstraintType === 6 &&
                 edit.task(sunday).ConstraintDate === "2026-09-18T17:00:00" && ok;
            print(`edit typed sunday finish ${shortDate(edit.task(sunday).Start)}..` +
                  `${shortDate(edit.task(sunday).Finish)} ` +
                  `pin=${shortDate(edit.task(sunday).ConstraintDate)}`);
            for (let k = 0; k < 3; k++) edit.undo();

            /* **Una demora en porcentaje, tipeada**: se guarda como Project la
             * escribe -- 50, formato 19 -- se muestra igual y corre a la
             * sucesora la mitad de la predecesora. */
            const stepWas = edit.at;
            const whole = typedOn({ Duration: "PT16H0M0S" });
            const half  = typedOn({ Duration: "PT8H0M0S" });
            const wholeID = edit.task(whole).ID;
            const halfLinks = this.linkValues(edit.task(half), `${wholeID}FS+50%`, "ID");
            ok = !!halfLinks.links && halfLinks.links.length === 1 &&
                 halfLinks.links[0].LinkLag === 50 &&
                 halfLinks.links[0].LagFormat === 19 && ok;
            edit.setLinks(half, halfLinks.links || []);
            const halfText = linksText(edit.task(half), this.holder.project, "ID");
            ok = halfText === `${wholeID}FS+50%` &&
                 edit.task(whole).Finish === "2026-09-02T17:00:00" &&
                 edit.task(half).Start === "2026-09-04T08:00:00" && ok;
            print(`edit typed percent lag ${halfText} ` +
                  `lag=${halfLinks.links ? halfLinks.links[0].LinkLag : "-"} ` +
                  `start=${shortDate(edit.task(half).Start)}`);
            while (edit.at > stepWas) edit.undo();
            edit.auto = autoWasT;
            this.setColumns(colsWereT);
            this.fill(null);
            ok = order() === was && ok;

            /* Resources and assignments through the commands the panel calls:
             * a new resource, a task assigned to it, and the work and cost
             * that follow from the task's own duration. */
            const res = edit.addResource({ Name: "Ana", Type: 1, MaxUnits: 1,
                                           StandardRate: 50, CalendarUID: 1 });
            const asg = edit.addAssignment(2, res.UID, 1);
            ok = res.UID === 1 && res.Name === "Ana" && asg &&
                 asg.TaskUID === 2 && asg.Work === "PT8H0M0S" &&
                 assignmentCost(edit.holder.project, asg) === 400 && ok;
            print(`edit resource uid=${res.UID} assignment work=${asg.Work} ` +
                  `cost=${assignmentCost(edit.holder.project, asg)}`);

            /* The rate table through the command the dialog calls: the list
             * comes back ordered by date, and the cost follows the period the
             * work happens in -- those 8h are after the raise, at 80. */
            ok = edit.setResourceRates(res.UID, [
                     new MspRate({ RatesFrom: "2026-09-01T00:00:00",
                                   RatesTo: "2026-12-31T23:59:00", RateTable: 0,
                                   StandardRate: 80, StandardRateFormat: 2 }),
                     new MspRate({ RatesFrom: "2026-01-01T00:00:00",
                                   RatesTo: "2026-08-31T23:59:00", RateTable: 0,
                                   StandardRate: 50, StandardRateFormat: 2,
                                   CostPerUse: 10 }),
                 ]) &&
                 edit.resource(res.UID).Rates.length === 2 &&
                 edit.resource(res.UID).Rates[0].RatesFrom === "2026-01-01T00:00:00" &&
                 assignmentCost(edit.holder.project,
                                edit.holder.project.Assignments[0]) === 640 && ok;
            print(`edit rates=${edit.resource(res.UID).Rates.length} ` +
                  `cost=${assignmentCost(edit.holder.project,
                                         edit.holder.project.Assignments[0])}`);

            /* The task type and effort-driven: one more unit on a task that
             * already carries one halves the duration and keeps the work. */
            edit.setFields(2, { Type: 0, EffortDriven: true });
            const bruno = edit.addResource({ Name: "Bruno", Type: 1,
                                             MaxUnits: 1, StandardRate: 40,
                                             CalendarUID: 1 });
            ok = edit.addAssignment(2, bruno.UID, 1) &&
                 edit.task(2).Duration === "PT4H0M0S" &&
                 edit.task(2).Work === "PT8H0M0S" && ok;
            print(`edit effort duration=${edit.task(2).Duration} ` +
                  `work=${edit.task(2).Work}`);

            /* The project's own minutes: a day is 420 now, so a typed "1d" is
             * seven hours and not eight. */
            ok = edit.setProject({ MinutesPerDay: 420, MinutesPerWeek: 2100,
                                   DaysPerMonth: 20 }) && ok;
            this.fill(2);
            this.TxtDuration.Text = "1d";
            ok = this.applyFields() &&
                 edit.task(2).Duration === "PT7H0M0S" && ok;
            print(`edit minutes a day: 1d -> ${edit.task(2).Duration}`);

            /* **Y con el automático encendido la duración tipeada no se
             * revierte**: la tarea lleva una asignación, y dos días escritos
             * son dos días de duración -- catorce horas de trabajo -- y no los
             * que el trabajo viejo decía. Es la dirección en que Project edita,
             * y el paso que la aplica es el mismo `commit`. */
            this.edit.auto = true;
            this.TxtDuration.Text = "2d";
            ok = this.applyFields() &&
                 edit.task(2).Duration === "PT14H0M0S" &&
                 edit.task(2).Work === "PT28H0M0S" && ok;
            print(`edit minutes a day auto: 2d -> ${edit.task(2).Duration} ` +
                  `work=${edit.task(2).Work}`);
            edit.undo();
            this.fill(2);
            this.edit.auto = false;
            ok = edit.task(2).Duration === "PT7H0M0S" &&
                 edit.task(2).Work === "PT8H0M0S" && ok;

            /* A calendar edited whole: Sunday works a morning from now on. */
            const cal = edit.calendar(1);
            const week = cal.WeekDays.slice();
            for (let i = 0; i < week.length; i++)
                if (week[i].DayType === 1)
                    week[i] = new MspWeekDay({
                        DayType: 1, DayWorking: true,
                        WorkingTimes: [new MspWorkingTime({ FromTime: "08:00:00",
                                                            ToTime: "12:00:00" })] });
            ok = edit.setCalendar(1, { WeekDays: week }) && ok;
            ok = edit.calendar(1).WeekDays[0].DayWorking === true && ok;
            print(`edit calendar sunday=${edit.calendar(1).WeekDays[0].DayWorking}`);

            /* A calendar of its own: a copy of the one there -- its real
             * week, Sunday included -- with a fresh UID, and it can go while
             * the project's stays. */
            const calendars = edit.holder.project.Calendars.length;
            const copy = edit.addCalendar("Copia", 1);
            ok = edit.holder.project.Calendars.length === calendars + 1 &&
                 copy.UID !== 1 && copy.WeekDays.length === 7 &&
                 copy.WeekDays[0].DayWorking === true &&
                 edit.removeCalendar(copy.UID) &&
                 edit.holder.project.Calendars.length === calendars &&
                 !edit.removeCalendar(1) && ok;
            print(`edit calendars copy=${copy.UID} ` +
                  `then=${edit.holder.project.Calendars.length}`);

            /* A custom field through the panel: the definition is a command of
             * its own, and then the task gets the value. */
            ok = edit.setFieldDef({ FieldID: "188743731", FieldName: "Text1",
                                    Alias: "External_ID" }) && ok;
            this.fill(2);
            this.TxtAttr.Text = "4821";
            ok = this.applyFields() &&
                 attrOf(edit.task(2), "188743731") === "4821" && ok;
            print(`edit custom field=${attrOf(edit.task(2), "188743731")}`);

            /* Another one, added, edited and removed: renaming keeps the
             * values, and deleting the definition takes them along. */
            ok = edit.setFieldDef({ FieldID: "188743732", FieldName: "Text2",
                                    Alias: "Temp" }) &&
                 edit.setFieldValue(2, "188743732", "x") && ok;
            ok = edit.setFieldDef({ FieldID: "188743732", FieldName: "Text2",
                                    Alias: "Temporal" }) &&
                 attrOf(edit.task(2), "188743732") === "x" && ok;
            ok = edit.removeFieldDef("188743732") &&
                 edit.holder.project.FieldDefs.length === 1 &&
                 attrOf(edit.task(2), "188743732") === "" && ok;
            print(`edit fields left=${edit.holder.project.FieldDefs.length}`);

            /* A list: the definition carries its entries, a value taken from
             * it is paired with the entry's ID, one the list does not carry
             * loses the pointer, and taking the field out takes both. */
            ok = edit.setFieldDef({ FieldID: "188743733", FieldName: "Text3",
                                    Alias: "Estado",
                                    ValueList: [
                                        { ID: 0, Value: "Pendiente" },
                                        { ID: 0, Value: "En curso",
                                          Description: "trabajando" },
                                    ] }) &&
                 edit.setFieldValue(2, "188743733", "En curso") && ok;
            const estado = edit.task(2).Attributes.find(
                (a) => a.FieldID === "188743733");
            ok = !!estado && estado.ValueGUID === "2" && ok;
            ok = edit.setFieldValue(2, "188743733", "Libre") &&
                 edit.task(2).Attributes.find(
                     (a) => a.FieldID === "188743733").ValueGUID === "" && ok;
            ok = edit.removeFieldDef("188743733") &&
                 edit.holder.project.FieldDefs.length === 1 && ok;
            print(`edit list ${estado ? estado.Value : "-"} ` +
                  `guid=${estado ? estado.ValueGUID : "-"}`);

            /* El hipervínculo de la tarea -- el lugar del archivo para un
             * enlace, porque los campos personalizados no tienen ese tipo --,
             * con el botón de abrir siguiendo la dirección. Se limpia antes de
             * guardar, para no mover el golden. */
            this.fill(2);
            this.TxtLinkText.Text    = "Ticket 4821";
            this.TxtLinkAddress.Text = "https://glpi.example/front/ticket.form.php?id=4821";
            this.TxtLinkAddress_Change();
            this.TxtLinkSub.Text     = "comentarios";
            ok = this.applyFields() &&
                 edit.task(2).Hyperlink === "Ticket 4821" &&
                 edit.task(2).HyperlinkAddress ===
                     "https://glpi.example/front/ticket.form.php?id=4821" &&
                 edit.task(2).HyperlinkSubAddress === "comentarios" &&
                 this.BtnLinkUri.Enabled && ok;
            print(`edit hyperlink=${edit.task(2).HyperlinkAddress}`);

            /* Y su columna: un link de verdad -- la tabla la declara `Link` y
             * cada celda se abre sola --, con el texto del enlace o la
             * dirección cuando no hay texto. */
            const linkColumns = this.columns.slice();
            this.setColumns(["link"]);
            ok = this.Tasks.Columns.length === 2 &&
                 this.Tasks.Columns[1].Link === true &&
                 this.Tasks.Row("2")[1] === "Ticket 4821" && ok;
            this.setColumns(linkColumns);

            this.TxtLinkText.Text    = "";
            this.TxtLinkAddress.Text = "";
            this.TxtLinkAddress_Change();
            this.TxtLinkSub.Text     = "";
            ok = this.applyFields() &&
                 edit.task(2).HyperlinkAddress === "" &&
                 !this.BtnLinkUri.Enabled && ok;

            /* Apply sits under the tabs and only the two that edit fields show it. */
            this.PropsTabs_Switch(2);
            ok = !this.ApplyBar.Visible && ok;
            this.PropsTabs_Switch(1);
            ok = this.ApplyBar.Visible && ok;
            this.PropsTabs_Switch(0);

            /* The resources' own dialog, beside the calendars: the list, a new
             * one through the fields, and the same one renamed through them. */
            const resCount = edit.holder.project.Resources.length;
            const resdlg = ResourcesForm.open(edit.holder.project,
                                              this.resourceActions());
            ok = resdlg.rows.length === 2 && resdlg.Resources.Index < 0 && ok;
            resdlg.TxtResName.Text = "Carla";
            resdlg.TxtResRate.Text = "30";
            resdlg.BtnResApply_Click();
            ok = edit.holder.project.Resources.length === resCount + 1 &&
                 resdlg.rows.length === 3 &&
                 resdlg.TxtResName.Text === "Carla" && resdlg.BtnResDel.Enabled && ok;
            resdlg.TxtResName.Text = "Carlota";
            resdlg.BtnResApply_Click();
            ok = edit.holder.project.Resources.length === resCount + 1 &&
                 edit.resource(resdlg.selectedUID).Name === "Carlota" && ok;
            print(`edit resources dialog rows=${resdlg.rows.length}`);
            /* Taken back, so what follows sees the plan the dialog found. */
            edit.undo(); edit.undo();
            this.fill(this.selectedUID);
            ok = edit.holder.project.Resources.length === resCount && ok;
            resdlg.Close();

            /* The dialog beside the calendars: the list of what the plan
             * defines -- with its tick -- and a new field starting on the next
             * free text one. */
            const fdlg = FieldsForm.open(edit.holder.project, this.fieldActions());
            ok = fdlg.rows.length === 1 && fdlg.ChkShown.Enabled &&
                 typeof fdlg.ChkShown_Click === "function" &&
                 typeof fdlg.BtnFieldNew_Click === "function" &&
                 typeof fdlg.BtnFieldEdit_Click === "function" &&
                 typeof fdlg.BtnFieldDel_Click === "function" && ok;
            fdlg.Close();
            const fform = FieldForm.open(null, edit.holder.project.FieldDefs,
                                         () => {});
            ok = fform.TxtFieldID.Text === "188743732" &&
                 fform.TxtFieldName.Text === "Text2" && ok;
            print(`edit field form next=${fform.TxtFieldID.Text}`);
            fform.Close();

            /* Y el editor de un campo con lista: las filas son las entradas. */
            const listDef = new MspFieldDef({
                FieldID: "188743733", FieldName: "Text3", Alias: "Estado",
                ValueList: [new MspValueEntry({ ID: 1, Value: "A" }),
                            new MspValueEntry({ ID: 2, Value: "B" })] });
            const lform = FieldForm.open(listDef, edit.holder.project.FieldDefs,
                                         () => {});
            ok = lform.ChkList.Active && lform.ListBox.Visible &&
                 lform.FieldValues.Count === 2 &&
                 typeof lform.ChkList_Click === "function" &&
                 typeof lform.BtnValAdd_Click === "function" &&
                 typeof lform.BtnValDel_Click === "function" &&
                 typeof lform.FieldValues_Select === "function" && ok;
            lform.TxtValValue.Text = "C";
            lform.TxtValDescription.Text = "tercera";
            lform.BtnValAdd_Click();
            ok = lform.entries.length === 3 && lform.FieldValues.Count === 3 && ok;
            lform.FieldValues.Index = 2;
            lform.FieldValues_Select();
            ok = lform.BtnValDel.Enabled && lform.TxtValValue.Text === "C" && ok;
            lform.BtnValDel_Click();
            ok = lform.entries.length === 2 && ok;
            print(`edit list form entries=${lform.FieldValues.Count}`);
            lform.Close();

            /* The baseline keeps the plan as it stands, and a hundred per
             * cent finishes the task: the actual dates follow. Two numbers
             * are kept side by side, the second one through the panel's own
             * combo and button, and re-saving replaces rather than stacks. */
            edit.setBaseline(0);
            this.saveBaseline(1);
            this.saveBaseline(0);
            ok = edit.task(2).Baselines.length === 2 &&
                 baselineOf(edit.task(2), 0).Start === edit.task(2).Start &&
                 baselineOf(edit.task(2), 1).Start === edit.task(2).Start && ok;
            print(`edit baseline 0=${baselineOf(edit.task(2), 0).Start} ` +
                  `1=${baselineOf(edit.task(2), 1).Start} ` +
                  `of=${edit.task(2).Baselines.length}`);

            this.fill(2);
            this.SpinPercent.Value = 100;
            ok = this.applyFields() &&
                 edit.task(2).ActualStart !== "" &&
                 edit.task(2).ActualFinish === edit.task(2).Finish && ok;
            print(`edit progress actual=${edit.task(2).ActualStart}..` +
                  `${edit.task(2).ActualFinish}`);

            /* The filter: the matches and the ancestors that place them. */
            this.TxtFilter.Text = "Analyse";
            this.TxtFilter_Change();
            ok = this.Tasks.Count === 2 && ok;
            print(`edit filter rows=${this.Tasks.Count}`);
            this.TxtFilter.Text = "";
            this.TxtFilter_Change();
            ok = this.Tasks.Count === 4 && ok;

            /* The columns are a view: choosing them rebuilds the table and
             * leaves the plan alone.  The choice the window came with is put
             * back at the end, so the run leaves no trace in the settings. */
            const remembered = this.columns.slice();
            this.setColumns(["duration", "percent"]);
            ok = this.Tasks.Columns.length === 3 &&
                 this.Tasks.Row("2")[1] === durationText(edit.task(2),
                                                         this.holder.project) &&
                 String(this.Tasks.Row("2")[2]).endsWith("%") && ok;

            /* A custom field is one more column -- and more than one at a
             * time: each one is read by its `FieldID`. */
            this.setColumns(["duration", fieldColumnID("188743731"), "cost"]);
            ok = this.Tasks.Columns.length === 4 &&
                 this.Tasks.Columns[2].Text === "External_ID" &&
                 this.Tasks.Row("2")[2] === "4821" && ok;

            this.setColumns(["duration", "start", "finish",
                             fieldColumnID("188743731"), "cost"]);

            /* The heading's menu: built for the secondary click only, and the
             * name -- the tree -- cannot be taken away, so its item is greyed.
             * Hiding a column over a data heading leaves the plan alone. */
            const menu  = this.Tasks_HeaderClick(2, 3, false, false);
            const named = this.Tasks_HeaderClick(0, 3, false, false);
            const item  = (list, name) => list.find((i) => i.name === name);
            ok = this.Tasks_HeaderClick(2, 1, false, false) === undefined &&
                 menu && menu.length === 8 &&
                 item(menu, "MnuColHide").enabled &&
                 !item(named, "MnuColHide").enabled &&
                 item(menu, "MnuColShowAll").enabled &&
                 item(menu, "MnuColDialog").text === Locale.Text("Columns…") &&
                 ok;
            this.MnuColHide_Click(2);
            ok = this.columns.indexOf("start") < 0 &&
                 this.visibleColumns().length === 4 &&
                 this.Tasks.Columns.length === 5 &&
                 this.Tasks.Row("2").length === 5 && ok;
            print(`edit headermenu=${menu.length} ` +
                  `hidden=${this.columns.length}`);
            /* Moving and inserting, through the heading's menu: Finish goes
             * ahead of Duration, the first column cannot go further left nor
             * the last further right, and the hidden Start comes back where it
             * was asked for -- left of the fourth heading -- through its
             * dialog. */
            this.MnuColLeft_Click(2);
            ok = this.tableColumns().slice(0, 3).join() === "name,finish,duration" &&
                 !item(this.Tasks_HeaderClick(0, 3, false, false), "MnuColLeft").enabled &&
                 !item(this.Tasks_HeaderClick(4, 3, false, false), "MnuColRight").enabled &&
                 item(this.Tasks_HeaderClick(1, 3, false, false), "MnuColLeft").enabled && ok;
            const insdlg = this.MnuColInsert_Click(3);
            const startAt = insdlg.choices.findIndex((c) => c.id === "start");
            insdlg.CmbColumn.Index = startAt;
            insdlg.BtnOk_Click();
            ok = startAt >= 0 &&
                 this.tableColumns().slice(0, 4).join() === "name,finish,duration,start" &&
                 this.visibleColumns().length === 5 && ok;
            print(`edit column order=${this.tableColumns().slice(0, 4).join()}`);

            /* **The name moves like any other** -- the Id ahead of it is
             * Project's own sheet -- and the outline goes with it: the
             * heading that carries the arrow is the name's wherever it is. */
            this.MnuColRight_Click(0);
            ok = this.tableColumns().slice(0, 2).join() === "finish,name" &&
                 this.Tasks.Columns[1].Tree === true &&
                 !this.Tasks.Columns[0].Tree &&
                 this.Tasks.Row("2")[1] === edit.task(2).Name &&
                 !item(this.Tasks_HeaderClick(1, 3, false, false), "MnuColHide").enabled && ok;
            this.MnuColHide_Click(1);
            ok = this.tableColumns().indexOf("name") === 1 && ok;
            this.MnuColLeft_Click(1);
            print(`edit name moves, tree=${this.Tasks.Columns.findIndex((c) => c.Tree)}`);

            /* A heading dragged: the runtime moves it and says where, and the
             * order is the app's again -- declared in it, with the outline on
             * the name. */
            this.Tasks.MoveColumn(0, 2);
            this.Tasks_ColumnMove(0, 2);
            ok = this.tableColumns().slice(0, 3).join() === "finish,duration,name" &&
                 this.Tasks.ColumnOrder.join() === this.Tasks.Columns.map((c, i) => i).join() &&
                 this.Tasks.Columns[2].Tree === true &&
                 this.Tasks.Row("2")[2] === edit.task(2).Name && ok;
            this.Tasks_ColumnMove(2, 0);
            ok = this.tableColumns()[0] === "name" && ok;
            print(`edit heading dragged, order=${this.Tasks.ColumnOrder.join()}`);

            this.MnuColShowAll_Click();
            ok = this.visibleColumns().length === COLUMNS.length + 1 &&
                 this.Tasks.Columns.length === COLUMNS.length + 2 &&
                 !item(this.Tasks_HeaderClick(2, 3, false, false),
                       "MnuColShowAll").enabled && ok;

            /* **The grid's own road.** Each column declares the editor its
             * values need, a summary's cells are shut where they are drawn, and
             * an edit is the panel's own commands -- one field, one undo.
             * The gesture is driven through `EditCell`/`EndEdit` where the
             * editor is the point (a `Number`, a `Check`, the dialog a
             * `Custom` cell opens) and through `Emit` where what is asserted is
             * how a text maps to the model (the value kinds, the refusals). */
            this.setColumns(["duration", "start", "percent", "milestone",
                             "priority", "calendar", "type", "constraint",
                             "notes", fieldColumnID("188743731")]);
            const atDur   = this.tableColumns().indexOf("duration");
            const atStart = this.tableColumns().indexOf("start");
            const atPct   = this.tableColumns().indexOf("percent");
            const atMile  = this.tableColumns().indexOf("milestone");
            const atPrio  = this.tableColumns().indexOf("priority");
            const atCal   = this.tableColumns().indexOf("calendar");
            const atType  = this.tableColumns().indexOf("type");
            const atCon   = this.tableColumns().indexOf("constraint");
            const atNotes = this.tableColumns().indexOf("notes");
            const atField = this.tableColumns().indexOf(fieldColumnID("188743731"));
            const specOf  = (at) => this.Tasks.Columns[at].Editor;
            this.fill(2);

            ok = specOf(atDur) === "Text" &&
                 specOf(atStart) === "Date" &&
                 specOf(atPct).Kind === "Number" && specOf(atPct).Max === 100 &&
                 specOf(atMile).Kind === "Check" && specOf(atMile).ActiveText === "◆" &&
                 specOf(atCal) === "Combo" && specOf(atType) === "Combo" &&
                 specOf(atCon) === "Custom" && ok;
            print(`edit cell editors pct=${specOf(atPct).Kind} ` +
                  `start=${specOf(atStart)} mile=${specOf(atMile).Kind} ` +
                  `cal=${specOf(atCal)} con=${specOf(atCon)}`);

            /* **A summary's cells are shut, not refused after the typing**:
             * no editor opens at all, and the field does not move. */
            const wasStart = edit.task(1).Start;
            ok = this.Tasks.EditCell("1", atStart) === false &&
                 this.Tasks.EditCell("1", atDur) === false &&
                 edit.task(1).Start === wasStart && ok;
            print(`edit cell summary shut`);

            /* A Number: the spin opens on `40%`, answers `40`, and the model
             * follows -- one command, one undo. */
            const wasPct = edit.task(2).PercentComplete;
            this.Tasks.SetCell("2", atPct, "40%");
            ok = this.Tasks.EditCell("2", atPct) === true &&
                 this.Tasks.EndEdit() === true &&
                 edit.task(2).PercentComplete === 40 && ok;
            edit.undo();
            this.fill(2);
            ok = edit.task(2).PercentComplete === wasPct && ok;
            print(`edit cell percent ${wasPct} -> 40 -> undone=` +
                  `${edit.task(2).PercentComplete}`);

            /* A Check: opening it is turning it, and its text is the flag. */
            const wasMile = edit.task(2).Milestone;
            ok = this.Tasks.EditCell("2", atMile) === true &&
                 edit.task(2).Milestone === !wasMile && ok;
            edit.undo();
            this.fill(2);
            ok = edit.task(2).Milestone === wasMile && ok;
            print(`edit cell milestone ${wasMile} -> ${!wasMile}`);

            /* A field: the text, one command, and a word where a duration goes
             * is refused with the cell put back. The `3d` also proves the
             * answer is the canonical spelling, not the text -- the cell is
             * handed one in its own unit. */
            const wasDuration = edit.task(2).Duration;
            /* A day is the plan's own `MinutesPerDay` -- the check edits it
             * earlier, so the arithmetic is read from the project. */
            const threeDays = mspdiDuration(3 * (this.holder.project.MinutesPerDay || 480));
            const cellDur  = this.Tasks.Emit("CellEdit", "2", atDur, "3d");
            ok = cellDur !== false && edit.task(2).Duration === threeDays && ok;
            edit.undo();
            this.fill(2);
            ok = edit.task(2).Duration === wasDuration && ok;
            print(`edit cell duration=${wasDuration} -> ${threeDays} -> undone=` +
                  `${edit.task(2).Duration}`);

            ok = this.Tasks.Emit("CellEdit", "2", atDur, "3x") === false &&
                 edit.task(2).Duration === wasDuration && ok;
            print(`edit cell duration refused`);

            /* A Date: a bare day -- what the calendar picks -- takes the plan's
             * own start time, and a word is refused. */
            const wasTaskStart = edit.task(2).Start;
            ok = this.Tasks.Emit("CellEdit", "2", atStart, "2026-09-10") !== false &&
                 edit.task(2).Start === "2026-09-10T08:00:00" && ok;
            edit.undo();
            this.fill(2);
            ok = edit.task(2).Start === wasTaskStart && ok;
            ok = this.Tasks.Emit("CellEdit", "2", atStart, "soon") === false &&
                 edit.task(2).Start === wasTaskStart && ok;
            print(`edit cell start bare day=${wasTaskStart} -> undone=` +
                  `${edit.task(2).Start}`);

            /* The lists a `CellEditor` answers: the plan's calendars, the three
             * task types -- and a custom field is a field unless the file says
             * its values are a list. */
            const calItems = this.Tasks_CellEditor("2", atCal);
            ok = calItems && calItems.Items[0] === Locale.Text("Project default") &&
                 calItems.Items.indexOf("Standard") > 0 && ok;
            const typeItems = this.Tasks_CellEditor("2", atType);
            ok = typeItems && typeItems.Items.length === 3 &&
                 typeItems.Items[0] === "Fixed units" && ok;
            ok = this.Tasks_CellEditor("2", atField) === undefined && ok;
            print(`edit cell lists cal=${calItems ? calItems.Items.join("|") : "-"} ` +
                  `type=${typeItems ? typeItems.Items.length : "-"}`);

            ok = this.Tasks.Emit("CellEdit", "2", atCal, Locale.Text("Project default")) !== false &&
                 edit.task(2).CalendarUID === -1 && ok;
            edit.undo();
            this.fill(2);
            ok = edit.task(2).CalendarUID === 1 && ok;
            ok = this.Tasks.Emit("CellEdit", "2", atCal, "Nope") === false && ok;

            ok = this.Tasks.Emit("CellEdit", "2", atType, "Fixed work") !== false &&
                 edit.task(2).Type === 2 && ok;
            edit.undo();
            this.fill(2);
            ok = this.Tasks.Emit("CellEdit", "2", atType, "Fixed") === false && ok;

            /* The constraint's dialog: opened by the cell, one command on
             * accept, and the check that keeps it open while the date it needs
             * is missing. The dialog is asked through a spy here so the check
             * drives the wiring and not a window. */
            let askedCon = null;
            const realConstraint = ConstraintForm.open;
            ConstraintForm.open = (names, type, date, accept, clean) => {
                askedCon = { names, type, date, accept, clean };
            };
            ok = this.Tasks_CellEditor("2", atCon) === undefined && !!askedCon && ok;
            ConstraintForm.open = realConstraint;
            ok = askedCon.names.length === 8 && askedCon.type === 0 && ok;
            ok = askedCon.clean(2, "") !== "" && askedCon.clean(0, "") === "" &&
                 askedCon.clean(2, "2026-09-10") === "" && ok;
            askedCon.accept(2, "2026-09-10 08:00");
            ok = edit.task(2).ConstraintType === 2 &&
                 edit.task(2).ConstraintDate === "2026-09-10T08:00:00" && ok;
            edit.undo();
            this.fill(2);
            print(`edit cell constraint dialog type=${edit.task(2).ConstraintType} ` +
                  `back=${JSON.stringify(edit.task(2).ConstraintDate)}`);

            /* The dialog itself builds and closes, like every other one. */
            ConstraintForm.open(this.CmbConstraint.Items, 4, "2026-09-04 08:00",
                                () => {}, () => "").Close();

            const cellNotes = this.Tasks.Emit("CellEdit", "2", atNotes, "Desde la celda");
            ok = cellNotes !== false && edit.task(2).Notes === "Desde la celda" && ok;
            edit.undo();
            this.fill(2);
            print(`edit cell notes=${cellNotes !== false}`);

            /* The cell of a custom field, through the command that owns the
             * `ValueGUID` pointer. */
            const cellAttr = this.Tasks.Emit("CellEdit", "2", atField, "9001");
            ok = cellAttr !== false && attrOf(edit.task(2), "188743731") === "9001" && ok;
            edit.undo();
            this.fill(2);
            ok = attrOf(edit.task(2), "188743731") === "4821" && ok;
            print(`edit cell attr back=${attrOf(edit.task(2), "188743731")}`);

            const cellPrio = this.Tasks.Emit("CellEdit", "2", atPrio, "600");
            ok = cellPrio !== false && edit.task(2).Priority === 600 && ok;
            edit.undo();
            this.fill(2);
            print(`edit cell priority=${cellPrio !== false}`);

            /* A summary's name is the user's, in the cell like anywhere. */
            const cellName = this.Tasks.Emit("CellEdit", "1", 0, "Analizado");
            ok = cellName !== false && edit.task(1).Name === "Analizado" && ok;
            edit.undo();
            this.fill(2);
            ok = edit.task(1).Name === "Analyse II" && ok;
            print(`edit cell name back=${edit.task(1).Name}`);

            /* **La celda se mueve como la grilla de Project**: Enter baja,
             * Tab a la derecha y Shift+Tab a la izquierda. El commit dice con
             * qué terminó (`how`), y el mismo movimiento es el de la tecla
             * suelta; la barra de entrada sigue a la celda. Una tercera fila
             * -- que se deshace al final -- es lo que hay para bajar. */
            const navTask = edit.addTask(null);
            const navKey  = String(navTask.UID);
            this.setColumns(["duration", "start"]);
            this.fill(2);
            const atDur2   = this.tableColumns().indexOf("duration");
            const atStart2 = this.tableColumns().indexOf("start");

            this.Tasks.CurrentCell = { Row: "2", Column: atDur2 };
            ok = JSON.stringify(this.Tasks.CurrentCell) ===
                 `{"Row":"2","Column":${atDur2}}` &&
                 this.cell.key === "2" && this.cell.id === "duration" && ok;

            const cellEnter = this.Tasks.Emit("CellEdit", "2", atDur2, "3d", "enter");
            ok = cellEnter !== false && this.cell.key === navKey &&
                 this.cell.id === "duration" &&
                 JSON.stringify(this.Tasks.CurrentCell) ===
                 `{"Row":"${navKey}","Column":${atDur2}}` && ok;
            print(`edit cell enter -> ${this.cell.key}/${this.cell.id}`);
            edit.undo();
            this.fill(2);

            this.Tasks.CurrentCell = { Row: "2", Column: atDur2 };
            const cellTab = this.Tasks.Emit("CellEdit", "2", atDur2, "3d", "tab");
            ok = cellTab !== false && this.cell.key === "2" &&
                 this.cell.id === "start" && ok;
            edit.undo();
            this.fill(2);

            /* El final de una fila da la vuelta a la primera columna de la
             * siguiente, y el comienzo a la última de la anterior. */
            this.Tasks.CurrentCell = { Row: "2", Column: atStart2 };
            this.moveCell("right");
            ok = this.cell.key === navKey && this.cell.id === "name" && ok;
            this.moveCell("left");
            ok = this.cell.key === "2" && this.cell.id === "start" && ok;

            /* La tecla suelta es el mismo movimiento, y la barra de entrada
             * muestra la celda nueva. */
            this.Tasks.CurrentCell = { Row: "2", Column: atDur2 };
            ok = this.Tasks_KeyPress("Return", false, false, false) === true &&
                 this.cell.key === navKey && this.cell.id === "duration" &&
                 this.TxtEntry.Text === this.Tasks.Cell(navKey, atDur2) &&
                 this.LblEntry.Text === Locale.Text("Duration") && ok;
            ok = this.Tasks_KeyPress("Tab", false, false, false) === true &&
                 this.cell.key === navKey && this.cell.id === "start" && ok;
            ok = this.Tasks_KeyPress("ISO_Left_Tab", false, true, false) === true &&
                 this.cell.key === navKey && this.cell.id === "duration" && ok;
            print(`edit cell keys -> ${this.cell.key}/${this.cell.id}`);

            /* Insert agrega una tarea después de la elegida y Delete borra la
             * elegida -- la puerta de los comandos de siempre. */
            const wasTasks = edit.holder.project.Tasks.length;
            ok = this.Tasks_KeyPress("Insert", false, false, false) === true &&
                 edit.holder.project.Tasks.length === wasTasks + 1 && ok;
            edit.undo();
            this.fill(2);
            const realDelete = this.ActDelete_Execute;
            let askedDelete = 0;
            this.ActDelete_Execute = () => { askedDelete++; };
            ok = this.Tasks_KeyPress("Delete", false, false, false) === true &&
                 askedDelete === 1 && ok;
            this.ActDelete_Execute = realDelete;

            /* Una edición rechazada no mueve la celda: es la que hay que
             * corregir. */
            this.Tasks.CurrentCell = { Row: "2", Column: atDur2 };
            const cellBad = this.Tasks.Emit("CellEdit", "2", atDur2, "3x", "enter");
            ok = cellBad === false && this.cell.key === "2" &&
                 this.cell.id === "duration" && ok;

            /* **La celda sobrevive a la reconstrucción**: la columna queda y la
             * fila es la que la tabla conserva; una columna que se oculta deja
             * la celda en nada, que es lo que no puede apuntar a otro campo. */
            this.Tasks.CurrentCell = { Row: "2", Column: atStart2 };
            this.fill(2);
            ok = this.cell.key === "2" && this.cell.id === "start" &&
                 JSON.stringify(this.Tasks.CurrentCell) ===
                 `{"Row":"2","Column":${atStart2}}` && ok;
            this.setColumns(["duration"]);
            ok = this.cell === null && this.Tasks.CurrentCell === null && ok;
            print(`edit cell survives fill, hidden column clears`);
            edit.undo();
            this.setColumns(["duration", "start", "percent", "milestone",
                             "priority", "calendar", "type", "constraint",
                             "notes", fieldColumnID("188743731")]);
            this.fill(2);

            /* **Información de la tarea**: the double click's door -- the
             * panel's own fields over the window, OK writing them as one
             * command -- and the summary's derived fields greyed there too. */
            this.fill(2);
            const dlg = this.Tasks_Activate();
            ok = !!dlg && dlg.TxtName.Text === edit.task(2).Name &&
                 dlg.TxtDuration.Text === durationText(edit.task(2), this.holder.project) &&
                 dlg.CmbTaskCalendar.Items[0] === Locale.Text("Project default") && ok;
            const wasDialogName = edit.task(2).Name;
            const wasDialogDuration = edit.task(2).Duration;
            dlg.TxtName.Text = "From the dialog";
            dlg.TxtDuration.Text = "2d";
            dlg.BtnOk_Click();
            const twoDays = mspdiDuration(2 * (this.holder.project.MinutesPerDay || 480));
            ok = edit.task(2).Name === "From the dialog" &&
                 edit.task(2).Duration === twoDays && ok;
            edit.undo();
            this.fill(2);
            ok = edit.task(2).Name === wasDialogName &&
                 edit.task(2).Duration === wasDialogDuration && ok;
            print(`edit dialog name=${edit.task(2).Name} duration=${edit.task(2).Duration}`);

            /* The dialog's custom field, through the door and its OK: one
             * command, the `ValueGUID` pointer included. */
            const dlAttr = this.Tasks_Activate();
            dlAttr.TxtAttr.Text = "9001";
            dlAttr.BtnOk_Click();
            ok = attrOf(edit.task(2), "188743731") === "9001" && ok;
            edit.undo();
            this.fill(2);
            ok = attrOf(edit.task(2), "188743731") === "4821" && ok;
            print(`edit dialog attr back=${attrOf(edit.task(2), "188743731")}`);

            /* **Las pestañas de vínculos y recursos**, que el diálogo edita
             * sobre copias y el Aceptar escribe con los campos en **un solo
             * Deshacer**: Cancelar no deja nada, y Link/Unlink y las órdenes
             * de las asignaciones -- alta, baja, presupuesto -- no tocan el
             * plan hasta que se acepta. */
            const linksWas = edit.task(2).Links.length;
            const asgWas   = edit.holder.project.Assignments
                                 .filter((a) => a.TaskUID === 2).length;
            const asgOf    = (resUID) => edit.holder.project.Assignments
                .find((a) => a.TaskUID === 2 && a.ResourceUID === resUID);

            const dlgC = this.Tasks_Activate();
            ok = dlgC.Tabs.Tabs.length === 4 &&
                 dlgC.Links.Count === linksWas &&
                 dlgC.Assignments.Count === asgWas &&
                 dlgC.predChoices.indexOf(3) > 0 && ok;
            dlgC.CmbPred.Index = dlgC.predChoices.indexOf(3);
            dlgC.CmbType.Index = 1;                    // start to start
            dlgC.SpinLag.Value = 20;
            dlgC.BtnLinkAdd.Click();
            ok = dlgC.Links.Count === linksWas + 1 &&
                 edit.task(2).Links.length === linksWas && ok;
            dlgC.CmbAssignRes.Index = dlgC.resChoices.indexOf(2);   // Bruno
            dlgC.TxtAssignUnits.Text = "2";
            dlgC.BtnAssignAdd.Click();
            ok = dlgC.Assignments.Count === asgWas &&
                 dlgC.assignRows[1].units === 2 && ok;
            dlgC.BtnCancel.Click();
            ok = edit.task(2).Links.length === linksWas &&
                 asgOf(2).Units === 1 && ok;
            print(`edit dialog tabs cancel links=${edit.task(2).Links.length}`);

            /* El Aceptar los escribe con los campos: un solo Deshacer los
             * devuelve a los tres -- el vínculo, el presupuesto y el alta. */
            this.fill(2);
            const dlgT = this.Tasks_Activate();
            dlgT.CmbPred.Index = dlgT.predChoices.indexOf(3);
            dlgT.CmbType.Index = 1;
            dlgT.SpinLag.Value = 20;
            dlgT.BtnLinkAdd.Click();
            dlgT.Assignments.Select(0);                // Ana
            dlgT.TxtAssignBudget.Text = "60";
            dlgT.BtnAssignApply.Click();
            dlgT.CmbAssignRes.Index = dlgT.resChoices.indexOf(2);   // Bruno
            dlgT.TxtAssignUnits.Text = "2";
            dlgT.BtnAssignAdd.Click();
            dlgT.BtnOk.Click();
            ok = edit.task(2).Links.length === linksWas + 1 &&
                 edit.task(2).Links.some((l) => l.PredecessorUID === 3 &&
                                                l.Type === 3 &&
                                                l.LinkLag === 200) &&
                 asgOf(1).BudgetCost === 60 && asgOf(2).Units === 2 && ok;
            edit.undo();
            this.fill(2);
            ok = edit.task(2).Links.length === linksWas &&
                 asgOf(1).BudgetCost === 0 && asgOf(2).Units === 1 && ok;
            print(`edit dialog tabs ok links=${edit.task(2).Links.length} ` +
                  `ana=${asgOf(1).BudgetCost} bruno=${asgOf(2).Units}`);

            /* A summary's dates, duration and completion are greyed in the
             * dialog, as the panel greys them: only the name is the user's. */
            this.fill(1);
            const dlSum = this.Tasks_Activate();
            ok = !!dlSum && dlSum.TxtName.Enabled && !dlSum.TxtStart.Enabled &&
                 !dlSum.TxtDuration.Enabled && !dlSum.ChkMilestone.Enabled && ok;
            dlSum.Close();
            print(`edit dialog summary name=${dlSum.TxtName.Enabled} ` +
                  `start=${dlSum.TxtStart.Enabled}`);

            /* **Predecessors as text**: MSPDI's own spelling, parsed whole --
             * `3FS+2d, 7SS` -- with one command for the list and the engine's
             * refusals (a task that is not there, itself, a loop) putting the
             * cell back. */
            this.setColumns(["duration", "predecessors"]);
            const atPred = this.tableColumns().indexOf("predecessors");
            this.fill(2);
            ok = this.Tasks.Row("2")[atPred] === "1" && ok;   // the fixture's link
            const predDays = this.holder.project.MinutesPerDay || 480;
            ok = this.Tasks.Emit("CellEdit", "2", atPred, "1SS+2d") !== false &&
                 edit.task(2).Links.length === 1 &&
                 edit.task(2).Links[0].Type === 3 &&
                 edit.task(2).Links[0].LinkLag === 2 * predDays * 10 && ok;
            this.fill(2);
            ok = this.Tasks.Row("2")[atPred] === "1SS+2d" && ok;
            edit.undo();
            this.fill(2);
            ok = this.Tasks.Row("2")[atPred] === "1" && ok;
            ok = this.Tasks.Emit("CellEdit", "2", atPred, "9") === false && ok;
            ok = this.Tasks.Emit("CellEdit", "2", atPred, "2FS") === false && ok;
            ok = this.Tasks.Emit("CellEdit", "2", atPred, "x") === false && ok;
            ok = this.Tasks.Emit("CellEdit", "2", atPred, "") !== false &&
                 edit.task(2).Links.length === 0 && ok;
            edit.undo();
            this.fill(2);
            ok = edit.task(2).Links.length === 1 &&
                 this.Tasks.Row("2")[atPred] === "1" && ok;
            print(`edit predecessors text=${this.Tasks.Row("2")[atPred]} ` +
                  `links=${edit.task(2).Links.length}`);

            /* **The entry bar**: the current cell's whole text, and the same
             * command typed from there; it follows the row, shows a summary's
             * derived cell without editing it, and Escape puts the value
             * back. */
            this.fill(2);
            this.Tasks.Emit("CellEditor", "2", atDur);
            ok = this.LblEntry.Text === Locale.Text("Duration") &&
                 this.TxtEntry.Text === this.Tasks.Cell("2", atDur) &&
                 this.TxtEntry.Enabled && ok;
            this.TxtEntry.Text = "3d";
            ok = this.TxtEntry_Activate() !== false &&
                 edit.task(2).Duration === threeDays && ok;
            edit.undo();
            this.fill(2);
            ok = this.TxtEntry.Text === this.Tasks.Cell("2", atDur) && ok;
            this.fill(1);
            ok = this.LblEntry.Text === Locale.Text("Duration") &&
                 !this.TxtEntry.Enabled && ok;
            this.TxtEntry.Text = "9d";
            this.TxtEntry_KeyPress("Escape", false, false, false);
            ok = this.TxtEntry.Text === this.Tasks.Cell("1", atDur) && ok;
            print(`edit entry bar "${this.LblEntry.Text}"=` +
                  `"${this.TxtEntry.Text}" enabled=${this.TxtEntry.Enabled}`);

            /* **The bar's switch**: hidden until asked for -- Project 2013's
             * default -- and remembered. The check reads the setting first so
             * that toggling here leaves it exactly where it was. */
            const entryShown = Settings.Get("bintana-project.entrybar", false);
            this.MnuEntry_Click(true);
            ok = this.EntryBar.Visible && ok;
            this.MnuEntry_Click(false);
            ok = !this.EntryBar.Visible && ok;
            this.MnuEntry_Click(entryShown);
            ok = this.EntryBar.Visible === entryShown && ok;

            this.showColumns(remembered);
            print(`edit columns=${this.Tasks.Columns.length} ` +
                  `row=${this.Tasks.Row("2").length}`);

            /* The report: the bands are declared, the rows are the plan, and
             * the PDF is what a colleague who does not run the app opens. */
            const doc = new ReportDocument();
            fillReport(doc, planReport(this.holder.project, this.path, {}));
            const report = File.Join(out, "bintana-project-report.pdf");
            doc.SavePdf(report);
            const paper = File.Info(report);
            ok = doc.PageCount >= 1 && paper && paper.Size > 0 && ok;
            print(`edit report pages=${doc.PageCount} ` +
                  `pdf=${paper ? paper.Size : -1}`);

            const outPath = File.Join(out, "bintana-project-edit-" + name);
            writeMspdi(outPath, this.holder);
            print(`out=${outPath}`);
            edit.markSaved();
            ok = !edit.dirty && ok;

            const second  = readMspdi(outPath);
            const after   = summarize(second.project);
            const touched = treeDiff(pristine.doc.Root, second.doc.Root);
            print(`roundtrip tasks=${after.tasks} links=${after.links} ` +
                  `touched=${touched.length}`);
            if (Application.Arguments.indexOf("dump-touched") >= 0)
                for (const t of touched) print(`touched: ${t}`);

            /* The new task sits after UID 1's subtree and before its next
             * sibling: [summary, 1, new, 2]. */
            const saved = second.project.Tasks;
            print(`edit saved tasks=${after.tasks} links=${after.links} ` +
                  `rows=${saved.length} one=${saved[1].Name}/${saved[1].Summary} ` +
                  `two=${saved[2].UID}/${saved[2].Name}/${saved[2].OutlineLevel} ` +
                  `three=${saved[3].UID}`);
            ok = after.tasks === 2 && after.links === 2 && saved.length === 4 &&
                 saved[1].Name === "Analyse II" && saved[1].Summary === true &&
                 saved[2].UID === 3 && saved[2].Name === "New task" &&
                 saved[2].OutlineLevel === 2 && saved[3].UID === 2 &&
                 saved[2].Links.length === 1 &&
                 saved[2].ConstraintType === 4 &&
                 saved[2].Estimated === true &&
                 saved[2].Notes === "Edited in the harness" &&
                 second.project.Resources.length === 2 &&
                 second.project.Resources[0].Rates.length === 2 &&
                 second.project.Assignments.length === 2 &&
                 second.project.Assignments[0].Work === "PT4H0M0S" &&
                 second.project.FieldDefs.length === 1 &&
                 saved[3].Attributes.length === 1 &&
                 saved[3].Attributes[0].Value === "4821" &&
                 saved[3].Baselines.length === 2 &&
                 saved[3].ActualFinish !== "" && ok;

            print(`check-edit ${name}: ${ok ? "ok" : "FAILED"}`);
            print(ok ? "CHECK-OK" : "CHECK-FAILED");
            Application.Quit(ok ? 0 : 1);
        } catch (e) {
            print(`check-edit ${name}: ERROR ${e.message}`);
            print("CHECK-FAILED");
            Application.Quit(1);
        }
    }

    /*
     * A form is wired by name, and a control whose handler is missing does
     * nothing in silence -- which is exactly how the Open button spent an
     * afternoon after a rewrite. The check names the pairs the window needs.
     */
    checkWiring() {
        const wanted = ["ActOpen", "ActNew", "ActSave", "ActSaveAs", "ActExport",
                        "ActQuit", "ActUndo", "ActRedo", "ActAdd", "ActAddMilestone", "ActAddSummary", "ActDelete",
                        "ActLink", "ActUnlink", "ActCut", "ActPct0", "ActPct25", "ActPct50", "ActPct75", "ActPct100",
                        "ActIndent", "ActOutdent", "ActUp", "ActDown",
                        "ActCopy", "ActPaste", "ActZoomIn", "ActZoomOut", "ActZoomFit",
                        "ActScrollToTask",
                        "ActExpandAll", "ActCollapseAll", "ActLevel1", "ActLevel2",
                        "ActLevel3",
                        "ActRecalc", "ActSettings", "ActBaseline", "ActReport", "ActFilter", "ActColumns", "ActFormat",
                        "ActTaskInfo",
                        "BtnApply", "BtnLinkAdd", "BtnResManage",
                        "BtnLinkDel", "MnuRecent", "MnuLog", "MnuEntry", "MnuSummaryTask", "MnuProps", "ToolProps", "MnuTasks", "MnuChart", "ToolTasks", "ToolChart", "MnuAbout",
                        "MnuColHide", "MnuColShowAll", "MnuColDialog", "MnuColInsert",
                        "MnuColLeft", "MnuColRight",
                        "BtnAssignAdd", "BtnAssignApply", "BtnAssignDel",
                        "ActProjData", "ActProjOptions", "ActCalendar", "ActResources", "ActFields"]
            /* A command raises `Execute`; a button and a menu item, `Click`. */
            .map((name) => name.startsWith("Act") ? `${name}_Execute` : `${name}_Click`)
            .concat(["Tasks_Select", "Tasks_HeaderClick", "Tasks_ColumnMove", "Gantt_Draw", "Header_Draw", "GanttScroll_Scroll",
                     "CmbScale_Select",
                     "Links_Select", "Assignments_Select", "PropsTabs_Switch",
                     "CmbAttr_Select", "CmbAttrValue_Select", "TxtLinkAddress_Change",
                     "TxtFilter_Change", "CmbStatus_Select", "SldZoom_Change", "Tasks_KeyPress",
                     "TxtFilter_IconClick",
                     "Gantt_MouseDown", "Gantt_MouseMove", "Gantt_MouseLeave", "Gantt_MouseUp", "Gantt_KeyPress",
                     "Tasks_Activate", "Tasks_CellEdit", "Tasks_CellEditor", "Tasks_CellChange", "Gantt_DblClick",
                     "TxtEntry_Activate", "TxtEntry_KeyPress"]);

        let ok = true;
        for (const member of wanted) {
            if (typeof this[member] !== "function") {
                print(`wiring missing: ${member}`);
                ok = false;
            }
        }
        return ok;
    }

    /*
     * The table is the tree the chart draws, addressed by key: every row is a
     * task, its name and duration are where they should be, and selecting one
     * marks it for the chart. Generic over the file -- the fixture's own
     * numbers are not the assertion.
     */
    checkTree() {
        /* The list's own rows, not the plan's: with no filter the two are the
         * same list, and a check that counted the plan would only be right
         * until somebody filters. */
        const rows = this.chartRows();
        let ok = this.Tasks.Count === rows.length;

        for (const task of rows) {
            const key = String(task.UID);
            if (!this.Tasks.Exists(key)) { ok = false; continue; }
            const row  = this.Tasks.Row(key);
            const name = task.Milestone ? `◆ ${task.Name}` : task.Name;
            const at   = this.tableColumns().indexOf("duration");
            if (row[this.tableColumns().indexOf("name")] !== name ||
                (at > 0 && row[at] !== durationText(task, this.holder.project)))
                ok = false;
        }

        this.Tasks.Key = rows.length ? String(rows[0].UID) : "";
        this.Tasks_Select();
        if (rows.length && this.selectedUID !== rows[0].UID) ok = false;

        print(`tree ${File.Name(this.path)} rows=${rows.length} ` +
              `table=${this.Tasks.Count} ` +
              `selected=${this.selectedUID === null ? "-" : this.selectedUID} ` +
              `${ok ? "ok" : "FAILED"}`);
        return ok;
    }

    /*
     * The chart ran to the end: the same Draw into a PNG (explicit size --
     * a surface never shown has none of its own), then the file the Export
     * button writes, and the frame's own dump. A handler that threw halfway
     * writes no file and leaves a dump with no closing Pop.
     *
     * **The dump is the file's frame, not the pane's**: a `Save` runs the same
     * `Draw`, and it is the last one that ran. So the names it holds are the
     * names a chart carries on its own -- which is the promise of a picture --
     * and the pane's own geometry is what `checkView` measures.
     */
    /*
     * The chart's style, asserted with a painter that writes down instead of
     * drawing. **A frame is not a picture of a test**: what the dump of a real
     * draw can say is that some calls happened, while the order things are drawn
     * in is part of the style -- an elbow under a bar and the same elbow over it
     * draw exactly the same calls -- and only a recording says which came first.
     * So this is a painter with the same verbs that remembers, and every
     * assertion below is about a call, a colour or an order.
     */
    checkGanttStyle(log, w, h, rows, geom, selected) {
        const g = geom || {};
        /* The calendar is the plan's own, as the pane's geometry carries it.
         * Spelled out rather than merged: `Object.assign` is not in this
         * language, and the runtime's working notes say so twice. */
        drawGantt(log, w, h, rows,
                  selected !== undefined ? selected
                          : (rows.length ? rows[0].UID : null),
                  0, null, 0, {
            plotX: g.plotX !== undefined ? g.plotX : PAD,
            rowH:  g.rowH  !== undefined ? g.rowH  : 36,
            headH: g.headH !== undefined ? g.headH : 25,
            scrollY: g.scrollY || 0,
            calendar: g.calendar || new WorkCalendar(this.holder.project, -1),
            /* A file is the one geometry that carries a ground of its own, and
             * it has to be asked for by name or the frame under test is a
             * pane's and says nothing about a PNG. */
            paper: g.paper === true,
        });
        return log;
    }

    /* One assertion about the frame: what it drew, in what colour, and in what
     * order. */
    styleEq(what, got, want) {
        const same = got === want;
        print(`style ${what}: ${got}${same ? "" : ` (want ${want})`} ` +
              `${same ? "ok" : "FAILED"}`);
        return same;
    }

    styleYes(what, cond, got) {
        const same = !!cond;
        print(`style ${what}: ${got === undefined ? "" : got} ` +
              `${same ? "ok" : "FAILED"}`);
        return same;
    }

    checkGantt() {
        const png  = File.Join(Environment.TempDirectory, "bintana-project-gantt.png");
        this.saveChart(png, false);
        const info = File.Info(png);

        /* The export road: a PDF of the chart as a file, which is what the
         * Export button writes -- the whole plan, not the pane. */
        const pdf = File.Join(Environment.TempDirectory, "bintana-project-gantt.pdf");
        this.saveChart(pdf, true);
        const pinfo = File.Info(pdf);

        const dump = this.Gantt.Dump();
        const calls = dump ? dump.split("\n").length : 0;
        const rows = this.chartRows();
        let names = rows.length > 0;
        for (let i = 0; i < Math.min(rows.length, 2); i++) {
            if (dump.indexOf(rows[i].Name) < 0) names = false;
        }
        /* The timescale control changes what the chart measures, not only
         * what it labels: a day per 30 px is the width of the span. */
        let scale = true;
        const range = this.chartRange();
        if (range) {
            const days = (range.to - range.from) / (24 * 3600 * 1000);
            this.CmbScale.Index = 1;   // Day
            this.CmbScale_Select();
            scale = this.Gantt.MinWidth === Math.round(PAD + days * 30 + 8);
            this.CmbScale.Index = 0;   // back to Auto
            this.CmbScale_Select();
            /* And `Auto` asks for no floor at all, which is what leaves the
             * chart the pane's own width. */
            scale = scale && this.Gantt.MinWidth === 0;
        }

        /* The style, with a painter that records: the palette and the order.
         * Neither depends on the plan, so they are asked of every fixture. The
         * two that do -- a day the calendar does not work, and the row that is
         * chosen -- are asked where there is one: `check-view`'s plan. */
        const style = this.checkGanttStyle(new CallLog(), 900, 320,
                                           this.chartRows(),
                                           { plotX: PAD, rowH: 36, headH: 25 });
        const ink = this.styleEq("the ink is the theme's own",
                                 style.hasColor(style.Foreground), true);
        const pal = ganttPalette(style);
        const bar  = style.firstOf("Fill", pal.bar);
        const link = style.firstOf("Stroke", pal.link);
        /* A plan with no dependency has no elbow to place, and saying so is
         * better than a claim that passes because it had nothing to look at:
         * the fixture that does have links is asked in `check-view`, which is a
         * plan of forty tasks and forty-four of them. */
        const elbow = this.chartRows().some((t) => t.Links.length > 0);
        const under = elbow
            ? this.styleYes("and a dependency is drawn under the bars",
                            link >= 0 && bar >= 0 && link < bar,
                            `link ${link}, bar ${bar}`)
            : this.styleYes("a plan with no links draws no elbow", link < 0,
                            `bar ${bar}`);

        print(`gantt ${File.Name(this.path)} png=${info ? info.Size : -1} ` +
              `pdf=${pinfo ? pinfo.Size : -1} ` +
              `calls=${calls} names=${names ? "yes" : "no"} ` +
              `scale=${scale ? "ok" : "FAILED"}`);
        if (Application.Arguments.indexOf("dump-gantt") >= 0) print(dump);
        return info && info.Size > 0 && pinfo && pinfo.Size > 0 &&
               calls > 10 && names && scale &&
               ink && under;
    }
}

/* The width the panel of properties is given, and the least the plan can be
 * left: below that the panel is the thing that has to give way, and a form
 * squeezed under a plan is neither readable nor usable. */
const PANEL_W = 380;
const MIN_PLAN_W = 420;

/* How often the chart asks whether a fold left it drawing the wrong rows:
 * short enough that the bars follow the arrow, long enough to be nothing. */
const FOLD_POLL_MS = 150;
/* How long a rebuild holds the scroll against the layout of its new rows,
 * which is a frame or two away. */
const SCROLL_HOLD_MS = 300;

/*
 * The columns the plan table can show. The name is not here: it is the tree
 * and never goes. `Width` 0 is the elastic one, and the order is the order
 * they are offered and drawn in.
 */
/*
 * A painter with the same verbs that writes down instead of drawing. It is what
 * makes the chart's style assertable: the *order* the calls come in is part of
 * the style and a real frame's dump cannot say it, while this can.
 *
 * It answers the three questions a drawing asks of its painter honestly rather
 * than conveniently: the ink it was given is the text colour it reports, its
 * text is measured in fixed cells (six pixels a character, a line for the rest)
 * so a fit test has something to be right about, and a colour it is given is
 * the one it keeps -- `Painter.Color` reads back the string it was set to, so a
 * palette that reaches for `var(--accent)` and does not get it fails here rather
 * than in a frame.
 */
class CallLog {
    calls = [];
    Dark = false;
    Foreground = "rgb(46,52,54)";
    Font = "Sans 13.333px";
    LineWidth = 1;
    LineDash = [];
    LineCap = "Butt";
    LineJoin = "Miter";
    Antialias = true;
    Color = "#000000";

    note(name, args) {
        this.calls.push({ name, args, color: this.Color, font: this.Font });
    }

    Rectangle(...a)  { this.note("Rectangle", a); }
    MoveTo(...a)     { this.note("MoveTo", a); }
    LineTo(...a)     { this.note("LineTo", a); }
    Text(text, x, y) { this.note("Text", [text, x, y]); }
    Polyline(pts)   { this.note("Polyline", pts); }
    Polygon(pts)    { this.note("Polygon", pts); }
    Fill()           { this.note("Fill", []); }
    Stroke()         { this.note("Stroke", []); }
    Clip()           { this.note("Clip", []); }
    Arc(...a)        { this.note("Arc", a); }
    CurveTo(...a)    { this.note("CurveTo", a); }
    Translate(...a)  { this.note("Translate", a); }
    Scale(...a)      { this.note("Scale", a); }
    ClosePath()      { this.note("ClosePath", []); }
    Push()           { this.note("Push", []); }
    Pop()            { this.note("Pop", []); }
    ClipRectangle(...a) { this.note("ClipRectangle", a); }

    TextWidth(text)  { return String(text).length * 6; }
    /* As strict as the real painter, which refuses a call without the text. */
    TextHeight(text) {
        if (text === undefined) throw new TypeError("TextHeight(text, [options]) needs text");
        return 12;
    }

    /* Where the first call of a kind was drawn in a given colour, `-1` for
     * never: the order of two things is two numbers compared. */
    firstOf(name, color) {
        for (let i = 0; i < this.calls.length; i++) {
            const call = this.calls[i];
            if (call.name === name && call.color === color) return i;
        }
        return -1;
    }

    countOf(name, color) {
        let n = 0;
        for (const call of this.calls)
            if (call.name === name && call.color === color) n++;
        return n;
    }

    hasColor(color) {
        for (const call of this.calls) if (call.color === color) return true;
        return false;
    }

    /* The texts it drew, in order. */
    texts() { return this.calls.filter((c) => c.name === "Text").map((c) => c.args[0]); }
}

/* Each column names the editor its cells open: a field, a number, a date, a
 * tick, a list -- or `Custom`, which opens the app's own dialog. **Duration
 * stays text**: `2d`, `8h` and `3ed` are spellings a `Number` would eat (its
 * spin reads the digits and drops the unit), and a duration whose unit is gone
 * is a wrong number. */
/* The name column's starting width: room for a name of forty-odd characters
 * three levels deep. */
const NAME_WIDTH = 280;

const COLUMNS = [
    { id: "id",         Text: "ID",               Width: 44,  Alignment: "Right" },
    { id: "duration",   Text: "Duration",         Width: 84,  Alignment: "Right",
      Editor: "Text" },
    { id: "start",      Text: "Start",            Width: 130, Editor: "Date" },
    { id: "finish",     Text: "Finish",           Width: 130, Editor: "Date" },
    { id: "predecessors", Text: "Predecessors",   Width: 130, Editor: "Text" },
    { id: "wbspreds",   Text: "WBS predecessors", Width: 130, Editor: "Text" },
    { id: "percent",    Text: "Percent complete", Width: 70,  Alignment: "Right",
      Editor: { Kind: "Number", Min: 0, Max: 100, Step: 1 } },
    { id: "critical",   Text: "Critical",         Width: 60,  Alignment: "Center" },
    { id: "slack",      Text: "Slack",            Width: 84,  Alignment: "Right" },
    { id: "variance",  Text: "Variance",        Width: 84,  Alignment: "Right" },
    { id: "milestone",  Text: "Milestone",        Width: 60,  Alignment: "Center",
      Editor: { Kind: "Check", ActiveText: "◆", InactiveText: "" } },
    { id: "work",       Text: "Work",             Width: 84,  Alignment: "Right" },
    { id: "cost",       Text: "Cost",             Width: 80,  Alignment: "Right" },
    { id: "resources",  Text: "Resource names",   Width: 160, Editor: "Text" },
    { id: "wbs",        Text: "WBS",              Width: 80 },
    { id: "priority",   Text: "Priority",         Width: 60,  Alignment: "Right",
      Editor: { Kind: "Number", Min: 0, Max: 1000, Step: 1 } },
    { id: "constraint", Text: "Constraint",       Width: 110, Editor: "Custom" },
    { id: "deadline",   Text: "Deadline",         Width: 130, Editor: "Date" },
    { id: "calendar",   Text: "Calendar",         Width: 100, Editor: "Combo" },
    { id: "type",       Text: "Task type",        Width: 100, Editor: "Combo" },
    { id: "notes",      Text: "Notes",            Width: 160, Editor: "Text" },
    { id: "link",       Text: "Hyperlink",        Width: 160, Link: true },
];

/* What a summary takes from its children. Its cells are shut where they are
 * drawn -- `SetEditable(key, column, false)`, so they read dim and open
 * nothing -- while the same columns are fields on every other row; and
 * `cellValues` refuses the same list as a backstop. A summary's calendar is
 * its own, as the panel has it. */
const SUMMARY_SHUT = ["duration", "start", "finish", "percent", "milestone",
                      "constraint", "deadline", "type"];

/* A custom-field column: one per field the plan defines, and its id carries
 * the `FieldID` -- so the choice survives a file swap and a field that is not
 * defined in the file is not a column. The label is the file's own words, in
 * the same order the side panel's combo offers them. */
const FIELD_COLUMN = "attr:";

function fieldColumnID(fieldID) { return FIELD_COLUMN + fieldID; }

export function fieldLabel(def) { return def.Alias || def.FieldName || def.FieldID; }

/* What a stored column list may carry: the name's place, a catalog id, or a
 * custom field's. */
export function isColumnId(id) {
    return id === "name" || COLUMNS.some((c) => c.id === id) ||
           (id.slice(0, FIELD_COLUMN.length) === FIELD_COLUMN &&
            id.length > FIELD_COLUMN.length);
}

/* The four link types, in MSPDI's own numbering (0 FF, 1 FS, 2 SF, 3 SS) and
 * in the order the combos show them -- the panel's and the dialog's: FS, SS,
 * FF, SF. */
export const LINK_NAMES = ["FF", "FS", "SF", "SS"];
export const LINK_ORDER = [1, 3, 0, 2];   // combo index -> MSPDI type
export const LINK_INDEX = { 0: 2, 1: 0, 2: 3, 3: 1 };
/* What the timescale control means, by the combo's index (its items are
 * translated, so the text is not a key): pixels a day, and the header step in
 * days -- null/0 is the chart's own choice, which is what Auto is. */
/* What the status filter lets through, by the combo's index (the words are
 * translated, so the text is not a key). Index 0 is every task. */
const STATUS_FILTERS = ["all", "critical", "notStarted", "inProgress", "done",
                        "overdue", "milestone"];

function taskHasStatus(task, index) {
    const percent = task.PercentComplete || 0;
    switch (STATUS_FILTERS[index]) {
    case "critical":   return !!task.Critical;
    case "notStarted": return percent === 0;
    case "inProgress": return percent > 0 && percent < 100;
    case "done":       return percent >= 100;
    case "overdue": {
        const finish = task.Finish ? whenMs(task.Finish) : null;
        return percent < 100 && finish !== null && finish < new Date().getTime();
    }
    case "milestone":  return !!task.Milestone;
    }
    return true;
}

const ZOOM_MIN = 0.5, ZOOM_MAX = 120;   // pixels a day, the slider's two ends

const SCALES = [
    null,                        // Auto
    { dayW: 30, step: 1 },       // Day
    { dayW: 10, step: 7 },       // Week
    { dayW: 3,  step: 30 },      // Month
];

/* Which rows these are, as one string: the tasks' UIDs in order, which is
 * what two frames have to agree on to be the same frame. */
function rowsKey(rows) {
    return rows.map((task) => task.UID).join(",");
}

/* A number typed in a field, with the comma a keyboard may give it; NaN when
 * it is not one, which the caller refuses. */
export function resourceNumber(text) {
    return Number(String(text || "").replace(",", "."));
}

/* Eight hex digits that tell two paths apart (FNV-1a): a name, not a
 * secret, so a collision costs a recovery question and nothing more. */
function pathHash(path) {
    let h = 0x811c9dc5;
    for (let i = 0; i < path.length; i++) {
        h ^= path.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, "0");
}

/* "2026-10-01T17:00:00" reads better as "2026-10-01 17:00" in a row. */
export function shortDate(when) {
    return String(when || "").slice(0, 16).replace("T", " ");
}

/* The same spelling for an instant in milliseconds, which is what the
 * statistics hand back -- `null` included, because a plan with no date of that
 * kind has one and says nothing rather than inventing the zero date. */
function statsDateText(ms) {
    return ms === null || ms === undefined ? "" : shortDate(isoLocal(ms));
}

/*
 * A number of working minutes in the unit the task's own durations are read in
 * -- which is what Project shows, and what `durationText` does for a duration,
 * given a number instead of a `PT…S`. **The sign is part of the reading**, so it
 * is written here rather than left to the reader to work out from the column.
 */
function minutesText(minutes, task, project) {
    const format = durationFormat(task.DurationFormat || project.DurationFormat,
                                  project);
    /* Two places, because it is only read: 50 minutes at 480 a day is
     * 0.1d and not 0.10416666666666667d. (A duration is not rounded -- its
     * text goes back through the field on Apply, and would move the task.) */
    const n = Math.round(Math.abs(minutes) / format.per * 100) / 100;
    return `${minutes < 0 ? "-" : ""}${n}${format.unit}`;
}

/*
 * **A task's links as Project spells them**: `3FS+2d, 7SS` -- the
 * predecessor's `ID` (the row; `WBS` for the *WBS Predecessors* column, never
 * the UID, which is the file's identity and not a reader's), the type's two
 * letters when it is not finish-to-start (or when there is a lag), and the
 * lag with its unit. A plain `3` is the link a reader assumes.
 */

/* **A link type's letters**, by the kind they name: Project's English ones
 * -- what a file pasted from anywhere carries -- and the ones the app's
 * language gives them, FC/CC/FF/CF in Spanish, which is what is shown. */
export function linkName(kind) { return Locale.Text(LINK_NAMES[kind]); }

function linkLetters() {
    const letters = {};
    LINK_NAMES.forEach((name, kind) => {
        letters[name] = kind;
        letters[linkName(kind).toUpperCase()] = kind;
    });
    return letters;
}

/* What follows the predecessor in its text: the type, then the lag -- in a
 * unit of time, or in percent of the predecessor (`+50%`, `+50e%`). Any two
 * letters read as a type here, and `linkRest` keeps only the ones that name
 * one. */
const LINK_REST = /^\s*([A-Za-z]{2})?\s*(?:([+-])\s*(\d+(?:[.,]\d+)?)\s*(e?mo|e?m|e?h|e?d|e?w|e?%)?)?\s*$/i;

function linkRest(text) {
    const m = LINK_REST.exec(text);
    return m && (!m[1] || m[1].toUpperCase() in linkLetters()) ? m : null;
}

function linksText(task, project, by) {
    const parts = [];

    for (const link of task.Links) {
        const kind = linkKind(link);
        const lag  = linkLagText(link, project);
        const pred = taskOf(project, link.PredecessorUID);
        let part   = pred ? String(pred[by]) : `UID ${link.PredecessorUID}`;

        if (kind !== 1 || lag) part += linkName(kind);
        if (lag) part += lag;
        parts.push(part);
    }
    return parts.join(", ");
}

/* **The Resource Names cell**, as Project writes it: the task's resources in
 * the plan's order, separated by semicolons, each with its units in brackets
 * when they are not one -- a percentage for a work resource (`Bruno[50%]`), the
 * quantity for a material one, with its label when it has one (`Cemento[10
 * bolsas]`). A cost resource has no units to show. */
function resourcesText(task, project) {
    const parts = [];

    for (const a of project.Assignments) {
        if (a.TaskUID !== task.UID) continue;
        const r = resourceOf(project, a.ResourceUID);
        let part = r ? r.Name : `UID ${a.ResourceUID}`;
        const units = a.Units === undefined || a.Units === null ? 1 : a.Units;
        if (r && r.Type === 1 && units !== 1)
            part += `[${Locale.Number(Math.round(units * 10000) / 100)}%]`;
        else if (r && r.Type === 0 && (units !== 1 || r.MaterialLabel))
            part += `[${Locale.Number(units)}${r.MaterialLabel ? " " + r.MaterialLabel : ""}]`;
        parts.push(part);
    }
    return parts.join("; ");
}

/* **The cell read back**: names separated by semicolons -- or commas, which
 * a keyboard reaches first -- each with optional units in brackets, `[50%]`
 * or `[50]` (both half a unit of a work resource; for a material one the
 * number is the quantity and the label after it is ignored). A comma inside
 * the brackets is a decimal, not a separator. The number is kept as typed,
 * `{ Name, Amount }`, because only `setTaskResources` knows which kind of
 * resource a name turns out to be; no `Amount` keeps what the assignment
 * had. A name typed twice is the last one. Answers `{ resources }`, or
 * `{ refused }` with the piece that does not read. */
export function parseResourceNames(text) {
    const pieces = [];
    let depth = 0, from = 0;
    const s = String(text || "");
    for (let i = 0; i <= s.length; i++) {
        const c = s[i];
        if (c === "[") depth++;
        else if (c === "]") depth = Math.max(depth - 1, 0);
        else if (i === s.length || (depth === 0 && (c === ";" || c === ","))) {
            pieces.push(s.slice(from, i).trim());
            from = i + 1;
        }
    }

    const resources = [];
    for (const piece of pieces) {
        if (!piece) continue;
        const m = /^(.*?)\s*(?:\[\s*(\d+(?:[.,]\d+)?)\s*%?[^\]]*\])?$/.exec(piece);
        const name = m ? m[1].trim() : "";
        if (!m || !name || /[\[\]]/.test(name)) return { refused: piece };
        const entry = { Name: name };
        if (m[2] !== undefined) {
            entry.Amount = Number(m[2].replace(",", "."));
            if (!(entry.Amount > 0)) return { refused: piece };
        }
        const same = resources.findIndex((r) => r.Name.toLocaleLowerCase() ===
                                                name.toLocaleLowerCase());
        if (same >= 0) resources[same] = entry; else resources.push(entry);
    }
    return { resources };
}

/* The lag in the link's own unit -- `+2d`, `-4h`, `+30m` -- with the sign in
 * the reading, as the slack's is. */
function linkLagText(link, project) {
    if (!link.LinkLag) return "";
    if (isPercentLagFormat(link.LagFormat))
        return `${link.LinkLag < 0 ? "-" : "+"}${Math.abs(link.LinkLag)}` +
               `${link.LagFormat === 20 || link.LagFormat === 52 ? "e" : ""}%`;

    const format  = durationFormat(link.LagFormat || 7, project);
    const minutes = link.LinkLag / TENTHS;
    const n = Math.round(Math.abs(minutes) / format.per * 100) / 100;

    return `${minutes < 0 ? "-" : "+"}${n}${format.elapsed ? "e" : ""}${format.unit}`;
}

/*
 * The slack, in the task's own unit.
 *
 * **The sentinel is a blank and not a zero.** `NO_MINUTES` means the pass never
 * answered for this task -- it is ALAP, or the file never dated it -- and a row
 * that reads "0d" there would be claiming the task has no room when nobody
 * looked, and that is the one number in the table that would be a lie rather
 * than a reading. A zero that *is* an answer prints as a zero, like any other.
 */
function slackText(task, project) {
    return task.TotalSlack === NO_MINUTES
        ? "" : minutesText(task.TotalSlack / TENTHS, task, project);
}

/*
 * The **finish** variance, and not the start one: it is the date a deadline is
 * about and the one a reader asks about, and the start variance is in the file
 * for Project to read. The same blank for the same reason -- a task with no
 * baseline is not a task that is exactly on one.
 */
function varianceText(task, project) {
    return task.FinishVariance === NO_MINUTES
        ? "" : minutesText(task.FinishVariance / TENTHS, task, project);
}

/*
 * The duration as the file's own DurationFormat reads it, with an `e` when it
 * counts elapsed time and a `?` when it is estimated -- the field's own flag
 * or the format's spelling, whichever says so.
 */
export function durationText(task, project) {
    const minutes = mspdiMinutes(task.Duration);
    if (minutes === null) return task.Duration || "";
    const format = durationFormat(task.DurationFormat, project);
    const estimated = task.Estimated || format.estimated;
    return `${minutes / format.per}${format.elapsed ? "e" : ""}${format.unit}` +
           (estimated ? "?" : "");
}

/* "2026-10-01 08:00" is how a plan is read, and **`2026-10-01T08:00:00` is
 * what the file gets**: `xsd:dateTime` has seconds, and `Field.DateTime` takes
 * a moment without them and writes it as typed. Empty is an empty date, which
 * the field lets through when not required.
 *
 * A bare date has no time of its own, so it takes `time` when the caller has
 * one that means something -- the first minute of an exception or a rate
 * period, the last one of its end -- and otherwise goes through as typed, for
 * the field to refuse: a task's start at midnight would be an invented time. */
export function parseMoment(text, time) {
    const t = String(text || "").trim();
    if (t === "") return "";
    const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
    if (!m) return t.replace(" ", "T");
    if (m[2] === undefined) return time ? `${m[1]}T${time}` : m[1];
    return `${m[1]}T${m[2].padStart(2, "0")}:${m[3]}:${m[4] || "00"}`;
}

/*
 * "2d", "8h", "30m", "1mo", "2ed" -- elapsed -- or a bare number in `unit`
 * (the setting) or in the task's own unit. A unit written wins, then the
 * setting, and the format moves with whichever was said; a bare number with
 * neither keeps the format it had. **The `?` is the estimate, as in
 * Project**: `2d?` is estimated and `2d` is not, so `estimated` answers
 * whether it was typed, and the format comes back without its estimated
 * variant (35-44) -- the flag carries it, or a `2d` would still read `2d?`.
 */
export function parseDuration(text, format, unit, project) {
    const m = /^\s*(\d+(?:[.,]\d+)?)\s*(e?)(mo|m|h|d|w)?\s*(\??)\s*$/.exec(String(text || ""));
    if (!m) return null;

    const typed = m[3] ? m[2] + m[3] : "";
    let chosen = format >= 35 && format <= 44 ? format - 32 : format;
    if (typed)     chosen = formatOfUnit(typed);
    else if (unit) chosen = formatOfUnit(unit);

    const minutes = Math.round(Number(m[1].replace(",", ".")) *
                               durationFormat(chosen, project).per);
    return { minutes, format: chosen, estimated: m[4] === "?" };
}

/*
 * What SaveXml changed, leaf by leaf, keyed by `path/Name[n]` so a removed
 * or inserted sibling never shifts the ones after it. Containers are not
 * compared by text: an element's `Text` is all the character data under it,
 * and indentation alone would report every one of them.
 */
function leafValues(el, path, out) {
    const kids = el.Children;
    if (!kids.length) {
        out.push(`${path}=${JSON.stringify(el.Text || "")}`);
        return;
    }
    const seen = {};
    for (const kid of kids) {
        const n = seen[kid.Name] = (seen[kid.Name] || 0) + 1;
        leafValues(kid, `${path}/${kid.Name}[${n}]`, out);
    }
}

function treeDiff(before, after) {
    const a = [], b = [];
    if (before) leafValues(before, "/" + before.Name, a);
    if (after) leafValues(after, "/" + after.Name, b);
    const inA = {}, inB = {};
    for (const line of a) inA[line.slice(0, line.indexOf("="))] = line.slice(line.indexOf("=") + 1);
    for (const line of b) inB[line.slice(0, line.indexOf("="))] = line.slice(line.indexOf("=") + 1);
    const out = [];
    for (const key in inA) {
        if (!(key in inB)) out.push(`${key}: removed (was ${inA[key]})`);
        else if (inA[key] !== inB[key]) out.push(`${key}: ${inA[key]} -> ${inB[key]}`);
    }
    for (const key in inB) {
        if (!(key in inA)) out.push(`${key}: added (${inB[key]})`);
    }
    return out;
}
