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

/* Where each choice is kept. The title, subtitle and notes are the
 * report's -- they belong to the piece of paper being made -- and the dates
 * printed are the project's; neither is kept. The logo is a file a reader
 * chooses once for their reports, so it is. */
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
                     "phases", "pack", "legend", "mural", "overlap", "guide",
                     "notesWhere", "logo", "fontScale", "columnStyles",
                     "allLabels", "labelScale"];

/* The chart's own controls, shown only while the chart is what is printed. */
const GANTT_CONTROLS = ["LblGanttSetup", "ChkMural", "LblOverlap", "SpnOverlap", "ChkGuide",
                        "LblWide", "SpnWide", "ChkTall", "SpnTall",
                        "LblTable", "SpnTable", "ChkRepeat", "ChkPhases", "ChkPack", "ChkLegend",
                        "ChkAllLabels", "LblLabelScale", "SpnLabelScale",
                        "LblFrom", "DateFrom", "LblTo", "DateTo", "BtnWholePlan"];
/* The notes flow in the table's page footer; the chart has its own foot with
 * the printed date and its sheets. The table's font size and the labels' size
 * are separate settings: the first sets the table's type, the second only the
 * letters the chart writes around the bars. */
const TABLE_ONLY = ["LblNotes", "TxtNotes", "LblNotesWhere", "CmbNotesWhere",
                    "LblFontScale", "SpnFontScale"];

/* What the last report was made with. A logo is the one choice with a global
 * default and a per-project exception: the report of a plan uses the logo
 * remembered for that file, or the one configured for every report. */
export function loadReportOptions(path) {
    const o = reportOptions({});
    for (const key of REPORT_KEPT)
        o[key] = Settings.Get(REPORT_KEY + key, o[key]);
    const logos = Settings.Get(REPORT_KEY + "logos", {});
    o.logo = path && logos[path] !== undefined
           ? logos[path] : Settings.Get(REPORT_KEY + "logo", o.logo);
    return reportOptions(o);
}

