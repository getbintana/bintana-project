/*
 * A task's fields in their own dialog, which is the door Project opens with a
 * double click: the four pages of the side panel -- Task, Advanced, Links and
 * Resources -- over the window, with OK writing them as one command and Cancel
 * changing nothing.
 *
 * **The controls carry the panel's own names**, so the fill and the read are
 * the same functions for both: `fillTaskForm` and `taskFormValues` are given
 * whichever of the two is on screen, and the two doors cannot diverge in what
 * a field means or in what a bad value refuses.
 *
 * **Links and assignments are edited over a copy and applied on OK**, unlike
 * the panel, which writes where it is: `links` is the task's list to change
 * whole, and `assignOps` is the list of things done to the assignments -- an
 * add, a remove, a budget -- in the order they were made, which the table
 * shows already applied. `Edit.applyTask` writes it all with the fields, in
 * one undo.
 */
"use strict";

/* The calendars a task may name, with the plan's own in front: the choices
 * (UIDs, -1 for the project's) and the labels the combo shows. **The plan's
 * own is chosen in the project dialog** -- it is a property of the file. */
export function workCalendarNames(project) {
    const choices = [-1];
    const items   = [Locale.Text("Project default")];
    for (const calendar of project.Calendars) {
        choices.push(calendar.UID);
        items.push(calendar.Name);
    }
    return { choices, items };
}

/* The custom fields the plan defines, as `{ id, label }` pairs: the label is
 * what the combo shows (alias, field name, or the ID). */
export function planFieldsOf(project) {
    const out = [];
    if (project)
        for (const def of project.FieldDefs)
            out.push({ id: def.FieldID, label: fieldLabel(def) });
    return out;
}

/* The open button is the desktop's opener (`LinkButton`): the address it holds
 * follows the box, so a link can be tried before OK, and with nothing to open
 * it is grey. */
export function updateLinkUri(ui) {
    const uri = ui.TxtLinkAddress.Text.trim();
    ui.BtnLinkUri.Uri     = uri;
    ui.BtnLinkUri.Enabled = uri !== "";
}

/* Fill a task's controls -- the panel's or the dialog's -- from the record.
 * `task` may be null, which is the panel with nothing selected. */
export function fillTaskForm(ui, task, project) {
    const has      = task !== null && task !== undefined;
    const editable = has && !task.Summary;

    ui.TxtName.Text     = has ? task.Name : "";
    ui.TxtStart.Text    = has ? shortDate(task.Start) : "";
    ui.TxtFinish.Text   = has ? shortDate(task.Finish) : "";
    ui.TxtDuration.Text = has ? durationText(task, project) : "";
    ui.ChkMilestone.Active    = has ? task.Milestone : false;
    ui.ChkManual.Active       = has ? task.Manual : false;
    ui.ChkEffortDriven.Active = has ? task.EffortDriven : false;
    ui.ChkEstimated.Active    = has ? task.Estimated : false;
    ui.CmbTaskType.Index = has ? taskKind(project, task) : 0;

    const work = workCalendarNames(project);
    ui.workCalChoices = work.choices;
    ui.CmbTaskCalendar.Items = work.items;
    const atCal = has
                ? work.choices.indexOf(task.CalendarUID > 0 ? task.CalendarUID : -1)
                : 0;
    ui.CmbTaskCalendar.Index = atCal >= 0 ? atCal : 0;

    ui.SpinPercent.Value   = has ? task.PercentComplete : 0;
    ui.CmbConstraint.Index = has ? (task.ConstraintType || 0) : 0;
    ui.TxtConstraint.Text  = has ? shortDate(task.ConstraintDate) : "";
    ui.TxtDeadline.Text    = has ? shortDate(task.Deadline) : "";
    ui.TxtNotes.Text       = has ? task.Notes : "";
    ui.TxtLinkText.Text    = has ? task.Hyperlink : "";
    ui.TxtLinkAddress.Text = has ? task.HyperlinkAddress : "";
    ui.TxtLinkSub.Text     = has ? task.HyperlinkSubAddress : "";
    updateLinkUri(ui);

    ui.TxtName.Enabled = has;
    /* A summary's dates, duration and completion are what Project derives from
     * its children; only its name is the user's. */
    for (const w of [ui.TxtStart, ui.TxtFinish, ui.TxtDuration,
                     ui.ChkMilestone, ui.ChkEffortDriven, ui.ChkEstimated,
                     ui.CmbTaskType, ui.SpinPercent, ui.CmbConstraint,
                     ui.TxtConstraint, ui.TxtDeadline])
        w.Enabled = editable;

    fillTaskAttrs(ui, has ? task : null, project);
}

