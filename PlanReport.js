/*
 * The plan as a document: which rows, which columns, and the bands that lay
 * them out on the paper chosen.
 *
 * Pure -- a project and some options in, `{ Paper, Orientation, Margins,
 * Sections, Data }` out -- so the preview dialog, the command that saves a PDF
 * and the self-check all ask the same function, and a `ReportDocument` with no
 * window can be filled from it. It used to be `MainForm.buildReport`, written
 * into a `Report` control kept hidden on the main window for want of anywhere
 * else to put it; the control lives in `ReportForm` now, where it is seen.
 */
"use strict";

/* The columns a report can carry besides the task's name, in the order they
 * are drawn. The widths are points at their natural size; the name takes what
 * is left of the line, and on paper too narrow for all of them the rest are
 * shrunk together rather than run off the edge. */
export const REPORT_COLUMNS = [
    { id: "start",    field: "Start",    width: 70 },
    { id: "finish",   field: "Finish",   width: 70 },
    { id: "duration", field: "Duration", width: 60, align: "Right" },
    { id: "complete", field: "Complete", width: 60, align: "Right" },
    { id: "critical", field: "Critical", width: 60 },
    { id: "cost",     field: "Cost",     width: 80, align: "Right", format: "Money" },
];

/* The heading of each, written at the call so the extractor finds it. */
export function reportColumnTitle(id) {
    switch (id) {
    case "start":    return Locale.Text("Start");
    case "finish":   return Locale.Text("Finish");
    case "duration": return Locale.Text("Duration");
    case "complete": return Locale.Text("Complete");
    case "critical": return Locale.Text("Critical");
    case "cost":     return Locale.Text("Cost");
    }
    return id;
}

/* Which tasks, by the index of the dialog's combo. */
export const REPORT_TASKS = ["all", "critical", "open"];

/* What a report is when nobody chose anything: the columns the old one had,
 * landscape A4, and the 40 points a `ReportDocument` defaults to (14 mm). */
const REPORT_DEFAULTS = {
    title:       "",
    /* `null` means "the plan's own Title, when it has one": a report of a
     * Project file opens with the subtitle the file already carries, and an
     * empty string is how the reader takes it out. */
    subtitle:    null,
    notes:       "",
    notesWhere:  "footer",
    logo:        "",
    path:        true,
    columns:     REPORT_COLUMNS.map((c) => c.id),
    /* All the table's type, as a percentage of 9 points, and any column that
     * was given a width of its own (mm) or another alignment. */
    fontScale:   100,
    columnStyles: {},
    tasks:       "all",
    summaries:   false,
    stripes:     false,
    paper:       "A4",
    orientation: "Landscape",
    margins:     40,
    /* What is printed: the table alone, or the table beside the chart -- and
     * then how many sheets across the chart takes, and whether the table is
     * repeated on every one of them. */
    kind:        "table",
    wide:        1,
    repeat:      true,
    /* And how the chart is cut down and what it carries: how many sheets tall
     * at most (0 is as many as the rows need), the table's share of a sheet's
     * width in percent, a sheet per phase (and short ones together), the legend, and the days printed
     * (ISO dates; empty is the plan's own end). */
    tall:        0,
    table:       65,
    phases:      false,
    pack:        false,
    legend:      true,
    from:        "",
    to:          "",
    /* The mural: the chart drawn once and cut into sheets that overlap by
     * `overlap` points (7 mm) to be glued, with an assembly guide first. */
    mural:       false,
    overlap:     20,
    guide:       true,
};

/* What a report can be, by the index of the dialog's combo. */
export const REPORT_KINDS = ["table", "gantt"];

const REPORT_GAP     = 8;    // between two columns
const REPORT_NAME_W  = 120;  // the least the task's name is given
const REPORT_INDENT  = "    ";
const REPORT_MM_POINT = 72 / 25.4;

/* A column's own look, when the reader changed it: a width in millimetres
 * (0 asks for the content's), and an alignment that overrides the column's
 * own. The type size is the report's: one size for every column. */
export const REPORT_ALIGNS = ["", "Left", "Center", "Right"];

