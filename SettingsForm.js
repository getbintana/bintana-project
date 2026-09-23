/*
 * The one dialog that edits the keys the code reads -- no second spelling of a
 * default, in code or in a form: what it writes is what `MainForm` reads, on
 * the next run and on the way out of this one.
 */
"use strict";

/* The unit a bare duration is read in, in the combo's order. Empty is the
 * task's own `DurationFormat`. */
const UNIT_KEYS = ["", "m", "h", "d", "w", "mo"];

class SettingsForm extends Form {

    static open(onSaved) {
        const dlg = new SettingsForm();

        dlg.onSaved = onSaved;
        dlg.Modal   = true;

        dlg.TxtFolder.Text = Settings.Get("bintana-project.folder", "");
        dlg.CmbScale.Index = Number(Settings.Get("bintana-project.timescale", 0)) || 0;
        dlg.TxtField.Text  = Settings.Get("bintana-project.field", "");

        const unit = UNIT_KEYS.indexOf(Settings.Get("bintana-project.unit", ""));
        dlg.CmbUnit.Index = unit >= 0 ? unit : 0;

        dlg.ChkAutorecalc.Active = Settings.Get("bintana-project.autorecalc", false);
        dlg.ChkAutosave.Active   = Settings.Get("bintana-project.autosave", true);

        dlg.Show();
        dlg.BtnSave.SetFocus();
        return dlg;
    }

    BtnSave_Click() {
        Settings.Set("bintana-project.folder", trim(this.TxtFolder.Text));
        Settings.Set("bintana-project.timescale", this.CmbScale.Index);
        Settings.Set("bintana-project.field", trim(this.TxtField.Text));
        Settings.Set("bintana-project.unit", UNIT_KEYS[this.CmbUnit.Index] || "");
        Settings.Set("bintana-project.autorecalc", this.ChkAutorecalc.Active);
        Settings.Set("bintana-project.autosave", this.ChkAutosave.Active);
        if (this.onSaved) this.onSaved();
        this.Close();
    }

    BtnCancel_Click() { this.Close(); }
}

/* `String.prototype.trim` is not part of the curated language. */
function trim(text) {
    return String(text || "").replace(/^\s+|\s+$/g, "");
}
