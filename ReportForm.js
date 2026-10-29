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
 *
 * **It prints the Gantt chart too** (`ganttPrint`, GanttPrint.js): the same
 * options, the same paper, and the sheets drawn into a drawing area of the
 * dialog's own instead of the `Report` -- which lays out bands and has no room
 * for a chart cut across several sheets. Whichever is chosen is the one shown,
 * saved and printed.
 */
"use strict";

/* Where each choice is kept. The title and the dates printed are the
 * project's and are not kept. */
export const REPORT_KEY = "bintana-project.report.";

/* The zoom combo, in its order: the two fits, then a scale of the paper. */
const REPORT_ZOOMS = ["page", "width", 0.5, 0.75, 1, 1.5, 2];

/* Points to pixels at 100 %: a point is 1/72 of an inch, a pixel 1/96. */
const POINT_PX = 96 / 72;
const MM_POINT = 72 / 25.4;

/* The column checkboxes, by the column each one is. */
const REPORT_CHECKS = { start: "ChkColStart", finish: "ChkColFinish",
                        duration: "ChkColDuration", complete: "ChkColComplete",
                        critical: "ChkColCritical", cost: "ChkColCost" };

/* The choices that are kept, between one report and the next. */
const REPORT_KEPT = ["path", "summaries", "stripes", "paper", "orientation", "margins",
                     "tasks", "columns", "kind", "wide", "repeat", "tall", "table",
                     "phases", "pack", "legend", "mural", "overlap", "guide"];

/* The chart's own controls, shown only while the chart is what is printed. */
const GANTT_CONTROLS = ["LblGanttSetup", "ChkMural", "LblOverlap", "SpnOverlap", "ChkGuide",
                        "LblWide", "SpnWide", "ChkTall", "SpnTall",
                        "LblTable", "SpnTable", "ChkRepeat", "ChkPhases", "ChkPack", "ChkLegend",
                        "LblFrom", "DateFrom", "LblTo", "DateTo", "BtnWholePlan"];

/* What the last report was made with. */
function loadReportOptions() {
    const o = reportOptions({});
    for (const key of REPORT_KEPT)
        o[key] = Settings.Get(REPORT_KEY + key, o[key]);
    return reportOptions(o);
}

function saveReportOptions(o, zoom) {
    for (const key of REPORT_KEPT)
        Settings.Set(REPORT_KEY + key, o[key]);
    Settings.Set(REPORT_KEY + "zoom", zoom);
}

/* The kept part of the options, as one string to compare: what moved is what
 * is written. */
function keptOf(o, zoom) {
    const kept = {};
    for (const key of REPORT_KEPT) kept[key] = o[key];
    return JSON.stringify([kept, zoom]);
}

export class ReportForm extends Form {

