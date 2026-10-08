/*
 * The plan's custom fields, administered: the list of the ones the file
 * defines and the three things one does to it -- new, edit and delete -- plus
 * which of them the table shows. **More than one can be shown at a time**:
 * each ticked field is a column of its own.
 *
 * That last choice is a view, like the columns, and it takes effect at once
 * and is remembered with them; the definitions are the file's, and each of
 * those is a command through `Edit` with its own undo. The dialog is opened
 * from the project's data, and not from Settings: the fields belong to the
 * plan, not to the application.
 */
"use strict";

class FieldsForm extends Form {

    static open(project, actions) {
        const dlg = new FieldsForm();

        dlg.project = project;
        dlg.actions = actions;
        dlg.Modal   = true;
        dlg.fill();
        dlg.Show();
        return dlg;
    }

    /* The list, with the chosen row kept when it still exists -- and the first
     * one chosen when the dialog opens. **The tick is set while `filling` is
     * on**: a `CheckButton` raises `Click` on an assignment too, and without
     * the flag a fill would answer as if the user had clicked. */
    fill(keepID) {
        this.filling = true;
        this.FieldList.Clear();
        this.rows = this.project.FieldDefs.slice();
        for (const def of this.rows)
            this.FieldList.Add([fieldLabel(def), def.FieldID,
                                def.ValueList && def.ValueList.length ? "✓" : "",
                                this.actions.shown(def.FieldID) ? "✓" : ""]);

        let at = this.rows.findIndex((d) => d.FieldID === keepID);
        if (at < 0 && keepID === undefined) at = this.rows.length ? 0 : -1;
        this.FieldList.Index = at;
        this.filling = false;
        this.FieldList_Select();
    }

    FieldList_Select() {
        const field = this.FieldList.Index >= 0
                    ? this.rows[this.FieldList.Index] : null;
        this.selected = field;
        this.BtnFieldEdit.Enabled = !!field;
        this.BtnFieldDel.Enabled  = !!field;
        this.ChkShown.Enabled     = !!field;

        this.filling = true;
        this.ChkShown.Active = field ? this.actions.shown(field.FieldID) : false;
        this.filling = false;
    }

    /* Showing a field in the table is the same view choice the columns are:
     * it happens now, is remembered, and has nothing to undo. */
    ChkShown_Click() {
        if (this.filling || !this.selected) return;
        const fieldID = this.selected.FieldID;
        this.actions.show(fieldID, this.ChkShown.Active);
        this.fill(fieldID);
    }

    BtnFieldNew_Click() {
        FieldForm.open(null, this.project.FieldDefs, (values) => {
            this.actions.set(values);
            this.fill(values.FieldID);
        });
    }

    BtnFieldEdit_Click() {
        const field = this.selected;
        if (!field) return;
        FieldForm.open(field, this.project.FieldDefs, (values) => {
            this.actions.set(values);
            this.fill(field.FieldID);
        });
    }

    BtnFieldDel_Click() {
        const field = this.selected;
        if (!field) return;
        ConfirmForm.ask(Locale.Text("Delete custom field"),
            Locale.Text('Delete "{0}"? Its values on the tasks go with it.',
                        fieldLabel(field)),
            Locale.Text("Delete"), () => {
                this.actions.remove(field.FieldID);
                this.fill();
            });
    }

    BtnClose_Click() { this.Close(); }
}
