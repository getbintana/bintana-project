/*
 * The columns the plan table shows, and nothing else: the name is the tree
 * and never goes, so the checklist covers the rest. The order is the one the
 * table declares -- adding and removing is what this is for -- and the
 * choice is a view setting, like the timescale: it survives the window and
 * does not touch the file.
 */
"use strict";

/* Column id -> the checkbox that shows it. */
const COLUMN_CHECKS = {
    duration:   "ChkColDuration",
    start:      "ChkColStart",
    finish:     "ChkColFinish",
    percent:    "ChkColPercent",
    critical:   "ChkColCritical",
    slack:      "ChkColSlack",
    variance:  "ChkColVariance",
    milestone:  "ChkColMilestone",
    work:       "ChkColWork",
    cost:       "ChkColCost",
    wbs:        "ChkColWbs",
    priority:   "ChkColPriority",
    constraint: "ChkColConstraint",
    deadline:   "ChkColDeadline",
    calendar:   "ChkColCalendar",
    type:       "ChkColType",
    notes:      "ChkColNotes",
    link:       "ChkColLink",
};

class ColumnsForm extends Form {

    static open(available, current, onSaved) {
        const dlg = new ColumnsForm();

        dlg.available = available;
        dlg.current   = current;
        dlg.onSaved   = onSaved;
        dlg.Modal     = true;

        for (const column of available) {
            const control = COLUMN_CHECKS[column.id];
            if (control) dlg[control].Active = current.indexOf(column.id) >= 0;
        }

        dlg.Show();
        return dlg;
    }

    BtnOk_Click() {
        const chosen = [];
        for (const column of this.available)
            if (this[COLUMN_CHECKS[column.id]].Active) chosen.push(column.id);

        /* The custom-field columns are not this dialog's to choose -- they are
         * ticked where the fields are administered -- so they stay where they
         * were instead of being dropped by a dialog that never showed them. */
        for (const id of this.current)
            if (isColumnId(id) && !this.available.some((c) => c.id === id))
                chosen.push(id);

        this.Close();
        if (this.onSaved) this.onSaved(chosen);
    }

    BtnCancel_Click() { this.Close(); }
}
