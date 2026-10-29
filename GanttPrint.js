/*
 * The plan printed as a Gantt: the table and the bars on paper, cut into sheets
 * the way a reader wants them rather than the way Project leaves them.
 *
 * **What Project gets wrong, and what this does instead.** Project fits a chart
 * to a page by shrinking it, so a plan of a year on one sheet is type nobody can
 * read, and a chart across several sheets carries its names on the first one
 * only -- the second sheet is bars with no task to say whose. Here:
 *
 * - **The width is the reader's choice, in sheets** (`wide`), and the timescale
 *   is worked out from it: the plan's span is spread over that many sheets of
 *   chart and the ruler steps by whatever fits there -- days, weeks or months --
 *   instead of the type getting smaller.
 * - **The table goes on every sheet** (`repeat`), the task's name and the
 *   columns chosen, so any sheet held up alone says which row is which; and
 *   **every sheet carries its own ruler**, with the dates it spans in its head.
 * - **The height follows the rows**: as many sheets down as the rows need, each
 *   one whole rows, shared out evenly, with no summary left alone at the foot
 *   of a sheet -- or a phase to a sheet (`ganttSheets`). Asked for fewer sheets
 *   down (`tall`), the rows get shorter, to a size that can still be read.
 * - **The dates printed are the reader's** (`from`, `to`), and **the legend
 *   names only what those dates show**.
 *
 * Pure in the sense `PlanReport` is: a project and the options in, a layout out
 * whose `draw(p, page, width, height, screen)` paints one sheet with any painter
 * -- the preview's, a PDF's (`Drawing.SavePdf`) or a printer's (`_DrawPage`).
 * What is previewed is what is saved and printed because it is one function.
 *
 * The chart itself is `drawGantt`'s, the one on screen, handed a slice of time
 * and a scroll: sheet `c` across is the range from where sheet `c - 1` ended,
 * at the same days per point, so a bar or a link that crosses from one sheet to
 * the next continues at the same height on the other side of the cut.
 */
"use strict";

/* The sizes of a sheet's parts, in points. A row is a little taller than the
 * screen's share of it would be, because a printed bar is read at arm's length
 * and the type is set at 8 points. A fit to fewer sheets down makes rows
 * shorter, to `PRINT_MIN_ROW` at the least -- below that a bar is a hairline
 * and the type is too small to read, and more sheets is the honest answer. */
const PRINT_ROW     = 18;
const PRINT_MIN_ROW = 9;
const PRINT_RULER   = 26;  // the timescale's two bands, which `drawGantt` fits
const PRINT_FOOT    = 14;
const PRINT_LEGEND  = 18;
const PRINT_NAME    = 170; // the name's width when nothing squeezes it
const PRINT_PAD     = 4;   // between a cell's edge and its words

/* A sheet is black on white whatever the screen is; these are the shades the
 * table is ruled with, matched to the chart's own on paper. */
const PRINT_INK   = "#000000";
const PRINT_HEAD  = "rgba(0,0,0,0.035)";
const PRINT_RULE  = "rgba(0,0,0,0.12)";
const PRINT_FAINT = "rgba(0,0,0,0.06)";
const PRINT_EDGE  = "rgba(0,0,0,0.30)";
const PRINT_ZEBRA = "rgba(0,0,0,0.045)";

/* The table's type for a row of `rowH` points: 8 points while a row is the
 * full height, and smaller with it when a fit has squeezed the rows. */
function printFonts(rowH) {
    const size = rowH >= 16 ? 8 : Math.max(5, Math.round(rowH * 0.5 * 2) / 2);
    return { plain: `Sans ${size}`, bold: `Sans Bold ${size}` };
}

/*
 * **The level a phase is**: the shallowest level at which there are at least
 * two summaries. A plan whose only top summary is the project's own has its
 * phases one level under it, and a plan with no summaries has no phases.
 */
function phaseLevel(tasks) {
    const count = {};
    for (const t of tasks)
        if (t.Summary) count[t.OutlineLevel] = (count[t.OutlineLevel] || 0) + 1;
    const levels = Dictionary.Keys(count).map(Number).sort((a, b) => a - b);
    for (const level of levels) if (count[level] >= 2) return level;
    return levels.length ? levels[0] : null;
}

