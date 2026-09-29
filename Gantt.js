/*
 * Gantt: the project as bars on a timescale. Pure drawing over `Mspdi.js`.
 *
 * **The chart's rows are the table's rows.** It used to lay out its own --
 * every task, in file order, at a row height of its own -- and the two views
 * shared *identity* only: the selected UID tinted a row here. Now the row
 * height, the height of the heading row and the scroll are the table's own
 * numbers (`TableView.RowHeight`, `HeaderHeight`, `ScrollY`), and the chart is
 * drawn beside the list in one `Split` with one vertical scroll between them.
 * A chart is still a `Save()` away from a PNG and a `Dump()` away from an
 * assertion, and a frame drawn at `head + i * row - scroll` is the row the
 * table is drawing, not a row that agrees with it by luck.
 *
 * A summary is a bracket over its dates, a critical task is red and the rest
 * blue, which is the reading Project taught. Dates are instants
 * (`new Date("2026-10-01T17:00:00")` reads local, which is what a plan drawn
 * on this machine means); durations never enter, only Start/Finish. The heading
 * carries the timescale in two bands -- weeks above, months below, as Project
 * does -- and the grid steps by whatever fits.
 */
"use strict";

const GUTTER = 170;   // the names, for a chart that travels on its own
const PAD    = 8;     // the chart's own margin when the list shows the names
const BAR_H  = 12;

/* What the chart uses before the table has been laid out, and what an
 * assertion compares against: a row is never taller than this, and the
 * fallback keeps a frame drawable while `RowHeight` is still 0. */
const ROW_H  = 24;
const HEADER = 24;

/* The chart's own geometry, read from the table beside it. The fallbacks are
 * what the first frame uses, before GTK has measured a row. */
function chartGeometry(geom) {
    const g = geom || {};
    return {
        plotX:   g.plotX !== undefined ? g.plotX : GUTTER,
        rowH:    g.rowH  > 0 ? g.rowH  : ROW_H,
        headH:   g.headH >= 0 && g.headH !== undefined ? g.headH : HEADER,
        scrollY: g.scrollY > 0 ? g.scrollY : 0,
    };
}

/* What gets drawn, in file order: every task the tree shows, summaries
 * included, and no blank row -- IsNull is nothing. */
function ganttRows(project) {
    const rows = [];
    for (const task of project.Tasks) {
        if (task.IsNull) continue;
        rows.push(task);
    }
    return rows;
}

function whenMs(text) {
    const ms = new Date(String(text || "")).getTime();
    return isNaN(ms) ? null : ms;
}

/* The chart's time, padded a day each side so end bars never touch the edge.
 * Null when nothing has two dates to stand on. */
function ganttRange(rows) {
    let from = null, to = null;
    for (const task of rows) {
        const s = whenMs(task.Start), f = whenMs(task.Finish);
        if (s === null || f === null) continue;
        if (from === null || s < from) from = s;
        if (to === null || f > to) to = f;
    }
    if (from === null || to === null || to < from) return null;
    const day = 24 * 3600 * 1000;
    return { from: from - day, to: to + day };
}

/*
 * The layout a frame and a pointer share: the rows, the range and the mapping
 * between pixels and instants. `drawGantt` paints from it and the mouse
 * handlers hit-test with it, so a bar is exactly where the pointer thinks it
 * is -- two spellings of the geometry would drift.
 *
 * `geom` is the table's own: where the plot starts, how tall a row is, how tall
 * the heading is and how far down the list is scrolled. Row `i` is at
 * `headH + i * rowH - scrollY`, which is the y the table draws it at, so the
 * two panes need not know about each other to agree.
 */
