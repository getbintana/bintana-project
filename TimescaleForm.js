/*
 * The timescale, as Project's dialog of that name has it: one tier or two,
 * and for each what unit it steps by, what its labels say, every how many and
 * where in the cell. **The labels are offered by example** -- "L, M, X…",
 * "Lun 24", "Sem 35" -- because the one a reader wants is recognised and not
 * named: nobody asks for "the initial of the weekday", they point at it.
 *
 * It is part of the chart's format (Gantt.js, `GANTT_FORMAT`), so it is
 * remembered with it and a printed chart wears it too. Each change is drawn on
 * the chart as it is made; Cancel, Escape or closing the window put back what
 * there was.
 */
"use strict";

/* The tiers, by the prefix their controls and their format keys share. */
const TIERS = [{ key: "top", ctl: "Top" }, { key: "bottom", ctl: "Bottom" }];

/* The day the examples are written for: today, so the samples are this week's
 * and this month's. */
function sampleDay() {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/* What the label combo says for one choice: the label as it would be drawn --
 * three cells' worth for a day, whose spellings are told apart by the run of
 * them ("L, M, X…" against "24, 25, 26…") -- and "Automatic" for the ruler's
 * own choice. */
function labelExample(id, d) {
    if (id === "auto") return Locale.Text("Automatic");
    if (id.startsWith("day")) {
        const run = [0, 1, 2].map((k) =>
            timescaleText(id, new Date(d.getFullYear(), d.getMonth(), d.getDate() + k)));
        return `${run.join(", ")}…`;
    }
    return timescaleText(id, d);
}

export class TimescaleForm extends Form {

    /*
     * TimescaleForm.open(current, onSaved, onPreview)
     *
     * `current` is the chart's whole format; what comes back is the same with
     * the timescale changed. `onPreview` is handed every change as it is made,
     * and the format it started from when the dialog is let go without OK.
     */
    static open(current, onSaved, onPreview) {
        const dlg = new TimescaleForm();
        dlg.before    = ganttFormat(current);
        dlg.onSaved   = onSaved;
        dlg.onPreview = onPreview;
        dlg.saved     = false;
        dlg.Modal     = true;

        dlg.ready = false;
        dlg.sample = sampleDay();
        dlg.CmbTiers.Index = dlg.before.tiers === 1 ? 0 : 1;
        for (const tier of TIERS) {
            const unit = dlg.before[`${tier.key}Unit`];
            dlg[`Cmb${tier.ctl}Unit`].Index  = Math.max(0, TIMESCALE_UNITS.indexOf(unit));
            dlg.labels(tier, unit, dlg.before[`${tier.key}Label`]);
            dlg[`Spn${tier.ctl}Count`].Value = dlg.before[`${tier.key}Count`];
            dlg[`Cmb${tier.ctl}Align`].Index = dlg.before[`${tier.key}Align`] === "center" ? 1 : 0;
        }
        dlg.ready = true;
        dlg.enable();

        dlg.Show();
        return dlg;
    }

    /* The label combo of a tier, filled with the examples of its unit and set
     * to `id`. A unit left to the ruler has only "Automatic", and no count. */
    labels(tier, unit, id) {
        const ids   = TIMESCALE_LABELS[unit] || ["auto"];
        const combo = this[`Cmb${tier.ctl}Label`];
        combo.Items = ids.map((k) => labelExample(k, this.sample));
        combo.Index = Math.max(0, ids.indexOf(id));
    }

    /* What can be chosen: a tier's label and count only for a unit of its
     * own, and the bottom tier only when there are two. */
    enable() {
        const two = this.CmbTiers.Index === 1;
        for (const tier of TIERS) {
            const on   = tier.key === "top" || two;
            const unit = TIMESCALE_UNITS[this[`Cmb${tier.ctl}Unit`].Index] || "auto";
            for (const name of ["Unit", "Align"])
                this[`Cmb${tier.ctl}${name}`].Enabled = on;
            this[`Cmb${tier.ctl}Label`].Enabled = on && unit !== "auto";
            this[`Spn${tier.ctl}Count`].Enabled = on && unit !== "auto";
        }
    }

    /* What the fields say, over the format the chart had. */
    values() {
        const fmt = { ...this.before, tiers: this.CmbTiers.Index === 0 ? 1 : 2 };
        for (const tier of TIERS) {
            const unit = TIMESCALE_UNITS[this[`Cmb${tier.ctl}Unit`].Index] || "auto";
            fmt[`${tier.key}Unit`]  = unit;
            fmt[`${tier.key}Label`] = (TIMESCALE_LABELS[unit] || ["auto"])
                                          [this[`Cmb${tier.ctl}Label`].Index] || "auto";
            fmt[`${tier.key}Count`] = Number(this[`Spn${tier.ctl}Count`].Value || 1);
            fmt[`${tier.key}Align`] = this[`Cmb${tier.ctl}Align`].Index === 1 ? "center" : "left";
        }
        return ganttFormat(fmt);
    }

    /* Every change is seen on the chart at once. */
    changed() {
        if (!this.ready) return;
        this.enable();
        if (this.onPreview) this.onPreview(this.values());
    }

    /* A new unit starts on its automatic label: the old one is another unit's. */
    unitChanged(tier) {
        if (!this.ready) return;
        const unit = TIMESCALE_UNITS[this[`Cmb${tier.ctl}Unit`].Index] || "auto";
        this.ready = false;
        this.labels(tier, unit, "auto");
        this.ready = true;
        this.changed();
    }

    CmbTiers_Select()       { this.changed(); }
    CmbTopUnit_Select()     { this.unitChanged(TIERS[0]); }
    CmbTopLabel_Select()    { this.changed(); }
    SpnTopCount_Change()    { this.changed(); }
    CmbTopAlign_Select()    { this.changed(); }
    CmbBottomUnit_Select()  { this.unitChanged(TIERS[1]); }
    CmbBottomLabel_Select() { this.changed(); }
    SpnBottomCount_Change() { this.changed(); }
    CmbBottomAlign_Select() { this.changed(); }

    BtnSave_Click() {
        const fmt = this.values();
        for (const key of TIMESCALE_KEYS) Settings.Set(FORMAT_KEY + key, fmt[key]);
        this.saved = true;
        this.Close();
        if (this.onSaved) this.onSaved(fmt);
    }

    BtnCancel_Click() { this.Close(); }

    /* Cancel, Escape or the window's own close: the chart goes back to what it
     * was before the dialog tried anything on it. */
    Form_Close() {
        if (!this.saved && this.onPreview) {
            const back = this.onPreview;
            this.onPreview = null;
            back(this.before);
        }
    }
}