/* The custom fields the file defines, and the value the task carries in the
 * one the combo shows. */
export function fillTaskAttrs(ui, task, project) {
    const items = [];
    ui.attrChoices = [];
    for (const field of planFieldsOf(project)) {
        ui.attrChoices.push(field.id);
        items.push(field.label);
    }
    ui.CmbAttr.Items = items;

    let at = ui.attrChoices.indexOf(ui.attrShown);
    if (at < 0) at = items.length ? 0 : -1;
    ui.CmbAttr.Index = at;
    ui.attrShown = at >= 0 ? ui.attrChoices[at] : "";

    const enabled = !!task && at >= 0;
    ui.CmbAttr.Enabled = enabled;
    ui.TxtAttr.Enabled = enabled;
    ui.CmbAttrValue.Enabled = enabled;
    fillTaskAttrValue(ui, task, project);
}

/* The value control follows the field: a list is a combo of its entries -- a
 * `None` first, to take the value out -- and anything else is the text box. A
 * text the list does not carry stays as an item so it can be read -- and
 * picked away. `TxtAttr` holds the value either way: it is what the OK reads. */
export function fillTaskAttrValue(ui, task, project) {
    const def   = ui.attrShown ? fieldDefOf(project, ui.attrShown) : null;
    const list  = def ? def.ValueList || [] : [];
    const value = task && def ? attrOf(task, def.FieldID) : "";

    ui.CmbAttrValue.Visible = list.length > 0;
    ui.TxtAttr.Visible      = list.length === 0;

    ui.valueItems = [];
    if (!list.length) {
        ui.TxtAttr.Text = value;
        return;
    }
    ui.valueItems.push("");
    for (const entry of list) ui.valueItems.push(entry.Value);
    if (value !== "" && ui.valueItems.indexOf(value) < 0)
        ui.valueItems.push(value);
    ui.CmbAttrValue.Items = ui.valueItems.map((item) =>
        item === "" ? Locale.Text("None") : item);
    ui.CmbAttrValue.Index = ui.valueItems.indexOf(value);
    ui.TxtAttr.Text = value;
}

export function selectTaskAttr(ui, task, project) {
    const at = ui.CmbAttr.Index;
    if (at >= 0) ui.attrShown = ui.attrChoices[at];
    fillTaskAttrValue(ui, task, project);
}

/* The chosen row is the value: the text box keeps it, so OK -- and the undo of
 * an OK -- move as one. */
export function selectTaskAttrValue(ui) {
    const at = ui.CmbAttrValue.Index;
    ui.TxtAttr.Text = at >= 0 && at < ui.valueItems.length
                    ? ui.valueItems[at] : "";
}

/* --- las pestañas de vínculos y recursos ----------------------------------
 *
 * El panel las escribe donde se hace; el diálogo, sobre una copia que el
 * Aceptar aplica entera. Las funciones de acá son las del diálogo y no las del
 * panel a propósito: el modelo -- la copia, las órdenes -- es lo que cambia.
 */

/* Los recursos que ofrece el editor de asignaciones, con sus UIDs: el UID 0 es
 * el "sin asignar" de Project y no se lista. Una sola descripción de la lista,
 * que el panel y el diálogo comparten. */
export function resourceNames(project) {
    const choices = [], items = [];
    for (const resource of project.Resources) {
        if (resource.IsNull || resource.UID === 0) continue;
        choices.push(resource.UID);
        items.push(resource.Name);
    }
    return { choices, items };
}

