/*
 * Edit: the commands that change the plan, and the history that undoes them.
 *
 * A step is a **snapshot**, not an inverse: the record tree is serialized after
 * every accepted command, so Set, Add, Remove and Indent undo uniformly and a
 * deletion another task linked to comes back whole. `holder.project` is what
 * gets replaced on undo/redo; the document is never edited in place --
 * `writeMspdi` writes each time into a fresh copy of the file as it was read,
 * so a deletion that was saved still has its whole element to come back to.
 *
 * The plan is the array of `MspTask` records in file order, and the outline is
 * `OutlineLevel` over it: a task owns the deeper ones that follow until one at
 * its own level or shallower. Indent and Outdent move that level and then
 * recompute which tasks are summaries -- `OutlineNumber`/`WBS` are left to
 * Project, which derives them (ROADMAP's open decision).
 */
"use strict";

class Edit {

    static LIMIT = 50;   // steps kept; a plan is not a video

    holder = null;
    states = [];
    at     = 0;
    saved  = 0;

    /* With `auto` on, every accepted command brings the schedule up to date
     * before the snapshot, so one edit is still one undo. Off by default:
     * a date typed by hand is the user's until they ask. */
    auto = false;

    /* **The highest UID each kind ever had while this document was open**,
     * outside the snapshots on purpose. A UID is identity in the file:
     * `SaveXml` matches a record to its element by it, so a new task that took
     * a deleted one's number would inherit that element's unmodelled children
     * (TimephasedData, GUID, …) and any assignment still pointing at it. An
     * undo brings old records back, never old numbers to hand out again. */
    #issued = {};

    constructor(holder) {
        this.holder = holder;
        this.states = [holder.project.Serialize(true)];
        const p = holder.project;
        for (const [kind, list] of [["task", p.Tasks], ["resource", p.Resources],
                                    ["assignment", p.Assignments],
                                    ["calendar", p.Calendars]])
            this.#issued[kind] = list.reduce((m, r) => Math.max(m, r.UID), 0);
    }