export function saveReportOptions(o, zoom, path, logoChanged) {
    for (const key of REPORT_KEPT)
        if (key !== "logo") Settings.Set(REPORT_KEY + key, o[key]);
    Settings.Set(REPORT_KEY + "zoom", zoom);

    /* A zoom change must not freeze the current logo as a project override:
     * only a logo the reader actually touched belongs to this project. */
    if (!logoChanged) return;
    const logos = Settings.Get(REPORT_KEY + "logos", {});
    const byProject = {};
    for (const key in logos) byProject[key] = logos[key];
    if (path) {
        byProject[path] = o.logo;
        Settings.Set(REPORT_KEY + "logos", byProject);
    } else {
        Settings.Set(REPORT_KEY + "logo", o.logo);
    }
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
        dlg.show(loadReportOptions(path),
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
        this.ChkAllLabels.Active     = o.allLabels !== false;
        this.SpnLabelScale.Value     = o.labelScale;
        this.DateFrom.Value          = o.from;
        this.DateTo.Value            = o.to;
        this.TxtTitle.Text           = o.title;
        this.TxtTitle.Placeholder    = this.project.Name || File.Name(this.path) || "";
        this.TxtSubtitle.Text        = o.subtitle !== null && o.subtitle !== undefined
                                     ? String(o.subtitle)
                                     : String(this.project.Title || "");
        this.TxtNotes.Text           = o.notes || "";
        this.CmbNotesWhere.Index     = o.notesWhere === "header" ? 1 : 0;
        this.TxtLogo.Text            = o.logo || "";
        this.logo0                   = o.logo || "";
        this.ChkPath.Active          = !!o.path;
        this.CmbTasks.Index          = Math.max(0, REPORT_TASKS.indexOf(o.tasks));
        this.ChkSummaries.Active     = !!o.summaries;
        this.ChkStripes.Active       = !!o.stripes;
        for (const id in REPORT_CHECKS)
            this[REPORT_CHECKS[id]].Active = o.columns.includes(id);
        this.columnStyles            = { ...(o.columnStyles || {}) };
        this.CmbColumn.Items         = REPORT_COLUMNS.map((c) => reportColumnTitle(c.id));
        this.CmbColumn.Index         = 0;
        this.CmbColAlign.Items       = REPORT_ALIGNS.map(
            (a) => Locale.Text(a || "Default"));
        this.CmbColAlign.Index       = 0;
        this.SpnFontScale.Value      = o.fontScale;
        this.CmbOrientation.Index    = o.orientation === "Portrait" ? 0 : 1;
        this.SpnMargins.Value        = Math.round(o.margins / MM_POINT);
        this.CmbZoom.Index           = Math.max(0, Math.min(REPORT_ZOOMS.length - 1, zoom));

        /* What is kept already, so opening the dialog and changing nothing
         * writes nothing. */
        this.kept  = keptOf(o, this.CmbZoom.Index);
        this.ready = true;
        this.pickColumnStyle();
        this.rebuild();
    }

    /* What the fields say, as `planReport` reads it. */
    options() {
        return reportOptions({
            title:       this.TxtTitle.Text.trim(),
            subtitle:    this.TxtSubtitle.Text.trim(),
            notes:       this.TxtNotes.Text.trim(),
            notesWhere:  this.CmbNotesWhere.Index === 1 ? "header" : "footer",
            logo:        this.TxtLogo.Text.trim(),
            path:        this.ChkPath.Active,
            tasks:       REPORT_TASKS[this.CmbTasks.Index] || "all",
            summaries:   this.ChkSummaries.Active,
            stripes:     this.ChkStripes.Active,
            columns:     Dictionary.Keys(REPORT_CHECKS)
                             .filter((id) => this[REPORT_CHECKS[id]].Active),
            fontScale:   Number(this.SpnFontScale.Value || 100),
            columnStyles: this.columnStyles,
            paper:       this.CmbPaper.Text || "A4",
            orientation: this.CmbOrientation.Index === 0 ? "Portrait" : "Landscape",
            margins:     Math.round(Number(this.SpnMargins.Value || 0) * MM_POINT),
            kind:        REPORT_KINDS[this.CmbKind.Index] || "table",
            wide:        Number(this.SpnWide.Value || 1),
            repeat:      this.ChkRepeat.Active,
            tall:        this.ChkTall.Active ? Number(this.SpnTall.Value || 1) : 0,
            table:       Number(this.SpnTable.Value || 65),
            phases:      this.ChkPhases.Active,
            pack:        this.ChkPack.Active,
            mural:       this.ChkMural.Active,
            overlap:     Math.round(Number(this.SpnOverlap.Value || 0) * MM_POINT),
            guide:       this.ChkGuide.Active,
            legend:      this.ChkLegend.Active,
            allLabels:   this.ChkAllLabels.Active,
            labelScale:  Number(this.SpnLabelScale.Value || 100),
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
        for (const name of TABLE_ONLY) this[name].Visible = !gantt;
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
        saveReportOptions(o, this.CmbZoom.Index, this.path,
                          o.logo !== this.logo0);
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
    ChkAllLabels_Click()    { this.rebuild(); }
    SpnLabelScale_Change()  { this.rebuild(); }
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
    TxtSubtitle_Change()    { this.rebuild(); }
    TxtNotes_Change()       { this.rebuild(); }
    CmbNotesWhere_Select()  { this.rebuild(); }
    TxtLogo_Change()        { this.rebuild(); }
    ChkPath_Click()         { this.rebuild(); }

    /* A logo is a file the report can carry, not a field of the plan: the
     * chooser validates that it really is an image before the path enters the
     * option, so a missing or unreadable file cannot break the PDF later. */
    BtnLogo_Click() {
        Dialog.OpenFile(Locale.Text("Choose a logo"),
            { Folder: this.path ? File.Directory(this.path) : Application.Directory,
              Filters: [[Locale.Text("Images"),
                         "*.png *.jpg *.jpeg *.webp *.bmp *.tif *.tiff"],
                        [Locale.Text("All files"), "*"]] },
            (path) => {
                try {
                    const size = Probe.Image(path);
                    if (!size || !(size.Width > 0) || !(size.Height > 0))
                        throw new Error(Locale.Text("that file is not an image"));
                    this.TxtLogo.Text = path;
                    this.rebuild();
                } catch (e) {
                    Message.Error("Cannot use {0} as a logo: {1}", path, e.message);
                }
            });
    }
    CmbTasks_Select()       { this.rebuild(); }
    ChkSummaries_Click()    { this.rebuild(); }
    ChkStripes_Click()      { this.rebuild(); }
    ChkColStart_Click()     { this.rebuild(); }
    ChkColFinish_Click()    { this.rebuild(); }
    ChkColDuration_Click()  { this.rebuild(); }
    ChkColComplete_Click()  { this.rebuild(); }
    ChkColCritical_Click()  { this.rebuild(); }
    ChkColCost_Click()      { this.rebuild(); }

    /* The style controls edit one column at a time: choosing another one
     * shows what it has, and looking writes nothing. */
    CmbColumn_Select()      { if (this.ready) this.pickColumnStyle(); }
    SpnColWidth_Change()    { this.setColumnStyle(); }
    CmbColAlign_Select()    { this.setColumnStyle(); }
    SpnFontScale_Change()   { this.rebuild(); }

    pickColumnStyle() {
        const col   = REPORT_COLUMNS[this.CmbColumn.Index];
        const style = reportColumnStyle(this.columnStyles, col && col.id);
        this.ready = false;
        this.SpnColWidth.Value = style.width;
        this.CmbColAlign.Index = Math.max(0, REPORT_ALIGNS.indexOf(style.align));
        this.ready = true;
    }

    setColumnStyle() {
        if (!this.ready) return;
        const col = REPORT_COLUMNS[this.CmbColumn.Index];
        if (!col) return;
        const width = Math.max(0, Math.min(150,
                           Math.round(Number(this.SpnColWidth.Value) || 0)));
        const align = REPORT_ALIGNS[this.CmbColAlign.Index] || "";
        const styles = { ...this.columnStyles };
        /* A column back at its own width and alignment is no exception, and
         * does not need to be remembered as one. */
        if (width || align) styles[col.id] = { width, align };
        else delete styles[col.id];
        this.columnStyles = styles;
        this.rebuild();
    }
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