/* La tabla de vínculos del diálogo, desde su copia: el nombre de la
 * predecesora -- o su UID, si el plan no la tiene --, el tipo y el retardo. El
 * combo ofrece el plan entero, con un marcador primero y sin resúmenes, que el
 * motor no enlaza. */
export function fillFormLinks(ui, task, project) {
    ui.Links.Clear();
    ui.linkRows = [];
    ui.predChoices = [null];   // el marcador del combo
    ui.BtnLinkDel.Enabled = false;

    if (!task) return;

    for (const link of ui.links) {
        const pred = taskOf(project, link.PredecessorUID);
        ui.linkRows.push(link);
        ui.Links.Add([
            pred ? pred.Name : `UID ${link.PredecessorUID}`,
            LINK_NAMES[linkKind(link)],
            String((link.LinkLag || 0) / 10),
        ]);
    }

    const items = [Locale.Text("Choose…")];
    for (const other of project.Tasks) {
        if (other.IsNull || other.Summary || other.UID === task.UID) continue;
        ui.predChoices.push(other.UID);
        items.push(`${other.ID}  ${other.Name}`);
    }
    ui.CmbPred.Items = items;
    ui.CmbPred.Index = 0;
}

/* La tabla de asignaciones del diálogo: las del plan con las órdenes ya
 * aplicadas y las altas de recursos que la tarea todavía no tiene al final,
 * con sus unidades y sin trabajo ni costo, que los calcula el alta. **Un alta
 * sobre un recurso que ya está actualiza esa fila** -- una asignación por par,
 * como el archivo -- y no agrega una segunda. */
export function fillFormAssignments(ui, task, project) {
    ui.Assignments.Clear();
    ui.assignRows = [];
    ui.BtnAssignDel.Enabled   = false;
    ui.BtnAssignApply.Enabled = false;
    if (!task) return;

    const gone = new Set(ui.assignOps.filter((o) => o.remove !== undefined)
                                     .map((o) => o.remove));
    const units  = new Map();   // ResourceUID -> las unidades que quedaron
    const budget = new Map();   // assignment UID -> el presupuesto que quedó
    for (const op of ui.assignOps) {
        if (op.add) units.set(op.add.ResourceUID, op.add.Units);
        else if (op.budget) budget.set(op.budget.UID, op.budget.Cost);
    }

    const assigned = new Set();
    for (const assignment of project.Assignments) {
        if (assignment.TaskUID !== task.UID || gone.has(assignment.UID)) continue;
        assigned.add(assignment.ResourceUID);

        const shownUnits  = units.has(assignment.ResourceUID)
                          ? units.get(assignment.ResourceUID) : assignment.Units;
        const shownBudget = budget.has(assignment.UID)
                          ? budget.get(assignment.UID) : assignment.BudgetCost;
        const resource    = resourceOf(project, assignment.ResourceUID);

        ui.assignRows.push({ assignment, units: shownUnits, budget: shownBudget });
        ui.Assignments.Add([
            resource ? resource.Name
                     : assignment.ResourceUID > 0
                       ? `UID ${assignment.ResourceUID}`
                       : Locale.Text("No resource"),
            String(shownUnits),
            durationText({ Duration: assignment.Work, DurationFormat: 5 }, project),
            Locale.Number(assignmentCost(project, assignment), 2),
            shownBudget ? Locale.Number(shownBudget, 2) : "",
        ]);
    }

    const pending = new Map();   // ResourceUID -> la última alta de ese recurso
    for (const op of ui.assignOps)
        if (op.add && !assigned.has(op.add.ResourceUID))
            pending.set(op.add.ResourceUID, op);
    for (const op of pending.values()) {
        const resource = resourceOf(project, op.add.ResourceUID);
        ui.assignRows.push({ pending: op, units: op.add.Units, budget: 0 });
        ui.Assignments.Add([
            resource ? resource.Name : Locale.Text("No resource"),
            String(op.add.Units), "", "", "",
        ]);
    }
}