/*
 * **Where the sheets down are cut**, as `[start, end)` row spans.
 *
 * Three rules, which are what Project does not do:
 *
 * - **A summary is never the last row of a sheet** when what it sums follows:
 *   a heading at the foot of one sheet and its tasks on the next is a heading
 *   over nothing, twice. The cut moves up to above it.
 * - **The rows are shared out evenly** among the sheets a stretch needs, so
 *   forty-four rows at forty a sheet are two sheets of twenty-two and not one
 *   full and one of four.
 * - With `phases`, **every phase starts a sheet of its own**: the rows are cut
 *   into stretches at each summary of the phase level first, and each stretch is
 *   paginated by the two rules above.
 * - With `pack` as well, **short phases share a sheet**: consecutive phases
 *   that fit whole on one are put together, so a plan of small phases is not a
 *   stack of half-empty pages. A phase is never split to fill one -- a phase
 *   that does not fit whole starts a sheet, as without `pack`.
 */
export function ganttSheets(tasks, per, phases, pack) {
    const stretches = [];
    const level = phases ? phaseLevel(tasks) : null;
    let from = 0;
    for (let i = 0; i < tasks.length; i++) {
        if (level === null || i === from) continue;
        const t = tasks[i];
        if (!t.Summary || t.OutlineLevel !== level) continue;
        /* What came before is only the phase's ancestors -- the project's own
         * summary over everything -- which belong with the first phase. */
        let body = false;
        for (let k = from; k < i; k++) if (tasks[k].OutlineLevel >= level) body = true;
        if (!body) continue;
        stretches.push([from, i]);
        from = i;
    }
    stretches.push([from, tasks.length]);

    if (pack) {
        for (let k = 0; k + 1 < stretches.length;) {
            const [a] = stretches[k], [, b] = stretches[k + 1];
            if (b - a <= per) stretches.splice(k, 2, [a, b]);
            else k++;
        }
    }

    const sheets = [];
    for (const [a, b] of stretches) {
        let start = a;
        if (b <= a) { sheets.push([a, a]); continue; }
        while (start < b) {
            const left = b - start;
            const need = Math.ceil(left / per);
            let cut = start + Math.ceil(left / need);
            if (cut < b)
                while (cut - 1 > start && tasks[cut - 1].Summary) cut--;
            sheets.push([start, cut]);
            start = cut;
        }
    }
    return sheets;
}

/*
 * What the legend explains: only what is on the sheets. A legend of everything
 * a chart could draw is a key to a map of somewhere else; this one has the
 * critical bar when there is a critical task, the diamond when there is a
 * milestone, today's line when today is in the range printed.
 */
function legendItems(tasks, fmt, range, calendar) {
    const items = [];
    const any = (f) => tasks.some(f);
    const plain = (t) => !t.Summary && !t.Milestone;
    if (any((t) => plain(t) && !(t.Critical && fmt.critical))) items.push("task");
    if (fmt.critical && any((t) => plain(t) && t.Critical)) items.push("critical");
    if (fmt.progress && any((t) => plain(t) && t.PercentComplete > 0)) items.push("progress");
    if (any((t) => t.Summary)) items.push("summary");
    if (any((t) => t.Milestone)) items.push("milestone");
    if (any((t) => baselineOf(t, BASELINE))) items.push("baseline");
    if (any((t) => {
        const d = whenMs(t.Deadline), f = whenMs(t.Finish);
        return d !== null && f !== null && d < f;
    })) items.push("deadline");
    const now = Date.now();
    if (fmt.today && range && now >= range.from && now <= range.to) items.push("today");
    if (fmt.idle && calendar && range && ganttIdleDays(range, calendar).length)
        items.push("idle");
    return items;
}

/* The words of each, written at the call so the extractor finds them. */
function legendText(kind) {
    switch (kind) {
    case "task":      return Locale.Text("Task");
    case "critical":  return Locale.Text("Critical task");
    case "progress":  return Locale.Text("Progress");
    case "summary":   return Locale.Text("Summary task");
    case "milestone": return Locale.Text("Milestone");
    case "baseline":  return Locale.Text("Baseline");
    case "deadline":  return Locale.Text("Missed deadline");
    case "today":     return Locale.Text("Today");
    case "idle":      return Locale.Text("Non-working time");
    }
    return kind;
}

/* A day as an instant: the start of `iso`'s day, or the end of it. Null for no
 * date, or for one that is not a date. */
function dayMs(iso, end) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
    if (!m) return null;
    return localMs(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + (end ? 1 : 0));
}