export function reportColumnStyle(styles, id) {
    const s = (styles && id && styles[id]) || {};
    const width = Math.round(Number(s.width) || 0);
    return {
        width: width > 0 ? Math.max(5, Math.min(150, width)) : 0,
        align: REPORT_ALIGNS.includes(s.align) ? s.align : "",
    };
}

/* The table's type size, from the percentage the dialog asks for: 9 points at
 * 100 %, and never smaller than a legible 6. */
export function reportFontSize(percent) {
    const pct = Math.max(50, Math.min(200, Math.round(Number(percent) || 100)));
    return Math.max(6, Math.round(9 * pct / 100));
}

/* A logo's path as the report reads it: relative names resolve against the
 * project, as every other file the app reads does, and an absolute one is
 * already where it says. `Probe.Image` is what says how big it is -- the report
 * places a picture, it does not measure one -- so a file that is not an image
 * is simply no logo, rather than a report that throws while drawing. */
function imageFile(path) {
    const text = String(path || "").trim();
    if (!text) return "";
    return /^([A-Za-z]:[\\/]|\/)/.test(text)
        ? text : File.Join(Application.Directory, text);
}

export function reportLogo(logo, maxWidth, maxHeight) {
    if (!logo) return null;
    const file = imageFile(logo);
    try {
        const size = Probe.Image(file);
        if (!size || !(size.Width > 0) || !(size.Height > 0)) return null;
        const scale = Math.min(maxWidth / size.Width, maxHeight / size.Height);
        return { File: file,
                 Width:  Math.max(1, Math.round(size.Width * scale)),
                 Height: Math.max(1, Math.round(size.Height * scale)) };
    } catch (e) {
        return null;
    }
}

/* The options with every key there, whatever was passed. */
export function reportOptions(o) {
    const out = {};
    for (const key in REPORT_DEFAULTS) {
        out[key] = o && o[key] !== undefined ? o[key] : REPORT_DEFAULTS[key];
    }
    out.columns = REPORT_COLUMNS.map((c) => c.id).filter((id) => out.columns.includes(id));
    out.fontScale = Math.max(50, Math.min(200, Math.round(Number(out.fontScale) || 100)));
    const given = out.columnStyles && typeof out.columnStyles === "object"
                ? out.columnStyles : {};
    const styles = {};
    for (const c of REPORT_COLUMNS) {
        const style = reportColumnStyle(given, c.id);
        if (style.width || style.align) styles[c.id] = style;
    }
    out.columnStyles = styles;
    if (!REPORT_TASKS.includes(out.tasks)) out.tasks = "all";
    if (!REPORT_KINDS.includes(out.kind)) out.kind = "table";
    if (out.notesWhere !== "header") out.notesWhere = "footer";
    out.wide = Math.max(1, Math.min(20, Math.round(Number(out.wide) || 1)));
    out.tall = Math.max(0, Math.min(20, Math.round(Number(out.tall) || 0)));
    out.table = Math.max(15, Math.min(70, Math.round(Number(out.table) || 45)));
    out.overlap = Math.max(0, Math.min(85, Math.round(Number(out.overlap) || 0)));
    for (const key of ["from", "to"])
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(out[key]))) out[key] = "";
    return out;
}

/*
 * The rows, in the plan's order.
 *
 * A filter keeps a task by what it is and a summary by what is under it: a
 * summary with nothing kept beneath it would be a heading over nothing. A
 * summary's cost is its tasks' added up, carried apart (`RollCost`) so the
 * report's total -- a `Sum` over `Cost` -- counts every task once.
 */
function reportRows(project, o) {
    return reportPicks(project, o).map((pick) => pick.row);
}

/* The same rows with the task each one is of: what a printed Gantt needs, since
 * its bars are drawn from the task and its table from the row. */
