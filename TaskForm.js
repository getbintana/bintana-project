/*
 * A task's fields in their own dialog, which is the door Project opens with a
 * double click: the two pages of the side panel that edit the selected record
 * -- Task and Advanced -- over the window, with OK writing them as one command
 * and Cancel changing nothing. Links and assignments stay in the panel for
 * now.
 *
 * **The controls carry the panel's own names**, so the fill and the read are
 * the same functions for both: `fillTaskForm` and `taskFormValues` are given
 * whichever of the two is on screen, and the two doors cannot diverge in what
 * a field means or in what a bad value refuses.
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
        values.Estimated       = ui.ChkEstimated.Active;
        values.PercentComplete = Math.round(ui.SpinPercent.Value);

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
        values.ConstraintType = Math.max(ui.CmbConstraint.Index, 0);
        values.ConstraintDate = values.ConstraintType > 1
                              ? parseMoment(ui.TxtConstraint.Text) : "";

        /* **A date changed here is a constraint**, the same as one typed into
         * a cell: with the picker untouched, a new start leaves a Start No
         * Earlier Than and a new finish a Finish No Earlier Than, so the pass
         * does not undo what the hand wrote. A type picked in the command --
         * even back to ASAP -- is the user's own answer and is left alone. */
        if (values.ConstraintType === (task.ConstraintType || 0)) {
            if (values.Start !== task.Start && values.Start !== "") {
                values.ConstraintType = CONSTRAINT_SNET;
                values.ConstraintDate = values.Start;
            } else if (values.Finish !== task.Finish && values.Finish !== "") {
                values.ConstraintType = CONSTRAINT_FNET;
                values.ConstraintDate = values.Finish;
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

    /* `onAccept` gets the values, already validated; the caller writes them
     * with its own command, so the dialog does not know about the history. */
    static open(project, task, unit, onAccept) {
        const dlg = new TaskForm();

        dlg.project  = project;
        dlg.task     = task;
        dlg.unit     = unit;
        dlg.onAccept = onAccept;
        dlg.Modal    = true;

        fillTaskForm(dlg, task, project);
        dlg.Show();
        dlg.TxtName.SetFocus();
        return dlg;
    }

    TxtLinkAddress_Change() { updateLinkUri(this); }
    CmbAttr_Select()        { selectTaskAttr(this, this.task, this.project); }
    CmbAttrValue_Select()   { selectTaskAttrValue(this); }

    BtnOk_Click() {
        const values = taskFormValues(this, this.task, this.project, this.unit);
        if (!values) return;

        this.Close();
        if (this.onAccept) this.onAccept(values);
    }

    BtnCancel_Click() { this.Close(); }
}
