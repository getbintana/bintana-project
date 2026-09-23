/*
 * One resource's rate tables, whole: the dated periods Project keeps, each
 * with its table and its numbers. The dialog edits its own copy and hands the
 * list to `Edit.setResourceRates` on OK -- cancelling answers nothing, the
 * way `ConfirmForm` does.
 *
 * The fields add a row and update the one picked, like the calendar's
 * exceptions. The rate *formats* (hour, day, month) belong to the file and
 * this dialog does not edit them: a row that arrives keeps its own, and a new
 * one starts in hours, which is what the cost makes of a number.
 */
"use strict";

class RatesForm extends Form {

    static open(resource, onSaved) {
        const dlg = new RatesForm();

        dlg.uid     = resource.UID;
        dlg.onSaved = onSaved;
        dlg.Modal   = true;
        dlg.LblRatesTitle.Text = Locale.Text("Rates of {0}", resource.Name);
        dlg.rows = resource.Rates.slice();
        dlg.fill();
        dlg.Show();
        return dlg;
    }

    fill() {
        this.RatesList.Clear();
        for (const rate of this.rows) {
            const table = "ABCDE".charAt(Math.min(Math.max(rate.RateTable || 0, 0), 4));
            this.RatesList.Add([
                shortDate(rate.RatesFrom),
                shortDate(rate.RatesTo),
                table,
                Locale.Number(rate.StandardRate, 2),
                Locale.Number(rate.OvertimeRate, 2),
                Locale.Number(rate.CostPerUse, 2),
            ]);
        }
        this.BtnRateDel.Enabled = false;
    }

    RatesList_Select() {
        const rate = this.RatesList.Index >= 0 ? this.rows[this.RatesList.Index] : null;
        this.BtnRateDel.Enabled = !!rate;
        if (!rate) return;

        this.TxtRateFrom.Text    = shortDate(rate.RatesFrom);
        this.TxtRateTo.Text      = shortDate(rate.RatesTo);
        this.CmbRateTable.Index  = Math.min(Math.max(rate.RateTable || 0, 0), 4);
        this.TxtRateStandard.Text = String(rate.StandardRate || 0);
        this.TxtRateOvertime.Text = String(rate.OvertimeRate || 0);
        this.TxtRateCostUse.Text  = String(rate.CostPerUse || 0);
    }

    /* Add, or update the one picked -- the fields are the editor for both. */
    BtnRateAdd_Click() {
        const from = parseMoment(this.TxtRateFrom.Text);
        if (from === "") {
            Message.Error(Locale.Text("A rate period needs a date."));
            return;
        }
        const to = parseMoment(this.TxtRateTo.Text) || from;
        const standard = resourceNumber(this.TxtRateStandard.Text);
        const overtime = resourceNumber(this.TxtRateOvertime.Text);
        const cost = resourceNumber(this.TxtRateCostUse.Text);
        if (isNaN(standard) || isNaN(overtime) || isNaN(cost)) {
            Message.Error(Locale.Text("The rates must be numbers."));
            return;
        }

        const was = this.RatesList.Index >= 0 ? this.rows[this.RatesList.Index] : null;
        let rate;
        try {
            rate = new MspRate({
                RatesFrom:          from,
                RatesTo:            to,
                RateTable:          Math.max(this.CmbRateTable.Index, 0),
                StandardRate:       standard,
                StandardRateFormat: was ? was.StandardRateFormat : 2,
                OvertimeRate:       overtime,
                OvertimeRateFormat: was ? was.OvertimeRateFormat : 2,
                CostPerUse:         cost,
            });
        } catch (e) {
            Message.Error("Cannot apply: {0}", e.message);
            return;
        }

        if (was) this.rows[this.RatesList.Index] = rate;
        else     this.rows.push(rate);
        this.fill();
    }

    BtnRateDel_Click() {
        if (this.RatesList.Index < 0) return;
        this.rows.splice(this.RatesList.Index, 1);
        this.fill();
    }

    BtnOk_Click() {
        this.Close();
        if (this.onSaved) this.onSaved(this.rows);
    }

    BtnCancel_Click() { this.Close(); }
}
