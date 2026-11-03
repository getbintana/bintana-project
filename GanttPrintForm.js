/*
 * The Gantt chart on paper, seen before it leaves: the table and the bars cut
 * into sheets (`ganttPrint`, GanttPrint.js), drawn into a drawing area of the
 * dialog's own -- a `Report` lays out bands and has no room for a chart cut
 * across several sheets -- and from the same function to a PDF or the printer.
 *
 * Its own dialog, beside the report's (ReportForm): it was one with it, behind
 * a combo, and the chart's options came last in a column of everything. What
 * the two share -- the header, the columns, the paper, the zoom, the ways out
 * -- is `PrintForm`'s (PrintPreview.js).
 *
 * **The options are in the order a reader decides them**: the dates to print,
 * then the sheets -- separate or a mural, how many across and down -- and the
 * paper they are, then the rows and columns, the table's share, the bars, and
 * last the header, which is the project's by default and is seldom touched.
 */
"use strict";

/* The choices the chart keeps, between one print and the next. */
const GANTT_KEPT = [...PRINT_KEPT, "wide", "repeat", "tall", "table", "phases", "pack",
                    "legend", "mural", "overlap", "guide", "allLabels", "labelScale"];

/* What the last chart was printed with. Until it has kept anything of its own,
 * it reads what the report kept: the chart's choices lived there while the two
 * were one dialog. */
export function loadGanttPrintOptions(path) {
    return loadPrintOptions(GANTT_KEY, GANTT_KEPT, path, REPORT_KEY);
}

export class GanttPrintForm extends PrintForm {

    /*
     * GanttPrintForm.open(project, path, log, chart)
     *
     * `chart` is what the window's chart wears -- its format, its labels, its
     * calendar -- so the Gantt on paper is the one on screen.
     */
    static open(project, path, log, chart) {
        const dlg = new GanttPrintForm();
        dlg.chart  = chart || null;
        dlg.sheet  = 1;
        dlg.layout = null;
        return dlg.start(project, path, log);
    }

    get keyPrefix()   { return GANTT_KEY; }
    get keptKeys()    { return GANTT_KEPT; }
    get keyFallback() { return REPORT_KEY; }

    showOwn(o) {
        this.SpnWide.Value       = o.wide;
        this.ChkRepeat.Active    = !!o.repeat;
        this.ChkTall.Active      = o.tall > 0;
        this.SpnTall.Value       = Math.max(1, o.tall);
        this.SpnTable.Value      = o.table;
        this.ChkPhases.Active    = !!o.phases;
        this.ChkPack.Active      = !!o.pack;
        this.CmbOutput.Index     = o.mural ? 1 : 0;
        this.SpnOverlap.Value    = Math.round(o.overlap / MM_POINT);
        this.ChkGuide.Active     = !!o.guide;
        this.ChkLegend.Active    = !!o.legend;
        this.ChkAllLabels.Active = o.allLabels !== false;
        this.SpnLabelScale.Value = o.labelScale;
        this.DateFrom.Value      = o.from;
        this.DateTo.Value        = o.to;
    }

    ownOptions() {
        return {
            wide:       Number(this.SpnWide.Value || 1),
            repeat:     this.ChkRepeat.Active,
            tall:       this.ChkTall.Active ? Number(this.SpnTall.Value || 1) : 0,
            table:      Number(this.SpnTable.Value || 65),
            phases:     this.ChkPhases.Active,
            pack:       this.ChkPack.Active,
            mural:      this.CmbOutput.Index === 1,
            overlap:    Math.round(Number(this.SpnOverlap.Value || 0) * MM_POINT),
            guide:      this.ChkGuide.Active,
            legend:     this.ChkLegend.Active,
            allLabels:  this.ChkAllLabels.Active,
            labelScale: Number(this.SpnLabelScale.Value || 100),
            from:       this.DateFrom.Value || "",
            to:         this.DateTo.Value || "",
        };
    }

    render(o) {
        this.SpnTall.Enabled = this.ChkTall.Active;
        /* A mural is one picture: there is no sheet of its own for a phase to
         * start, nor a table to repeat -- and only a mural has an overlap and
         * a guide to assemble it by. What does not apply to the way out chosen
         * is not shown at all, rather than greyed: two or three dead controls
         * in sight, whichever was chosen, read as a dialog that is broken. */
        const mural = o.mural;
        this.ChkRepeat.Visible  = !mural;
        this.ChkPhases.Visible  = !mural;
        this.ChkPack.Visible    = !mural;
        this.ChkPack.Enabled    = this.ChkPhases.Active;
        this.OverlapRow.Visible = mural;
        this.ChkGuide.Visible   = mural;

        this.layout = ganttPrint(this.project, this.path, o, this.chart);
        this.sheet  = Math.max(1, Math.min(this.layout.pages, this.sheet));
        this.Sheet.Redraw();
    }

    view()      { return this.Sheet; }
    pageNow()   { return this.sheet; }
    pageCount() { return this.layout ? this.layout.pages : 1; }
    turn(n) {
        this.sheet = Math.max(1, Math.min(this.pageCount(), n));
        this.Sheet.Redraw();
        this.showPage();
    }

    /* The sheets: on screen with the paper's edge drawn, and to the printer one
     * sheet at a time, as `Printer` asks for them. */
    Sheet_Draw(p, width, height) {
        if (this.layout) this.layout.draw(p, this.sheet, width, height, true);
    }
    Sheet_DrawPage(p, page, width, height) {
        if (this.layout) this.layout.draw(p, page, width, height, false);
    }

    SpnWide_Change()       { this.rebuild(); }
    ChkRepeat_Click()      { this.rebuild(); }
    ChkTall_Click()        { this.rebuild(); }
    SpnTall_Change()       { this.rebuild(); }
    SpnTable_Change()      { this.rebuild(); }
    ChkPhases_Click()      { this.rebuild(); }
    ChkPack_Click()        { this.rebuild(); }
    CmbOutput_Select()     { this.rebuild(); }
    SpnOverlap_Change()    { this.rebuild(); }
    ChkGuide_Click()       { this.rebuild(); }
    ChkLegend_Click()      { this.rebuild(); }
    ChkAllLabels_Click()   { this.rebuild(); }
    SpnLabelScale_Change() { this.rebuild(); }
    DateFrom_Change()      { this.rebuild(); }
    DateTo_Change()        { this.rebuild(); }

    /* Back to the plan's own span: the pickers emptied, which only code can do. */
    BtnWholePlan_Click() {
        this.ready = false;
        this.DateFrom.Value = "";
        this.DateTo.Value   = "";
        this.ready = true;
        this.rebuild();
    }

    /* Every sheet, one file, at the paper's exact size in points, vector --
     * the text in it is text. */
    get saveTitle()  { return Locale.Text("Save the Gantt chart"); }
    get saveSuffix() { return "gantt"; }

    savePdf(path) {
        const lay = this.layout;
        Drawing.SavePdf(path, Math.round(lay.width), Math.round(lay.height), lay.pages,
                        (p, page, pw, ph) => lay.draw(p, page, pw, ph, false));
    }

    BtnPrint_Click() {
        const o = this.options();
        Printer.Send(this.Sheet, { Pages: this.layout.pages, Paper: o.paper,
                                   Orientation: o.orientation }, (job) => this.sent(job));
    }
}