function ganttGeometry(project, width, height, step, geom) {
    const g = chartGeometry(geom);
    const rows  = project ? ganttRows(project) : [];
    const range = ganttRange(rows);
    /* The heading is drawn *over* the rows -- it is the table's own, and the
     * table does not scroll it away -- so a point in that band is over the
     * heading and not over a row, however the arithmetic would place one. */
    const rowAt = (py) => {
        if (py < g.headH) return -1;
        const i = Math.floor((py - g.headH + g.scrollY) / g.rowH);
        return i >= 0 && i < rows.length ? i : -1;
    };
    if (!rows.length || !range) {
        return { rows, range: null, plotX: g.plotX, plotW: 0, dayW: 0,
                 headH: g.headH, rowH: g.rowH, scrollY: g.scrollY,
                 x: () => 0, msAt: () => 0, rowAt: () => -1 };
    }

    const plotX = g.plotX, plotW = Math.max(width - g.plotX - 8, 50);
    const spanDays = (range.to - range.from) / DAY_MS;
    const dayW = plotW / spanDays;

    return {
        rows, range, plotX, plotW, dayW,
        headH: g.headH, rowH: g.rowH, scrollY: g.scrollY,
        x: (ms) => plotX + (ms - range.from) / (range.to - range.from) * plotW,
        msAt: (px) => range.from + (px - plotX) / plotW * (range.to - range.from),
        rowAt,
    };
}

/* The two bands of the heading, the way Project reads a timescale: a week over
 * a month, and the day's gridlines falling from the week's edge. A band whose
 * labels would not fit is left out rather than drawn on top of each other --
 * below about six pixels a day a week is unreadable, and a month is the only
 * band that survives. */
function ganttTimescaleBands(dayW) {
    const bands = [];
    if (dayW >= 6) bands.push({ step: 7, label: (d) => `${d.getDate()}/${d.getMonth() + 1}` });
    if (dayW >= 3) bands.push({ step: 30, label: (d) =>
        d.getMonth() === 0 ? `${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`
                           : `${d.getMonth() + 1}` });
    return bands;
}

