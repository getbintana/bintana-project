/*
 * The report, seen before it leaves: the plan laid out on paper, with what it
 * carries and how, and the two ways out -- a PDF, or the printer.
 *
 * The rows and the bands are `planReport`'s (PlanReport.js); this dialog only
 * holds the options and shows the result, so what is previewed is what is
 * saved and printed -- the same `Report` control does all three. It replaced a
 * command that wrote a PDF blind from a `Report` kept hidden on the main
 * window, which was the only place that control could live.
 *
 * Every option applies as it is changed: a report is hundreds of rows, and the
 * measure is the whole cost of a change, which is cheap at that size.
 */
"use strict";

/* Where each choice is kept. The title is the project's and is not kept. */
const REPORT_KEY = "bintana-project.report.";

/* The zoom combo, in its order: the two fits, then a scale of the paper. */
const REPORT_ZOOMS = ["page", "width", 0.5, 0.75, 1, 1.5, 2];

/* Points to pixels at 100 %: a point is 1/72 of an inch, a pixel 1/96. */
const POINT_PX = 96 / 72;
const MM_POINT = 72 / 25.4;

/* The column checkboxes, by the column each one is. */
const REPORT_CHECKS = { start: "ChkColStart", finish: "ChkColFinish",
                        duration: "ChkColDuration", complete: "ChkColComplete",
                        critical: "ChkColCritical", cost: "ChkColCost" };

/* What the last report was made with. */
function loadReportOptions() {
    const o = reportOptions({});
    for (const key of ["path", "summaries", "stripes", "paper", "orientation", "margins", "tasks"])
        o[key] = Settings.Get(REPORT_KEY + key, o[key]);
    o.columns = Settings.Get(REPORT_KEY + "columns", o.columns);
    return reportOptions(o);
}

function saveReportOptions(o, zoom) {
    for (const key of ["path", "summaries", "stripes", "paper", "orientation",
                       "margins", "tasks", "columns"])
        Settings.Set(REPORT_KEY + key, o[key]);
    Settings.Set(REPORT_KEY + "zoom", zoom);
}

class ReportForm extends Form {

    /*
     * ReportForm.open(project, path, log)
     *
     * `log` is the window's own line for what happened, so a PDF saved from
     * here is reported where every other file the app writes is.
     */
    static open(project, path, log) {
        const dlg = new ReportForm();

        dlg.project = project;
        dlg.path    = path || "";
        dlg.log     = log || (() => {});
        dlg.Modal   = true;
        dlg.show(loadReportOptions(),
                 Number(Settings.Get(REPORT_KEY + "zoom", 0)) || 0);

        dlg.Show();
        return dlg;
    }

    /* The options into the fields, and the report built from them. The fields
     * raise their events as they are filled, so nothing is applied until all
     * of them say what they should. */
    show(o, zoom) {
        this.ready = false;

        this.CmbPaper.Items = Dictionary.Keys(Printer.Papers);
        this.CmbPaper.Text  = this.CmbPaper.Items.includes(o.paper) ? o.paper : "A4";

        this.TxtTitle.Text           = o.title;
        this.TxtTitle.Placeholder    = this.project.Name || File.Name(this.path) || "";
        this.ChkPath.Active          = !!o.path;
        this.CmbTasks.Index          = Math.max(0, REPORT_TASKS.indexOf(o.tasks));
        this.ChkSummaries.Active     = !!o.summaries;
        this.ChkStripes.Active       = !!o.stripes;
        for (const id in REPORT_CHECKS)
            this[REPORT_CHECKS[id]].Active = o.columns.includes(id);
        this.CmbOrientation.Index    = o.orientation === "Portrait" ? 0 : 1;
        this.SpnMargins.Value        = Math.round(o.margins / MM_POINT);
        this.CmbZoom.Index           = Math.max(0, Math.min(REPORT_ZOOMS.length - 1, zoom));

        /* What is kept already, so opening the dialog and changing nothing
         * writes nothing. */
        const { title, ...kept } = o;
        this.kept  = JSON.stringify([kept, this.CmbZoom.Index]);
        this.ready = true;
        this.rebuild();
    }

    /* What the fields say, as `planReport` reads it. */
    options() {
        return reportOptions({
            title:       this.TxtTitle.Text.trim(),
            path:        this.ChkPath.Active,
            tasks:       REPORT_TASKS[this.CmbTasks.Index] || "all",
            summaries:   this.ChkSummaries.Active,
            stripes:     this.ChkStripes.Active,
            columns:     Dictionary.Keys(REPORT_CHECKS)
                             .filter((id) => this[REPORT_CHECKS[id]].Active),
            paper:       this.CmbPaper.Text || "A4",
            orientation: this.CmbOrientation.Index === 0 ? "Portrait" : "Landscape",
            margins:     Math.round(Number(this.SpnMargins.Value || 0) * MM_POINT),
        });
    }