export function reportPicks(project, o) {
    const tasks = project.Tasks.filter((t) => !t.IsNull);
    const wants = (t) => o.tasks === "critical" ? !!t.Critical
                       : o.tasks === "open"     ? Number(t.PercentComplete || 0) < 100
                       : true;

    /* Backwards, so a summary knows about everything after it at once: the
     * tasks under a summary are the ones that follow it at a deeper level. */
    const kept = new Array(tasks.length).fill(false);
    const roll = new Array(tasks.length).fill(0);
    const open = [];   // summaries still collecting, innermost last

    for (let i = tasks.length - 1; i >= 0; i--) {
        const t = tasks[i];
        if (t.Summary) {
            let cost = 0, any = false;
            while (open.length && open[open.length - 1].level > t.OutlineLevel) {
                const under = open.pop();
                cost += under.cost;
                any = any || under.any;
            }
            kept[i] = any;
            roll[i] = cost;
            open.push({ level: t.OutlineLevel, cost, any });
        } else {
            const cost = taskCost(project, t);
            const here = wants(t);
            kept[i] = here;
            open.push({ level: t.OutlineLevel, cost, any: here });
        }
    }

    const rows = [];
    tasks.forEach((t, i) => {
        if (!kept[i] || (t.Summary && !o.summaries)) return;

        const indent = o.summaries
            ? REPORT_INDENT.repeat(Math.max(0, Number(t.OutlineLevel || 0) - 1)) : "";
        rows.push({ task: t, row: {
            Task:     indent + (t.Name || ""),
            Summary:  !!t.Summary,
            Start:    String(t.Start || "").slice(0, 10),
            Finish:   String(t.Finish || "").slice(0, 10),
            Duration: durationText(t, project),
            Complete: `${t.PercentComplete || 0}%`,
            Critical: t.Critical ? Locale.Text("Critical") : "",
            Cost:     t.Summary ? 0 : taskCost(project, t),
            RollCost: roll[i],
        } });
    });
    return rows;
}

/* Where each column goes across the printable width: `[{ col, x, width }]`
 * with the task's name first. */
export function reportLayout(width, ids, preferred, styles) {
    const cols  = REPORT_COLUMNS.filter((c) => ids.includes(c.id))
                               .map((c) => {
        const style = reportColumnStyle(styles, c.id);
        return { ...c,
                 width: preferred && preferred[c.id] ? preferred[c.id] : c.width,
                 align: style.align || c.align };
    });
    const gaps  = cols.length * REPORT_GAP;
    const fixed = cols.reduce((sum, c) => sum + c.width, 0);

    let scale = 1;
    let name  = width - fixed - gaps;
    if (name < REPORT_NAME_W && fixed > 0) {
        scale = Math.max(0.4, (width - REPORT_NAME_W - gaps) / fixed);
        name  = Math.max(REPORT_NAME_W / 2, width - fixed * scale - gaps);
    }

    const out = [{ col: null, x: 0, width: Math.floor(name) }];
    let x = name + REPORT_GAP;
    for (const c of cols) {
        const w = Math.floor(c.width * scale);
        out.push({ col: c, x: Math.floor(x), width: w });
        x += w + REPORT_GAP;
    }
    return out;
}

/* The width a column wants for its own heading and values, before the paper
 * says how much there is. Measuring the content is the first half of not
 * cutting a column; the ellipsis is the last resort, not the plan. A width the
 * reader set is taken as it is: that is what "manual" means. */
export function reportWidths(rows, ids, styles, fontPercent) {
    const out = {};
    const pt = reportFontSize(fontPercent);
    const normal = `Sans ${pt}`;
    const bold   = `Sans Bold ${pt}`;
    for (const c of REPORT_COLUMNS.filter((col) => ids.includes(col.id))) {
        const style = reportColumnStyle(styles, c.id);
        if (style.width > 0) {
            out[c.id] = Math.round(style.width * REPORT_MM_POINT);
            continue;
        }
        let widest = Text.Size(reportColumnTitle(c.id), bold).Width;
        for (const row of rows) {
            const value = c.id === "cost"
                        ? Locale.Currency(Number(row.Summary ? row.RollCost : row.Cost) || 0, 2)
                        : String(row[c.field] === undefined ? "" : row[c.field]);
            widest = Math.max(widest,
                              Text.Size(value, normal).Width,
                              row.Summary
                                  ? Text.Size(value, bold).Width : 0);
        }
        out[c.id] = Math.ceil(widest + 8);
    }
    return out;
}

/* A single line cut at the column's edge, with the ellipsis that says so.
 * `Text.Size` is the same measurement the report uses to lay the line out, so
 * the cut and the drawing agree. */
