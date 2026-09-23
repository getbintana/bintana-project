/*
 * The calendars, administered: the list and the three things one does to it
 * -- new (a copy of the picked one), edit and delete. It is not an editor of
 * its own: each of those calls back into the application, which runs the
 * command through `Edit` and opens `CalendarForm` for the one being edited.
 * That is why the dialog is opened from the menu and not from the panel: the
 * panel assigns a calendar to a task, a resource or the plan, and this is
 * where the calendars themselves come from.
 *
 * Deleting the plan's own calendar is refused here: everything runs on it.
 */
"use strict";

class CalendarsForm extends Form {

    static open(project, actions) {
        const dlg = new CalendarsForm();

        dlg.project = project;
        dlg.actions = actions;
        dlg.Modal   = true;
        dlg.fill();
        dlg.Show();
        return dlg;
    }

    fill() {
        this.CalendarList.Clear();
        this.rows = this.project.Calendars.slice();
        for (const calendar of this.rows) {
            const base = calendar.BaseCalendarUID
                       ? (this.calendar(calendar.BaseCalendarUID) || {}).Name || ""
                       : "";
            this.CalendarList.Add([calendar.Name, base]);
        }
        this.CalendarList_Select();
    }

    calendar(uid) {
        for (const calendar of this.project.Calendars)
            if (calendar.UID === uid) return calendar;
        return null;
    }

    CalendarList_Select() {
        const picked = this.CalendarList.Index >= 0;
        this.BtnCalEdit.Enabled = picked;
        this.BtnCalDel.Enabled  = picked;
    }

    /* A copy of the picked calendar -- or of the plan's own when nothing is
     * picked -- opened right away so it gets a name. */
    BtnCalNew_Click() {
        const source = this.CalendarList.Index >= 0
                     ? this.rows[this.CalendarList.Index].UID
                     : this.project.CalendarUID;
        const uid = this.actions.add(source);
        this.fill();
        const at = this.rows.findIndex((c) => c.UID === uid);
        if (at >= 0) {
            this.CalendarList.Select(at);
            this.CalendarList_Select();
        }
        this.actions.edit(uid, () => this.fill());
    }

    BtnCalEdit_Click() {
        if (this.CalendarList.Index < 0) return;
        this.actions.edit(this.rows[this.CalendarList.Index].UID,
                          () => this.fill());
    }

    BtnCalDel_Click() {
        if (this.CalendarList.Index < 0) return;
        const calendar = this.rows[this.CalendarList.Index];
        if (calendar.UID === this.project.CalendarUID) {
            Message.Warning(Locale.Text("The project's own calendar cannot be deleted."));
            return;
        }
        ConfirmForm.ask(Locale.Text("Delete calendar"),
            Locale.Text('Delete "{0}"?', calendar.Name),
            Locale.Text("Delete"), () => {
                this.actions.remove(calendar.UID);
                this.fill();
            });
    }

    BtnClose_Click() { this.Close(); }
}