/*
 * The layout: what the sheets are and how many, and the drawing of each.
 *
 * `chart` is what the window knows and a project does not: the chart's format,
 * what a label beside a bar says (`labelOf`) and the calendar whose idle days
 * are shaded. Each may be missing, and the chart is then the default one.
 */
export function ganttPrint(project, path, options, chart) {
    const o = reportOptions(options);
    chart = chart || {};
    const fmt = ganttFormat(chart.format);

    const sheet = Printer.Papers[o.paper] || Printer.Papers.A4;
    const [pw, ph] = o.orientation === "Landscape" ? [sheet.Height, sheet.Width]
                                                   : [sheet.Width, sheet.Height];
    const m  = o.margins;
    const cw = Math.max(200, pw - 2 * m);
    const ch = Math.max(200, ph - 2 * m);

    const picks = reportPicks(project, o);
    const tasks = picks.map((pick) => pick.task);
    const wide  = o.wide;
    const calendar = chart.calendar !== undefined ? chart.calendar
                                                  : new WorkCalendar(project, -1);

    /* **The time printed**: the plan's, or the dates asked for -- each one on
     * its own, so "from today" leaves the end where the plan has it. A range
     * that ends before it starts is not one, and the plan's is printed. */
    const plan  = ganttRange(tasks);
    let range = plan;
    if (plan && (o.from || o.to)) {
        const from = dayMs(o.from, false), to = dayMs(o.to, true);
        const r = { from: from !== null ? from : plan.from, to: to !== null ? to : plan.to };
        if (r.to > r.from) range = r;
    }

    /* The legend is of what is *printed*: a task outside the dates asked for
     * draws nothing, and names nothing in the key. */
    const shown = !range ? tasks : tasks.filter((t) => {
        const s = whenMs(t.Start), f = whenMs(t.Finish);
        return s === null || f === null || (f >= range.from && s <= range.to);
    });
    const items = o.legend ? legendItems(shown, fmt, range, calendar) : [];
    const headH = o.path && path ? 40 : 26;
    const footH = PRINT_FOOT + (items.length ? PRINT_LEGEND : 0);

    if (o.mural)
        return ganttMural({ o, project, path, chart, fmt, pw, ph, m, cw, ch, picks, tasks,
                            calendar, range, items, headH, footH });
    const bodyH = ch - headH - footH;
    const room  = Math.max(PRINT_MIN_ROW, bodyH - PRINT_RULER);

    /* **The height of a row, and with it the sheets down.** At the full row
     * unless a number of sheets down was asked for and the rows do not fit it:
     * then the rows get shorter, half a point at a time, until they do or until
     * they would be too short to read. */
    let rowH = PRINT_ROW, per, sheets;
    for (;;) {
        per    = Math.max(1, Math.floor(room / rowH));
        sheets = ganttSheets(tasks, per, o.phases, o.pack);
        if (!o.tall || sheets.length <= o.tall || rowH <= PRINT_MIN_ROW) break;
        rowH = Math.max(PRINT_MIN_ROW, rowH - 0.5);
    }
    const tall  = sheets.length;
    const fonts = printFonts(rowH);

    /* The table at its natural width, unless that is more than the share of the
     * sheet it is given -- then the columns shrink together, as the report's do. */
    const chosen  = REPORT_COLUMNS.filter((c) => o.columns.includes(c.id));
    const natural = PRINT_NAME + chosen.reduce((sum, c) => sum + c.width * 0.8 + 8, 0);
    const tableW  = Math.round(Math.min(natural, cw * o.table / 100));
    const cols    = reportLayout(tableW - 2 * PRINT_PAD, o.columns);
    const tableOn = (c) => c === 0 || o.repeat ? tableW : 0;

    /* The chart's width on each sheet across, and where each starts in the
     * whole: a sheet with no table gives the chart the room the table took. */
    const chartW = (c) => cw - tableOn(c);
    const starts = [];
    let total = 0;
    for (let c = 0; c < wide; c++) { starts.push(total); total += chartW(c); }
    const slice = (c) => range && {
        from: range.from + starts[c] / total * (range.to - range.from),
        to:   range.from + (starts[c] + chartW(c)) / total * (range.to - range.from),
    };

    const title = o.title || project.Name || File.Name(path || "") || Locale.Text("Plan");
    const pages = wide * tall;
    const palette = ganttPalette(GANTT_PAPER, fmt.theme, fmt);

    /* Sheet `n` (one-based) is row `r` down and column `c` across, read the way
     * a page is: across first, then down. */
    const place = (n) => ({ r: Math.floor((n - 1) / wide), c: (n - 1) % wide });

    function draw(p, number, width, height, screen) {
        const n = Math.max(1, Math.min(pages, Math.round(Number(number) || 1)));
        const { r, c } = place(n);
        const [first, end] = sheets[r];
        const count = end - first;
        const used  = PRINT_RULER + count * rowH;

        /* The whole sheet, scaled to the frame and centred: `Translate` then
         * `Scale`, as the report does it, for the same reason. */
        const scale = Math.min(width / pw, height / ph);
        p.Push();
        p.Translate((width - pw * scale) / 2, (height - ph * scale) / 2);
        p.Scale(scale);

        p.Color = "#ffffff";
        p.Rectangle(0, 0, pw, ph);
        p.Fill();
        if (screen) {
            p.Color = "rgba(0,0,0,0.20)";
            p.LineWidth = 1;
            p.Rectangle(0.5, 0.5, pw - 1, ph - 1);
            p.Stroke();
        }

        p.Translate(m, m);
        drawHead(p, cw, headH, title, o.path ? path : "", slice(c));

        p.Push();
        p.Translate(0, headH);

        if (o.stripes) {
            p.Color = PRINT_ZEBRA;
            for (let i = 0; i < count; i++) {
                if ((first + i) % 2 === 0) continue;
                p.Rectangle(0, PRINT_RULER + i * rowH, cw, rowH);
                p.Fill();
            }
        }

        const left = tableOn(c);
        if (left > 0) drawTable(p, picks, first, count, cols, left, rowH, fonts);

        /* The chart is handed every row and scrolled to this sheet's first:
         * a link from a row on another sheet is still drawn, to the edge. */
        p.Push();
        p.Translate(left, 0);
        p.ClipRectangle(0, 0, chartW(c), used);
        drawGantt(p, chartW(c) + 8, used, tasks, null, 0, null, BASELINE, {
            plotX: 0, rowH, headH: PRINT_RULER, scrollY: first * rowH,
            calendar, format: fmt, labelOf: chart.labelOf,
            range: slice(c), print: true,
        });
        p.Pop();

        if (left > 0) {
            p.Color = PRINT_EDGE;
            p.LineWidth = 1;
            p.MoveTo(left - 0.5, 0);
            p.LineTo(left - 0.5, used);
            p.Stroke();
        }
        p.Pop();

        if (items.length) drawLegend(p, cw, ch - footH, items, palette);
        drawFoot(p, cw, ch, n, pages, wide > 1 || tall > 1 ? [r + 1, c + 1] : null);
        p.Pop();
    }

    return { width: pw, height: ph, pages, wide, tall, perPage: per, rowH, sheets,
             tableW, range, slice, legend: items, draw };
}