function clipText(text, width, font) {
    const value = String(text === undefined || text === null ? "" : text);
    if (!value || width <= 0) return "";
    if (Text.Size(value, font).Width <= width) return value;
    const ellipsis = "…";
    let low = 0, high = value.length;
    while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        if (Text.Size(value.slice(0, mid) + ellipsis, font).Width <= width)
            low = mid;
        else
            high = mid - 1;
    }
    return low > 0 ? value.slice(0, low) + ellipsis : ellipsis;
}

/* The rows as the table will draw them: the values the columns can hold, with
 * the long ones cut at their own width. A cost is left to `Format: "Money"`,
 * which the report draws; its column is measured from the same format above. */
function clipRows(rows, cols, fontPercent) {
    const pt = reportFontSize(fontPercent);
    const normal = `Sans ${pt}`;
    const bold   = `Sans Bold ${pt}`;
    return rows.map((row) => {
        const out = { ...row };
        const font = row.Summary ? bold : normal;
        for (const { col, width } of cols) {
            if (!col) {
                out.Task = clipText(row.Task, width - 4, font);
                continue;
            }
            if (col.id === "cost") {
                out.CostText = clipText(
                    Locale.Currency(Number(row.Cost) || 0, 2), width - 4, font);
                out.RollCostText = clipText(
                    Locale.Currency(Number(row.RollCost) || 0, 2), width - 4, font);
                continue;
            }
            out[col.field] = clipText(row[col.field], width - 4, font);
        }
        return out;
    });
}

