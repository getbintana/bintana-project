/*
 * The plan read back: what it costs, how long it runs, how far along it is
 * and what it is late on. It is a reading and not an edit -- **the whole
 * arithmetic is in `projectStats` (see Stats.js)** -- so there is no OK here:
 * the only button closes it, and nothing it shows is written to the file. That
 * is also why `open` takes no callback: a dialog that answers nothing does not
 * need one, and `ConfirmForm` is the shape to copy when it does.
 *
 * The sheet is a scroll and the window can be made bigger, because this is the
 * one dialog whose content has no length: every task that broke a promise is a
 * row, and a plan that has never been recalculated can have hundreds of them.
 */
"use strict";

/* The money, in the plan's own currency: the symbol and the number of places
 * the file writes, and this desktop's idea of which side a symbol goes on --
 * which is not the same everywhere and not something to spell out by hand. A
 * file that wrote no currency of its own keeps the desktop's, which is what an
 * amount with nothing to say about its currency should be read as. */
function statsMoney(project, value) {
    const options = {};
    if (project.CurrencySymbol) options.Symbol = project.CurrencySymbol;
    if (project.CurrencyDigits) options.Decimals = project.CurrencyDigits;
    return Locale.Currency(value, options);
}

/* An instant the way the rest of the app writes one, and nothing at all when
 * there is none: a plan the file never scheduled has no finish, and a made-up
 * date would be a lie in the one dialog whose whole job is not to lie. */
function statsDate(ms) {
    return ms === null || ms === undefined ? "" : shortDate(isoLocal(ms));
}

class StatsForm extends Form {

    static open(project) {
        const dlg = new StatsForm();

        dlg.project = project;
        dlg.Modal   = true;
        dlg.fill(projectStats(project));

        dlg.Show();
        return dlg;
    }

    fill(s) {
        const project = this.project;

        this.LblStatsTitle.Text = Locale.Text("Statistics of {0}",
                                              project.Name || Locale.Text("the plan"));

        this.TxtStart.Text  = statsDate(s.start);
        this.TxtFinish.Text = statsDate(s.finish);
        /* Where elapsed and remaining are measured, said with the moment
         * beside it: the plan's own status date is what Project calls "today"
         * for a plan, and a file that wrote none is read at this machine's. */
        this.TxtReadAt.Text = Locale.Text("{0} ({1})", statsDate(s.readAt),
                                           s.status !== null
                                               ? Locale.Text("the status date")
                                               : Locale.Text("today"));
        this.TxtDuration.Text  = Locale.Number(s.workingDays, 1);
        this.TxtCalendar.Text  = s.calendarDays === null
                                   ? "" : Locale.Number(s.calendarDays);
        this.TxtElapsed.Text   = Locale.Number(s.elapsed, 1);
        this.TxtRemaining.Text = Locale.Number(s.remaining, 1);

        this.TxtPercent.Text    = `${Locale.Number(s.percent, 1)}%`;
        this.TxtTasks.Text      = Locale.Number(s.tasks);
        this.TxtSummaries.Text  = Locale.Number(s.summaries);
        this.TxtMilestones.Text = Locale.Number(s.milestones);
        this.TxtDone.Text       = Locale.Number(s.done);
        this.TxtRunning.Text    = Locale.Number(s.running);
        this.TxtWaiting.Text    = Locale.Number(s.waiting);
        this.TxtCritical.Text   = Locale.Number(s.critical);

        this.TxtTotalCost.Text    = statsMoney(project, s.cost);
        this.TxtWork.Text         = durationText({ Duration: s.work,
                                                   DurationFormat: 5 }, project);
        this.TxtWorkCost.Text     = statsMoney(project, s.kindWork);
        this.TxtMaterialCost.Text = statsMoney(project, s.kindMaterial);
        this.TxtCostCost.Text     = statsMoney(project, s.kindCost);
        this.TxtOver.Text         = Locale.Number(s.overAllocated);
        /* The schedule variance, the other half of the baseline: **the span the
         * baseline caught against the span the plan has now.** Both are shown
         * because either alone is a question -- "1 day late" says nothing
         * about whether the plan takes a week or a year -- and neither is
         * answered when there is no baseline, which is the same bargain the
         * per-task variances make. */
        this.TxtBaselineSpan.Text = s.baselineFinish === null
            ? "" : `${statsDate(s.baselineStart)} – ${statsDate(s.baselineFinish)}`;
        this.TxtScheduleVariance.Text = s.variance === null
            ? "" : (s.variance === 0 ? Locale.Text("on baseline")
                                     : `${s.variance > 0 ? "+" : ""}${Locale.Number(s.variance)} d`);

        /* The baseline is what the file kept and the total is what this app
         * calculates, so the variance is only as good as both -- and a plan
         * that never took a baseline has no number to vary from. */
        this.TxtBaselineCost.Text = s.baselined
            ? statsMoney(project, s.baselineCost) : "";
        this.TxtVariance.Text     = s.baselined
            ? statsMoney(project, s.cost - s.baselineCost) : "";

        /* **The budget is the other reading of the same money**: what the plan
         * said it would spend, out of the assignments. A plan that took no
         * budget shows nothing at all, because "no budget" is not "a budget of
         * zero" and a row of zeroes there would read like a plan that is
         * exactly on budget. */
        this.TxtBudget.Text = s.budget > 0 ? statsMoney(project, s.budget) : "";
        this.TxtBudgetVariance.Text = s.budgetVariance === null
            ? "" : statsMoney(project, s.budgetVariance);
        this.TxtBudgetPercent.Text = s.budgetPercent === null
            ? "" : `${Locale.Number(s.budgetPercent, 1)}%`;

        this.TxtLate.Text          = Locale.Number(s.late.length);
        this.TxtWorst.Text         = s.worstLate ? Locale.Number(s.worstLate) : "";
        this.TxtPastDeadline.Text  = Locale.Number(s.lateDeadline);
        this.TxtPastBaseline.Text  = s.baselined
            ? Locale.Number(s.lateBaseline) : "";
        this.TxtNotMet.Text        = Locale.Number(s.notMet);
        this.TxtDaysBehind.Text    = s.behind ? Locale.Number(s.behind) : "";

        this.fillLate(s.late);
    }

    /* The delay as a list, which is the only part of this dialog with a
     * length: one row per task that finished later than the date it was
     * given, worst first, and the heading says so when there is nothing --
     * an empty table under a heading reads like a table that failed to load. */
    fillLate(rows) {
        this.LateList.Clear();
        for (const row of rows) {
            this.LateList.Add([
                row.Name,
                statsDate(row.Promised),
                statsDate(row.Finished),
                Locale.Number(row.Late),
                statsMoney(this.project, row.Cost),
            ]);
        }
        this.LblLateHeading.Text = rows.length
            ? Locale.Text("Tasks behind their promise")
            : Locale.Text("No task is past the date it was given");
    }

    BtnClose_Click() { this.Close(); }
}