    /*
     * ReportForm.open(project, path, log, chart)
     *
     * `log` is the window's own line for what happened, so a PDF saved from
     * here is reported where every other file the app writes is. `chart` is
     * what the window's chart wears -- its format, its labels, its calendar --
     * so the Gantt on paper is the one on screen.
     */
    static open(project, path, log, chart) {
        const dlg = new ReportForm();

        dlg.project = project;
        dlg.chart   = chart || null;
        dlg.sheet   = 1;
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

        this.CmbKind.Index           = Math.max(0, REPORT_KINDS.indexOf(o.kind));
        this.SpnWide.Value           = o.wide;
        this.ChkRepeat.Active        = !!o.repeat;
        this.ChkTall.Active          = o.tall > 0;
        this.SpnTall.Value           = Math.max(1, o.tall);
        this.SpnTable.Value          = o.table;
        this.ChkPhases.Active        = !!o.phases;
        this.ChkPack.Active          = !!o.pack;
        this.ChkMural.Active         = !!o.mural;
        this.SpnOverlap.Value        = Math.round(o.overlap / MM_POINT);
        this.ChkGuide.Active         = !!o.guide;
        this.ChkLegend.Active        = !!o.legend;
        this.DateFrom.Value          = o.from;
        this.DateTo.Value            = o.to;
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
        this.kept  = keptOf(o, this.CmbZoom.Index);
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
            kind:        REPORT_KINDS[this.CmbKind.Index] || "table",
            wide:        Number(this.SpnWide.Value || 1),
            repeat:      this.ChkRepeat.Active,
            tall:        this.ChkTall.Active ? Number(this.SpnTall.Value || 1) : 0,
            table:       Number(this.SpnTable.Value || 45),
            phases:      this.ChkPhases.Active,
            pack:        this.ChkPack.Active,
            mural:       this.ChkMural.Active,
            overlap:     Math.round(Number(this.SpnOverlap.Value || 0) * MM_POINT),
            guide:       this.ChkGuide.Active,
            legend:      this.ChkLegend.Active,
            from:        this.DateFrom.Value || "",
            to:          this.DateTo.Value || "",
        });
    }

    rebuild() {
        if (!this.ready) return;
        const o = this.options();
        const gantt = o.kind === "gantt";

        /* Only what the chosen kind reads is shown: the sheets across and the
         * repeated table are a chart's, and the two previews take turns. */
        for (const name of GANTT_CONTROLS) this[name].Visible = gantt;
        this.SpnTall.Enabled = this.ChkTall.Active;
        /* A mural is one picture: there is no sheet of its own for a phase to
         * start, nor a table to repeat -- and only a mural has an overlap and
         * a guide to assemble it by. */
        const mural = this.ChkMural.Active;
        this.ChkRepeat.Enabled  = !mural;
        this.ChkPhases.Enabled  = !mural;
        this.ChkPack.Enabled    = !mural && this.ChkPhases.Active;
        this.SpnOverlap.Enabled = mural;
        this.ChkGuide.Enabled   = mural;
        this.Preview.Visible = !gantt;
        this.Sheet.Visible   = gantt;

        if (gantt) {
            this.layout = ganttPrint(this.project, this.path, o, this.chart);
            this.sheet  = Math.max(1, Math.min(this.layout.pages, this.sheet));
            this.Sheet.Redraw();
        } else {
            this.layout = null;
            fillReport(this.Preview, planReport(this.project, this.path, o));
        }
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
        const now = keptOf(o, this.CmbZoom.Index);
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
        const o      = this.options();
        const sheet  = Printer.Papers[o.paper] || Printer.Papers.A4;
        const [w, h] = o.orientation === "Landscape"
                           ? [sheet.Height, sheet.Width] : [sheet.Width, sheet.Height];
        const view   = this.view();

        if (z === "page") {
            this.PreviewScroll.Arrangement = "Vertical";
            view.Resize(-1, -1);
            view.Expand = true;
            return;
        }

        this.PreviewScroll.Arrangement = "Fixed";
        view.Expand = false;

        if (z === "width") {
            /* The view's width less the scrollbar it is about to grow. Before
             * the window is up there is no width to read, and the resize that
             * brings one asks again. */
            const room = this.PreviewScroll.Bounds().Width - 20;
            if (room <= 0) return;
            view.Resize(room, Math.round(room * h / w));
            return;
        }
        view.Resize(Math.round(w * POINT_PX * z), Math.round(h * POINT_PX * z));
    }

    /* The preview being shown: the report's, or the chart's sheets. */
    view() { return this.layout ? this.Sheet : this.Preview; }

    /* The page on screen and how many there are, of whichever is shown. */
    pageNow()   { return this.layout ? this.sheet : this.Preview.Page; }
    pageCount() { return this.layout ? this.layout.pages : this.Preview.PageCount; }

    showPage() {
        const n = this.pageCount();
        this.LblPage.Text    = Locale.Text("{0} / {1}", this.pageNow(), n);
        this.BtnPrev.Enabled = this.pageNow() > 1;
        this.BtnNext.Enabled = this.pageNow() < n;
    }

    /* Turn to page `n` of whichever is shown. */
    turn(n) {
        if (this.layout) {
            this.sheet = Math.max(1, Math.min(this.layout.pages, n));
            this.Sheet.Redraw();
        } else {
            this.Preview.Page = n;
        }
        this.showPage();
    }

    /* The chart's sheets: on screen with the paper's edge drawn, and to the
     * printer one sheet at a time, as `Printer` asks for them. */
    Sheet_Draw(p, width, height) {
        if (this.layout) this.layout.draw(p, this.sheet, width, height, true);
    }
    Sheet_DrawPage(p, page, width, height) {
        if (this.layout) this.layout.draw(p, page, width, height, false);
    }

    Form_Resize() {
        if (this.ready && REPORT_ZOOMS[this.CmbZoom.Index] === "width") this.zoom();
    }

    BtnPrev_Click() { this.turn(this.pageNow() - 1); }
    BtnNext_Click() { this.turn(this.pageNow() + 1); }

    /* The data moved the page, or the pages were counted again. */
    Preview_Page()     { if (this.ready) this.showPage(); }
    Preview_Prepared() { if (this.ready) this.showPage(); }

    CmbZoom_Select() {
        if (!this.ready) return;
        this.zoom();
        this.keep(this.options());
    }

    /* --- the options ------------------------------------------------------- */

    CmbKind_Select()        { this.rebuild(); }
    SpnWide_Change()        { this.rebuild(); }
    ChkRepeat_Click()       { this.rebuild(); }
    ChkTall_Click()         { this.rebuild(); }
    SpnTall_Change()        { this.rebuild(); }
    SpnTable_Change()       { this.rebuild(); }
    ChkPhases_Click()       { this.rebuild(); }
    ChkPack_Click()         { this.rebuild(); }
    ChkMural_Click()        { this.rebuild(); }
    SpnOverlap_Change()     { this.rebuild(); }
    ChkGuide_Click()        { this.rebuild(); }
    ChkLegend_Click()       { this.rebuild(); }
    DateFrom_Change()       { this.rebuild(); }
    DateTo_Change()         { this.rebuild(); }

    /* Back to the plan's own span: the pickers emptied, which only code can do. */
    BtnWholePlan_Click() {
        this.ready = false;
        this.DateFrom.Value = "";
        this.DateTo.Value   = "";
        this.ready = true;
        this.rebuild();
    }
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
        const kind = this.layout ? "gantt" : "report";
        Dialog.SaveFile(Locale.Text("Save the report"),
            { Folder: File.Directory(this.path), Name: `${base}-${kind}.pdf`,
              Filters: [[Locale.Text("PDF document"), "*.pdf"]] },
            (path) => {
                try {
                    this.savePdf(path);
                    this.log(Locale.Text("Reported {0}.", path));
                } catch (e) {
                    Message.Error("Cannot save {0}: {1}", path, e.message);
                }
            });
    }

    /* Every page, one file: the report's own, or the chart's sheets at the
     * paper's exact size in points, vector -- the text in it is text. */
    savePdf(path) {
        const lay = this.layout;
        if (!lay) { this.Preview.SavePdf(path); return; }
        Drawing.SavePdf(path, Math.round(lay.width), Math.round(lay.height), lay.pages,
                        (p, page, pw, ph) => lay.draw(p, page, pw, ph, false));
    }

    BtnPrint_Click() {
        const sent = (job) => {
            this.log(Locale.Text("Sent {0} copies of the report to the printer.", job.Copies));
        };
        if (!this.layout) { this.Preview.Send({}, sent); return; }
        const o = this.options();
        Printer.Send(this.Sheet, { Pages: this.layout.pages, Paper: o.paper,
                                   Orientation: o.orientation }, sent);
    }

    BtnClose_Click() { this.Close(); }
}
