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
