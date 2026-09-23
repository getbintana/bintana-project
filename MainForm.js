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
     * step in days, both null/0 for Auto -- fit the view. `drag` is the
     * gesture in flight: the model is not touched until the button is up. */
    dayW = null;
    step = 0;
    drag = null;

    /* The selected task's links, parallel to the `Links` table by index, and
     * the predecessors the combo offers in the same order. */
    linkRows    = [];
    predChoices = [];

    /* Set when the window is closing on purpose, so `Form_Close` stops asking
     * and the confirm dialog's own `Close()` does not loop. */
    forceClose = false;

    /* Settings are read and written only on the window's road: a headless
     * check must not touch what the user chose. `fieldID` is the custom field
     * the list shows (empty is the first) and `unit` the unit a bare duration
     * is read in (empty is the task's own). */
    settingsReady = false;
    fieldID = "";
    unit    = "";

    /* The files the menu offers, parallel to its entries by index, and the
     * timer that keeps the recovery copy. */
    recentPaths   = [];
    autosaveTimer = null;

    /* The Resources page: the table's records, the resource being edited and
     * the assignments of the selected task, each parallel to its control. */
    resRows       = [];
    resChoices    = [];
    selectedResUID = null;
    assignRows    = [];

    /* The Project page: its calendars and the one picked. */
    calRows        = [];
    calChoices     = [];
    selectedCalUID = null;

    /* The custom fields the Task page offers, by FieldID, and what the table
     * is filtered to. */
    attrChoices = [];
    filter = "";

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
            if (Application.Arguments.indexOf("check-drag") >= 0) {
                this.checkDrag();
                return;
            }
            if (Application.Arguments.indexOf("check-edit") >= 0) {
                this.checkEdit();
                return;
            }
            if (Application.Arguments.indexOf("check-oracle") >= 0) {
                this.checkOracle();
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
        this.startAutosave();
    }

    /* What the last run left. The folder is read where the dialog opens and
     * written when a file does; these three are read here. */
    applySettings() {
        const scale  = Number(Settings.Get("bintana-project.timescale", 0)) || 0;
        this.fieldID = Settings.Get("bintana-project.field", "");
        this.unit    = Settings.Get("bintana-project.unit", "");
        if (this.edit)
            this.edit.auto = Settings.Get("bintana-project.autorecalc", false);
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

    /* The menu bar's Open Recent, a dynamic submenu: the application assigns
     * the entries and the click arrives with the index. */
    showRecent(recent) {
        this.recentPaths = recent;
        this.MnuRecent.Items = recent.map((p) => File.Name(p));
        this.MnuRecent.Enabled = recent.length > 0;
    }

    openRecent(i) {
        const path = this.recentPaths[i];
        if (!path) return;
        try {
            this.load(path);
        } catch (e) {
            Message.Error("Cannot open {0}: {1}", path, e.message);
        }
    }

    MnuRecent_Click(index) { this.openRecent(index); }

    /* The View menu's tick, and the Help menu's one line. */
    MnuLog_Click(on) { this.Log.Visible = on; }

    MnuAbout_Click() {
        Message.Info("bintana-project {0} — MSPDI (MS Project XML) in Bintana",
                     Application.Version);
    }

    /* The bundled sample, so an empty first screen is never the question. */
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

    /* `keepPath` is the file the document is *called* while its bytes came
     * from somewhere else, which is what recovering an autosave is. */
    load(path, keepPath, recovering) {
        this.holder = readMspdi(path);
        this.path   = keepPath || path;
        this.edit   = new Edit(this.holder);
        this.edit.auto = Settings.Get("bintana-project.autorecalc", false);
        this.forceClose = false;
        this.fill();
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
    autosavePath() {
        return File.Join(Application.ConfigDirectory,
                         "autosave-" + File.BaseName(this.path) + ".xml");
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
                try {
                    this.load(copy, this.path, true);
                    if (File.Exists(copy)) File.Delete(copy);
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

        this.Tasks.Clear();
        const stack = [];
        for (const task of this.visibleTasks(project)) {
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

        this.fillResources();
        this.fillProject();

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

    /* What the filter lets through: the tasks whose name matches it and the
     * ancestors that give them their place in the outline. An empty filter is
     * the whole plan. */
    visibleTasks(project) {
        const tasks = [];
        for (const task of project.Tasks) if (!task.IsNull) tasks.push(task);
        if (!this.filter) return tasks;

        const shown = {};
        const ancestors = [];
        for (const task of tasks) {
            while (ancestors.length &&
                   ancestors[ancestors.length - 1].OutlineLevel >= task.OutlineLevel)
                ancestors.pop();
            ancestors.push(task);
            if (Locale.Matches(task.Name, this.filter))
                for (const a of ancestors) shown[a.UID] = true;
        }
        return tasks.filter((task) => shown[task.UID]);
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

    cells(task) {
        const name = task.Milestone ? `◆ ${task.Name}` : task.Name;
        const project = this.holder.project;
        const cost    = taskCost(project, task);
        return [name, durationText(task, project), shortDate(task.Start),
                shortDate(task.Finish), attrOf(task, this.fieldID),
                cost ? Locale.Number(cost, 2) : ""];
    }

    /* The plan's resources, with the cost of their assignments added up, and
     * the list the assignment editor offers. */
    fillResources() {
        this.Resources.Clear();
        this.resRows = [];
        const project = this.holder ? this.holder.project : null;
        if (!project) return;

        for (const resource of project.Resources) {
            /* UID 0 is Project's "Unassigned": it is not a resource anybody
             * edits or assigns, so it is not listed. */
            if (resource.IsNull || resource.UID === 0) continue;
            this.resRows.push(resource);
            this.Resources.Add([
                resource.Name,
                String(resource.MaxUnits),
                String(resourcePeak(project, resource)),
                String(resource.StandardRate),
                Locale.Number(resourceCost(project, resource), 2),
            ]);
        }
        this.LblResEmpty.Visible = this.resRows.length === 0;

        const items = [];
        this.resChoices = [];
        for (const resource of this.resRows) {
            this.resChoices.push(resource.UID);
            items.push(resource.Name);
        }
        this.CmbAssignRes.Items = items;
        this.CmbAssignRes.Index = items.length ? 0 : -1;
    }

    /* The project's own settings and its calendars. */
    fillProject() {
        const project = this.holder ? this.holder.project : null;
        if (!project) return;

        const cost = projectCost(project);
        this.TxtProjCost.Text = cost ? Locale.Number(cost, 2) : "";

        this.Calendars.Clear();
        this.calRows = [];
        for (const calendar of project.Calendars) {
            this.calRows.push(calendar);
            const base = calendar.BaseCalendarUID
                       ? (this.edit.calendar(calendar.BaseCalendarUID) || {}).Name || ""
                       : "";
            this.Calendars.Add([calendar.Name, base]);
        }
        this.BtnCalEdit.Enabled = false;
    }

    /* The project's data -- the document's metadata, the scheduling settings
     * and the currency -- in its own dialog; the values come back whole and
     * are one undo like any edit. */
    ActProjData_Click() {
        ProjectForm.open(this.holder.project, (values) => {
            if (!this.edit.setProject(values)) return;
            this.fill(this.selectedUID);
            this.log(Locale.Text("Project data saved."));
        });
    }

    /* The file's own preferences -- the defaults for new tasks, the
     * calculation switches, the earned-value method -- in their dialog and
     * as one undo, like any other edit. */
    ActProjOptions_Click() {
        OptionsForm.open(this.holder.project, (values) => {
            if (!this.edit.setProject(values)) return;
            this.fill(this.selectedUID);
            this.log(Locale.Text("Project options saved."));
        });
    }

    Calendars_Select() {
        this.selectedCalUID = this.Calendars.Index >= 0
                            ? this.calRows[this.Calendars.Index].UID : null;
        this.BtnCalEdit.Enabled = this.selectedCalUID !== null;
    }

    /* The calendar's own dialog: it hands the whole shape back, and the edit
     * is one undo like any other. */
    openCalendar(uid) {
        const calendar = uid === null ? null : this.edit.calendar(uid);
        if (!calendar) return;
        CalendarForm.open(this.holder.project, calendar, (values) => {
            this.edit.setCalendar(calendar.UID, values);
            this.fill(this.selectedUID);
        });
    }

    /* A new calendar, as a copy of the picked one (or of the project's), and
     * the dialog opens on it so it gets a name and a week. */
    BtnCalNew_Click() {
        const source = this.selectedCalUID !== null
                     ? this.selectedCalUID : this.holder.project.CalendarUID;
        let maxUID = 0;
        for (const calendar of this.holder.project.Calendars)
            if (calendar.UID > maxUID) maxUID = calendar.UID;

        const calendar = this.edit.addCalendar(
            Locale.Text("Calendar {0}", maxUID + 1), source);
        this.fill(this.selectedUID);
        const at = this.calRows.findIndex((c) => c.UID === calendar.UID);
        if (at >= 0) { this.Calendars.Select(at); this.Calendars_Select(); }
        this.openCalendar(calendar.UID);
    }

    BtnCalDel_Click() {
        if (this.selectedCalUID === null) return;
        const calendar = this.edit.calendar(this.selectedCalUID);
        if (!calendar) return;
        if (this.selectedCalUID === this.holder.project.CalendarUID) {
            Message.Warning(Locale.Text("The project's own calendar cannot be deleted."));
            return;
        }
        ConfirmForm.ask(Locale.Text("Delete calendar"),
            Locale.Text('Delete "{0}"?', calendar.Name),
            Locale.Text("Delete"), () => {
                this.edit.removeCalendar(calendar.UID);
                this.selectedCalUID = null;
                this.fill(this.selectedUID);
            });
    }

    BtnCalEdit_Click() {
        if (this.selectedCalUID !== null) this.openCalendar(this.selectedCalUID);
    }

    /* From the menu: the calendar picked in the list, or the project's own
     * when nothing is picked. */
    ActCalendar_Click() {
        let uid = this.selectedCalUID;
        if (uid === null && this.calRows.length) uid = this.calRows[0].UID;
        if (uid === null) {
            Message.Warning(Locale.Text("There are no calendars."));
            return;
        }
        this.openCalendar(uid);
    }

    /* A resource picked: the editor shows it, so Apply updates it. */
    Resources_Select() {
        const resource = this.Resources.Index >= 0
                       ? this.resRows[this.Resources.Index] : null;
        this.selectedResUID    = resource ? resource.UID : null;
        this.TxtResName.Text   = resource ? resource.Name : "";
        this.CmbResType.Index  = resource ? (resource.Type || 0) : 1;
        this.TxtResMax.Text    = resource ? String(resource.MaxUnits) : "1";
        this.TxtResRate.Text   = resource ? String(resource.StandardRate) : "";
        this.TxtResCostUse.Text = resource ? String(resource.CostPerUse) : "0";
        this.BtnResDel.Enabled   = !!resource;
        this.BtnResRates.Enabled = !!resource;
    }

    BtnResNew_Click() {
        this.Resources.DeselectAll();
        this.Resources_Select();
        this.TxtResName.SetFocus();
    }

    BtnResApply_Click() {
        const values = {
            Name:          this.TxtResName.Text,
            Type:          Math.max(this.CmbResType.Index, 0),
            MaxUnits:      resourceNumber(this.TxtResMax.Text),
            StandardRate:  resourceNumber(this.TxtResRate.Text),
            CostPerUse:    resourceNumber(this.TxtResCostUse.Text),
        };
        if (values.Name === "" || isNaN(values.MaxUnits) ||
            isNaN(values.StandardRate) || isNaN(values.CostPerUse)) {
            Message.Error("A resource needs a name, and its numbers must be numbers.");
            return;
        }
        try {
            const probe = new MspResource();
            for (const name in values) probe[name] = values[name];
        } catch (e) {
            Message.Error("Cannot apply: {0}", e.message);
            return;
        }

        let resource;
        if (this.selectedResUID === null) {
            resource = this.edit.addResource(values);
        } else {
            this.edit.setResource(this.selectedResUID, values);
            resource = this.edit.resource(this.selectedResUID);
        }
        this.fill(this.selectedUID);
        if (resource) {
            const at = this.resRows.findIndex((r) => r.UID === resource.UID);
            if (at >= 0) { this.Resources.Select(at); this.Resources_Select(); }
        }
    }

    BtnResDel_Click() {
        const resource = this.selectedResUID === null
                       ? null : this.edit.resource(this.selectedResUID);
        if (!resource) return;
        ConfirmForm.ask(Locale.Text("Delete resource"),
            Locale.Text('Delete "{0}" and its assignments?', resource.Name),
            Locale.Text("Delete"), () => {
                this.edit.removeResource(resource.UID);
                this.selectedResUID = null;
                this.fill(this.selectedUID);
            });
    }

    /* The resource's rate tables, in their own dialog: the list comes back
     * whole and it is one undo like any edit. */
    BtnResRates_Click() {
        const uid = this.selectedResUID;
        const resource = uid === null ? null : this.edit.resource(uid);
        if (!resource) return;

        RatesForm.open(resource, (rates) => {
            if (!this.edit.setResourceRates(uid, rates)) return;
            this.fill(this.selectedUID);
            const at = this.resRows.findIndex((r) => r.UID === uid);
            if (at >= 0) { this.Resources.Select(at); this.Resources_Select(); }
            this.log(Locale.Text("Rates saved."));
        });
    }

    /* The assignments of the selected task, with the cost each one adds. */
    fillAssignments(task) {
        this.Assignments.Clear();
        this.assignRows = [];
        this.BtnAssignDel.Enabled = false;
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
            ]);
        }
    }

    Assignments_Select() {
        const assignment = this.Assignments.Index >= 0
                         ? this.assignRows[this.Assignments.Index] : null;
        this.BtnAssignDel.Enabled = !!assignment;
        if (!assignment) return;
        const at = this.resChoices.indexOf(assignment.ResourceUID);
        if (at >= 0) this.CmbAssignRes.Index = at;
        this.TxtAssignUnits.Text = String(assignment.Units);
    }

    BtnAssignAdd_Click() {
        const task = this.selectedTask();
        if (!task) return;
        const at = this.CmbAssignRes.Index;
        const resourceUID = at >= 0 ? this.resChoices[at] : null;
        if (resourceUID === null || resourceUID === undefined) {
            Message.Warning(Locale.Text("Add a resource first."));
            return;
        }
        const units = resourceNumber(this.TxtAssignUnits.Text);
        if (isNaN(units) || units <= 0) {
            Message.Error(Locale.Text("Units must be a positive number."));
            return;
        }
        this.edit.addAssignment(task.UID, resourceUID, units);
        this.fill(task.UID);
    }

    BtnAssignDel_Click() {
        const assignment = this.Assignments.Index >= 0
                         ? this.assignRows[this.Assignments.Index] : null;
        if (!assignment) return;
        this.edit.removeAssignment(assignment.UID);
        this.fill(this.selectedUID);
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
        this.TxtDuration.Text = has
            ? durationText(task, this.holder.project) : "";
        this.ChkMilestone.Active    = has ? task.Milestone : false;
        this.ChkManual.Active       = has ? task.Manual : false;
        this.ChkEffortDriven.Active = has ? task.EffortDriven : false;
        this.ChkEstimated.Active    = has ? task.Estimated : false;
        this.CmbTaskType.Index = has
            ? taskKind(this.holder.project, task) : 0;
        this.SpinPercent.Value   = has ? task.PercentComplete : 0;
        this.CmbConstraint.Index = has ? (task.ConstraintType || 0) : 0;
        this.TxtConstraint.Text  = has ? shortDate(task.ConstraintDate) : "";
        this.TxtDeadline.Text    = has ? shortDate(task.Deadline) : "";
        this.TxtNotes.Text       = has ? task.Notes : "";

        this.TxtName.Enabled = has;
        /* A summary's dates, duration and completion are what Project
         * derives from its children; only its name is the user's. */
        for (const w of [this.TxtStart, this.TxtFinish, this.TxtDuration,
                         this.ChkMilestone, this.ChkEffortDriven,
                         this.ChkEstimated, this.CmbTaskType,
                         this.SpinPercent, this.CmbConstraint,
                         this.TxtConstraint, this.TxtDeadline])
            w.Enabled = editable;
        /* The commands the toolbar, the menu and the panel share are one
         * `Enabled`: assigning the button's would be refused, and rightly. */
        for (const act of [this.ActDelete, this.ActIndent, this.ActOutdent,
                           this.ActUp, this.ActDown])
            act.Enabled = has;
        for (const w of [this.BtnApply, this.TxtNotes,
                         this.CmbPred, this.CmbType, this.SpinLag,
                         this.BtnLinkAdd])
            w.Enabled = has;

        for (const w of [this.CmbAssignRes, this.TxtAssignUnits,
                         this.BtnAssignAdd])
            w.Enabled = has;

        this.fillLinks(has ? task : null);
        this.fillAssignments(has ? task : null);
        this.fillAttrs(has ? task : null);
    }

    /* The custom fields the file defines, and the value the selected task
     * carries in the one the combo shows. */
    fillAttrs(task) {
        const project = this.holder.project;
        const items = [];
        this.attrChoices = [];
        for (const def of project.FieldDefs) {
            this.attrChoices.push(def.FieldID);
            items.push(def.Alias || def.FieldName || def.FieldID);
        }
        this.CmbAttr.Items = items;

        let at = this.attrChoices.indexOf(this.fieldID);
        if (at < 0) at = items.length ? 0 : -1;
        this.CmbAttr.Index = at;

        const enabled = !!task && at >= 0;
        this.CmbAttr.Enabled = enabled;
        this.TxtAttr.Enabled = enabled;
        this.TxtAttr.Text = enabled
            ? attrOf(task, this.attrChoices[at]) : "";
    }

    CmbAttr_Select() {
        const task = this.selectedTask();
        const at = this.CmbAttr.Index;
        this.TxtAttr.Text = task && at >= 0
            ? attrOf(task, this.attrChoices[at]) : "";
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
                    LINK_NAMES[linkKind(link)],
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
    /* A double click on a row -- or Enter -- is "edit this one": the panel's
     * name field takes the keyboard, which is where a rename starts. */
    /* Ctrl+F: the filter field takes the keyboard. */
    ActFilter_Click() {
        this.TxtFilter.SetFocus();
    }

    Tasks_Activate() {
        if (this.selectedTask()) this.TxtName.SetFocus();
    }

    Tasks_Select() {
        const key = this.Tasks.Key;
        this.selectedUID = key === "" ? null : Number(key);
        this.showTask(this.selectedTask());
        this.Gantt.Redraw();
    }

    /* Ctrl+F: the filter field takes the keyboard. */
    ActFilter_Click() {
        this.TxtFilter.SetFocus();
    }

    Tasks_Activate() {
        if (this.selectedTask()) this.TxtName.SetFocus();
    }

    /* --- the chart's pointer ------------------------------------------- */

    ganttWidth()  { const b = this.Gantt.Bounds(); return b.Width  || this.Gantt.Width; }
    ganttHeight() { const b = this.Gantt.Bounds(); return b.Height || this.Gantt.Height; }

    /* Which task, and which part of its bar, is under the pointer. */
    ganttHit(x, y) {
        const project = this.holder ? this.holder.project : null;
        if (!project) return null;

        const g = ganttGeometry(project, this.ganttWidth(), this.ganttHeight(),
                                this.step);
        const i = g.rowAt(y);
        if (i < 0 || x < g.plotX) return null;

        const task = g.rows[i];
        const s = whenMs(task.Start), f = whenMs(task.Finish);
        if (s === null || f === null) return null;

        const x0 = g.x(Math.min(s, f)), x1 = g.x(Math.max(s, f));
        const edge = task.Milestone ? 9 : 5;
        if (x < x0 - edge || x > x1 + edge) return null;
        return { task, zone: !task.Milestone && x >= x1 - edge ? "end" : "bar" };
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
        if (!hit || button !== 1) return;

        if (ctrl) {
            this.drag = { mode: "link", uid: hit.task.UID, px: x, py: y, to: null };
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
        this.Gantt.Redraw();
    }

    Gantt_DblClick(x, y, button, ctrl, shift) {
        if (button !== 1 || !this.selectedTask()) return;
        this.TxtName.SetFocus();
    }

    Gantt_MouseMove(x, y) {
        const drag = this.drag;
        if (!drag) return;
        drag.px = x;
        drag.py = y;

        if (drag.mode === "link") {
            const hit = this.ganttHit(x, y);
            drag.to = hit && hit.task.UID !== drag.uid ? hit.task.UID : null;
            this.Gantt.Redraw();
            return;
        }

        const g = ganttGeometry(this.holder.project, this.ganttWidth(),
                                this.ganttHeight(), this.step);
        if (!g.dayW) return;
        const days = Math.round((x - drag.x0) / g.dayW);
        if (drag.mode === "move") {
            drag.start  = drag.originStart  + days * DAY_MS;
            drag.finish = drag.originFinish + days * DAY_MS;
        } else {
            drag.finish = Math.max(drag.originStart,
                                   drag.originFinish + days * DAY_MS);
        }
        this.Gantt.Redraw();
    }

    Gantt_MouseUp() {
        const drag = this.drag;
        this.drag = null;
        if (!drag) return;

        if (drag.mode === "link") {
            if (drag.to !== null && drag.to !== undefined) {
                const succ  = this.edit.task(drag.to);
                const links = succ.Links.filter((l) => l.PredecessorUID !== drag.uid);
                links.push(new MspLink({ PredecessorUID: drag.uid,
                                         Type: LINK_ORDER[this.CmbDrawType.Index] || 1,
                                         LinkLag: 0, LagFormat: 3 }));
                if (this.edit.setLinks(succ.UID, links)) this.fill(succ.UID);
                else this.Gantt.Redraw();
            } else {
                this.Gantt.Redraw();
            }
            return;
        }

        const task = this.edit.task(drag.uid);
        if (!task) { this.Gantt.Redraw(); return; }

        const values = { Start: isoLocal(drag.start),
                         Finish: isoLocal(drag.finish) };
        if (drag.mode === "resize")
            values.Duration = mspdiDuration(
                this.workingMinutes(task, drag.start, drag.finish));
        this.edit.setFields(task.UID, values);
        this.fill(task.UID);
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
    Gantt_Draw(p, width, height) {
        drawGantt(p, width, height, this.holder ? this.holder.project : null,
                  this.selectedUID, this.step, this.drag,
                  this.baselineNumber || 0);
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

    /* The one dialog that edits the settings the app reads; what it writes is
     * re-read here, so nothing needs a restart. */
    ActSettings_Click() {
        SettingsForm.open(() => {
            this.applySettings();
            this.fill(this.selectedUID);
        });
    }

    /* The chart as a file to send: PNG by the dialog's filter, PDF when the
     * name says so, at the chart's own size so nothing is cropped. */
    ActExport_Click() {
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

        /* Notes and custom fields belong to any task, a summary included. */
        const values = { Name: this.TxtName.Text, Notes: this.TxtNotes.Text };

        const attrAt = this.CmbAttr.Index;
        if (attrAt >= 0 && this.attrChoices[attrAt]) {
            const fieldID = this.attrChoices[attrAt];
            const kept = task.Attributes.filter((a) => a.FieldID !== fieldID);
            if (this.TxtAttr.Text !== "")
                kept.push(new MspFieldValue({ FieldID: fieldID,
                                              Value: this.TxtAttr.Text }));
            if (JSON.stringify(task.Attributes) !== JSON.stringify(kept))
                values.Attributes = kept;
        }

        /* A summary is what Project derives it from: only the name is read. */
        if (!task.Summary) {
            const duration = parseDuration(this.TxtDuration.Text, task.DurationFormat,
                                            this.unit, this.holder.project);
            if (duration === null) {
                Message.Error("{0} is not a duration -- try 2d, 8h or 30m",
                              this.TxtDuration.Text);
                return false;
            }
            values.Start           = parseMoment(this.TxtStart.Text);
            values.Finish          = parseMoment(this.TxtFinish.Text);
            values.Duration        = mspdiDuration(duration.minutes);
            values.DurationFormat  = duration.format;
            values.Type            = Math.max(this.CmbTaskType.Index, 0);
            values.Milestone       = this.ChkMilestone.Active;
            values.Manual          = this.ChkManual.Active;
            values.EffortDriven    = this.ChkEffortDriven.Active;
            values.Estimated       = this.ChkEstimated.Active;
            values.PercentComplete = Math.round(this.SpinPercent.Value);

            /* A percentage moves the actual dates the way Project reads them:
             * started above zero, finished at a hundred, and back to none. */
            const start = values.Start || task.Start;
            if (values.PercentComplete > 0 && task.ActualStart === "")
                values.ActualStart = start;
            if (values.PercentComplete >= 100) {
                if (values.ActualStart === "") values.ActualStart = start;
                values.ActualFinish = values.Finish || task.Finish;
            }
            if (values.PercentComplete === 0) {
                values.ActualStart  = "";
                values.ActualFinish = "";
            }

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

    ActAdd_Click() {
        const added = this.edit.addTask(this.selectedUID);
        this.fill(added.UID);
    }

    ActDelete_Click() {
        const task = this.selectedTask();
        if (!task) return;
        ConfirmForm.ask(Locale.Text("Delete task"), Locale.Text('Delete "{0}"?', task.Name),
            Locale.Text("Delete"), () => {
                this.edit.removeTask(task.UID);
                this.fill(null);
            });
    }

    ActIndent_Click()  { this.nudge(1); }
    ActOutdent_Click() { this.nudge(-1); }

    nudge(delta) {
        const task = this.selectedTask();
        if (!task) return;
        if (this.edit.indent(task.UID, delta)) this.fill(task.UID);
    }

    /* Up and Down swap the task with its sibling, subtree and all. */
    ActUp_Click()   { this.move(-1); }
    ActDown_Click() { this.move(1); }

    move(delta) {
        const task = this.selectedTask();
        if (!task) return;
        if (this.edit.moveTask(task.UID, delta)) this.fill(task.UID);
    }

    /* The plan-wide command: place every task from its links. It is one undo
     * and it says how many it placed. */
    ActRecalc_Click() {
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
        if (at >= 0) this.CmbPred.Index = at;
        this.CmbType.Index = LINK_INDEX[linkKind(link)];
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

    /*
     * The plan as a document: a banded report of the tasks -- dates, duration,
     * progress, cost -- that leaves as one PDF. The bands are declared here,
     * which is what keeps the totals from drifting from the rows.
     */
    ActReport_Click() {
        const base = File.BaseName(this.path) || "plan";
        Dialog.SaveFile(Locale.Text("Save the report"),
            { Folder: File.Directory(this.path), Name: `${base}-report.pdf`,
              Filters: [[Locale.Text("PDF document"), "*.pdf"]] },
            (path) => {
                try {
                    this.buildReport();
                    this.Plan.SavePdf(path);
                    this.log(`Reported ${path}.`);
                } catch (e) {
                    Message.Error("Cannot save {0}: {1}", path, e.message);
                }
            });
    }

    buildReport() {
        const project = this.holder.project;
        const rows = [];
        for (const task of project.Tasks) {
            if (task.IsNull || task.Summary) continue;

            rows.push({
                Task:     task.Name,
                Start:    String(task.Start || "").slice(0, 10),
                Finish:   String(task.Finish || "").slice(0, 10),
                Duration: durationText(task, project),
                Complete: `${task.PercentComplete}%`,
                Critical: task.Critical ? Locale.Text("Critical") : "",
                Cost:     taskCost(project, task),
            });
        }

        const money = (x, y, w) => ({ Kind: "Total", Field: "Cost", Op: "Sum",
                                      Format: "Money", X: x, Y: y, Width: w,
                                      Align: "Right" });
        const head = (text, x, w, align) => ({ Kind: "Text", Text: text, X: x,
                                               Y: 30, Width: w,
                                               Align: align || "Left",
                                               Font: "Bold 9" });
        const cell = (field, x, w, align, format) => ({ Kind: "Field",
                                                        Field: field, X: x, Y: 0,
                                                        Width: w,
                                                        Align: align || "Left",
                                                        Format: format || "" });

        this.Plan.Paper       = "A4";
        this.Plan.Orientation = "Landscape";
        this.Plan.Sections = {
            /* The page header sits at the top of every page and the rest of
             * the bands flow under it, so the title belongs here with the
             * captions -- and it repeats with them, which a plan across
             * pages wants anyway. */
            PageHeader: { Height: 48, Elements: [
                { Kind: "Text", Text: project.Name || File.Name(this.path),
                  X: 0, Y: 0, Font: "Bold 12" },
                { Kind: "Text", Text: this.path, X: 0, Y: 16, Font: "8" },
                head(Locale.Text("Task"), 0, 240),
                head(Locale.Text("Start"), 248, 70),
                head(Locale.Text("Finish"), 322, 70),
                head(Locale.Text("Duration"), 396, 60, "Right"),
                head(Locale.Text("Complete"), 460, 60, "Right"),
                head(Locale.Text("Critical"), 524, 60),
                head(Locale.Text("Cost"), 588, 80, "Right"),
                { Kind: "Line", Y1: 46, X2: 668, Y2: 46, Color: "#999999" },
            ]},
            Detail: { Height: 15, Elements: [
                cell("Task", 0, 240),
                cell("Start", 248, 70),
                cell("Finish", 322, 70),
                cell("Duration", 396, 60, "Right"),
                cell("Complete", 460, 60, "Right"),
                cell("Critical", 524, 60),
                cell("Cost", 588, 80, "Right", "Money"),
            ]},
            PageFooter: { Height: 16, Elements: [
                { Kind: "Field", Field: "@Page", X: 600, Y: 0, Width: 30,
                  Align: "Right", Font: "8" },
                { Kind: "Text", Text: "/", X: 632, Y: 0, Font: "8" },
                { Kind: "Field", Field: "@Pages", X: 640, Y: 0, Width: 30,
                  Font: "8" },
            ]},
            ReportFooter: { Height: 22, Elements: [
                { Kind: "Text", Text: Locale.Text("Total"), X: 480, Y: 4,
                  Width: 100, Align: "Right", Font: "Bold 9" },
                money(588, 4, 80),
            ]},
        };
        this.Plan.Data = rows;
    }

    /* Which baseline is in hand: the one Save writes and the one the chart
     * draws. A view choice, so it dies with the window. */
    CmbBaseline_Select() {
        const combo = this.CmbBaseline;
        if (!combo) return;        // the event fires while the form is built
        this.baselineNumber = Math.max(combo.Index, 0);
        if (this.Gantt) this.Gantt.Redraw();
    }

    /* The plan as it stands, kept so a later date can be compared with it.
     * It is one undo like any other command. */
    saveBaseline() {
        const number = Math.max(this.CmbBaseline.Index, 0);
        this.edit.setBaseline(number);
        this.fill(this.selectedUID);
        this.log(Locale.Text("Baseline {0} saved.", number));
    }

    ActBaseline_Click() {
        this.saveBaseline();
    }

    BtnBaselineSave_Click() {
        this.saveBaseline();
    }

    ActUndo_Click() {
        const keep = this.selectedUID;
        if (this.edit.undo()) this.fill(keep);
    }

    ActRedo_Click() {
        const keep = this.selectedUID;
        if (this.edit.redo()) this.fill(keep);
    }

    /* --- opening, saving and closing ------------------------------------ */

    ActOpen_Click() {
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

    ActQuit_Click() { this.Close(); }

    ActSave_Click() { this.save(); }

    ActSaveAs_Click() {
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
            const copy = this.autosavePath();
            if (File.Exists(copy)) File.Delete(copy);
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

            /* Where the shapes start, taken from the XSD: the two `Type`
             * fields have no default and start below every real value, so a
             * file's own 0 is kept; the project's default task type and a
             * resource's units are the schema's 1; and a missing Type reads
             * as the project says (FS for a link). */
            const fresh = new MspProject({ Name: "Fresh" });
            ok = eq("fresh defaults",
                    [fresh.ScheduleFromStart, fresh.DefaultTaskType,
                     fresh.WeekStartDay, new MspTask({}).Type,
                     new MspTask({}).EffortDriven, new MspTask({}).Estimated,
                     new MspLink({}).Type, new MspResource({}).MaxUnits].join(","),
                    "true,1,-1,-1,false,true,-1,1") && ok;
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

            /* And what the pass derives: two units carrying eight hours each
             * make an eight-hour task, while Fixed Duration keeps the
             * duration and doubles the work. */
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
            ok = eq("work derives the duration",
                    workDuration(w, w.Tasks[0], 960), 480) && ok;
            ok = eq("...and the work is in step", w.Tasks[0].Work, "PT16H0M0S") && ok;
            w.Tasks[0].Type = 1;
            ok = eq("duration keeps its own",
                    workDuration(w, w.Tasks[0], 240), 240) && ok;
            ok = eq("...and derives the work", w.Tasks[0].Work, "PT8H0M0S") && ok;

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

            /* Where the first task's bar is, from the chart's own geometry. */
            const g = ganttGeometry(this.holder.project, this.ganttWidth(),
                                    this.ganttHeight(), this.step);
            const task = edit.task(1);
            const y    = HEADER + g.rows.indexOf(task) * ROW_H + ROW_H / 2;
            const mid  = g.x((whenMs(task.Start) + whenMs(task.Finish)) / 2);
            const end  = g.x(whenMs(task.Finish));

            /* Move it two days: both dates travel, the duration does not. */
            this.Gantt_MouseDown(mid, y, 1, false, false);
            this.Gantt_MouseMove(mid + 2 * g.dayW, y);
            this.Gantt_MouseUp();
            ok = eq("move start", edit.task(1).Start, "2026-09-03T08:00:00") && ok;
            ok = eq("move finish", edit.task(1).Finish, "2026-09-04T17:00:00") && ok;
            ok = eq("move duration", edit.task(1).Duration, "PT8H0M0S") && ok;
            edit.undo();
            ok = eq("move undone", edit.task(1).Start, "2026-09-01T08:00:00") && ok;

            /* The end edge resizes: the duration follows the finish. The
             * fixture's calendar is Monday to Friday, so three calendar days
             * from Tuesday are three working ones. */
            this.Gantt_MouseDown(end, y, 1, false, false);
            this.Gantt_MouseMove(end + g.dayW, y);
            this.Gantt_MouseUp();
            ok = eq("resize finish", edit.task(1).Finish, "2026-09-03T17:00:00") && ok;
            ok = eq("resize duration", edit.task(1).Duration, "PT24H0M0S") && ok;
            edit.undo();

            /* Ctrl from one bar to another draws a link of the kind the
             * chart's own combo says -- Start to start, here, which is its
             * second item and MSPDI's 3. The undo replaced the records, so
             * the geometry is taken again from the plan as it is now. */
            this.CmbDrawType.Index = 1;
            const g2   = ganttGeometry(this.holder.project, this.ganttWidth(),
                                       this.ganttHeight(), this.step);
            const one  = edit.task(1), two = edit.task(2);
            const oy   = HEADER + g2.rows.indexOf(two) * ROW_H + ROW_H / 2;
            const omid = g2.x((whenMs(two.Start) + whenMs(two.Finish)) / 2);
            const y1   = HEADER + g2.rows.indexOf(one) * ROW_H + ROW_H / 2;
            const mid1 = g2.x((whenMs(one.Start) + whenMs(one.Finish)) / 2);
            this.Gantt_MouseDown(omid, oy, 1, true, false);
            this.Gantt_MouseMove(mid1, y1);
            this.Gantt_MouseUp();
            ok = eq("link count", edit.task(1).Links.length, 1) && ok;
            ok = eq("link predecessor", edit.task(1).Links[0].PredecessorUID, 2) && ok;
            ok = eq("link type", edit.task(1).Links[0].Type, 3) && ok;
            this.CmbDrawType.Index = 0;
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
                        finish: task.Finish, critical: !!task.Critical });
        }

        const run = recalculate(project);
        const days = (a, b) => a === null || b === null
                             ? null : Math.round((b - a) / DAY_MS);

        let same = 0, starts = 0, finishes = 0, criticals = 0;
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
            if (ds !== 0 || df !== 0)
                print(`oracle ${task.UID} ${was.name}: ` +
                      `${shortDate(was.start)}..${shortDate(was.finish)} -> ` +
                      `${shortDate(task.Start)}..${shortDate(task.Finish)} ` +
                      `(${ds}d/${df}d)`);
        }
        print(`oracle ${File.Name(path)}: ${kept.length} tasks, ` +
              `${run.placed} placed, ${run.skipped} kept, ${same} same, ` +
              `${starts} starts off, ${finishes} finishes off, ` +
              `${criticals} critical off`);
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
                 task.PercentComplete === 75 &&
                 task.ActualStart === "2026-09-01T08:00:00" && ok;   // the file's own
            print(`edit fields name="${task.Name}" duration=${task.Duration} ` +
                  `start=${task.Start} percent=${task.PercentComplete} ` +
                  `actual=${task.ActualStart}`);

            /* The forward pass as one undo: UID 1 already finished and keeps
             * its actual dates, and UID 2 is placed after them. Before the
             * indent, because a summary is not scheduled -- it is the span of
             * its children. */
            const recalc = edit.recalculate();
            ok = recalc.placed === 1 && recalc.skipped === 1 &&
                 edit.task(1).Start === "2026-09-01T09:00" &&
                 edit.task(1).Finish === "2026-09-02T17:00" &&
                 edit.task(2).Start === "2026-09-03T08:00:00" && ok;
            print(`edit recalc placed=${recalc.placed} skipped=${recalc.skipped} ` +
                  `A=${edit.task(1).Start}..${edit.task(1).Finish} ` +
                  `B=${edit.task(2).Start}..${edit.task(2).Finish}`);
            edit.undo();
            ok = edit.task(1).Start === "2026-09-01T09:00" && ok;
            edit.redo();

            /* Recalculating a plan already where the pass puts it moves
             * nothing, so it costs no undo step. */
            const steps = edit.at;
            const again = edit.recalculate();
            ok = !again.changed && edit.at === steps && ok;
            print(`edit recalc again changed=${again.changed} steps=${edit.at}`);

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

            /* A custom field through the panel: the file gets the definition,
             * the task gets the value. */
            ok = edit.setProject({ FieldDefs: [new MspFieldDef({
                     FieldID: "188743731", FieldName: "Text1",
                     Alias: "External_ID" })] }) && ok;
            this.fill(2);
            this.TxtAttr.Text = "4821";
            ok = this.applyFields() &&
                 attrOf(edit.task(2), "188743731") === "4821" && ok;
            print(`edit custom field=${attrOf(edit.task(2), "188743731")}`);

            /* The baseline keeps the plan as it stands, and a hundred per
             * cent finishes the task: the actual dates follow. Two numbers
             * are kept side by side, the second one through the panel's own
             * combo and button, and re-saving replaces rather than stacks. */
            edit.setBaseline(0);
            this.CmbBaseline.Index = 1;
            this.BtnBaselineSave_Click();
            this.CmbBaseline.Index = 0;
            this.BtnBaselineSave_Click();
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

            /* The report: the bands are declared, the rows are the plan, and
             * the PDF is what a colleague who does not run the app opens. */
            this.buildReport();
            const report = File.Join(out, "bintana-project-report.pdf");
            this.Plan.SavePdf(report);
            const paper = File.Info(report);
            ok = this.Plan.PageCount >= 1 && paper && paper.Size > 0 && ok;
            print(`edit report pages=${this.Plan.PageCount} ` +
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
        const wanted = ["ActOpen", "ActSave", "ActSaveAs", "ActExport",
                        "ActQuit", "ActUndo", "ActRedo", "ActAdd", "ActDelete",
                        "ActIndent", "ActOutdent", "ActUp", "ActDown",
                        "ActRecalc", "ActSettings", "ActBaseline", "ActReport", "ActFilter",
                        "BtnApply", "BtnLinkAdd",
                        "BtnLinkDel", "MnuRecent", "MnuLog", "MnuAbout",
                        "BtnResNew", "BtnResApply", "BtnResDel", "BtnResRates",
                        "BtnAssignAdd", "BtnAssignDel", "ActProjData", "ActProjOptions", "ActCalendar",
                        "BtnCalEdit", "BtnBaselineSave"]
            .map((name) => `${name}_Click`)
            .concat(["Tasks_Select", "Gantt_Draw", "CmbScale_Select",
                     "CmbBaseline_Select",
                     "Links_Select", "Resources_Select", "Assignments_Select",
                     "Calendars_Select", "CmbAttr_Select", "TxtFilter_Change",
                     "TxtFilter_IconClick",
                     "Gantt_MouseDown", "Gantt_MouseMove", "Gantt_MouseUp",
                     "Tasks_Activate", "Gantt_DblClick"]);

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
            if (row[0] !== name ||
                row[1] !== durationText(task, this.holder.project)) ok = false;
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

/* The four link types, in MSPDI's own numbering (0 FF, 1 FS, 2 SF, 3 SS) and
 * in the order the panel's combo shows them: FS, SS, FF, SF. */
const LINK_NAMES = ["FF", "FS", "SF", "SS"];
const LINK_ORDER = [1, 3, 0, 2];   // combo index -> MSPDI type
const LINK_INDEX = { 0: 2, 1: 0, 2: 3, 3: 1 };

/* What the timescale control means, by the combo's index (its items are
 * translated, so the text is not a key): pixels a day, and the header step in
 * days -- null/0 is the chart's own choice, which is what Auto is. */
const SCALES = [
    null,                        // Auto
    { dayW: 30, step: 1 },       // Day
    { dayW: 10, step: 7 },       // Week
    { dayW: 3,  step: 30 },      // Month
];

/* A number typed in a field, with the comma a keyboard may give it; NaN when
 * it is not one, which the caller refuses. */
function resourceNumber(text) {
    return Number(String(text || "").replace(",", "."));
}

/* "2026-10-01T17:00:00" reads better as "2026-10-01 17:00" in a row. */
function shortDate(when) {
    return String(when || "").slice(0, 16).replace("T", " ");
}

/*
 * The duration as the file's own DurationFormat reads it, with an `e` when it
 * counts elapsed time and a `?` when it is estimated -- the field's own flag
 * or the format's spelling, whichever says so.
 */
function durationText(task, project) {
    const minutes = mspdiMinutes(task.Duration);
    if (minutes === null) return task.Duration || "";
    const format = durationFormat(task.DurationFormat, project);
    const estimated = task.Estimated || format.estimated;
    return `${minutes / format.per}${format.elapsed ? "e" : ""}${format.unit}` +
           (estimated ? "?" : "");
}

/* "2026-10-01 08:00" is how a plan is read; `Field.DateTime` wants the T.
 * Empty is an empty date, which the field lets through when not required. */
function parseMoment(text) {
    const t = String(text || "").trim();
    return t === "" ? "" : t.replace(" ", "T");
}

/*
 * "2d", "8h", "30m", "1mo", "2ed" -- elapsed -- or a bare number in `unit`
 * (the setting) or in the task's own unit. A unit written wins, then the
 * setting, and the format moves with whichever was said; a bare number with
 * neither keeps the format it had, estimated months included. A trailing `?`
 * -- what the field itself writes on an estimated duration -- is read and
 * left to the Estimated checkbox, which is the editor for that flag.
 */
function parseDuration(text, format, unit, project) {
    const m = /^\s*(\d+(?:[.,]\d+)?)\s*(e?)(mo|m|h|d|w)?\s*\??\s*$/.exec(String(text || ""));
    if (!m) return null;

    const typed = m[3] ? m[2] + m[3] : "";
    let chosen = format;
    if (typed)     chosen = formatOfUnit(typed);
    else if (unit) chosen = formatOfUnit(unit);

    const minutes = Math.round(Number(m[1].replace(",", ".")) *
                               durationFormat(chosen, project).per);
    return { minutes, format: (typed || unit) ? chosen : format };
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
