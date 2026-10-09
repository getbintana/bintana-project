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
const REPORT_COLUMNS = [
    { id: "start",    field: "Start",    width: 70 },
    { id: "finish",   field: "Finish",   width: 70 },
    { id: "duration", field: "Duration", width: 60, align: "Right" },
    { id: "complete", field: "Complete", width: 60, align: "Right" },
    { id: "critical", field: "Critical", width: 60 },
    { id: "cost",     field: "Cost",     width: 80, align: "Right", format: "Money" },
];

/* The heading of each, written at the call so the extractor finds it. */
function reportColumnTitle(id) {
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
const REPORT_TASKS = ["all", "critical", "open"];

/* What a report is when nobody chose anything: the columns the old one had,
 * landscape A4, and the 40 points a `ReportDocument` defaults to (14 mm). */
const REPORT_DEFAULTS = {
    title:       "",
    path:        true,
    columns:     REPORT_COLUMNS.map((c) => c.id),
    tasks:       "all",
    summaries:   false,
    stripes:     false,
    paper:       "A4",
    orientation: "Landscape",
    margins:     40,
};

const REPORT_GAP     = 8;    // between two columns
const REPORT_NAME_W  = 120;  // the least the task's name is given
const REPORT_INDENT  = "    ";

/* The options with every key there, whatever was passed. */
function reportOptions(o) {
    const out = {};
    for (const key in REPORT_DEFAULTS) {
        out[key] = o && o[key] !== undefined ? o[key] : REPORT_DEFAULTS[key];
    }
    out.columns = REPORT_COLUMNS.map((c) => c.id).filter((id) => out.columns.includes(id));
    if (!REPORT_TASKS.includes(out.tasks)) out.tasks = "all";
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
        rows.push({
            Task:     indent + (t.Name || ""),
            Summary:  !!t.Summary,
            Start:    String(t.Start || "").slice(0, 10),
            Finish:   String(t.Finish || "").slice(0, 10),
            Duration: durationText(t, project),
            Complete: `${t.PercentComplete || 0}%`,
            Critical: t.Critical ? Locale.Text("Critical") : "",
            Cost:     t.Summary ? 0 : taskCost(project, t),
            RollCost: roll[i],
        });
    });
    return rows;
}

/* Where each column goes across the printable width: `[{ col, x, width }]`
 * with the task's name first. */
function reportLayout(width, ids) {
    const cols  = REPORT_COLUMNS.filter((c) => ids.includes(c.id));
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

/* The whole report: what a `ReportDocument` (or a `Report`) is filled with. */
function planReport(project, path, options) {
    const o = reportOptions(options);

    const sheet = Printer.Papers[o.paper] || Printer.Papers.A4;
    const [pw]  = o.orientation === "Landscape" ? [sheet.Height, sheet.Width]
                                                : [sheet.Width, sheet.Height];
    const width = Math.max(200, pw - 2 * o.margins);
    const cols  = reportLayout(width, o.columns);
    const right = cols[cols.length - 1].x + cols[cols.length - 1].width;

    const title = o.title || project.Name || File.Name(path || "") || Locale.Text("Plan");
    const headY = o.path && path ? 30 : 18;

    const header = [
        { Kind: "Text", Text: title, X: 0, Y: 0, Font: "Sans Bold 12" },
    ];
    if (o.path && path) header.push({ Kind: "Text", Text: path, X: 0, Y: 16, Font: "Sans 8" });

    const detail = [];
    if (o.stripes) {
        detail.push({ Kind: "Box", X: 0, Y: 0, Width: right, Height: "Band",
                      Fill: true, Color: "#eeeeee", When: "@Odd" });
    }

    for (const { col, x, width: w } of cols) {
        const text  = col ? reportColumnTitle(col.id) : Locale.Text("Task");
        const align = (col && col.align) || "Left";
        header.push({ Kind: "Text", Text: text, X: x, Y: headY, Width: w,
                      Align: align, Font: "Sans Bold 9" });

        const field = col ? col.field : "Task";
        const cell  = { Kind: "Field", Field: field, X: x, Y: 0, Width: w,
                        Align: align, Format: (col && col.format) || "" };

        if (col && col.id === "cost") {
            /* A summary shows what its tasks cost, a task its own. */
            detail.push({ ...cell, When: { Field: "Summary", IsNot: true } });
            detail.push({ ...cell, Field: "RollCost", Font: "Sans Bold 9",
                          When: { Field: "Summary", Is: true } });
        } else {
            detail.push({ ...cell, When: { Field: "Summary", IsNot: true } });
            detail.push({ ...cell, Font: "Sans Bold 9", When: { Field: "Summary", Is: true } });
        }
    }
    header.push({ Kind: "Line", Y1: headY + 16, X2: right, Y2: headY + 16, Color: "#999999" });

    const sections = {
        /* The page header sits at the top of every page and the rest flows
         * under it, so the title belongs here with the captions -- and it
         * repeats with them, which a plan across pages wants anyway. */
        PageHeader: { Height: headY + 18, Elements: header },
        Detail:     { Height: 15, Elements: detail },
        PageFooter: { Height: 16, Elements: [
            { Kind: "Field", Field: "@Page", X: right - 70, Y: 0, Width: 30,
              Align: "Right", Font: "Sans 8" },
            { Kind: "Text", Text: "/", X: right - 38, Y: 0, Font: "Sans 8" },
            { Kind: "Field", Field: "@Pages", X: right - 30, Y: 0, Width: 30, Font: "Sans 8" },
        ]},
    };

    const cost = cols.find((c) => c.col && c.col.id === "cost");
    if (cost) {
        sections.ReportFooter = { Height: 22, Elements: [
            { Kind: "Text", Text: Locale.Text("Total"), X: cost.x - 108, Y: 4,
              Width: 100, Align: "Right", Font: "Sans Bold 9" },
            { Kind: "Total", Field: "Cost", Op: "Sum", Format: "Money",
              X: cost.x, Y: 4, Width: cost.width, Align: "Right" },
        ]};
    }

    return {
        Paper:       o.paper,
        Orientation: o.orientation,
        Margins:     o.margins,
        Sections:    sections,
        Data:        reportRows(project, o),
    };
}

/* Into a `ReportDocument` or a `Report`: the paper first, since the bands are
 * measured against it, and the rows last, which is what measures. */
function fillReport(target, spec) {
    target.Paper       = spec.Paper;
    target.Orientation = spec.Orientation;
    target.Margins     = spec.Margins;
    target.Sections    = spec.Sections;
    target.Data        = spec.Data;
}