/* The legend, a line of swatches across the sheet above its foot, each drawn
 * the way the chart draws the thing it names and in the chart's colours. A
 * line that runs out of sheet stops rather than run off it. */
function drawLegend(p, cw, y, items, c) {
    p.Font = "Sans 7";
    const mid = y + PRINT_LEGEND / 2 - 1;
    let x = 0;
    for (const kind of items) {
        const text = legendText(kind);
        const w = 18 + 4 + p.TextWidth(text) + 14;
        if (x + w > cw) break;
        legendSwatch(p, kind, x, mid, c);
        p.Color = PRINT_INK;
        p.Text(text, x + 22, mid - p.TextHeight(text) / 2);
        x += w;
    }
}

function legendSwatch(p, kind, x, mid, c) {
    const bar = (color, w) => {
        p.Color = color;
        p.Rectangle(x, mid - 3, w, 6);
        p.Fill();
    };
    switch (kind) {
    case "task":     bar(c.bar, 18); break;
    case "critical": bar(c.late, 18); break;
    case "progress": bar(c.bar, 18); bar(c.progress, 10); break;
    case "summary":
        p.Color = "rgba(0,0,0,0.75)";
        p.Rectangle(x, mid - 2, 18, 3);
        p.Fill();
        p.Polygon([x, mid + 1, x + 4, mid + 1, x, mid + 5]);
        p.Fill();
        p.Polygon([x + 18, mid + 1, x + 14, mid + 1, x + 18, mid + 5]);
        p.Fill();
        break;
    case "milestone":
        p.Color = c.bar;
        p.Polygon([x + 9, mid - 5, x + 14, mid, x + 9, mid + 5, x + 4, mid]);
        p.Fill();
        break;
    case "baseline":
        p.Color = c.baseline;
        p.Rectangle(x, mid - 1, 18, 2);
        p.Fill();
        break;
    case "deadline":
        p.Color = c.late;
        p.Polygon([x + 9, mid + 3, x + 13, mid - 3, x + 5, mid - 3]);
        p.Fill();
        break;
    case "today":
        p.Color = c.today;
        p.LineWidth = 1;
        p.LineDash = [3, 2];
        p.MoveTo(x + 9, mid - 6);
        p.LineTo(x + 9, mid + 6);
        p.Stroke();
        p.LineDash = [];
        break;
    case "idle":
        p.Color = c.idle;
        p.Rectangle(x, mid - 6, 18, 12);
        p.Fill();
        p.Color = c.dim;
        p.LineWidth = 1;
        p.Rectangle(x + 0.5, mid - 5.5, 17, 11);
        p.Stroke();
        break;
    }
}

