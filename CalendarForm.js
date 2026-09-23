/*
 * One calendar, whole: its name, the working times of each week day and its
 * exceptions. The dialog edits its own copy and hands it to `Edit.setCalendar`
 * on OK -- cancelling answers nothing, the way `ConfirmForm` does.
 *
 * A day's times are one field of prose, "08:00-12:00 13:00-17:00", because a
 * day may have more than one span and the alternative is a grid of rows per
 * span. An exception that is working keeps whatever times it had: the editor
 * changes its dates, its name and whether it works at all.
 */
"use strict";

class CalendarForm extends Form {

    static open(calendar, onSaved) {
        const dlg = new CalendarForm();

        dlg.uid     = calendar.UID;
        dlg.onSaved = onSaved;
        dlg.Modal   = true;
        dlg.TxtName.Text = calendar.Name;

        dlg.week = [];
        for (let day = 1; day <= 7; day++) {
            let found = null;
            for (const wd of calendar.WeekDays)
                if (wd.DayType === day) { found = wd; break; }

            dlg["ChkDay" + day].Active = found ? found.DayWorking : false;
            dlg["TxtDay" + day].Text = found && found.DayWorking
                                     ? spansText(found.WorkingTimes) : "";
            dlg.week.push({ day });
        }

        dlg.excRows = calendar.Exceptions.slice();
        dlg.fillExc();
        dlg.Show();
        dlg.TxtName.SetFocus();
        return dlg;
    }

    fillExc() {
        this.Exc.Clear();
        for (const ex of this.excRows) {
            const period = ex.TimePeriod;
            this.Exc.Add([
                shortDate(period ? period.FromDate : ""),
                shortDate(period ? period.ToDate : ""),
                ex.Name || "",
                ex.DayWorking ? Locale.Text("Working") : Locale.Text("Holiday"),
            ]);
        }
        this.BtnExcDel.Enabled = false;
    }

    Exc_Select() {
        const ex = this.Exc.Index >= 0 ? this.excRows[this.Exc.Index] : null;
        this.BtnExcDel.Enabled = !!ex;
        if (!ex) return;

        const period = ex.TimePeriod;
        this.TxtExcFrom.Text    = shortDate(period ? period.FromDate : "");
        this.TxtExcTo.Text      = shortDate(period ? period.ToDate : "");
        this.TxtExcName.Text    = ex.Name || "";
        this.ChkExcWorking.Active = !!ex.DayWorking;
    }

    /* Add, or update the one picked -- the fields are the editor for both. */
    BtnExcAdd_Click() {
        const from = parseMoment(this.TxtExcFrom.Text);
        if (from === "") {
            Message.Error(Locale.Text("An exception needs a date."));
            return;
        }
        const to = parseMoment(this.TxtExcTo.Text) || from;

        const ex = new MspException({
            TimePeriod: new MspTimePeriod({ FromDate: from, ToDate: to }),
            Name:       this.TxtExcName.Text,
            Type:       1,
            DayWorking: this.ChkExcWorking.Active,
        });
        /* The times of a working exception are what the file wrote, and this
         * dialog does not edit them. */
        const was = this.Exc.Index >= 0 ? this.excRows[this.Exc.Index] : null;
        if (was && was.WorkingTimes.length) ex.WorkingTimes = was.WorkingTimes;

        if (this.Exc.Index >= 0) this.excRows[this.Exc.Index] = ex;
        else this.excRows.push(ex);
        this.fillExc();
    }

    BtnExcDel_Click() {
        if (this.Exc.Index < 0) return;
        this.excRows.splice(this.Exc.Index, 1);
        this.fillExc();
    }

    BtnOk_Click() {
        const week = [];
        for (const row of this.week) {
            const working = this["ChkDay" + row.day].Active;
            week.push(new MspWeekDay({
                DayType:      row.day,
                DayWorking:   working,
                WorkingTimes: working ? parseSpans(this["TxtDay" + row.day].Text) : [],
            }));
        }
        this.Close();
        if (this.onSaved)
            this.onSaved({ Name: this.TxtName.Text, WeekDays: week,
                           Exceptions: this.excRows });
    }

    BtnCancel_Click() { this.Close(); }
}

/* "08:00-12:00 13:00-17:00" as `WorkingTime` records; what does not parse is
 * not a span and is left out. */
function parseSpans(text) {
    const out = [];
    for (const piece of String(text || "").split(/[\s,]+/)) {
        const m = /^(\d{1,2}:\d{2}(?::\d{2})?)-(\d{1,2}:\d{2}(?::\d{2})?)$/.exec(piece);
        if (m) out.push(new MspWorkingTime({ FromTime: m[1], ToTime: m[2] }));
    }
    return out;
}

function spansText(times) {
    const parts = [];
    for (const wt of times) parts.push(`${wt.FromTime}-${wt.ToTime}`);
    return parts.join(" ");
}
