/*
 * Edit: the commands that change the plan, and the history that undoes them.
 *
 * A step is a **snapshot**, not an inverse: the record tree is serialized after
 * every accepted command, so Set, Add, Remove and Indent undo uniformly and a
 * deletion another task linked to comes back whole. `holder.project` is what
 * gets replaced on undo/redo; `holder.doc` is not touched until `SaveXml`
 * writes into it, which is the same tree the round trip keeps.
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

    constructor(holder) {
        this.holder = holder;
        this.states = [holder.project.Serialize(true)];
    }

    get dirty()   { return this.at !== this.saved; }
    get canUndo() { return this.at > 0; }
    get canRedo() { return this.at < this.states.length - 1; }

    markSaved() { this.saved = this.at; }

    task(uid) {
        for (const task of this.holder.project.Tasks)
            if (task.UID === uid) return task;
        return null;
    }

    /* One accepted command, and the state it left behind. The redo tail is
     * dropped, and the oldest step goes when the stack is full. */
    commit() {
        if (this.auto) recalculate(this.holder.project);
        this.states.length = this.at + 1;
        this.states.push(this.holder.project.Serialize(true));
        if (this.states.length > Edit.LIMIT) {
            this.states.shift();
            this.saved = Math.max(0, this.saved - 1);
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
            /* After the next sibling's whole subtree, which is what makes the
             * move a swap and not an insert into somebody's children. */
            if (end >= tasks.length || tasks[end].OutlineLevel !== level) return false;
            let after = end;
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
        let maxUID = 0;
        for (const resource of project.Resources)
            if (resource.UID > maxUID) maxUID = resource.UID;

        const resource = new MspResource(values);
        resource.UID = maxUID + 1;
        resource.ID = maxUID + 1;
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

        let maxUID = 0;
        for (const assignment of project.Assignments)
            if (assignment.UID > maxUID) maxUID = assignment.UID;

        const assignment = new MspAssignment({
            UID: maxUID + 1, TaskUID: taskUID, ResourceUID: resourceUID,
            Units: units, Work: work, RegularWork: work,
            Start: task.Start, Finish: task.Finish,
        });

        const kept = [];
        for (const other of project.Assignments) {
            if (other.TaskUID === taskUID && other.ResourceUID === resourceUID)
                continue;
            /* What stays is the new duration at its own units, but only when
             * the duration moved: an untouched one is the file's number. */
            const r = this.resource(other.ResourceUID);
            if (r && r.Type === 1 && duration !== minutes)
                other.Work = mspdiDuration(
                    Math.round(duration * (other.Units || 0)));
            kept.push(other);
        }
        kept.push(assignment);

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

        project.Assignments = kept;
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

    /* A task after `afterUID`'s whole subtree, a sibling of it; without one,
     * at the end, level 1. It carries no dates: an invented start would be a
     * lie, and the form is where they are typed. */
    addTask(afterUID) {
        const project = this.holder.project;
        const tasks   = project.Tasks;
        let maxUID = 0;
        for (const task of tasks) if (task.UID > maxUID) maxUID = task.UID;

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
            UID: maxUID + 1, ID: maxUID + 1, Name: Locale.Text("New task"),
            OutlineLevel: level, Priority: 500,
            Duration: "PT0H0M0S", DurationFormat: 7, Work: "PT0H0M0S",
            CalendarUID: project.CalendarUID,
        });
        tasks.splice(at, 0, task);
        this.commit();
        return task;
    }

    /* The task and the subtree it owns, and every link that pointed at any of
     * them -- a successor of a deleted task does not keep a dangling UID. */
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

        task.OutlineLevel = level;
        this.#recomputeSummary();
        this.commit();
        return true;
    }

    /* The scheduling pass over the plan, as one undo. Answers how many tasks
     * it placed and how many it kept because their constraint needs Project's
     * backward scheduling. */
    recalculate() {
        const result = recalculate(this.holder.project);
        if (result.placed) this.commit();
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
