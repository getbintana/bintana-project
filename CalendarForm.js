/*
 * One calendar, whole: its name, the working times of each week day and its
 * exceptions. The dialog edits its own copy and hands it to `Edit.setCalendar`
 * on OK -- cancelling answers nothing, the way `ConfirmForm` does.
 *
 * A day's times are one field of prose, "08:00-12:00 13:00-17:00", because a
 * day may have more than one span and the alternative is a grid of rows per
 * span. An exception that is working keeps whatever times it had: the editor
 * changes its dates, its name and whether it works at all -- and a new one
 * works the week's first working day, since a working exception with no
 * times is a day off.
 */
"use strict";

class CalendarForm extends Form {

    static open(project, calendar, onSaved, onCancelled) {
        const dlg = new CalendarForm();

        dlg.uid     = calendar.UID;
        dlg.onSaved = onSaved;
        dlg.onCancelled = onCancelled;
        dlg.Modal   = true;
        dlg.TxtName.Text = calendar.Name;

        /* The week the calendar *really* has, its base's included: what the
         * dialog edits and what a derived calendar would otherwise show as
         * blank. Saving writes it as the calendar's own. */
        const work = new WorkCalendar(project, calendar.UID);
        dlg.week = [];
        for (let day = 1; day <= 7; day++) {
            const spans = work.days[day] || [];
            dlg["ChkDay" + day].Active = spans.length > 0;
            dlg["TxtDay" + day].Text = spans.length
                                     ? spansText(spans.map(([from, to]) =>
                                           new MspWorkingTime({ FromTime: clockText(from),
                                                                ToTime: clockText(to) })))
                                     : "";
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
        const from = parseMoment(this.TxtExcFrom.Text, "00:00:00");
        if (from === "") {
            Message.Error("An exception needs a date.");
            return;
        }
        const to = parseMoment(this.TxtExcTo.Text, "23:59:00") ||
                   from.slice(0, 10) + "T23:59:00";
        if (to < from) {
            Message.Error("A period must end after it starts.");
            return;
        }

        /* **What the fields do not show is the exception's own**: one picked
         * keeps the recurrence it had -- its type, period, days of the week,
         * month and occurrences -- and only the dates, the name and whether it
         * is worked are what is typed. Rebuilt from the fields alone, renaming a
         * "every Monday for ten weeks" turned it into a plain range of days. A
         * new one is the daily range (type 1) the fields describe. */
        const was = this.Exc.Index >= 0 ? this.excRows[this.Exc.Index] : null;
        const kept = was ? {
            Type: was.Type, EnteredByOccurrences: was.EnteredByOccurrences,
            Occurrences: was.Occurrences, Period: was.Period,
            DaysOfWeek: was.DaysOfWeek, MonthItem: was.MonthItem,
            MonthPosition: was.MonthPosition, Month: was.Month,
            MonthDay: was.MonthDay } : { Type: 1 };

        /* A date that is not one is the record's to refuse, said as an error
         * rather than thrown at the user. */
        let ex;
        try {
            const fields = {
                TimePeriod: new MspTimePeriod({ FromDate: from, ToDate: to }),
                Name:       this.TxtExcName.Text,
                DayWorking: this.ChkExcWorking.Active,
            };
            for (const name in kept) fields[name] = kept[name];
            ex = new MspException(fields);
        } catch (e) {
            Message.Error("Cannot apply: {0}", e.message);
            return;
        }
        /* The times of a working exception are what the file wrote, and this
         * dialog does not edit them; a new one takes the week's first working
         * day. A holiday has no times. */
        if (ex.DayWorking) {
            if (was && was.WorkingTimes.length) ex.WorkingTimes = was.WorkingTimes;
            else ex.WorkingTimes = this.firstWorkingTimes();
        }

        if (this.Exc.Index >= 0) this.excRows[this.Exc.Index] = ex;
        else this.excRows.push(ex);
        this.fillExc();
    }

    firstWorkingTimes() {
        for (let day = 1; day <= 7; day++) {
            if (!this["ChkDay" + day].Active) continue;
            const spans = parseSpans(this["TxtDay" + day].Text);
            if (spans && spans.length) return spans;
        }
        return SHIFT.map(([from, to]) => new MspWorkingTime({ FromTime: from, ToTime: to }));
    }

    BtnExcDel_Click() {
        if (this.Exc.Index < 0) return;
        this.excRows.splice(this.Exc.Index, 1);
        this.fillExc();
    }

    BtnOk_Click() {
        /* A working day whose times do not read is said, not dropped: it
         * used to save as a working day of no hours, which is a day off. */
        const week = [];
        for (const row of this.week) {
            const working = this["ChkDay" + row.day].Active;
            const spans = working ? parseSpans(this["TxtDay" + row.day].Text) : [];
            if (!spans || (working && !spans.length)) {
                Message.Error(
                    "A working day's times read like 08:00-12:00 13:00-17:00.");
                this["TxtDay" + row.day].SetFocus();
                return;
            }
            week.push(new MspWeekDay({
                DayType:      row.day,
                DayWorking:   working,
                WorkingTimes: spans,
            }));
        }
        this.saved = true;
        this.Close();
        if (this.onSaved)
            this.onSaved({ Name: this.TxtName.Text, WeekDays: week,
                           Exceptions: this.excRows });
    }

    BtnCancel_Click() { this.Close(); }

    /* Cancel, Escape or the window's own close: whoever opened the dialog for
     * a calendar it had just made takes it back. */
    Form_Close() {
        if (!this.saved && this.onCancelled) {
            const cancelled = this.onCancelled;
            this.onCancelled = null;
            cancelled();
        }
    }
}

/* "08:00-12:00 13:00-17:00" as `WorkingTime` records, or null when a piece
 * is not a span: "8:00" is read as 08:00 and written the way the file spells
 * it, and an end of 24:00 or 00:00 is midnight (`clockSpan`). */
function parseSpans(text) {
    const out = [];
    for (const piece of String(text || "").split(/[\s,]+/)) {
        if (!piece) continue;
        const m = /^(\d{1,2}:\d{2}(?::\d{2})?)-(\d{1,2}:\d{2}(?::\d{2})?)$/.exec(piece);
        if (!m) return null;
        const from = clockMinutes(m[1]), to = clockMinutes(m[2]);
        const end = to === 0 ? 1440 : to;
        if (from >= 1440 || end > 1440 || end <= from) return null;
        out.push(new MspWorkingTime({ FromTime: clockText(from), ToTime: clockText(end) }));
    }
    return out;
}

function spansText(times) {
    const parts = [];
    for (const wt of times) parts.push(`${wt.FromTime}-${wt.ToTime}`);
    return parts.join(" ");
}
