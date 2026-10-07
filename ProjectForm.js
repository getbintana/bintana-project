/*
 * The project's identity, in its own dialog: the document's data -- Name,
 * Title, Subject, Author, Manager, Company, Category -- and what Project's
 * Project Information holds -- the start, the status date, the calendar, the
 * currency. The file's defaults and calculation switches live in
 * `OptionsForm`; the administrative flags Project writes are modelled but
 * have no dialog.
 *
 * The read-only fields (the finish, the creation date, the last save) are
 * shown and not written: Project manages them. A combo whose items do not
 * cover the value the file wrote leaves that value alone instead of forcing
 * the first item.
 */
"use strict";

/* Fill a project dialog's controls from the shape, and read them back; the
 * two dialogs differ in their tables and nothing else. */
function fillProjectForm(dlg, project, tables) {
    for (const prop in tables.TEXT)
        dlg[tables.TEXT[prop]].Text = project[prop];
    for (const prop in tables.NUMBER)
        dlg[tables.NUMBER[prop]].Text = String(project[prop]);
    for (const prop in tables.DATE)
        dlg[tables.DATE[prop]].Text = shortDate(project[prop]);
    for (const prop in tables.TIME)
        dlg[tables.TIME[prop]].Text = project[prop];
    for (const prop in tables.CHECK)
        dlg[tables.CHECK[prop]].Active = project[prop];
    /* **The items are the form's own, translated**, unless the table brings
     * labels of its own (the calendars, which are the plan's): writing the
     * codes over them showed "0/1/2" for the task type. A combo whose items do
     * not cover the value the file wrote changes nothing, which is what an
     * empty calendar list is -- but a combo cannot show nothing (`Index = -1`
     * moves nothing, and new items select the first), so the row it shows
     * instead is remembered, and only a different choice is a choice. */
    dlg.comboUnmatched = {};
    for (const prop in tables.COMBO) {
        const [control, choices, labels] = tables.COMBO[prop];
        if (labels) dlg[control].Items = labels;
        const at = choices.indexOf(project[prop]);
        dlg[control].Index = at;
        if (at < 0) dlg.comboUnmatched[prop] = dlg[control].Index;
    }
}

/* The values the dialog holds, or null when a number is not one. A combo
 * with no matching item keeps what the file wrote. */
function projectFormValues(dlg, project, tables) {
    const values = {};
    for (const prop in tables.TEXT)
        values[prop] = dlg[tables.TEXT[prop]].Text;
    for (const prop in tables.NUMBER)
        values[prop] = resourceNumber(dlg[tables.NUMBER[prop]].Text);
    for (const prop in tables.DATE)
        values[prop] = parseMoment(dlg[tables.DATE[prop]].Text);
    for (const prop in tables.TIME)
        values[prop] = dlg[tables.TIME[prop]].Text.trim();
    for (const prop in tables.CHECK)
        values[prop] = dlg[tables.CHECK[prop]].Active;
    for (const prop in tables.COMBO) {
        const [control, choices] = tables.COMBO[prop];
        const at = dlg[control].Index;
        const left = (dlg.comboUnmatched || {})[prop];
        values[prop] = at >= 0 && at !== left ? choices[at] : project[prop];
    }
    for (const prop in tables.NUMBER)
        if (isNaN(values[prop]) || values[prop] < 0) return null;
    return values;
}

class ProjectForm extends Form {

    static TEXT = {
        Name:     "TxtProjName",
        Title:    "TxtProjTitle",
        Subject:  "TxtProjSubject",
        Author:   "TxtProjAuthor",
        Manager:  "TxtProjManager",
        Company:  "TxtProjCompany",
        Category: "TxtProjCategory",
        CurrencyCode:   "TxtProjCurrencyCode",
        CurrencySymbol: "TxtProjCurrencySymbol",
    };
    static NUMBER = {
        Revision:       "TxtProjRevision",
        CurrencyDigits: "TxtProjCurrencyDigits",
    };
    static DATE = {
        StartDate:  "TxtProjStart",
        StatusDate: "TxtProjStatus",
    };
    static TIME = {};
    static CHECK = {
        ScheduleFromStart: "ChkProjFromStart",
    };
    static COMBO = {
        CurrencySymbolPosition: ["CmbProjCurrencyPosition", [0, 1, 2, 3]],
    };

    /* **The calendars are the file's own, so their items are the plan's** and
     * cannot be written down here: they are read when the dialog opens and put
     * in a copy of the map, because a static map is one for every dialog and two
     * plans open at once would fight over it. The names are what a person reads
     * and the UIDs are what the file keeps, which is why the entry carries
     * both -- the third element of a combo, and the only one that uses it. */
    static tablesFor(project) {
        const uids = [], names = [];
        for (const calendar of project.Calendars || []) {
            uids.push(calendar.UID);
            names.push(calendar.Name);
        }
        return {
            TEXT: ProjectForm.TEXT,
            NUMBER: ProjectForm.NUMBER,
            DATE: ProjectForm.DATE,
            TIME: ProjectForm.TIME,
            CHECK: ProjectForm.CHECK,
            COMBO: {
                CurrencySymbolPosition: ProjectForm.COMBO.CurrencySymbolPosition,
                CalendarUID: ["CmbProjCalendar", uids, names],
            },
        };
    }

    static open(project, onSaved) {
        const dlg = new ProjectForm();

        dlg.project = project;
        dlg.onSaved = onSaved;
        dlg.Modal   = true;

        const tables = ProjectForm.tablesFor(project);
        fillProjectForm(dlg, project, tables);
        dlg.tables = tables;

        /* The three the file owns, shown and never written, and the plan's own
         * total: **the cost is a number this app calculates**, not one the file
         * keeps, so it is written nowhere and shown beside the calendar it comes
         * from. It was in the side panel, where it took a tab of its own for a
         * line of text. */
        dlg.TxtProjCreation.Text = shortDate(project.CreationDate);
        dlg.TxtProjSaved.Text    = shortDate(project.LastSaved);
        dlg.TxtProjFinish.Text   = shortDate(project.FinishDate);
        const cost = projectCost(project);
        dlg.TxtProjTotal.Text    = cost ? Locale.Number(cost, 2) : "";

        dlg.Show();
        dlg.TxtProjName.SetFocus();
        return dlg;
    }

    BtnOk_Click() {
        const project = this.project;
        const values  = projectFormValues(this, project, this.tables);
        if (!values) {
            Message.Error(Locale.Text("The project's numbers must be numbers."));
            return;
        }
        try {
            const probe = new MspProject();
            for (const name in values) probe[name] = values[name];
        } catch (e) {
            Message.Error("Cannot apply: {0}", e.message);
            return;
        }

        this.Close();
        if (this.onSaved) this.onSaved(values);
    }

    BtnCancel_Click() { this.Close(); }
}
