/*
 * The one dialog that edits the keys the code reads -- no second spelling of a
 * default, in code or in a form: what it writes is what `MainForm` reads, on
 * the next run and on the way out of this one.
 */
"use strict";

/* The unit a bare duration is read in, in the combo's order. Empty is the
 * task's own `DurationFormat`. */
const UNIT_KEYS = ["", "m", "h", "d", "w", "mo"];

/* The global report logo. `ReportForm` remembers a project's own choice
 * under another key; this is the one every report without an override uses. */
const REPORT_LOGO_KEY = "bintana-project.report.logo";

export class SettingsForm extends Form {

    static open(onSaved) {
        const dlg = new SettingsForm();

        dlg.onSaved = onSaved;
        dlg.Modal   = true;

        dlg.TxtFolder.Text = Settings.Get("bintana-project.folder", "");
        dlg.CmbScale.Index = Number(Settings.Get("bintana-project.timescale", 0)) || 0;

        const unit = UNIT_KEYS.indexOf(Settings.Get("bintana-project.unit", ""));
        dlg.CmbUnit.Index = unit >= 0 ? unit : 0;

        dlg.ChkAutorecalc.Active = Settings.Get("bintana-project.autorecalc", true);
        dlg.ChkNewManual.Active  = Settings.Get("bintana-project.newmanual", false);
        dlg.ChkAutosave.Active   = Settings.Get("bintana-project.autosave", true);
        dlg.TxtLogo.Text         = Settings.Get(REPORT_LOGO_KEY, "");

        dlg.Show();
        dlg.BtnSave.SetFocus();
        return dlg;
    }

    BtnLogo_Click() {
        Dialog.OpenFile(Locale.Text("Choose a logo"),
            { Folder: Environment.HomeDirectory,
              Filters: [[Locale.Text("Images"),
                         "*.png *.jpg *.jpeg *.webp *.bmp *.tif *.tiff"],
                        [Locale.Text("All files"), "*"]] },
            (path) => {
                try {
                    const size = Probe.Image(path);
                    if (!size || !(size.Width > 0) || !(size.Height > 0))
                        throw new Error(Locale.Text("that file is not an image"));
                    this.TxtLogo.Text = path;
                } catch (e) {
                    Message.Error("Cannot use {0} as a logo: {1}", path, e.message);
                }
            });
    }

    BtnSave_Click() {
        Settings.Set("bintana-project.folder", trim(this.TxtFolder.Text));
        Settings.Set("bintana-project.timescale", this.CmbScale.Index);
        Settings.Set("bintana-project.unit", UNIT_KEYS[this.CmbUnit.Index] || "");
        Settings.Set("bintana-project.autorecalc", this.ChkAutorecalc.Active);
        Settings.Set("bintana-project.newmanual", this.ChkNewManual.Active);
        Settings.Set("bintana-project.autosave", this.ChkAutosave.Active);
        Settings.Set(REPORT_LOGO_KEY, trim(this.TxtLogo.Text));
        if (this.onSaved) this.onSaved();
        this.Close();
    }

    BtnCancel_Click() { this.Close(); }
}

/* `String.prototype.trim` is not part of the curated language. */
export function trim(text) {
    return String(text || "").replace(/^\s+|\s+$/g, "");
}