    /* The next UID of a kind: after every one it has had, not just the ones
     * it has now. */
    nextUID(kind, list) {
        const top = list.reduce((m, r) => Math.max(m, r.UID), this.#issued[kind] || 0);
        this.#issued[kind] = top + 1;
        return top + 1;
    }

    get dirty()   { return this.at !== this.saved; }
    get canUndo() { return this.at > 0; }
    get canRedo() { return this.at < this.states.length - 1; }

    markSaved() { this.saved = this.at; }

    /* **Different from every step the history holds**, which is what a
     * recovered autosave is: what the window shows was never written to the
     * file it is called. No step is ever at -1, so nothing undoes back to
     * clean. */
    markUnsaved() { this.saved = -1; }

    task(uid) {
        for (const task of this.holder.project.Tasks)
            if (task.UID === uid) return task;
        return null;
    }

    /* One accepted command, and the state it left behind. The redo tail is
     * dropped, and the oldest step goes when the stack is full.
     *
     * **When the saved state is one of the steps dropped, nothing is saved any
     * more** -- the index it had is about to name a different state, and an
     * undo that landed there would read clean without being the file. */
    commit() {
        if (this.auto) recalculate(this.holder.project);
        if (this.saved > this.at) this.saved = -1;
        this.states.length = this.at + 1;
        this.states.push(this.holder.project.Serialize(true));
        if (this.states.length > Edit.LIMIT) {
            this.states.shift();
            this.saved = this.saved > 0 ? this.saved - 1 : -1;
        }
        this.at = this.states.length - 1;
    }

    restore() { this.holder.project = MspProject.Load(this.states[this.at]); }

    undo() {
        if (!this.canUndo) return false;
        this.at--;
        this.restore();
        return true;
    }

    redo() {
        if (!this.canRedo) return false;
        this.at++;
        this.restore();
        return true;
    }

    /* Several fields in one step, so a form's Apply is one undo. The setters
     * validate; a bad value throws before anything is committed. */
    setFields(uid, values) {
        const task = this.task(uid);
        if (!task) return false;

        let changed = false;
        for (const name in values) {
            if (task[name] !== values[name]) changed = true;
            task[name] = values[name];
        }
        if (!changed) return false;

        this.commit();
        return true;
    }

    /* A task and its subtree, moved past the sibling before or after it: the
     * outline does not change, only the order within one parent. */
    moveTask(uid, delta) {
        const tasks = this.holder.project.Tasks;
        const i = tasks.findIndex((t) => t.UID === uid);
        if (i < 0) return false;

        const level = tasks[i].OutlineLevel;
        let end = i + 1;
        while (end < tasks.length && tasks[end].OutlineLevel > level) end++;
        const block = tasks.slice(i, end);

        if (delta < 0) {
            /* The sibling above, wherever its own subtree ended. */
            let at = i - 1;
            while (at >= 0 && tasks[at].OutlineLevel > level) at--;
            if (at < 0 || tasks[at].OutlineLevel !== level) return false;
            tasks.splice(i, block.length);
            for (let k = 0; k < block.length; k++) tasks.splice(at + k, 0, block[k]);
        } else {
            /* After the next sibling's whole subtree, so the move is a swap and not an
             * insert into somebody's children -- and so a leaf moves *past* its
             * neighbour instead of onto it. The scan starts one past the sibling,
             * because at `end` the level is equal and not greater: starting there
             * the loop stopped on the sibling itself and put the task back where
             * it had been, so moving down silently did nothing. */
            if (end >= tasks.length || tasks[end].OutlineLevel !== level) return false;
            let after = end + 1;
            while (after < tasks.length && tasks[after].OutlineLevel > level) after++;
            tasks.splice(i, block.length);
            const at = after - block.length;
            for (let k = 0; k < block.length; k++) tasks.splice(at + k, 0, block[k]);
        }
        this.commit();
        return true;
    }

    /* The whole link list in one step: the panel adds, updates and removes
     * through here, so each of those is one undo. Equal lists are no step. */
    setLinks(uid, links) {
        const task = this.task(uid);
        if (!task) return false;
        if (JSON.stringify(task.Links) === JSON.stringify(links)) return false;
        task.Links = links;
        this.commit();
        return true;
    }

    /* --- resources and assignments ------------------------------------- */

    resource(uid) {
        for (const resource of this.holder.project.Resources)
            if (resource.UID === uid) return resource;
        return null;
    }

    assignment(uid) {
        for (const assignment of this.holder.project.Assignments)
            if (assignment.UID === uid) return assignment;
        return null;
    }

    /* A resource the program chooses the UID for: the file's own numbering is
     * Project's, and a new one goes after the last. */
    addResource(values) {
        const project = this.holder.project;
        const uid = this.nextUID("resource", project.Resources);

        const resource = new MspResource(values);
        resource.UID = uid;
        resource.ID = uid;
        project.Resources.push(resource);
        this.commit();
        return resource;
    }

    setResource(uid, values) {
        const resource = this.resource(uid);
        if (!resource) return false;

        let changed = false;
        for (const name in values) {
            if (resource[name] !== values[name]) changed = true;
            resource[name] = values[name];
        }
        if (!changed) return false;

        this.commit();
        return true;
    }

    /* A resource's rate periods, whole: the dialog hands the list back and
     * one undo covers it. Ordered by table and from-date, which is how the
     * file reads and how the engine walks it. */
    setResourceRates(uid, rates) {
        const resource = this.resource(uid);
        if (!resource) return false;

        const kept = (rates || []).slice();
        kept.sort((a, b) => (a.RateTable || 0) - (b.RateTable || 0) ||
                            Locale.Compare(a.RatesFrom, b.RatesFrom));
        if (JSON.stringify(resource.Rates) === JSON.stringify(kept)) return false;

        resource.Rates = kept;
        this.commit();
        return true;
    }

    /* The resource and the assignments that named it: an assignment to a
     * resource that is gone is a dangling reference. */
    removeResource(uid) {
        const project = this.holder.project;
        const kept = project.Resources.filter((r) => r.UID !== uid);
        if (kept.length === project.Resources.length) return false;

        project.Resources = kept;
        project.Assignments = project.Assignments.filter(
            (a) => a.ResourceUID !== uid);
        this.commit();
        return true;
    }

    /* A task and a resource, joined. One assignment per pair: assigning the
     * same resource again updates the units instead of adding a second. The
     * task's `Type` and `EffortDriven` decide what the units do to the
     * duration, and the work a work resource carries is that duration at its
     * units; a material is measured by the units and has none. */
    /* **One assignment's budget, which is the only budget there is**: MSPDI
     * keeps it on the assignment and not on the task or the plan, so this is
     * where a number the user typed becomes a file's number. Zero is a real
     * answer (no money budgeted) and so is "no answer at all", because that is
     * what an absent element reads as -- which is why there is no sentinel here
     * and why the field is money and not minutes.
     *
     * One undo, like every other field: a budget nobody wrote is not an edit. */
    setAssignmentBudget(uid, cost) {
        const assignment = this.assignment(uid);
        if (!assignment) return false;

        const budget = Number(cost) || 0;
        if (assignment.BudgetCost === budget) return false;

        assignment.BudgetCost = budget;
        this.commit();
        return true;
    }

    addAssignment(taskUID, resourceUID, units) {
        const project  = this.holder.project;
        const task     = this.task(taskUID);
        const resource = this.resource(resourceUID);
        if (!task || !resource) return null;

        /* What the task already carries in work-resource units, and what the
         * assignment being replaced carried: a task with none is its own unit
         * of work at a hundred per cent. */
        let existing = 0, replaced = 0;
        for (const assignment of project.Assignments) {
            if (assignment.TaskUID !== taskUID) continue;
            const other = this.resource(assignment.ResourceUID);
            if (!other || other.Type !== 1) continue;
            existing += assignment.Units || 0;
            if (assignment.ResourceUID === resourceUID)
                replaced = assignment.Units || 0;
        }
        const adds   = resource.Type === 1 ? units : 0;
        const before = existing > 0 ? existing : 1;
        const after  = existing > 0 ? existing - replaced + adds : 1 + adds;

        const minutes  = mspdiMinutes(task.Duration) || 0;
        const duration = assignmentDuration(project, task, before, after);
        const work = resource.Type === 0 ? "PT0H0M0S"
                   : mspdiDuration(Math.round(duration * units));

        /* **The work moves with the regular work it was**: a file writes both,
         * and they are equal unless there is overtime, which this does not
         * edit -- so `RegularWork` follows only when it said the same. */
        const setWork = (a, w) => {
            if (a.RegularWork === a.Work) a.RegularWork = w;
            a.Work = w;
        };

        /* **Assigning the same resource again updates that assignment**, it
         * does not replace it: the UID, the actuals, the contour, the budget and
         * whatever the file carries that the shapes do not (TimephasedData)
         * belong to the one already there. */
        const same = project.Assignments.find(
            (a) => a.TaskUID === taskUID && a.ResourceUID === resourceUID);
        /* A task whose duration moved follows it: the finish is the working
         * time from the start, which is the road `recalculate` walks. */
        if (duration !== minutes) {
            task.Duration = mspdiDuration(duration);
            task.Work     = mspdiDuration(Math.round(duration * after));
            if (task.Start !== "") {
                const calendar = new WorkCalendar(project, task.CalendarUID);
                const from = whenMs(task.Start);
                if (from !== null)
                    task.Finish = isoLocal(calendar.add(from, duration));
            }
        }

        /* The task's other work assignments: the new duration at their own
         * units, ending where the task now ends -- but only when the duration
         * moved: an untouched one is the file's number. Only this task's; the
         * loop used to rewrite the work of every assignment in the plan. */
        if (duration !== minutes) {
            for (const other of project.Assignments) {
                if (other === same || other.TaskUID !== taskUID) continue;
                const r = this.resource(other.ResourceUID);
                if (!r || r.Type !== 1) continue;
                setWork(other, mspdiDuration(Math.round(duration * (other.Units || 0))));
                other.Start  = task.Start;
                other.Finish = task.Finish;
            }
        }

        /* The dates after the task's, so the assignment ends where it does. */
        let assignment = same;
        if (assignment) {
            assignment.Units = units;
            setWork(assignment, work);
        } else {
            assignment = new MspAssignment({
                UID: this.nextUID("assignment", project.Assignments),
                TaskUID: taskUID, ResourceUID: resourceUID,
                Units: units, Work: work, RegularWork: work,
            });
            project.Assignments.push(assignment);
        }
        assignment.Start  = task.Start;
        assignment.Finish = task.Finish;

        this.commit();
        return assignment;
    }

    removeAssignment(uid) {
        const project = this.holder.project;
        const kept = project.Assignments.filter((a) => a.UID !== uid);
        if (kept.length === project.Assignments.length) return false;

        project.Assignments = kept;
        this.commit();
        return true;
    }

    /* The plan as it stands, kept under one number -- 0 to start, the ten
     * Project offers -- every task's dates and work into its own `Baseline`,
     * which is what Project's Set Baseline does. Re-saving one number
     * replaces it and leaves the others alone. */
    setBaseline(number) {
        const at = Math.min(Math.max(Number(number) || 0, 0), 10);
        for (const task of this.holder.project.Tasks) {
            if (task.IsNull) continue;
            const kept = task.Baselines.filter((b) => b.Number !== at);
            kept.push(new MspBaseline({ Number: at, Start: task.Start,
                                        Finish: task.Finish, Work: task.Work }));
            kept.sort((a, b) => a.Number - b.Number);
            task.Baselines = kept;
        }
        this.commit();
        return true;
    }

    /* A custom-field value on a task: empty takes the record out, since a
     * value with no text is a value the file does not carry. */
    setFieldValue(taskUID, fieldID, value) {
        const task = this.task(taskUID);
        if (!task || !fieldID) return false;

        const kept = task.Attributes.filter((a) => a.FieldID !== fieldID);
        if (value !== "") kept.push(new MspFieldValue({ FieldID: fieldID, Value: value }));
        if (JSON.stringify(task.Attributes) === JSON.stringify(kept)) return false;

        task.Attributes = kept;
        this.commit();
        return true;
    }

    /* --- the project and its calendars --------------------------------- */

    calendar(uid) {
        for (const calendar of this.holder.project.Calendars)
            if (calendar.UID === uid) return calendar;
        return null;
    }

    /* The project's own settings: its start, its calendar, the minutes a day,
     * the currency. One step, like a task's fields. */
    setProject(values) {
        const project = this.holder.project;
        let changed = false;
        for (const name in values) {
            if (project[name] !== values[name]) changed = true;
            project[name] = values[name];
        }
        if (!changed) return false;
        this.commit();
        return true;
    }

    /* A calendar whole: its name, its week days and its exceptions. The dialog
     * edits its own copy and hands the new one in, which is why the lists
     * compare by value and not by reference. */
    setCalendar(uid, values) {
        const calendar = this.calendar(uid);
        if (!calendar) return false;

        let changed = false;
        for (const name in values) {
            if (name === "WeekDays" || name === "Exceptions") {
                if (JSON.stringify(calendar[name]) !== JSON.stringify(values[name]))
                    changed = true;
                calendar[name] = values[name];
                continue;
            }
            if (calendar[name] !== values[name]) changed = true;
            calendar[name] = values[name];
        }
        if (!changed) return false;

        this.commit();
        return true;
    }

    /* A new calendar, as a copy of one already there: the week it really has
     * -- its base's included, which is what the dialog shows -- and its own
     * exceptions, under a fresh UID. Project's "create a calendar" starts
     * from a copy too; without a source, every day is off. */
    addCalendar(name, fromUID) {
        const project = this.holder.project;
        const uid = this.nextUID("calendar", project.Calendars);

        const source = fromUID ? this.calendar(fromUID) : null;
        const week = [];
        const work = source ? new WorkCalendar(project, source.UID) : null;
        for (let day = 1; day <= 7; day++) {
            const spans = work ? (work.days[day] || []) : [];
            week.push(new MspWeekDay({
                DayType:      day,
                DayWorking:   spans.length > 0,
                WorkingTimes: spans.map(([from, to]) => new MspWorkingTime({
                    FromTime: clockText(from), ToTime: clockText(to) })),
            }));
        }

        const calendar = new MspCalendar({
            UID:            uid,
            Name:           name || `Calendar ${uid}`,
            IsBaseCalendar: true,
            WeekDays:       week,
            /* Copies, not the source's records: the two calendars would share
             * them, and editing one would edit the other until the next undo. */
            Exceptions:     source ? source.Exceptions.map((e) => e.Clone()) : [],
        });
        project.Calendars = project.Calendars.concat([calendar]);
        this.commit();
        return calendar;
    }

    /* A calendar nobody runs on: the project's own is the plan's, and a task
     * or a resource that named it falls back to the project's. */
    removeCalendar(uid) {
        const project = this.holder.project;
        if (uid === project.CalendarUID) return false;

        const gone = project.Calendars.find((c) => c.UID === uid);
        if (!gone) return false;

        /* A calendar derived from this one inherits from what this one
         * inherited from -- or from the project's, which cannot be removed,
         * when this one was a base -- so the chain stays whole instead of
         * pointing at a UID that is not there. */
        const heir = gone.BaseCalendarUID > 0 ? gone.BaseCalendarUID : project.CalendarUID;
        project.Calendars = project.Calendars.filter((c) => c !== gone);
        for (const calendar of project.Calendars)
            if (calendar.BaseCalendarUID === uid) calendar.BaseCalendarUID = heir;
        for (const task of project.Tasks)
            if (task.CalendarUID === uid) task.CalendarUID = -1;
        for (const resource of project.Resources)
            if (resource.CalendarUID === uid) resource.CalendarUID = -1;

        this.commit();
        return true;
    }

    /* A task after `afterUID`'s whole subtree, a sibling of it; without one,
     * at the end, level 1. It carries no dates: an invented start would be a
     * lie, and the form is where they are typed. */
    addTask(afterUID) {
        const project = this.holder.project;
        const tasks   = project.Tasks;
        const uid = this.nextUID("task", tasks);

        let at = tasks.length, level = 1;
        if (afterUID !== null && afterUID !== undefined) {
            const i = tasks.findIndex((t) => t.UID === afterUID);
            if (i >= 0) {
                level = tasks[i].OutlineLevel;
                at = i + 1;
                while (at < tasks.length && tasks[at].OutlineLevel > level) at++;
            }
        }

        const task = new MspTask({
            UID: uid, ID: uid, Name: Locale.Text("New task"),
            OutlineLevel: level, Priority: 500,
            Duration: "PT0H0M0S", DurationFormat: 7, Work: "PT0H0M0S",
            CalendarUID: project.CalendarUID,
        });
        tasks.splice(at, 0, task);
        this.commit();
        return task;
    }

    /* The task and the subtree it owns, every link that pointed at any of
     * them -- a successor of a deleted task does not keep a dangling UID --
     * and every assignment on them: work nobody does still costs money in
     * `projectCost`, and it would be written to the file for a task that is
     * not there. */
    removeTask(uid) {
        const tasks = this.holder.project.Tasks;
        const i = tasks.findIndex((t) => t.UID === uid);
        if (i < 0) return false;

        let end = i + 1;
        while (end < tasks.length && tasks[end].OutlineLevel > tasks[i].OutlineLevel) end++;

        const gone = {};
        for (let k = i; k < end; k++) gone[tasks[k].UID] = true;
        tasks.splice(i, end - i);
        for (const task of tasks)
            task.Links = task.Links.filter((link) => !gone[link.PredecessorUID]);
        this.holder.project.Assignments =
            this.holder.project.Assignments.filter((a) => !gone[a.TaskUID]);

        this.#recomputeSummary();
        this.commit();
        return true;
    }

    /* One level down or up. Down is bounded by the task above -- a child has
     * to have a parent -- and up by level 1; the project summary stays at 0. */
    indent(uid, delta) {
        const tasks = this.holder.project.Tasks;
        const i = tasks.findIndex((t) => t.UID === uid);
        if (i < 0 || tasks[i].OutlineLevel === 0) return false;

        const task = tasks[i];
        let level = task.OutlineLevel + delta;
        if (delta > 0) {
            let above = 0;
            for (let k = i - 1; k >= 0; k--)
                if (!tasks[k].IsNull) { above = tasks[k].OutlineLevel; break; }
            level = Math.min(level, above + 1);
        }
        level = Math.max(level, 1);
        if (level === task.OutlineLevel) return false;

        /* **The subtree goes with it**, by the same step, which is what Project
         * does: moving only the row would turn an indented summary's children
         * into its siblings, and an outdented one's into a jump of two levels
         * the outline cannot hold. */
        let end = i + 1;
        while (end < tasks.length && tasks[end].OutlineLevel > task.OutlineLevel) end++;
        const step = level - task.OutlineLevel;
        for (let k = i; k < end; k++) tasks[k].OutlineLevel += step;
        this.#recomputeSummary();
        this.commit();
        return true;
    }

    /* The scheduling pass over the plan, as one undo -- and no undo at all
     * when the plan already was where the pass puts it: a key that changes
     * nothing must not dirty the file nor spend a step. Answers how many
     * tasks it placed, how many it kept, and whether anything moved. */
    recalculate() {
        const before = JSON.stringify(this.holder.project);
        const result = recalculate(this.holder.project);
        result.changed = JSON.stringify(this.holder.project) !== before;
        if (result.changed) this.commit();
        return result;
    }

    /* A task is a summary when the next one is deeper; Project derives the
     * flag the same way. `IsNull` rows are not structure. */
    #recomputeSummary() {
        const tasks = this.holder.project.Tasks.filter((t) => !t.IsNull);
        for (let i = 0; i < tasks.length; i++)
            tasks[i].Summary = i + 1 < tasks.length &&
                               tasks[i + 1].OutlineLevel > tasks[i].OutlineLevel;
    }
}