/* The head of a sheet: the title, the file it came from, and on the right the
 * dates this sheet's chart spans -- which, across several sheets, is the one
 * thing that tells two of them apart at a glance. */
function drawHead(p, cw, headH, title, path, span) {
    p.Color = PRINT_INK;
    p.Font = "Sans Bold 12";
    p.Text(title, 0, 0);
    if (path) {
        p.Font = "Sans 8";
        p.Text(path, 0, 20);
    }
    if (span) {
        p.Font = "Sans 8";
        const text = `${Locale.Date(span.from)} – ${Locale.Date(span.to)}`;
        p.Text(text, cw - p.TextWidth(text), 3);
    }
}

/* The foot: when it was printed, which sheet of the mural this is when there
 * is more than one, and the page. */
function drawFoot(p, cw, ch, n, pages, at) {
    const y = ch - PRINT_FOOT + 3;
    p.Color = PRINT_RULE;
    p.LineWidth = 1;
    p.MoveTo(0, y - 3.5);
    p.LineTo(cw, y - 3.5);
    p.Stroke();

    p.Color = PRINT_INK;
    p.Font = "Sans 8";
    p.Text(Locale.Text("Printed {0}", Locale.Date(Date.now())), 0, y);
    if (at) {
        const text = Locale.Text("Row {0}, column {1}", at[0], at[1]);
        p.Text(text, (cw - p.TextWidth(text)) / 2, y);
    }
    if (n === null) return;
    const page = Locale.Text("Page {0} of {1}", n, pages);
    p.Text(page, cw - p.TextWidth(page), y);
}

/* The table's width and columns: at its natural width, unless that is more
 * than the share of a sheet it is given -- then the columns shrink together, as
 * the report's do. */
function tableLayout(o, cw) {
    const chosen  = REPORT_COLUMNS.filter((c) => o.columns.includes(c.id));
    const natural = PRINT_NAME + chosen.reduce((sum, c) => sum + c.width * 0.8 + 8, 0);
    const width   = Math.round(Math.min(natural, cw * o.table / 100));
    return { width, cols: reportLayout(width - 2 * PRINT_PAD, o.columns) };
}

/* The sheet itself, white, scaled to the frame and centred -- `Translate` then
 * `Scale`, as the report does it, for the same reason -- with its edge drawn
 * when it is on a screen. The caller pops. */
function paperSheet(p, pw, ph, width, height, screen) {
    const scale = Math.min(width / pw, height / ph);
    p.Push();
    p.Translate((width - pw * scale) / 2, (height - ph * scale) / 2);
    p.Scale(scale);
    p.Color = "#ffffff";
    p.Rectangle(0, 0, pw, ph);
    p.Fill();
    if (screen) {
        p.Color = "rgba(0,0,0,0.20)";
        p.LineWidth = 1;
        p.Rectangle(0.5, 0.5, pw - 1, ph - 1);
        p.Stroke();
    }
}