/* La fila elegida en los campos: una asignación del plan trae sus valores -- o
 * los que las órdenes le cambiaron -- y un alta pendiente los suyos, sin
 * presupuesto, que todavía no existe. */
export function selectFormAssignment(ui) {
    const row = ui.Assignments.Index >= 0 ? ui.assignRows[ui.Assignments.Index] : null;

    ui.BtnAssignDel.Enabled   = !!row;
    ui.BtnAssignApply.Enabled = !!(row && row.assignment);
    if (!row) return;

    const resourceUID = row.assignment ? row.assignment.ResourceUID
                                       : row.pending.add.ResourceUID;
    const at = ui.resChoices.indexOf(resourceUID);

    if (at >= 0) ui.CmbAssignRes.Index = at;
    ui.TxtAssignUnits.Text  = String(row.units);
    ui.TxtAssignBudget.Text = row.assignment ? Locale.Number(row.budget || 0, 2) : "";
}

/*
 * What the controls hold, as the values a command writes -- or null, with the
 * sentence already shown, when something is not what it says. **The panel's
 * Apply and the dialog's OK are this one read.**
 */
export function taskFormValues(ui, task, project, unit) {
    if (!task) return null;

    /* Notes, hyperlinks and custom fields belong to any task, a summary
     * included. */
    const values = { Name: ui.TxtName.Text, Notes: ui.TxtNotes.Text,
                     Hyperlink: ui.TxtLinkText.Text,
                     HyperlinkAddress: ui.TxtLinkAddress.Text,
                     HyperlinkSubAddress: ui.TxtLinkSub.Text };

    const attrAt = ui.CmbAttr.Index;
    if (attrAt >= 0 && ui.attrChoices[attrAt]) {
        const fieldID = ui.attrChoices[attrAt];
        const kept = task.Attributes.filter((a) => a.FieldID !== fieldID);
        if (ui.TxtAttr.Text !== "")
            kept.push(new MspFieldValue({ FieldID: fieldID,
                                          Value: ui.TxtAttr.Text,
                                          ValueGUID: fieldEntryID(project, fieldID,
                                                                  ui.TxtAttr.Text) }));
        if (JSON.stringify(task.Attributes) !== JSON.stringify(kept))
            values.Attributes = kept;
    }

    /* A summary is what Project derives it from: only the name is read. */
    if (!task.Summary) {
        const duration = parseDuration(ui.TxtDuration.Text, task.DurationFormat,
                                        unit, project);
        if (duration === null) {
            Message.Error("{0} is not a duration -- try 2d, 8h or 30m",
                          ui.TxtDuration.Text);
            return null;
        }
        values.Start           = parseMoment(ui.TxtStart.Text);
        values.Finish          = parseMoment(ui.TxtFinish.Text);
        values.Duration        = mspdiDuration(duration.minutes);
        values.DurationFormat  = duration.format;
        values.Type            = Math.max(ui.CmbTaskType.Index, 0);
        values.CalendarUID     = ui.workCalChoices[ui.CmbTaskCalendar.Index] !== undefined
                               ? ui.workCalChoices[ui.CmbTaskCalendar.Index] : -1;
        values.Milestone       = ui.ChkMilestone.Active;
        values.Manual          = ui.ChkManual.Active;
        values.EffortDriven    = ui.ChkEffortDriven.Active;
        /* Two editors for one flag: the box when it was what changed, and
         * otherwise the `?` of the duration as typed -- `2d` makes it firm. */
        values.Estimated       = ui.ChkEstimated.Active !== !!task.Estimated
                               ? ui.ChkEstimated.Active : duration.estimated;
        values.PercentComplete = Math.round(ui.SpinPercent.Value);

        /* **The three agree when Apply is done**, as a cell leaves them
         * (`typedDates`): a new start carries the finish, a new finish the
         * start -- or the duration, on a manual or a started task -- and a
         * new duration the finish from the start. The start goes first when
         * both dates moved, as the constraint below reads them, and the
         * constraint is dated at what was typed (`pinAt`). */
        const typed = (name) => values[name] !== task[name] && values[name] !== "";
        const startTyped = typed("Start"), finishTyped = typed("Finish");
        let dates = null;
        if (startTyped)
            dates = typedDates(project, task, "Start", values.Start,
                               duration.minutes, duration.format, values.Manual);
        else if (finishTyped)
            dates = typedDates(project, task, "Finish", values.Finish,
                               duration.minutes, duration.format, values.Manual);
        else if (values.Duration !== task.Duration && values.Start !== "")
            dates = typedDates(project, task, "Start", values.Start,
                               duration.minutes, duration.format, values.Manual);
        if (dates && dates.refused) {
            Message.Error(dates.refused);
            return null;
        }
        if (dates) {
            values.Start  = dates.Start;
            values.Finish = dates.Finish;
            values.Duration = mspdiDuration(dates.minutes);
            if (dates.ActualStart !== undefined) values.ActualStart = dates.ActualStart;
            /* Firm unless the box was what changed. */
            if (dates.firm && ui.ChkEstimated.Active === !!task.Estimated)
                values.Estimated = false;
            /* The percentage the stretch keeps the work done at -- unless
             * the spin was what changed. */
            if (dates.percent !== undefined &&
                values.PercentComplete === (task.PercentComplete || 0))
                values.PercentComplete = dates.percent;
        }

        /* A percentage moves the actual dates the way the cell and the
         * progress buttons move them, on the dates just typed. */
        const moved = percentValues({ Start: values.Start || task.Start,
                                      Finish: values.Finish || task.Finish,
                                      ActualStart: task.ActualStart,
                                      ActualFinish: task.ActualFinish },
                                    values.PercentComplete);
        for (const name in moved) values[name] = moved[name];

        /* ASAP and ALAP carry no date; the rest need one. */
        values.ConstraintType = Math.max(ui.CmbConstraint.Index, 0);
        values.ConstraintDate = values.ConstraintType > 1
                              ? parseMoment(ui.TxtConstraint.Text) : "";

        /* **A date changed here is a constraint**, the same as one typed into
         * a cell: with the picker untouched, a new start leaves a Start No
         * Earlier Than and a new finish a Finish No Earlier Than, so the pass
         * does not undo what the hand wrote -- on an automatic task only. A type picked in the command --
         * even back to ASAP -- is the user's own answer and is left alone. */
        if (values.ConstraintType === (task.ConstraintType || 0) &&
            dates && dates.pin) {
            if (startTyped) {
                values.ConstraintType = CONSTRAINT_SNET;
                values.ConstraintDate = dates.pinAt;
            } else if (finishTyped) {
                values.ConstraintType = CONSTRAINT_FNET;
                values.ConstraintDate = dates.pinAt;
            }
        }
        values.Deadline       = parseMoment(ui.TxtDeadline.Text);
    }

    /* The setters validate; a bad value throws before anything is committed --
     * the same probe the panel's Apply always made. */
    try {
        const probe = new MspTask();
        for (const name in values) probe[name] = values[name];
    } catch (e) {
        Message.Error("Cannot apply: {0}", e.message);
        return null;
    }
    return values;
}

