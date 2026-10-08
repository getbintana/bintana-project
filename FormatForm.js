/*
 * How the chart looks, and what it says beside each bar: the colours, the one
 * field written to the right of the bar, the bar's size and what is drawn at
 * all -- critical colouring, progress, dependencies, today's line. It is a view
 * setting, like the columns and the timescale: it is remembered, it does not
 * touch the file, and a chart exported to a file wears it too.
 *
 * The dialog only reads and writes the keys; the window reads them back.
 */
"use strict";

/* The label's choices, in the combo's order; empty is nothing. */
const LABEL_KEYS = ["", "name", "resources", "percent", "dates", "duration",
                    "work", "cost", "wbs"];

/* Where each choice is kept. */
const FORMAT_KEY = "bintana-project.format.";

/* The chart's format as the last run left it. */
function loadFormat() {
    const fmt = {};
    fmt.theme    = Settings.Get(FORMAT_KEY + "theme", GANTT_FORMAT.theme);
    fmt.label    = Settings.Get(FORMAT_KEY + "label", GANTT_FORMAT.label);
    fmt.size     = Number(Settings.Get(FORMAT_KEY + "size", GANTT_FORMAT.size));
    fmt.critical = Settings.Get(FORMAT_KEY + "critical", GANTT_FORMAT.critical);
    fmt.progress = Settings.Get(FORMAT_KEY + "progress", GANTT_FORMAT.progress);
    fmt.links    = Settings.Get(FORMAT_KEY + "links", GANTT_FORMAT.links);
    fmt.today    = Settings.Get(FORMAT_KEY + "today", GANTT_FORMAT.today);
    return ganttFormat(fmt);
}

class FormatForm extends Form {

    static open(current, onSaved) {
        const dlg = new FormatForm();
        const fmt = ganttFormat(current);

        dlg.onSaved = onSaved;
        dlg.Modal   = true;

        dlg.CmbTheme.Index = GANTT_THEME_IDS.indexOf(fmt.theme);
        const label = LABEL_KEYS.indexOf(fmt.label);
        dlg.CmbLabel.Index = label >= 0 ? label : 0;
        dlg.CmbSize.Index  = fmt.size;
        dlg.ChkCritical.Active = fmt.critical;
        dlg.ChkProgress.Active = fmt.progress;
        dlg.ChkLinks.Active    = fmt.links;
        dlg.ChkToday.Active    = fmt.today;

        dlg.Show();
        return dlg;
    }

    /* What the fields say, whole. */
    values() {
        return ganttFormat({
            theme:    GANTT_THEME_IDS[this.CmbTheme.Index],
            label:    LABEL_KEYS[this.CmbLabel.Index] || "",
            size:     this.CmbSize.Index,
            critical: this.ChkCritical.Active,
            progress: this.ChkProgress.Active,
            links:    this.ChkLinks.Active,
            today:    this.ChkToday.Active,
        });
    }

    BtnSave_Click() {
        const fmt = this.values();
        for (const key in fmt) Settings.Set(FORMAT_KEY + key, fmt[key]);
        this.Close();
        if (this.onSaved) this.onSaved(fmt);
    }

    BtnCancel_Click() { this.Close(); }
}