/*
 * **The mural: one chart, cut into sheets that are glued back into it.**
 *
 * Where the paged print makes every sheet a document of its own -- its title,
 * its table, its ruler -- the mural draws the chart *once*, as one picture as
 * wide as the sheets across and as tall as the rows need: the title and the
 * ruler at the top of it, the table down its left side, the legend at its foot.
 * The picture is then cut into tiles of the printable area, and **neighbouring
 * tiles overlap** by `overlap` points: the strip at the right and bottom of a
 * tile is printed again at the left and top of the next, which is what the next
 * one is glued over. Nothing is lost to the cut, and a row cut in two by a
 * sheet's edge is whole again on the wall.
 *
 * What the margins carry, since they are cut away: **corner marks** for the
 * cut, **meeting marks** where the next tile's edge lands, the tile's place in
 * the mural and a small map of it. And, before the tiles, **an assembly guide**:
 * the whole mural on one page with the tiles drawn over it and numbered, which
 * is the one thing that makes twelve sheets on a table into a plan on a wall.
 */
function ganttMural(b) {
    const { o, project, path, chart, fmt, pw, ph, m, cw, ch, picks, tasks,
            calendar, range, items, headH, footH } = b;

    const lap   = Math.max(0, Math.min(o.overlap, cw / 4, ch / 4));
    const stepW = cw - lap, stepH = ch - lap;
    const wide  = o.wide;
    const W     = wide * stepW + lap;

    const { width: tableW, cols } = tableLayout(o, cw);
    const chartW = W - tableW;

    /* The rows at their full height, or shorter to fit the sheets down asked
     * for -- the mural's height is the picture's, not a count of pages. */
    const fixed  = headH + PRINT_RULER + footH;
    const tallOf = (rh) => Math.max(1, Math.ceil((fixed + tasks.length * rh - lap) / stepH));
    let rowH = PRINT_ROW;
    while (o.tall && tallOf(rowH) > o.tall && rowH > PRINT_MIN_ROW)
        rowH = Math.max(PRINT_MIN_ROW, rowH - 0.5);
    const tall  = tallOf(rowH);
    const H     = fixed + tasks.length * rowH;
    const fonts = printFonts(rowH);
    const used  = PRINT_RULER + tasks.length * rowH;

    const title   = o.title || project.Name || File.Name(path || "") || Locale.Text("Plan");
    const palette = ganttPalette(GANTT_PAPER, fmt.theme, fmt);
    const tiles   = wide * tall;
    const guide   = o.guide && tiles > 1 ? 1 : 0;
    const pages   = tiles + guide;

    /* The whole picture, in its own points from its top left. `from` is where
     * the part being looked at starts across: a tile right of the table has
     * no table to draw, and does not record one. */
    function picture(p, from) {
        drawHead(p, W, headH, title, o.path ? path : "", range);
        p.Push();
        p.Translate(0, headH);
        if (o.stripes) {
            p.Color = PRINT_ZEBRA;
            for (let i = 1; i < tasks.length; i += 2) {
                p.Rectangle(0, PRINT_RULER + i * rowH, W, rowH);
                p.Fill();
            }
        }
        if (!(from >= tableW))
            drawTable(p, picks, 0, tasks.length, cols, tableW, rowH, fonts);
        p.Push();
        p.Translate(tableW, 0);
        p.ClipRectangle(0, 0, chartW, used);
        drawGantt(p, chartW + 8, used, tasks, null, 0, null, BASELINE, {
            plotX: 0, rowH, headH: PRINT_RULER, scrollY: 0,
            calendar, format: fmt, labelOf: chart.labelOf, range, print: true,
        });
        p.Pop();
        p.Color = PRINT_EDGE;
        p.LineWidth = 1;
        p.MoveTo(tableW - 0.5, 0);
        p.LineTo(tableW - 0.5, used);
        p.Stroke();
        p.Pop();
        if (items.length) drawLegend(p, W, H - footH, items, palette);
        drawFoot(p, W, H, null, 0, null);
    }

    /* Tile `t` (zero-based) is row `r` down and column `c` across, across
     * first, as the paged print reads. */
    const tileAt = (t) => ({ r: Math.floor(t / wide), c: t % wide });

    function draw(p, number, width, height, screen) {
        const n = Math.max(1, Math.min(pages, Math.round(Number(number) || 1)));
        paperSheet(p, pw, ph, width, height, screen);
        p.Translate(m, m);
        if (n <= guide) {
            drawGuide(p, cw, ch, title, picture, W, H, wide, tall, stepW, stepH, lap, guide);
            p.Pop();
            return;
        }
        const { r, c } = tileAt(n - guide - 1);

        p.Push();
        p.ClipRectangle(0, 0, cw, ch);
        p.Translate(-c * stepW, -r * stepH);
        picture(p, c * stepW);
        p.Pop();

        /* Where the next tile's edge lands, in the strip it is glued over: a
         * faint dashed line that the glued sheet covers. */
        p.Color = "rgba(0,0,0,0.25)";
        p.LineWidth = 0.5;
        p.LineDash = [2, 2];
        if (lap > 0 && c < wide - 1) {
            p.MoveTo(cw - lap, 0);
            p.LineTo(cw - lap, ch);
            p.Stroke();
        }
        if (lap > 0 && r < tall - 1) {
            p.MoveTo(0, ch - lap);
            p.LineTo(cw, ch - lap);
            p.Stroke();
        }
        p.LineDash = [];

        drawMarks(p, cw, ch, m, lap, c < wide - 1, r < tall - 1);
        drawTileLabel(p, cw, ch, m, n, pages, r, c, wide, tall);
        p.Pop();
    }

    return { width: pw, height: ph, pages, wide, tall, rowH, tableW, range,
             legend: items, mural: { W, H, lap, stepW, stepH, guide }, draw };
}

