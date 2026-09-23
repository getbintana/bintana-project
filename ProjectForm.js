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
    for (const prop in tables.COMBO) {
        const [control, choices] = tables.COMBO[prop];
        dlg[control].Index = choices.indexOf(project[prop]);
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
        values[prop] = at >= 0 ? choices[at] : project[prop];
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

    static open(project, onSaved) {
        const dlg = new ProjectForm();

        dlg.project = project;
        dlg.onSaved = onSaved;
        dlg.Modal   = true;

        fillProjectForm(dlg, project, ProjectForm);

        /* The three the file owns, shown and never written. */
        dlg.TxtProjCreation.Text = shortDate(project.CreationDate);
        dlg.TxtProjSaved.Text    = shortDate(project.LastSaved);
        dlg.TxtProjFinish.Text   = shortDate(project.FinishDate);

        dlg.Show();
        dlg.TxtProjName.SetFocus();
        return dlg;
    }

    BtnOk_Click() {
        const project = this.project;
        const values  = projectFormValues(this, project, ProjectForm);
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
