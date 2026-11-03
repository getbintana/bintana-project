/*
 * What the two printed views of a plan share: the report (ReportForm, the
 * table) and the Gantt chart on paper (GanttPrintForm). Each is a dialog of its
 * own -- the chart's options are many and none of them is the table's -- but
 * both are a page seen before it leaves, with the same header, the same rows
 * and columns, the same paper, and the same two ways out.
 *
 * `PrintForm` holds that: the fields both forms carry, the zoom and the pages,
 * the choices kept between one print and the next, and the PDF and the
 * printer. A subclass says what it adds (`showOwn`, `ownOptions`), how it lays
 * the page out (`render`), and which control shows it (`view`, the pages).
 *
 * Every option applies as it is changed: a report is hundreds of rows, and the
 * measure is the whole cost of a change, which is cheap at that size.
 */
"use strict";

/* Where each choice is kept, one prefix per dialog: a table on A4 portrait and
 * a chart on A3 landscape are both what a reader may want, from the same plan.
 * The title, subtitle and notes belong to the piece of paper being made and the
 * dates printed are the project's; neither is kept. The logo is a file a reader
 * chooses once for everything they print, so it is kept once, under the
 * report's prefix, whichever dialog chose it. */
export const REPORT_KEY = "bintana-project.report.";
export const GANTT_KEY  = "bintana-project.gantt.";

/* The zoom combo, in its order: the two fits, then a scale of the paper. */
const PRINT_ZOOMS = ["page", "width", 0.5, 0.75, 1, 1.5, 2];

/* Points to pixels at 100 %: a point is 1/72 of an inch, a pixel 1/96. */
const POINT_PX = 96 / 72;
export const MM_POINT = 72 / 25.4;

/* The columns' row of controls in the grid, by the column each one is: whether
 * it is printed, its width in mm (0 = measured) and its alignment. A column is
 * one row with all three, rather than a list of checkboxes and, apart, a combo
 * that chose which column the width and alignment below it were -- two lists
 * of the same six columns, and what one column was given out of sight while
 * another was chosen. */
const PRINT_COLUMNS = {};
for (const id of ["start", "finish", "duration", "complete", "critical", "cost"]) {
    const name = id[0].toUpperCase() + id.slice(1);
    PRINT_COLUMNS[id] = { check: `ChkCol${name}`, width: `SpnCol${name}Width`,
                          align: `CmbCol${name}Align` };
}

/* The choices both dialogs keep, each under its own prefix. */
export const PRINT_KEPT = ["path", "summaries", "stripes", "paper", "orientation",
                           "margins", "tasks", "columns", "columnStyles"];

/*
 * What the last print of a kind was made with. `fallback` is a prefix read
 * when this one has never been written: the chart's choices used to live with
 * the report's, and a reader who set them there finds them where they left
 * them. A logo is the one choice with a global default and a per-project
 * exception: the print of a plan uses the logo remembered for that file, or
 * the one configured for every print.
 */
export function loadPrintOptions(prefix, keys, path, fallback) {
    const o = reportOptions({});
    for (const key of keys) {
        const old = fallback ? Settings.Get(fallback + key, o[key]) : o[key];
        o[key] = Settings.Get(prefix + key, old);
    }
    const logos = Settings.Get(REPORT_KEY + "logos", {});
    o.logo = path && logos[path] !== undefined
           ? logos[path] : Settings.Get(REPORT_KEY + "logo", o.logo);
    return reportOptions(o);
}

