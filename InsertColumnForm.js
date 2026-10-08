/*
 * One column to put into the table, chosen from the ones it is not showing:
 * the catalog's and the plan's custom fields. The dialog only picks -- where
 * the column goes (left of the heading that was clicked) and the remembering
 * are the application's, so the choice is the same decision the column
 * checklist and the heading's menu make.
 */
"use strict";

class InsertColumnForm extends Form {

    /* `choices` is `[{ id, text }]`, already labelled. */
    static open(choices, onPicked) {
        const dlg = new InsertColumnForm();

        dlg.choices  = choices;
        dlg.onPicked = onPicked;
        dlg.Modal    = true;
        dlg.CmbColumn.Items = choices.map((c) => c.text);
        dlg.CmbColumn.Index = choices.length ? 0 : -1;
        dlg.Show();
        return dlg;
    }

    BtnOk_Click() {
        const choice = this.choices[this.CmbColumn.Index];
        this.Close();
        if (choice && this.onPicked) this.onPicked(choice.id);
    }

    BtnCancel_Click() { this.Close(); }
}
