/*
 * The file's own preferences, in their dialog: what Project calls Project
 * Options -- the defaults for new tasks, the calculation switches and the
 * earned-value method. They are the project's, not the application's: OK
 * hands them to `Edit.setProject` and they are one undo, while the app's own
 * settings stay in `SettingsForm`.
 *
 * The administrative flags Project writes (externally edited, actuals in
 * sync, remove file properties, admin project, extended creation date) are
 * modelled for the round trip and have no dialog.
 */
"use strict";

class OptionsForm extends Form {

    static TEXT = {};
    static NUMBER = {
        DefaultStandardRate: "TxtOptStdRate",
        DefaultOvertimeRate: "TxtOptOtRate",
        MinutesPerDay:       "TxtOptMinutesDay",
        MinutesPerWeek:      "TxtOptMinutesWeek",
        DaysPerMonth:        "TxtOptDaysMonth",
        CriticalSlackLimit:  "TxtOptSlack",
    };
    static DATE = {};
    static TIME = {
        DefaultStartTime:  "TxtOptStartTime",
        DefaultFinishTime: "TxtOptFinishTime",
    };
    static CHECK = {
        FiscalYearStart:             "ChkOptFiscal",
        EditableActualCosts:         "ChkOptEditableCosts",
        HonorConstraints:            "ChkOptHonor",
        InsertedProjectsLikeSummary: "ChkOptInserted",
        MultipleCriticalPaths:       "ChkOptMultiCritical",
        NewTasksEffortDriven:        "ChkOptEffort",
        NewTasksEstimated:           "ChkOptEstimated",
        SplitsInProgressTasks:       "ChkOptSplits",
        SpreadActualCost:            "ChkOptSpreadActual",
        SpreadPercentComplete:       "ChkOptSpreadPercent",
        TaskUpdatesResource:         "ChkOptTaskUpdates",
        MoveCompletedEndsBack:       "ChkOptMoveCompletedBack",
        MoveRemainingStartsBack:     "ChkOptMoveRemainingBack",
        MoveRemainingStartsForward:  "ChkOptMoveRemainingForward",
        MoveCompletedEndsForward:    "ChkOptMoveCompletedForward",
        AutoAddNewResourcesAndTasks: "ChkOptAutoAdd",
        Autolink:                    "ChkOptAutolink",
        MicrosoftProjectServerURL:   "ChkOptServerUrl",
    };
    static COMBO = {
        DefaultTaskType:        ["CmbOptTaskType", [0, 1, 2]],
        DefaultFixedCostAccrual: ["CmbOptAccrual", [1, 2, 3]],
        DurationFormat:         ["CmbOptDurationFormat", [3, 5, 7, 9, 11]],
        WorkFormat:             ["CmbOptWorkFormat", [1, 2, 3, 4, 5]],
        WeekStartDay:           ["CmbOptWeekStart", [0, 1, 2, 3, 4, 5, 6]],
        NewTaskStartDate:       ["CmbOptNewTaskStart", [0, 1]],
        FYStartDate:            ["CmbOptFY", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]],
        EarnedValueMethod:      ["CmbOptEVMethod", [0, 1]],
        BaselineForEarnedValue: ["CmbOptEVBaseline",
                                 [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]],
        DefaultTaskEVMethod:    ["CmbOptTaskEV", [0, 1]],
    };

    static open(project, onSaved) {
        const dlg = new OptionsForm();

        dlg.project = project;
        dlg.onSaved = onSaved;
        dlg.Modal   = true;

        fillProjectForm(dlg, project, OptionsForm);
        dlg.Show();
        return dlg;
    }

    BtnOk_Click() {
        const values = projectFormValues(this, this.project, OptionsForm);
        if (!values) {
            Message.Error(Locale.Text("The project's numbers must be numbers."));
            return;
        }
        try {
            const probe = new MspProject();
            for (const name in values) probe[name] = values[name];
        } catch (e) {
            Message.Error("Cannot apply: {0}", e.message);
            return;
        }

        this.Close();
        if (this.onSaved) this.onSaved(values);
    }

    BtnCancel_Click() { this.Close(); }
}
