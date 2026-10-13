/*
 * A constraint's two halves -- the type and, for the six that need one, the
 * date -- in one dialog, which is what the grid's `Custom` cell opens: one
 * cell cannot hold both, and this is where Project asks too.
 *
 * The list is passed in (the panel's own items, so the two cannot disagree),
 * and `clean` is the caller's check: it answers the sentence to say, or "" to
 * let it close -- so what a constraint of that type means stays in the
 * application, and this dialog only asks.
 */
"use strict";

export class ConstraintForm extends Form {

    static open(names, type, dateText, onAccept, clean) {
        const dlg = new ConstraintForm();

        dlg.onAccept = onAccept;
        dlg.clean    = clean;
        dlg.Modal    = true;
        dlg.CmbType.Items = names;
        dlg.CmbType.Index = type >= 0 && type < names.length ? type : 0;
        dlg.TxtDate.Text  = dateText || "";
        dlg.CmbType_Select();
        dlg.Show();
        return dlg;
    }

    /* Only a type that pins or bounds a date has one to type: `ASAP` and
     * `ALAP` take none, and everything from `Must start on` up does. */
    CmbType_Select() { this.TxtDate.Enabled = this.CmbType.Index > 1; }

    BtnOk_Click() {
        const type = Math.max(this.CmbType.Index, 0);
        const text = type > 1 ? this.TxtDate.Text : "";
        const problem = this.clean ? this.clean(type, text) : "";

        if (problem) {
            Message.Error(problem);
            return;                       /* the dialog stays where it is */
        }
        this.Close();
        if (this.onAccept) this.onAccept(type, text);
    }

    BtnCancel_Click() { this.Close(); }
}
