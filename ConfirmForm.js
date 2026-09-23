/*
 * A yes/no confirmation, after the IDE's: a Bintana form, not a runtime
 * primitive. It only calls the callback if the user confirms, so cancelling
 * answers nothing.
 *
 * `other` is the third answer for the questions where "no" is two different
 * things -- closing with unsaved work is *discard* or *save*, and only one of
 * those is the cancel button:
 *
 *   ConfirmForm.ask("Unsaved changes", "Save before closing?", "Discard",
 *                   () => close(), { Text: "Save", Run: () => save() });
 */
"use strict";

class ConfirmForm extends Form {

    static ask(title, message, acceptText, onConfirm, other, acceptStyle) {
        const dlg = new ConfirmForm();

        dlg.Text             = title;
        dlg.LblMessage.Text  = message;
        dlg.BtnYes.Text      = acceptText || Locale.Text("OK");
        dlg.onConfirm        = onConfirm;
        dlg.Modal            = true;

        /* The form's own accept is the dangerous one -- Delete, Discard -- and
         * a caller whose yes is safe says so. */
        if (acceptStyle) dlg.BtnYes.Style = acceptStyle;

        if (other) {
            dlg.BtnOther.Text    = other.Text;
            dlg.BtnOther.Visible = true;
            dlg.onOther          = other.Run;
        }

        dlg.Show();

        /* `BtnNo` is focused and nothing is `Default`: Enter must not be able
         * to delete something or throw work away by accident. */
        dlg.BtnNo.SetFocus();
        return dlg;
    }

    dismiss() { this.Close(); }

    BtnYes_Click() {
        this.dismiss();
        if (this.onConfirm) this.onConfirm();
    }

    BtnNo_Click() { this.dismiss(); }

    BtnOther_Click() {
        this.dismiss();
        if (this.onOther) this.onOther();
    }
}