/* Corner marks for the cut, in the margin and never on the picture, and the
 * meeting marks -- where the next tile's edge goes -- on the sides that have a
 * neighbour. A margin too thin to hold a mark holds none. */
function drawMarks(p, cw, ch, m, lap, right, below) {
    const len = Math.min(10, m - 3);
    if (len < 3) return;
    p.Color = PRINT_INK;
    p.LineWidth = 0.5;
    const tick = (x0, y0, x1, y1) => { p.MoveTo(x0, y0); p.LineTo(x1, y1); p.Stroke(); };
    for (const [x, y, dx, dy] of [[0, 0, -1, -1], [cw, 0, 1, -1],
                                  [0, ch, -1, 1], [cw, ch, 1, 1]]) {
        tick(x + dx * 2, y, x + dx * (2 + len), y);
        tick(x, y + dy * 2, x, y + dy * (2 + len));
    }
    if (right && lap > 0) {
        const x = cw - lap;
        p.Polygon([x, -2, x - 3, -2 - len / 2, x + 3, -2 - len / 2]);
        p.Fill();
        p.Polygon([x, ch + 2, x - 3, ch + 2 + len / 2, x + 3, ch + 2 + len / 2]);
        p.Fill();
    }
    if (below && lap > 0) {
        const y = ch - lap;
        p.Polygon([-2, y, -2 - len / 2, y - 3, -2 - len / 2, y + 3]);
        p.Fill();
        p.Polygon([cw + 2, y, cw + 2 + len / 2, y - 3, cw + 2 + len / 2, y + 3]);
        p.Fill();
    }
}

/* The tile's place, in the top margin: which row and column of the mural, the
 * page, and a map of the mural with this tile filled in. */
function drawTileLabel(p, cw, ch, m, n, pages, r, c, wide, tall) {
    if (m < 12) return;
    p.Font = "Sans 7";
    p.Color = "rgba(0,0,0,0.6)";
    const text = `${Locale.Text("Row {0}, column {1}", r + 1, c + 1)} · ` +
                 Locale.Text("Page {0} of {1}", n, pages);
    const th = p.TextHeight(text);
    p.Text(text, 14, -m + Math.max(1, (m - th) / 2 - 2));

    const cell = Math.max(2, Math.min(6, (m - 6) / Math.max(tall, 1)));
    const mapW = wide * cell, mapH = tall * cell;
    const x0 = cw - 14 - mapW, y0 = -m + (m - mapH) / 2;
    p.LineWidth = 0.5;
    for (let rr = 0; rr < tall; rr++)
        for (let cc = 0; cc < wide; cc++) {
            p.Color = rr === r && cc === c ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0.12)";
            p.Rectangle(x0 + cc * cell + 0.5, y0 + rr * cell + 0.5, cell - 1, cell - 1);
            p.Fill();
        }
}

/* The assembly guide: the whole mural shrunk onto one page, the tiles drawn
 * over it with the page each one is, and how to put them together. */