export function savePrintOptions(prefix, keys, o, zoom, path, logoChanged) {
    for (const key of keys) Settings.Set(prefix + key, o[key]);
    Settings.Set(prefix + "zoom", zoom);

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

export class PrintForm extends Form {

    /* The prefix and the keys this dialog keeps, and the one read when it has
     * kept nothing yet: a subclass's. */
    get keyPrefix()   { return REPORT_KEY; }
    get keptKeys()    { return PRINT_KEPT; }
    get keyFallback() { return null; }

    /* The dialog up, modal, with what was kept last time. */
    start(project, path, log) {
        this.project = project;
        this.path    = path || "";
        this.log     = log || (() => {});
        this.Modal   = true;
        this.show(loadPrintOptions(this.keyPrefix, this.keptKeys, this.path,
                                   this.keyFallback),
                  Number(Settings.Get(this.keyPrefix + "zoom",
                         this.keyFallback
                             ? Settings.Get(this.keyFallback + "zoom", 0) : 0)) || 0);
        this.Show();
        return this;
    }

    /* The options into the fields, and the page built from them. The fields
     * raise their events as they are filled, so nothing is applied until all
     * of them say what they should. */
    show(o, zoom) {
        this.ready = false;

        this.CmbPaper.Items = Dictionary.Keys(Printer.Papers);
        this.CmbPaper.Text  = this.CmbPaper.Items.includes(o.paper) ? o.paper : "A4";

        this.TxtTitle.Text           = o.title;
        this.TxtTitle.Placeholder    = this.project.Name || File.Name(this.path) || "";
        this.TxtSubtitle.Text        = o.subtitle !== null && o.subtitle !== undefined
                                     ? String(o.subtitle)
                                     : String(this.project.Title || "");
        this.TxtLogo.Text            = o.logo || "";
        this.logo0                   = o.logo || "";
        this.ChkPath.Active          = !!o.path;
        this.CmbTasks.Index          = Math.max(0, REPORT_TASKS.indexOf(o.tasks));
        this.ChkSummaries.Active     = !!o.summaries;
        this.ChkStripes.Active       = !!o.stripes;
        const aligns = REPORT_ALIGNS.map((a) => Locale.Text(a || "Default"));
        for (const id in PRINT_COLUMNS) {
            const c     = PRINT_COLUMNS[id];
            const style = reportColumnStyle(o.columnStyles, id);
            this[c.check].Text   = reportColumnTitle(id);
            this[c.check].Active = o.columns.includes(id);
            this[c.width].Value  = style.width;
            this[c.align].Items  = aligns;
            this[c.align].Index  = Math.max(0, REPORT_ALIGNS.indexOf(style.align));
        }
        this.CmbOrientation.Index    = o.orientation === "Portrait" ? 0 : 1;
        this.SpnMargins.Value        = Math.round(o.margins / MM_POINT);
        this.CmbZoom.Index           = Math.max(0, Math.min(PRINT_ZOOMS.length - 1, zoom));
        this.showOwn(o);

        /* What is kept already, so opening the dialog and changing nothing
         * writes nothing. */
        this.kept  = this.keptOf(o);
        this.ready = true;
        this.rebuild();
    }

    /* What a subclass adds to the fields, and reads back from them. */
    showOwn(o)   { }
    ownOptions() { return {}; }

    /* What the fields say, as `planReport` and `ganttPrint` read it. */
    options() {
        return reportOptions({
            title:       this.TxtTitle.Text.trim(),
            subtitle:    this.TxtSubtitle.Text.trim(),
            logo:        this.TxtLogo.Text.trim(),
            path:        this.ChkPath.Active,
            tasks:       REPORT_TASKS[this.CmbTasks.Index] || "all",
            summaries:   this.ChkSummaries.Active,
            stripes:     this.ChkStripes.Active,
            columns:     Dictionary.Keys(PRINT_COLUMNS)
                             .filter((id) => this[PRINT_COLUMNS[id].check].Active),
            columnStyles: this.columnStyles(),
            paper:       this.CmbPaper.Text || "A4",
            orientation: this.CmbOrientation.Index === 0 ? "Portrait" : "Landscape",
            margins:     Math.round(Number(this.SpnMargins.Value || 0) * MM_POINT),
            ...this.ownOptions(),
        });
    }

    /* The widths and alignments the grid says. A column at its own width and
     * alignment is no exception, and is not remembered as one. */
    columnStyles() {
        const styles = {};
        for (const id in PRINT_COLUMNS) {
            const c     = PRINT_COLUMNS[id];
            const width = Math.max(0, Math.min(150,
                              Math.round(Number(this[c.width].Value) || 0)));
            const align = REPORT_ALIGNS[this[c.align].Index] || "";
            if (width || align) styles[id] = { width, align };
        }
        return styles;
    }

    rebuild() {
        if (!this.ready) return;
        const o = this.options();
        /* A column that is not printed has no width or alignment to give. */
        for (const id in PRINT_COLUMNS) {
            const c = PRINT_COLUMNS[id], on = this[c.check].Active;
            this[c.width].Enabled = on;
            this[c.align].Enabled = on;
        }
        this.render(o);
        this.zoom();
        this.showPage();
        this.keep(o);
    }

    /* The kept part of the options, as one string to compare: what moved is
     * what is written. The logo is kept apart from the rest, but a logo that
     * moved is a choice that moved. */
    keptOf(o) {
        const kept = { logo: o.logo };
        for (const key of this.keptKeys) kept[key] = o[key];
        return JSON.stringify([kept, this.CmbZoom.Index]);
    }

    /*
     * The choices are kept as they are made, and only when one moved: on the
     * way out the window may be going down with the program, and a value read
     * off a control then is not one to trust. Typing a title rebuilds on every
     * key and changes nothing kept, so it writes nothing.
     */
    keep(o) {
        const now = this.keptOf(o);
        if (now === this.kept) return;
        this.kept = now;
        savePrintOptions(this.keyPrefix, this.keptKeys, o, this.CmbZoom.Index,
                         this.path, o.logo !== this.logo0);
    }

    /* --- the page on screen ------------------------------------------------ */

    /*
     * The view always draws the whole page, scaled into whatever room it has
     * -- deliberately, it has no zoom of its own. So the zoom is the room: a fit
     * gives it the view, a scale gives it the paper's size and lets the scroller
     * do the rest.
     */
    zoom() {
        const z      = PRINT_ZOOMS[this.CmbZoom.Index] || "page";
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

    showPage() {
        const n = this.pageCount();
        this.LblPage.Text    = Locale.Text("{0} / {1}", this.pageNow(), n);
        this.BtnPrev.Enabled = this.pageNow() > 1;
        this.BtnNext.Enabled = this.pageNow() < n;
    }

    Form_Resize() {
        if (this.ready && PRINT_ZOOMS[this.CmbZoom.Index] === "width") this.zoom();
    }

    BtnPrev_Click() { this.turn(this.pageNow() - 1); }
    BtnNext_Click() { this.turn(this.pageNow() + 1); }

    CmbZoom_Select() {
        if (!this.ready) return;
        this.zoom();
        this.keep(this.options());
    }

    /* --- the options both carry -------------------------------------------- */

    TxtTitle_Change()       { this.rebuild(); }
    TxtSubtitle_Change()    { this.rebuild(); }
    TxtLogo_Change()        { this.rebuild(); }
    ChkPath_Click()         { this.rebuild(); }

    /* A logo is a file the print can carry, not a field of the plan: the
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

    SpnColStartWidth_Change()    { this.rebuild(); }
    SpnColFinishWidth_Change()   { this.rebuild(); }
    SpnColDurationWidth_Change() { this.rebuild(); }
    SpnColCompleteWidth_Change() { this.rebuild(); }
    SpnColCriticalWidth_Change() { this.rebuild(); }
    SpnColCostWidth_Change()     { this.rebuild(); }
    CmbColStartAlign_Select()    { this.rebuild(); }
    CmbColFinishAlign_Select()   { this.rebuild(); }
    CmbColDurationAlign_Select() { this.rebuild(); }
    CmbColCompleteAlign_Select() { this.rebuild(); }
    CmbColCriticalAlign_Select() { this.rebuild(); }
    CmbColCostAlign_Select()     { this.rebuild(); }
    CmbPaper_Select()       { this.rebuild(); }
    CmbOrientation_Select() { this.rebuild(); }
    SpnMargins_Change()     { this.rebuild(); }

    /* --- the ways out ------------------------------------------------------ */

    /* The save dialog's title and the file's suffix: a subclass's. */
    get saveTitle()  { return Locale.Text("Save the report"); }
    get saveSuffix() { return "report"; }

    BtnSave_Click() {
        const base = File.BaseName(this.path) || "plan";
        Dialog.SaveFile(this.saveTitle,
            { Folder: File.Directory(this.path), Name: `${base}-${this.saveSuffix}.pdf`,
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

    /* What the printer is told once the job is sent. */
    sent(job) {
        this.log(Locale.Text("Sent {0} copies of the report to the printer.", job.Copies));
    }

    BtnClose_Click() { this.Close(); }
}
