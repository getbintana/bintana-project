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

class MainForm extends Form {

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
     * step in days, both null/0 for Auto -- fit the view. */
    dayW = null;
    step = 0;

    /* The selected task's links, parallel to the `Links` table by index, and
     * the predecessors the combo offers in the same order. */
    linkRows    = [];
    predChoices = [];

    /* Set when the window is closing on purpose, so `Form_Close` stops asking
     * and the confirm dialog's own `Close()` does not loop. */
    forceClose = false;

    /* Settings are read and written only on the window's road: a headless
     * check must not touch what the user chose. */
    settingsReady = false;

    Form_Open() {
        try {
            if (Application.Arguments.indexOf("check-corpus") >= 0) {
                this.checkCorpus();
                return;
            }
            if (Application.Arguments.indexOf("check-cpm") >= 0) {
                this.checkCpm();
                return;
            }
            if (Application.Arguments.indexOf("check-edit") >= 0) {
                this.checkEdit();
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

    /* A path on the command line wins over the sample: the window opens the
     * file it was pointed at, which is how a real Project file gets looked at
     * without a dialog. */
    openStartup() {
        /* The form is built, so the window owns the settings now. */
        this.settingsReady = true;

        const given = Application.Arguments[0];
        if (given) {
            try {
                this.load(given);
            } catch (e) {
                Message.Error("Cannot open {0}: {1}", given, e.message);
                this.openSample();
            }
        } else {
            this.openSample();
        }
        this.applySettings();
    }

    /* What the last run left. Only the timescale is read here: the folder is
     * read where the dialog opens and written when a file does. */
    applySettings() {
        const scale = Number(Settings.Get("bintana-project.timescale", 0)) || 0;
        if (this.CmbScale.Index !== scale) {
            this.CmbScale.Index = scale;
            this.CmbScale_Select();
        }
    }

    /* The bundled sample, so an empty first screen is never the question. */
    openSample() {
        this.load(File.Join(Application.Directory, "tests", "corpus", "01-minimal.xml"));
    }

    /* A file dragged from the file manager, anywhere on the window. */
    Form_FileDrop(paths) {
        const xml = paths.find((p) => File.IsExtension(p, "xml"));
        if (!xml) return;
        try {
            this.load(xml);
        } catch (e) {
            Message.Error("Cannot open {0}: {1}", xml, e.message);
        }
    }

    load(path) {
        this.holder = readMspdi(path);
        this.path   = path;
        this.edit   = new Edit(this.holder);
        this.forceClose = false;
        this.fill();
        if (this.settingsReady)
            Settings.Set("bintana-project.folder", File.Directory(path));
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

        this.Tasks.Clear();
        const stack = [];
        for (const task of project.Tasks) {
            if (task.IsNull) continue;
            const key = String(task.UID);
            this.byUID[key] = task;
            while (stack.length && stack[stack.length - 1].level >= task.OutlineLevel)
                stack.pop();
            const options = { Key: key };
            if (stack.length) options.Parent = stack[stack.length - 1].key;
            this.Tasks.Add(this.cells(task), options);
            stack.push({ level: task.OutlineLevel, key: key });
        }

        const s = summarize(project);
        const problems = this.holder.problems.length;
        this.LblStatus.Text = problems
            ? Locale.Text("{0} tasks, {1} milestones, {2} with attributes, {3} links" +
                   " -- {4} not modelled (see log)",
                   s.tasks, s.milestones, s.withAttrs, s.links, problems)
            : Locale.Text("{0} tasks, {1} milestones, {2} with attributes, {3} links",
                   s.tasks, s.milestones, s.withAttrs, s.links);

        this.Log.Clear();
        this.log(`Opened ${File.Name(this.path)}: ${s.tasks} tasks, ` +
                 `${s.milestones} milestones, ${s.links} dependencies.`);
        for (const p of this.holder.problems) this.log(`not modelled: ${p}`);

        /* The data changed: the chart is a frame behind until asked, and its
         * own size depends on how many rows there now are. */
        this.syncGanttSize();

        if (keep !== undefined && keep !== null && this.Tasks.Exists(String(keep))) {
            this.Tasks.Key = String(keep);
            this.Tasks_Select();
        } else {
            this.showTask(null);
        }
        this.updateTitle();
    }

    cells(task) {
        const name = task.Milestone ? `◆ ${task.Name}` : task.Name;
        return [name, durationText(task), shortDate(task.Start),
                shortDate(task.Finish), firstAttr(task)];
    }

    selectedTask() {
        return this.selectedUID === null ? null
             : (this.byUID[String(this.selectedUID)] || null);
    }

    /* The panel is a view of the selected record, not a copy: it is written
     * when the selection moves and read only by Apply. */
    showTask(task) {
        const has      = task !== null && task !== undefined;
        const editable = has && !task.Summary;

        this.LblTask.Text     = has ? task.Name : Locale.Text("No task selected");
        this.TxtName.Text     = has ? task.Name : "";
        this.TxtStart.Text    = has ? shortDate(task.Start) : "";
        this.TxtFinish.Text   = has ? shortDate(task.Finish) : "";
        this.TxtDuration.Text = has ? durationText(task) : "";
        this.ChkMilestone.Active = has ? task.Milestone : false;
        this.SpinPercent.Value   = has ? task.PercentComplete : 0;
        this.CmbConstraint.Index = has ? (task.ConstraintType || 0) : 0;
        this.TxtConstraint.Text  = has ? shortDate(task.ConstraintDate) : "";
        this.TxtDeadline.Text    = has ? shortDate(task.Deadline) : "";
        this.TxtNotes.Text       = has ? task.Notes : "";

        this.TxtName.Enabled = has;
        /* A summary's dates, duration and completion are what Project
         * derives from its children; only its name is the user's. */
        for (const w of [this.TxtStart, this.TxtFinish, this.TxtDuration,
                         this.ChkMilestone, this.SpinPercent,
                         this.CmbConstraint, this.TxtConstraint,
                         this.TxtDeadline])
            w.Enabled = editable;
        for (const w of [this.BtnApply, this.BtnDelete,
                         this.BtnIndent, this.BtnOutdent, this.TxtNotes,
                         this.CmbPred, this.CmbType, this.SpinLag,
                         this.BtnLinkAdd])
            w.Enabled = has;

        this.fillLinks(has ? task : null);
    }

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
                const pred = this.byUID[String(link.PredecessorUID)];
                this.linkRows.push(link);
                this.Links.Add([
                    pred ? pred.Name : `UID ${link.PredecessorUID}`,
                    LINK_NAMES[link.Type] || String(link.Type),
                    String((link.LinkLag || 0) / 10),
                ]);
            }
            /* A placeholder first, so nothing is chosen until the user says
             * so; summaries are out because the engine links to their dates
             * as the file wrote them (see Schedule.js). */
            const items = ["Choose…"];
            for (const other of this.holder.project.Tasks) {
                if (other.IsNull || other.Summary || other.UID === task.UID) continue;
                this.predChoices.push(other.UID);
                items.push(`${other.UID}  ${other.Name}`);
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
        this.showTask(this.selectedTask());
        this.Gantt.Redraw();
    }

    Tasks_Activate() {
        if (this.selectedTask()) this.TxtName.SetFocus();
    }

    log(line) {
        this.Log.Append(line + "\n");
    }

    /* Every frame is drawn from the data; there is nothing to keep. */
    Gantt_Draw(p, width, height) {
        drawGantt(p, width, height, this.holder ? this.holder.project : null,
                  this.selectedUID, this.step);
    }

    /*
     * The chart's own size: as tall as its rows and as wide as the timescale
     * asks, with the scroller around it showing the difference. Auto fits the
     * view, which is why a window resize recomputes it.
     */
    syncGanttSize() {
        if (!this.Gantt) return;   // the form is still being built
        const project = this.holder ? this.holder.project : null;
        const rows = project ? ganttRows(project) : [];
        const range = project ? ganttRange(rows) : null;

        this.Gantt.Height = HEADER + rows.length * ROW_H + 8;
        const view = this.GanttScroll ? this.GanttScroll.Bounds().Width : 0;
        if (this.dayW && range) {
            const days = (range.to - range.from) / (24 * 3600 * 1000);
            const wanted = Math.round(GUTTER + days * this.dayW + 8);
            this.Gantt.Width = Math.max(wanted, view ? view - 16 : 0);
        } else {
            this.Gantt.Width = Math.max(view ? view - 16 : 0, 600);
        }
        this.Gantt.Redraw();
    }

    /* The window changed size: Auto means the chart fits it again. */
    Form_Resize() { this.syncGanttSize(); }

    /* The chart as a file to send: PNG by the dialog's filter, PDF when the
     * name says so, at the chart's own size so nothing is cropped. */
    BtnExport_Click() {
        const base = File.BaseName(this.path) || "gantt";
        Dialog.SaveFile(Locale.Text("Export the chart"),
            { Folder: Settings.Get("bintana-project.folder", File.Directory(this.path)),
              Name: `${base}-gantt.png`,
              Filters: [[Locale.Text("PNG image"), "*.png"],
                        [Locale.Text("PDF document"), "*.pdf"]] },
            (path) => {
                try {
                    const width  = Math.round(this.Gantt.Width);
                    const height = Math.round(this.Gantt.Height);
                    if (File.IsExtension(path, "pdf"))
                        this.Gantt.SavePdf(path, width, height);
                    else
                        this.Gantt.Save(path, width, height);
                    this.log(`Exported ${path}.`);
                } catch (e) {
                    Message.Error("Cannot save {0}: {1}", path, e.message);
                }
            });
    }

    /* Auto fits the view; the rest set a day width and let the scroller show
     * what does not fit. */
    CmbScale_Select() {
        const combo = this.CmbScale;
        if (!combo) return;        // the event fires while the form is built
        /* By index, not by text: the combo's items are translated. */
        const scale = SCALES[combo.Index] || null;
        this.dayW = scale ? scale.dayW : null;
        this.step = scale ? scale.step : 0;
        this.syncGanttSize();
        if (this.settingsReady)
            Settings.Set("bintana-project.timescale", combo.Index);
    }

    /* --- editing ------------------------------------------------------- */

    /* Read the panel, validate against a scratch record so a bad value cannot
     * half-apply, then one command -- one undo for one Apply. */
    applyFields() {
        const task = this.selectedTask();
        if (!task) return false;

        /* Notes belong to any task, a summary included. */
        const values = { Name: this.TxtName.Text, Notes: this.TxtNotes.Text };

        /* A summary is what Project derives it from: only the name is read. */
        if (!task.Summary) {
            const duration = parseDuration(this.TxtDuration.Text, task.DurationFormat);
            if (duration === null) {
                Message.Error("{0} is not a duration -- try 2d, 8h or 30m",
                              this.TxtDuration.Text);
                return false;
            }
            values.Start           = parseMoment(this.TxtStart.Text);
            values.Finish          = parseMoment(this.TxtFinish.Text);
            values.Duration        = mspdiDuration(duration.minutes);
            values.DurationFormat  = duration.format;
            values.Milestone       = this.ChkMilestone.Active;
            values.PercentComplete = Math.round(this.SpinPercent.Value);

            /* ASAP and ALAP carry no date; the rest need one. */
            values.ConstraintType  = Math.max(this.CmbConstraint.Index, 0);
            values.ConstraintDate  = values.ConstraintType > 1
                                   ? parseMoment(this.TxtConstraint.Text) : "";
            values.Deadline        = parseMoment(this.TxtDeadline.Text);
        }

        try {
            const probe = new MspTask();
            for (const name in values) probe[name] = values[name];
        } catch (e) {
            Message.Error("Cannot apply: {0}", e.message);
            return false;
        }

        this.edit.setFields(task.UID, values);
        this.fill(task.UID);
        return true;
    }

    BtnApply_Click() { this.applyFields(); }

    BtnAdd_Click() {
        const added = this.edit.addTask(this.selectedUID);
        this.fill(added.UID);
    }

    BtnDelete_Click() {
        const task = this.selectedTask();
        if (!task) return;
        ConfirmForm.ask(Locale.Text("Delete task"), Locale.Text('Delete "{0}"?', task.Name),
            Locale.Text("Delete"), () => {
                this.edit.removeTask(task.UID);
                this.fill(null);
            });
    }

    BtnIndent_Click()  { this.nudge(1); }
    BtnOutdent_Click() { this.nudge(-1); }

    nudge(delta) {
        const task = this.selectedTask();
        if (!task) return;
        if (this.edit.indent(task.UID, delta)) this.fill(task.UID);
    }

    /* The plan-wide command: place every task from its links. It is one undo
     * and it says how many it placed. */
    BtnRecalc_Click() {
        const result = this.edit.recalculate();
        if (!result.placed) {
            Message.Warning("Nothing to schedule: the project has no start date.");
            return;
        }
        const tasks = this.holder.project.Tasks;
        const critical = tasks.filter((t) => !t.IsNull && t.Critical).length;
        const late = tasks.filter((t) => {
            const deadline = t.Deadline ? whenMs(t.Deadline) : null;
            const finish   = t.Finish ? whenMs(t.Finish) : null;
            return deadline !== null && finish !== null && finish > deadline;
        }).length;
        this.fill(this.selectedUID);
        this.log(`Recalculated ${result.placed} tasks, ${critical} critical` +
                 (late ? `, ${late} past deadline` : "") +
                 (result.skipped
                    ? `, ${result.skipped} kept (constraint not scheduled here)`
                    : "") + ".");
    }

    /* A link picked in the table: its values go into the fields, so Link
     * updates that predecessor instead of adding a second link to it. */
    Links_Select() {
        const link = this.Links.Index >= 0 ? this.linkRows[this.Links.Index] : null;
        this.BtnLinkDel.Enabled = !!link;
        if (!link) return;
        const at = this.predChoices.indexOf(link.PredecessorUID);
        if (at >= 0) this.CmbPred.Index = at;
        this.CmbType.Index = LINK_INDEX[link.Type] || 0;
        this.SpinLag.Value = (link.LinkLag || 0) / 10;
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
        const link = new MspLink({
            PredecessorUID: predUID,
            Type: LINK_ORDER[this.CmbType.Index] || 1,
            LinkLag: Math.round(this.SpinLag.Value * 10),   // tenths of a minute
            LagFormat: 3,
        });
        const links = task.Links.filter((l) => l.PredecessorUID !== predUID);
        links.push(link);
        if (this.edit.setLinks(task.UID, links)) this.fill(task.UID);
    }

    BtnLinkDel_Click() {
        const task = this.selectedTask();
        const link = this.Links.Index >= 0 ? this.linkRows[this.Links.Index] : null;
        if (!task || !link) return;
        const links = task.Links.filter((l) => l.PredecessorUID !== link.PredecessorUID);
        if (this.edit.setLinks(task.UID, links)) this.fill(task.UID);
    }

    BtnUndo_Click() {
        const keep = this.selectedUID;
        if (this.edit.undo()) this.fill(keep);
    }

    BtnRedo_Click() {
        const keep = this.selectedUID;
        if (this.edit.redo()) this.fill(keep);
    }

    /* --- opening, saving and closing ------------------------------------ */

    BtnOpen_Click() {
        const folder = Settings.Get("bintana-project.folder",
                                    this.path ? File.Directory(this.path)
                                              : File.Join(Application.Directory,
                                                          "tests", "corpus"));
        Dialog.OpenFile("Open Project XML",
            { Folder: folder,
              Filters: [["Project XML", "*.xml"], ["All files", "*"]] },
            (path) => {
                try {
                    this.load(path);
                } catch (e) {
                    Message.Error("Cannot open {0}: {1}", path, e.message);
                }
            });
    }

    BtnSave_Click() { this.save(); }

    BtnSaveAs_Click() {
        Dialog.SaveFile("Save Project XML",
            { Folder: File.Directory(this.path), Name: File.Name(this.path),
              Filters: [["Project XML", "*.xml"]] },
            (path) => {
                this.path = path;
                this.save();
            });
    }

    /* The one road that writes. It answers whether it wrote, so the close
     * question can keep the window when it did not. */
    save() {
        try {
            writeMspdi(this.path, this.holder);
            this.edit.markSaved();
            this.updateTitle();
            this.log(`Saved ${this.path}.`);
            return true;
        } catch (e) {
            Message.Error("Cannot save {0}: {1}", this.path, e.message);
            return false;
        }
    }

    updateTitle() {
        const dirty = this.edit ? this.edit.dirty : false;
        this.Text = `${File.Name(this.path)}${dirty ? " •" : ""} — bintana-project`;
        this.LblFile.Text    = this.path;
        this.BtnUndo.Enabled = this.edit ? this.edit.canUndo : false;
        this.BtnRedo.Enabled = this.edit ? this.edit.canRedo : false;
    }

    /* Closing with unsaved work asks first. The answer may be Save, Discard or
     * Cancel, which is why it is a form and not a `Message`. Returning `true`
     * keeps the window open while the question is answered. */
    Form_Close() {
        if (this.forceClose || !this.edit || !this.edit.dirty) return false;

        const name = File.Name(this.path);
        ConfirmForm.ask(Locale.Text("Unsaved changes"),
            Locale.Text("Save changes to {0} before closing?", name), Locale.Text("Discard"),
            () => { this.forceClose = true; this.Close(); },
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

            /* 2026-09-07 is a Monday and the 8th is the holiday. */
            const p = projectOf([
                task(1, "PT8H0M0S"),                // A
                task(2, "PT8H0M0S", [link(1, 1)]),  // B: FS from A
                task(3, "PT8H0M0S", [link(1, 0)]),  // C: SS from A
                task(4, "PT8H0M0S", [link(2, 2)]),  // D: FF from B
                task(5, "PT0H0M0S", [link(2, 1)]),  // M: milestone FS from B
                task(6, "PT8H0M0S", [link(1, 3)]),  // E: SF from A
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

            /* The close question's form parses and opens: a broken `.form`
             * would fail here, not the first time somebody closes with
             * unsaved work. Nothing is clicked, so nothing runs. */
            ConfirmForm.ask("check-edit", "The dialog opens and closes.", "OK",
                            () => {}).Close();

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
                 task.Start === "2026-09-01T09:00" &&
                 task.PercentComplete === 75 && ok;
            print(`edit fields name="${task.Name}" duration=${task.Duration} ` +
                  `start=${task.Start} percent=${task.PercentComplete}`);

            /* The forward pass as one undo: UID 1 is 2d from the project
             * start and UID 2 follows it. Before the indent, because a
             * summary is not scheduled -- it is the span of its children. */
            const recalc = edit.recalculate();
            ok = recalc.placed === 2 && recalc.skipped === 0 &&
                 edit.task(1).Start === "2026-09-01T08:00:00" &&
                 edit.task(1).Finish === "2026-09-02T17:00:00" &&
                 edit.task(2).Start === "2026-09-03T08:00:00" && ok;
            print(`edit recalc placed=${recalc.placed} ` +
                  `A=${edit.task(1).Start}..${edit.task(1).Finish} ` +
                  `B=${edit.task(2).Start}..${edit.task(2).Finish}`);
            edit.undo();
            ok = edit.task(1).Start === "2026-09-01T09:00" && ok;
            edit.redo();

            /* A task after it, indented under it: UID 1 becomes a summary. */
            const added = edit.addTask(1);
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
                 edit.task(3).ConstraintDate === "2026-09-04T08:00" && ok;
            print(`edit constraint type=${edit.task(3).ConstraintType} ` +
                  `date=${edit.task(3).ConstraintDate}`);

            /* Notes through the panel too: the last field, and a multi-line
             * one. */
            this.TxtNotes.Text = "Edited in the harness";
            ok = this.applyFields() &&
                 edit.task(3).Notes === "Edited in the harness" && ok;
            print(`edit notes="${edit.task(3).Notes}"`);

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
                 saved[2].Notes === "Edited in the harness" && ok;

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
        const wanted = ["BtnOpen", "BtnSave", "BtnSaveAs", "BtnUndo", "BtnRedo",
                        "BtnRecalc", "BtnExport", "BtnApply", "BtnAdd",
                        "BtnDelete", "BtnIndent", "BtnOutdent", "BtnLinkAdd",
                        "BtnLinkDel"]
            .map((name) => `${name}_Click`)
            .concat(["Tasks_Select", "Gantt_Draw", "CmbScale_Select",
                     "Links_Select"]);

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
        const rows = ganttRows(this.holder.project);
        let ok = this.Tasks.Count === rows.length;

        for (const task of rows) {
            const key = String(task.UID);
            if (!this.Tasks.Exists(key)) { ok = false; continue; }
            const row  = this.Tasks.Row(key);
            const name = task.Milestone ? `◆ ${task.Name}` : task.Name;
            if (row[0] !== name || row[1] !== durationText(task)) ok = false;
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
     * a surface never shown has none of its own), then the file's weight
     * and the frame's own dump. A handler that threw halfway writes no
     * file and leaves a dump with no closing Pop.
     */
    checkGantt() {
        const png  = File.Join(Environment.TempDirectory, "bintana-project-gantt.png");
        this.Gantt.Save(png, 900, 320);
        const info = File.Info(png);

        /* The export road: a PDF of the chart's own size, which is what the
         * Export button writes. */
        const pdf = File.Join(Environment.TempDirectory, "bintana-project-gantt.pdf");
        this.Gantt.SavePdf(pdf, 595, 842);
        const pinfo = File.Info(pdf);

        const dump = this.Gantt.Dump();
        const calls = dump ? dump.split("\n").length : 0;
        const rows = ganttRows(this.holder.project);
        let names = rows.length > 0;
        for (let i = 0; i < Math.min(rows.length, 2); i++) {
            if (dump.indexOf(rows[i].Name) < 0) names = false;
        }
        /* The timescale control changes what the chart measures, not only
         * what it labels: a day per 30 px is the width of the span. */
        let scale = true;
        const range = ganttRange(rows);
        if (range) {
            const days = (range.to - range.from) / (24 * 3600 * 1000);
            this.CmbScale.Index = 1;   // Day
            this.CmbScale_Select();
            scale = this.Gantt.Width === Math.round(GUTTER + days * 30 + 8);
            this.CmbScale.Index = 0;   // back to Auto
            this.CmbScale_Select();
        }

        print(`gantt ${File.Name(this.path)} png=${info ? info.Size : -1} ` +
              `pdf=${pinfo ? pinfo.Size : -1} ` +
              `calls=${calls} names=${names ? "yes" : "no"} ` +
              `scale=${scale ? "ok" : "FAILED"}`);
        if (Application.Arguments.indexOf("dump-gantt") >= 0) print(dump);
        return info && info.Size > 0 && pinfo && pinfo.Size > 0 &&
               calls > 10 && names && scale;
    }
}

/* The four link types, in MSPDI's own numbering (0 SS, 1 FS, 2 FF, 3 SF) and
 * in the order the panel's combo shows them. */
const LINK_NAMES = ["SS", "FS", "FF", "SF"];
const LINK_ORDER = [1, 0, 2, 3];   // combo index -> MSPDI type
const LINK_INDEX = { 0: 1, 1: 0, 2: 2, 3: 3 };

/* What the timescale control means, by the combo's index (its items are
 * translated, so the text is not a key): pixels a day, and the header step in
 * days -- null/0 is the chart's own choice, which is what Auto is. */
const SCALES = [
    null,                        // Auto
    { dayW: 30, step: 1 },       // Day
    { dayW: 10, step: 7 },       // Week
    { dayW: 3,  step: 30 },      // Month
];

/* "2026-10-01T17:00:00" reads better as "2026-10-01 17:00" in a row. */
function shortDate(when) {
    return String(when || "").slice(0, 16).replace("T", " ");
}

/*
 * The duration as the file's own DurationFormat reads it: 3 minutes, 5 hours,
 * 7 days, 9 weeks, 11 and 43 months -- 43 is the estimated spelling, which
 * Project writes with a question mark. The divisors are the schema's defaults
 * (480 minutes a day, 20 days a month) because `MinutesPerDay` is not
 * modelled yet.
 */
function durationText(task) {
    const minutes = mspdiMinutes(task.Duration);
    if (minutes === null) return task.Duration || "";
    switch (task.DurationFormat) {
        case 3:  return `${minutes}m`;
        case 5:  return `${minutes / 60}h`;
        case 9:  return `${minutes / 2400}w`;
        case 11: return `${minutes / 9600}mo`;
        case 43: return `${minutes / 9600}mo?`;
        default: return `${minutes / 480}d`;
    }
}

/* "2026-10-01 08:00" is how a plan is read; `Field.DateTime` wants the T.
 * Empty is an empty date, which the field lets through when not required. */
function parseMoment(text) {
    const t = String(text || "").trim();
    return t === "" ? "" : t.replace(" ", "T");
}

/*
 * "2d", "8h", "30m", "1mo", or a bare number in the task's own unit. A unit
 * written wins and moves `DurationFormat` with it; a bare number keeps the
 * format it had -- 43, the estimated month, included.
 */
function parseDuration(text, format) {
    const m = /^\s*(\d+(?:[.,]\d+)?)\s*(mo|m|h|d|w)?\s*$/.exec(String(text || ""));
    if (!m) return null;

    const units = { m: [1, 3], h: [60, 5], d: [480, 7], w: [2400, 9], mo: [9600, 11] };
    const unit = m[2] || (format === 3 ? "m" : format === 5 ? "h" :
                          format === 9 ? "w" :
                          (format === 11 || format === 43) ? "mo" : "d");
    const minutes = Math.round(Number(m[1].replace(",", ".")) * units[unit][0]);
    return { minutes, format: m[2] ? units[unit][1] : format };
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