/* The whole report: what a `ReportDocument` (or a `Report`) is filled with. */
export function planReport(project, path, options) {
    const o = reportOptions(options);

    const sheet = Printer.Papers[o.paper] || Printer.Papers.A4;
    const [pw]  = o.orientation === "Landscape" ? [sheet.Height, sheet.Width]
                                                : [sheet.Width, sheet.Height];
    const width = Math.max(200, pw - 2 * o.margins);
    const rows  = reportRows(project, o);
    const widths = reportWidths(rows, o.columns, o.columnStyles, o.fontScale);
    const cols  = reportLayout(width, o.columns, widths, o.columnStyles);
    const right = cols[cols.length - 1].x + cols[cols.length - 1].width;

    /* One type size for the whole table, headings included: the columns are
     * aligned and measured against the size they will be drawn in. */
    const fontPt = reportFontSize(o.fontScale);
    const font   = `Sans ${fontPt}`;
    const bold   = `Sans Bold ${fontPt}`;
    const headRow = Math.max(16, Math.ceil(fontPt * 1.7));

    const title = o.title || project.Name || File.Name(path || "") || Locale.Text("Plan");
    const subtitle = o.subtitle !== null && o.subtitle !== undefined
                   ? String(o.subtitle).trim() : String(project.Title || "").trim();
    const notes = String(o.notes || "").trim();
    const logo = reportLogo(o.logo, width * 0.25, 40);
    const textX = logo ? logo.Width + 16 : 0;
    const titleW = logo ? Math.max(120, width - textX) : width;

    /* The header's type is measured, not guessed: a title or a path that wraps
     * grows the band, and the column headings start below what was actually
     * written. The logo sits on the left, and the text keeps out of its way. */
    const header = [];
    let headerY = 0;
    const headText = (text, font, color) => {
        if (!text) return;
        const height = Text.Size(text, font, { Width: titleW }).Height;
        const element = { Kind: "Text", Text: text, X: textX, Y: headerY,
                          Width: titleW, Font: font, Wrap: true };
        if (color) element.Color = color;
        header.push(element);
        headerY += height + 2;
    };
    headText(title, "Sans Bold 12");
    if (subtitle && subtitle !== title) headText(subtitle, "Sans 9");
    if (o.path && path) headText(path, "Sans 8", "#555555");
    if (notes && o.notesWhere === "header") headText(notes, "Sans 9", "#444444");
    if (logo) {
        header.push({ Kind: "Image", File: logo.File, X: 0,
                      Y: 0, Width: logo.Width, Height: logo.Height });
    }

    const headY = Math.max(headerY + 2, logo ? logo.Height + 6 : 0, 18);

    const detail = [];
    if (o.stripes) {
        detail.push({ Kind: "Box", X: 0, Y: 0, Width: right, Height: "Band",
                      Fill: true, Color: "#eeeeee", When: "@Odd" });
    }

    for (const { col, x, width: w } of cols) {
        const text  = clipText(col ? reportColumnTitle(col.id) : Locale.Text("Task"),
                               w - 2, bold);
        const align = (col && col.align) || "Left";
        header.push({ Kind: "Text", Text: text, X: x, Y: headY, Width: w,
                      Align: align, Font: bold });

        const field = col ? col.field : "Task";
        const cell  = { Kind: "Field", Field: field, X: x, Y: 0, Width: w,
                        Align: align, Font: font,
                        Format: (col && col.format) || "" };

        if (col && col.id === "cost") {
            /* A summary shows what its tasks cost, a task its own. The text is
             * pre-clipped, so the cell keeps its number formatting without
             * running over the next column. */
            detail.push({ ...cell, Field: "CostText", Format: "",
                          When: { Field: "Summary", IsNot: true } });
            detail.push({ ...cell, Field: "RollCostText", Format: "",
                          Font: bold, When: { Field: "Summary", Is: true } });
        } else {
            detail.push({ ...cell, When: { Field: "Summary", IsNot: true } });
            detail.push({ ...cell, Font: bold, When: { Field: "Summary", Is: true } });
        }
    }
    header.push({ Kind: "Line", Y1: headY + headRow, X2: right, Y2: headY + headRow,
                  Color: "#999999" });

    /* The foot: a note by default, at the left, with the page number at the
     * right. A note that wraps grows the band once, and the page numbers stay
     * on its last line. */
    const foot = [
        { Kind: "Field", Field: "@Page", X: right - 70, Y: 0, Width: 30,
          Align: "Right", Font: "Sans 8" },
        { Kind: "Text", Text: "/", X: right - 38, Y: 0, Font: "Sans 8" },
        { Kind: "Field", Field: "@Pages", X: right - 30, Y: 0, Width: 30, Font: "Sans 8" },
    ];
    let footH = 16;
    if (notes && o.notesWhere !== "header") {
        const noteW = Math.max(120, right - 90);
        const noteH = Text.Size(notes, "Sans 9", { Width: noteW }).Height;
        footH = Math.max(16, noteH + 4);
        foot.unshift({ Kind: "Text", Text: notes, X: 0, Y: 0, Width: noteW,
                       Font: "Sans 9", Wrap: true, Color: "#444444" });
        for (const el of foot)
            if (el.Kind === "Field" || (el.Kind === "Text" && el.Text === "/"))
                el.Y = Math.max(0, footH - 12);
    }

    const sections = {
        /* The page header sits at the top of every page and the rest flows
         * under it, so the title belongs here with the captions -- and it
         * repeats with them, which a plan across pages wants anyway. */
        PageHeader: { Height: headY + headRow + 2, Elements: header },
        Detail:     { Height: Math.max(15, fontPt + 6), Elements: detail },
        PageFooter: { Height: footH, Elements: foot },
    };

    const cost = cols.find((c) => c.col && c.col.id === "cost");
    if (cost) {
        sections.ReportFooter = { Height: Math.max(22, fontPt + 8), Elements: [
            { Kind: "Text", Text: Locale.Text("Total"), X: cost.x - 108, Y: 4,
              Width: 100, Align: "Right", Font: bold },
            { Kind: "Total", Field: "Cost", Op: "Sum", Format: "Money",
              X: cost.x, Y: 4, Width: cost.width, Align: "Right", Font: bold },
        ]};
    }

    return {
        Paper:       o.paper,
        Orientation: o.orientation,
        Margins:     o.margins,
        Sections:    sections,
        Data:        clipRows(rows, cols, o.fontScale),
    };
}

/* Into a `ReportDocument` or a `Report`: the paper first, since the bands are
 * measured against it, and the rows last, which is what measures. */
export function fillReport(target, spec) {
    target.Paper       = spec.Paper;
    target.Orientation = spec.Orientation;
    target.Margins     = spec.Margins;
    target.Sections    = spec.Sections;
    target.Data        = spec.Data;
}