function drawGantt(p, width, height, project, selected, step, drag, baseline, geom) {
    const g = ganttGeometry(project, width, height, step, geom);
    const rows = g.rows;
    if (!rows.length) {
        p.Text(Locale.Text("No tasks"), 12, 12);
        return;
    }
    if (!g.range) {
        p.Text(Locale.Text("No dated tasks"), 12, 12);
        return;
    }
    const range = g.range;

    const dark  = p.Dark;
    const ink   = dark ? "#eeeeec" : "#2e3436";
    const grid  = dark ? "#3d3d3d" : "#d6d6d6";
    const bar   = dark ? "#78aeed" : "#1c71d8";
    const late  = dark ? "#f66151" : "#c01c28";   // critical, as Project reads
    const done  = dark ? "#1c71d8" : "#0b4ea2";
    const link  = dark ? "#9a9996" : "#5e5c64";
    const today = "#e01b24";
    const band  = dark ? "#2f2f2f" : "#eaeaea";
    const head  = dark ? "#353535" : "#f6f5f4";

    const plotX = g.plotX, plotW = g.plotW;
    const x = g.x;
    const headH = g.headH, rowH = g.rowH;
    const top = (i) => headH + i * rowH - g.scrollY;      // row i's first pixel
    const cy = (i) => top(i) + rowH / 2;

    /* By UID, for the dependency elbows and the selection below. */
    const rowOf = {};
    for (let i = 0; i < rows.length; i++) rowOf[rows[i].UID] = i;

    /* The heading: the same band the table's column headings sit in, with the
     * timescale in it. A frame is drawn at the height the table says it is, so
     * a taller theme's heading is filled to its edge instead of leaving a gap
     * the list's rows do not. */
    if (headH > 0) {
        p.Color = head;
        p.Rectangle(0, 0, width, headH);
        p.Fill();
    }

    /* The grid and its labels, falling from the heading into the rows. */
    const dayMs = DAY_MS;
    const dayW = g.dayW;
    const bands = ganttTimescaleBands(dayW);
    const bandH = headH > 0 ? headH / bands.length : 0;
    p.Color = grid;
    p.LineWidth = 1;
    const t0 = Math.floor(range.from / dayMs) * dayMs;
    for (const band of bands) {
        const y = bandH * (bands.indexOf(band) + 1);
        p.Color = grid;
        p.MoveTo(0, y);
        p.LineTo(width, y);
        p.Stroke();
        for (let t = t0, n = 0; t <= range.to; t += band.step * dayMs, n++) {
            const d = new Date(t);
            if (n > 400) break;   // a corrupt range must not hang the frame
            if (x(t) > width) continue;
            p.Color = grid;
            p.MoveTo(x(t), y);
            p.LineTo(x(t), headH);
            p.Stroke();
            p.Color = ink;
            p.Text(band.label(d), x(t) + 3, y - bandH + 3);
        }
    }
    /* One line per step the rows are ruled by, which is a week while a week
     * fits and whatever else does. */
    if (!step) step = dayW >= 16 ? 1 : dayW >= 6 ? 7 : 30;
    p.Color = grid;
    for (let t = t0, n = 0; t <= range.to; t += step * dayMs, n++) {
        if (n > 400) break;
        p.MoveTo(x(t), headH);
        p.LineTo(x(t), height);
        p.Stroke();
    }

    /* The selected row, behind its bar. It is the row the table is highlighting
     * and it is painted where the table paints it, which is what a chart beside
     * a list is for. */
    const selRow = selected === null || selected === undefined
                 ? undefined : rowOf[selected];
    if (selRow !== undefined && top(selRow) < height && top(selRow) + rowH > headH) {
        p.Color = band;
        p.Rectangle(0, top(selRow), width, rowH);
        p.Fill();
    }

    /* The bars: a summary is a bracket over its dates, a milestone a diamond,
     * a zero span a tick, the rest a bar with its PercentComplete painted over
     * in a darker shade. Critical is red and the rest blue, as Project reads
     * a plan. */
    for (let i = 0; i < rows.length; i++) {
        const task = rows[i];
        const colour = task.Critical ? late : bar;
        const s = whenMs(task.Start), f = whenMs(task.Finish);
        const first = top(i);
        const y = first + (rowH - BAR_H) / 2;

        /* A row that is off the pane draws nothing: the list scrolls and this
         * is the same scroll, so a plan of two thousand tasks is not a frame of
         * two thousand bars clipped to the ones that fit. */
        if (first + rowH <= headH || first >= height) continue;

        /* The name, only where there is a gutter to hold it -- which is a chart
         * that travels on its own, since the file of an export has no list. */
        if (plotX >= 120) {
            p.Push();
            p.ClipRectangle(0, 0, plotX - 8, height);
            p.Color = ink;
            p.Text(task.Milestone ? `◆ ${task.Name}` : task.Name, 8, first + 4);
            p.Pop();
        }

        if (s === null || f === null) continue;
        const x0 = x(Math.min(s, f)), x1 = x(Math.max(s, f));

        /* A deadline the task is past, marked where it was promised: the
         * little red arrow Project draws over the bar. */
        const deadline = whenMs(task.Deadline);
        if (deadline !== null && deadline < f) {
            p.Color = late;
            p.Polygon([x(deadline), y - 2, x(deadline) + 5, y - 9,
                       x(deadline) - 5, y - 9]);
            p.Fill();
        }

        /* The baseline the view asked for, when the file carries it: a thin
         * gray bar under the task's own, which is what Project shows a slip
         * against. */
        const kept = baselineOf(task, baseline || 0);
        if (kept) {
            const bs = whenMs(kept.Start), bf = whenMs(kept.Finish);
            if (bs !== null && bf !== null) {
                const gx0 = x(Math.min(bs, bf)), gx1 = x(Math.max(bs, bf));
                p.Color = link;
                p.Rectangle(gx0, y + BAR_H + 1, Math.max(gx1 - gx0, 2), 3);
                p.Fill();
            }
        }

        if (task.Summary) {
            const top = y + 2;
            p.Color = colour;
            p.LineWidth = 2;
            p.Polyline([x0, top, x0, top + 8, x1, top + 8, x1, top]);
            p.Stroke();
            p.LineWidth = 1;
            continue;
        }
        if (task.Milestone) {
            const cx = x(s), midY = cy(i), r = 7;
            p.Color = colour;
            p.Polygon([cx, midY - r, cx + r, midY, cx, midY + r, cx - r, midY]);
            p.Fill();
            continue;
        }
        if (x1 - x0 < 2) {
            p.Color = colour;
            p.LineWidth = 3;
            p.MoveTo(x0, y);
            p.LineTo(x0, y + BAR_H);
            p.Stroke();
            p.LineWidth = 1;
            continue;
        }
        p.Color = colour;
        p.Rectangle(x0, y, x1 - x0, BAR_H);
        p.Fill();
        /* The progress is a thinner band inside the bar, not a repaint of it:
         * at 100% a critical task is still visibly critical. */
        if (task.PercentComplete > 0) {
            const band = 4, by = y + (BAR_H - band) / 2;
            p.Color = done;
            p.Rectangle(x0, by, (x1 - x0) * Math.min(task.PercentComplete, 100) / 100, band);
            p.Fill();
        }

        /* What the pointer is doing: an outline where the bar would land. The
         * model is not touched until the button is let go, so this is the
         * whole of the feedback and the whole of the undo. */
        if (drag && drag.uid === task.UID && drag.mode !== "link") {
            const px0 = x(Math.min(drag.start, drag.finish));
            const px1 = x(Math.max(drag.start, drag.finish));
            p.Color = ink;
            p.LineWidth = 2;
            p.Rectangle(px0, y - 2, Math.max(px1 - px0, 2), BAR_H + 4);
            p.Stroke();
            p.LineWidth = 1;
        }
    }

    /* A dependency being drawn: an elbow from the dragged bar to the pointer,
     * and the row it would land on outlined. */
    if (drag && drag.mode === "link") {
        const from = rowOf[drag.uid];
        if (from !== undefined) {
            const f = whenMs(rows[from].Finish);
            if (f !== null) {
                p.Color = link;
                p.LineWidth = 2;
                p.Polyline([x(f), cy(from), drag.px, cy(from), drag.px, drag.py]);
                p.Stroke();
                p.LineWidth = 1;
            }
        }
        if (drag.to !== null && drag.to !== undefined &&
            rowOf[drag.to] !== undefined) {
            p.Color = ink;
            p.Rectangle(plotX, top(rowOf[drag.to]), width - plotX, rowH);
            p.Stroke();
        }
    }

    /* Dependencies as elbows: out of the predecessor's end, down/across,
     * into the successor's start. One shape for every link type in cut 1. */
    p.Color = link;
    p.LineWidth = 1;
    for (let i = 0; i < rows.length; i++) {
        const task = rows[i];
        const s = whenMs(task.Start);
        if (s === null) continue;
        for (const edge of task.Links) {
            const from = rowOf[edge.PredecessorUID];
            if (from === undefined) continue;
            const pred = rows[from];
            const f = whenMs(pred.Finish);
            if (f === null) continue;
            const x0 = x(f), x1 = x(s), elbow = Math.max(x0, x1) + 8;
            p.Polyline([x0, cy(from), elbow, cy(from), elbow, cy(i), x1, cy(i)]);
            p.Stroke();
        }
    }

    /* Today, when it is on the chart. Dashed, so it reads as a ruler. */
    const now = new Date().getTime();
    if (now >= range.from && now <= range.to) {
        p.Color = today;
        p.LineDash = [4, 3];
        p.MoveTo(x(now), 0);
        p.LineTo(x(now), height);
        p.Stroke();
        p.LineDash = [];
    }
}