export class TaskForm extends Form {

    /* `onAccept` gets the values, the link list and the assignment orders,
     * already staged; the caller writes them with its own command, so the
     * dialog does not know about the history. */
    static open(project, task, unit, onAccept) {
        const dlg = new TaskForm();

        dlg.project  = project;
        dlg.task     = task;
        dlg.unit     = unit;
        dlg.onAccept = onAccept;
        dlg.Modal    = true;

        /* **Las dos pestañas nuevas editan copias**: los vínculos, la lista de
         * la tarea para cambiarla entera; las asignaciones, las del plan más
         * las órdenes que se vayan haciendo. */
        dlg.links     = task.Links.map((l) =>
                            new MspLink(JSON.parse(JSON.stringify(l))));
        dlg.assignOps = [];

        const res = resourceNames(project);
        dlg.resChoices = res.choices;
        dlg.CmbAssignRes.Items = res.items;
        dlg.CmbAssignRes.Index = res.items.length ? 0 : -1;

        fillTaskForm(dlg, task, project);
        fillFormLinks(dlg, task, project);
        fillFormAssignments(dlg, task, project);
        dlg.Show();
        dlg.TxtName.SetFocus();
        return dlg;
    }

    TxtLinkAddress_Change() { updateLinkUri(this); }
    CmbAttr_Select()        { selectTaskAttr(this, this.task, this.project); }
    CmbAttrValue_Select()   { selectTaskAttrValue(this); }

