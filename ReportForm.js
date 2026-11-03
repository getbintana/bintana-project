/*
 * The report, seen before it leaves: the plan laid out on paper as a table,
 * with what it carries and how, and the two ways out -- a PDF, or the printer.
 *
 * The rows and the bands are `planReport`'s (PlanReport.js); this dialog only
 * holds the options and shows the result, so what is previewed is what is
 * saved and printed -- the same `Report` control does all three. What it
 * shares with the Gantt chart on paper (GanttPrintForm) -- the header, the
 * columns, the paper, the zoom, the ways out -- is `PrintForm`'s
 * (PrintPreview.js); the two were one dialog once, with a combo that changed
 * half of it, and the chart's options buried the table's.
 */
"use strict";

/* The choices the report keeps, between one report and the next. */
const REPORT_KEPT = [...PRINT_KEPT, "notesWhere", "fontScale"];

/* What the last report was made with. */
export function loadReportOptions(path) {
    return loadPrintOptions(REPORT_KEY, REPORT_KEPT, path, null);
}

export function saveReportOptions(o, zoom, path, logoChanged) {
    savePrintOptions(REPORT_KEY, REPORT_KEPT, o, zoom, path, logoChanged);
}

export class ReportForm extends PrintForm {

    /*
     * ReportForm.open(project, path, log)
     *
     * `log` is the window's own line for what happened, so a PDF saved from
     * here is reported where every other file the app writes is.
     */
    static open(project, path, log) {
        return new ReportForm().start(project, path, log);
    }

    get keptKeys() { return REPORT_KEPT; }

    /* The notes flow in the table's page footer, or its header; the type size
     * is the table's. */
    showOwn(o) {
        this.TxtNotes.Text       = o.notes || "";
        this.CmbNotesWhere.Index = o.notesWhere === "header" ? 1 : 0;
        this.SpnFontScale.Value  = o.fontScale;
    }

    ownOptions() {
        return {
            notes:      this.TxtNotes.Text.trim(),
            notesWhere: this.CmbNotesWhere.Index === 1 ? "header" : "footer",
            fontScale:  Number(this.SpnFontScale.Value || 100),
        };
    }

    render(o) { fillReport(this.Preview, planReport(this.project, this.path, o)); }

    view()      { return this.Preview; }
    pageNow()   { return this.Preview.Page; }
    pageCount() { return this.Preview.PageCount; }
    turn(n) {
        this.Preview.Page = n;
        this.showPage();
    }

    /* The data moved the page, or the pages were counted again. */
    Preview_Page()     { if (this.ready) this.showPage(); }
    Preview_Prepared() { if (this.ready) this.showPage(); }

    TxtNotes_Change()      { this.rebuild(); }
    CmbNotesWhere_Select() { this.rebuild(); }
    SpnFontScale_Change()  { this.rebuild(); }

    savePdf(path) { this.Preview.SavePdf(path); }

    BtnPrint_Click() { this.Preview.Send({}, (job) => this.sent(job)); }
}