function drawGuide(p, cw, ch, title, picture, W, H, wide, tall, stepW, stepH, lap, guide) {
    p.Color = PRINT_INK;
    p.Font = "Sans Bold 12";
    p.Text(`${title} — ${Locale.Text("Assembly guide")}`, 0, 0);
    p.Font = "Sans 8";
    const steps = [
        Locale.Text("{0} sheets: {1} across and {2} down, in the order below.",
                    wide * tall, wide, tall),
        Locale.Text("Trim the margins of each sheet at the corner marks."),
        Locale.Text("Glue each sheet over the strip of its neighbour, with its edge on the meeting marks (▲ ▶)."),
    ];
    let y = 22;
    for (const line of steps) { p.Text(line, 0, y); y += 13; }
    y += 8;

    const fullH = tall * stepH + lap, fullW = W;
    const s = Math.min(cw / fullW, (ch - y) / fullH);
    p.Push();
    p.Translate((cw - fullW * s) / 2, y);
    p.Scale(s);
    p.Push();
    p.ClipRectangle(0, 0, fullW, fullH);
    picture(p, 0);
    p.Pop();
    p.LineWidth = 1 / s;
    for (let r = 0; r < tall; r++)
        for (let c = 0; c < wide; c++) {
            const x = c * stepW, yy = r * stepH, w = stepW + lap, h = stepH + lap;
            p.Color = "rgba(28,113,216,0.08)";
            p.Rectangle(x, yy, w, h);
            p.Fill();
            p.Color = "rgba(28,113,216,0.85)";
            p.Rectangle(x, yy, w, h);
            p.Stroke();
            const label = String(guide + r * wide + c + 1);
            p.Font = `Sans Bold ${Math.round(Math.min(w, h) * 0.18)}`;
            p.Color = "rgba(28,113,216,0.55)";
            p.Text(label, x + (w - p.TextWidth(label)) / 2, yy + (h - p.TextHeight(label)) / 2);
        }
    p.Pop();
}

/* The table beside the chart: a heading in the ruler's band and one line per
 * row, at the chart's own row height, so a row of the table and its bar are
 * one line across the sheet. */
function drawTable(p, picks, first, count, cols, width, rowH, fonts) {
    p.Color = PRINT_HEAD;
    p.Rectangle(0, 0, width, PRINT_RULER);
    p.Fill();

    p.Font = printFonts(PRINT_ROW).bold;
    for (const { col, x, width: w } of cols) {
        const text = col ? reportColumnTitle(col.id) : Locale.Text("Task");
        cell(p, text, PRINT_PAD + x, PRINT_RULER - PRINT_ROW, w, PRINT_ROW,
             (col && col.align) || "Left");
    }

    for (let i = 0; i < count; i++) {
        const { row } = picks[first + i];
        const y = PRINT_RULER + i * rowH;
        p.Font = row.Summary ? fonts.bold : fonts.plain;
        for (const { col, x, width: w } of cols) {
            cell(p, cellText(row, col), PRINT_PAD + x, y, w, rowH,
                 (col && col.align) || "Left");
        }
    }

    /* Ruled like the chart: a hairline under every row and a firmer one under
     * the heading. */
    p.LineWidth = 1;
    p.Color = PRINT_FAINT;
    for (let i = 1; i <= count; i++) {
        const y = PRINT_RULER + i * rowH - 0.5;
        p.MoveTo(0, y);
        p.LineTo(width, y);
        p.Stroke();
    }
    p.Color = PRINT_RULE;
    p.MoveTo(0, PRINT_RULER - 0.5);
    p.LineTo(width, PRINT_RULER - 0.5);
    p.Stroke();
}

/* What a row says in a column: the report's own values, so the table on paper
 * and the table of the report agree; a summary's cost is its tasks'. */
function cellText(row, col) {
    if (!col) return row.Task;
    if (col.id === "cost") {
        const v = row.Summary ? row.RollCost : row.Cost;
        return Locale.Currency(Number(v) || 0, 2);
    }
    return String(row[col.field] === undefined ? "" : row[col.field]);
}

/* One line of text in a cell, centred on the row and cut at the cell's edge
 * rather than run into the next column. */
function cell(p, text, x, y, w, h, align) {
    if (!text) return;
    const tw = p.TextWidth(text), th = p.TextHeight(text);
    const tx = align === "Right" ? x + w - tw : x;
    p.Push();
    p.ClipRectangle(x, y, w, h);
    p.Color = PRINT_INK;
    p.Text(text, tx, y + (h - th) / 2);
    p.Pop();
}