    /* La fila elegida trae sus valores a los campos, y Unlink la saca de la
     * copia: nada se escribe hasta el Aceptar. */
    Links_Select() {
        const link = this.Links.Index >= 0 ? this.linkRows[this.Links.Index] : null;
        this.BtnLinkDel.Enabled = !!link;
        if (!link) return;
        const at = this.predChoices.indexOf(link.PredecessorUID);
        this.CmbPred.Index = Math.max(at, 0);
        this.CmbType.Index = LINK_INDEX[linkKind(link)];
        this.SpinLag.Value = (link.LinkLag || 0) / 10;
    }

    /* Link agrega o actualiza la predecesora elegida -- una por par, como el
     * panel -- sobre la copia. */
    BtnLinkAdd_Click() {
        const at = this.CmbPred.Index;
        const predUID = at >= 0 ? this.predChoices[at] : null;
        if (predUID === null || predUID === undefined) {
            Message.Warning("Pick a predecessor first.");
            return;
        }
        const old = this.links.find((l) => l.PredecessorUID === predUID);
        this.links = this.links.filter((l) => l.PredecessorUID !== predUID);
        this.links.push(new MspLink({
            PredecessorUID: predUID,
            Type: this.CmbType.Index >= 0 ? LINK_ORDER[this.CmbType.Index] : 1,
            LinkLag: Math.round(this.SpinLag.Value * 10),
            LagFormat: old && old.LagFormat ? old.LagFormat : 3,
        }));
        fillFormLinks(this, this.task, this.project);
    }

    BtnLinkDel_Click() {
        const link = this.Links.Index >= 0 ? this.linkRows[this.Links.Index] : null;
        if (!link) return;
        this.links = this.links.filter((l) => l.PredecessorUID !== link.PredecessorUID);
        fillFormLinks(this, this.task, this.project);
    }

    Assignments_Select() { selectFormAssignment(this); }

    BtnAssignAdd_Click() {
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
        this.assignOps.push({ add: { ResourceUID: resourceUID, Units: units } });
        fillFormAssignments(this, this.task, this.project);
    }

    /* El presupuesto, de la asignación elegida: una pendiente todavía no
     * existe y no se presupuesta. */
    BtnAssignApply_Click() {
        const row = this.Assignments.Index >= 0
                  ? this.assignRows[this.Assignments.Index] : null;
        if (!row || !row.assignment) return;

        const budget = resourceNumber(this.TxtAssignBudget.Text);
        if (isNaN(budget) || budget < 0) {
            Message.Error("The budget must be a number, or nothing.");
            return;
        }
        this.assignOps.push({ budget: { UID: row.assignment.UID, Cost: budget } });
        fillFormAssignments(this, this.task, this.project);
    }

    BtnAssignDel_Click() {
        const row = this.Assignments.Index >= 0
                  ? this.assignRows[this.Assignments.Index] : null;
        if (!row) return;
        if (row.pending)
            this.assignOps = this.assignOps.filter((op) => op !== row.pending);
        else
            this.assignOps.push({ remove: row.assignment.UID });
        fillFormAssignments(this, this.task, this.project);
    }

    BtnOk_Click() {
        const values = taskFormValues(this, this.task, this.project, this.unit);
        if (!values) return;

        this.Close();
        if (this.onAccept) this.onAccept(values, this.links, this.assignOps);
    }

    BtnCancel_Click() { this.Close(); }
}