    rebuild() {
        if (!this.ready) return;
        const o = this.options();
        fillReport(this.Preview, planReport(this.project, this.path, o));
        this.zoom();
        this.showPage();
        this.keep(o);
    }

    /*
     * The choices are kept as they are made, and only when one moved: on the
     * way out the window may be going down with the program, and a value read
     * off a control then is not one to trust. Typing a title rebuilds on every
     * key and changes nothing kept, so it writes nothing.
     */
    keep(o) {
        const { title, ...kept } = o;
        const now = JSON.stringify([kept, this.CmbZoom.Index]);
        if (now === this.kept) return;
        this.kept = now;
        saveReportOptions(o, this.CmbZoom.Index);
    }

    /* --- the page on screen ------------------------------------------------ */

    /*
     * A `Report` always draws the whole page, scaled into whatever room it has
     * -- deliberately, it has no zoom of its own. So the zoom is the room: a fit
     * gives it the view, a scale gives it the paper's size and lets the scroller
     * do the rest.
     */
    zoom() {
        const z      = REPORT_ZOOMS[this.CmbZoom.Index] || "page";
        const sheet  = Printer.Papers[this.Preview.Paper] || Printer.Papers.A4;
        const [w, h] = this.Preview.Orientation === "Landscape"
                           ? [sheet.Height, sheet.Width] : [sheet.Width, sheet.Height];

        if (z === "page") {
            this.PreviewScroll.Arrangement = "Vertical";
            this.Preview.Resize(-1, -1);
            this.Preview.Expand = true;
            return;
        }

        this.PreviewScroll.Arrangement = "Fixed";
        this.Preview.Expand = false;

        if (z === "width") {
            /* The view's width less the scrollbar it is about to grow. Before
             * the window is up there is no width to read, and the resize that
             * brings one asks again. */
            const room = this.PreviewScroll.Bounds().Width - 20;
            if (room <= 0) return;
            this.Preview.Resize(room, Math.round(room * h / w));
            return;
        }
        this.Preview.Resize(Math.round(w * POINT_PX * z), Math.round(h * POINT_PX * z));
    }

    showPage() {
        const n = this.Preview.PageCount;
        this.LblPage.Text    = Locale.Text("{0} / {1}", this.Preview.Page, n);
        this.BtnPrev.Enabled = this.Preview.Page > 1;
        this.BtnNext.Enabled = this.Preview.Page < n;
    }

    Form_Resize() {
        if (this.ready && REPORT_ZOOMS[this.CmbZoom.Index] === "width") this.zoom();
    }

    BtnPrev_Click() { this.Preview.Page--; this.showPage(); }
    BtnNext_Click() { this.Preview.Page++; this.showPage(); }

    /* The data moved the page, or the pages were counted again. */
    Preview_Page()     { if (this.ready) this.showPage(); }
    Preview_Prepared() { if (this.ready) this.showPage(); }

    CmbZoom_Select() {
        if (!this.ready) return;
        this.zoom();
        this.keep(this.options());
    }

    /* --- the options ------------------------------------------------------- */

    TxtTitle_Change()       { this.rebuild(); }
    ChkPath_Click()         { this.rebuild(); }
    CmbTasks_Select()       { this.rebuild(); }
    ChkSummaries_Click()    { this.rebuild(); }
    ChkStripes_Click()      { this.rebuild(); }
    ChkColStart_Click()     { this.rebuild(); }
    ChkColFinish_Click()    { this.rebuild(); }
    ChkColDuration_Click()  { this.rebuild(); }
    ChkColComplete_Click()  { this.rebuild(); }
    ChkColCritical_Click()  { this.rebuild(); }
    ChkColCost_Click()      { this.rebuild(); }
    CmbPaper_Select()       { this.rebuild(); }
    CmbOrientation_Select() { this.rebuild(); }
    SpnMargins_Change()     { this.rebuild(); }

    /* --- the ways out ------------------------------------------------------ */

    BtnSave_Click() {
        const base = File.BaseName(this.path) || "plan";
        Dialog.SaveFile(Locale.Text("Save the report"),
            { Folder: File.Directory(this.path), Name: `${base}-report.pdf`,
              Filters: [[Locale.Text("PDF document"), "*.pdf"]] },
            (path) => {
                try {
                    this.Preview.SavePdf(path);
                    this.log(Locale.Text("Reported {0}.", path));
                } catch (e) {
                    Message.Error("Cannot save {0}: {1}", path, e.message);
                }
            });
    }

    BtnPrint_Click() {
        this.Preview.Send({}, (job) => {
            this.log(Locale.Text("Sent {0} copies of the report to the printer.", job.Copies));
        });
    }

    BtnClose_Click() { this.Close(); }
}
