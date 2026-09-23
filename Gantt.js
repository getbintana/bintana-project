/*
 * Gantt: the project as bars on a timescale. Pure drawing over `Mspdi.js`.
 *
 * One deliberate simplification runs through it: the chart lays out its own
 * rows (every task, in file order) and never tries to line up with the
 * `TableView` beside it. Two controls sharing one row height is a coupling
 * that breaks on every theme; a chart that owns its geometry is a `Save()`
 * away from a PNG and a `Dump()` away from an assertion. The two views share
 * **identity** instead: the selected UID tints a row here. Its size is its own
 * too -- as tall as its rows and as wide as the timescale asks -- and a
 * `Scroller` around it shows the difference.
 *
 * A summary is a bracket over its dates, a critical task is red and the rest
 * blue, which is the reading Project taught. Dates are instants
 * (`new Date("2026-10-01T17:00:00")` reads local, which is what a plan drawn
 * on this machine means); durations never enter, only Start/Finish. The
 * header step adapts: days while they fit, weeks below 16 px a day, months
 * below 6.
 */
"use strict";

const GUTTER = 170;   // names live here, clipped
const HEADER = 24;    // the timescale's own row
const ROW_H  = 24;
const BAR_H  = 12;

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
 */
function ganttGeometry(project, width, height, step) {
    const rows  = project ? ganttRows(project) : [];
    const range = ganttRange(rows);
    if (!rows.length || !range) {
        return { rows, range: null, plotX: 0, plotW: 0, dayW: 0,
                 x: () => 0, msAt: () => 0, rowAt: () => -1 };
    }

    const plotX = GUTTER, plotW = Math.max(width - GUTTER - 8, 50);
    const spanDays = (range.to - range.from) / DAY_MS;
    const dayW = plotW / spanDays;

    return {
        rows, range, plotX, plotW, dayW,
        x: (ms) => plotX + (ms - range.from) / (range.to - range.from) * plotW,
        msAt: (px) => range.from + (px - plotX) / plotW * (range.to - range.from),
        rowAt: (py) => {
            const i = Math.floor((py - HEADER) / ROW_H);
            return i >= 0 && i < rows.length ? i : -1;
        },
    };
}

function drawGantt(p, width, height, project, selected, step, drag) {
    const g = ganttGeometry(project, width, height, step);
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

    const plotX = g.plotX, plotW = g.plotW;
    const x = g.x;
    const cy = (i) => HEADER + i * ROW_H + ROW_H / 2;

    /* By UID, for the dependency elbows and the selection below. */
    const rowOf = {};
    for (let i = 0; i < rows.length; i++) rowOf[rows[i].UID] = i;

    /* The grid and its labels. `step` is the timescale control's choice in
     * days; without one it steps to what fits. */
    const dayMs = DAY_MS;
    const dayW = g.dayW;
    if (!step) step = dayW >= 16 ? 1 : dayW >= 6 ? 7 : 30;
    p.Color = grid;
    p.LineWidth = 1;
    const t0 = Math.floor(range.from / dayMs) * dayMs;
    for (let t = t0, n = 0; t <= range.to; t += step * dayMs, n++) {
        const d = new Date(t);
        p.MoveTo(x(t), HEADER - 4);
        p.LineTo(x(t), height);
        p.Stroke();
        p.Color = ink;
        const label = step === 1 ? String(d.getDate()) :
                      step === 7 ? `${d.getDate()}/${d.getMonth() + 1}` :
                      `${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`;
        p.Text(label, x(t) + 3, 4);
        p.Color = grid;
        if (n > 400) break;   // a corrupt range must not hang the frame
    }

    /* The selected row, behind its bar: the table and the chart share the UID
     * and nothing else. */
    const selRow = selected === null || selected === undefined
                 ? undefined : rowOf[selected];
    if (selRow !== undefined) {
        p.Color = band;
        p.Rectangle(0, HEADER + selRow * ROW_H, width, ROW_H);
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
        const y = HEADER + i * ROW_H + (ROW_H - BAR_H) / 2;

        /* The name, clipped to the gutter it lives in. */
        p.Push();
        p.ClipRectangle(0, 0, GUTTER - 8, height);
        p.Color = ink;
        p.Text(task.Milestone ? `◆ ${task.Name}` : task.Name, 8, HEADER + i * ROW_H + 5);
        p.Pop();

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

        /* The baseline, when the file carries one: a thin gray bar under the
         * task's own, which is what Project shows a slip against. */
        const baseline = baselineOf(task);
        if (baseline) {
            const bs = whenMs(baseline.Start), bf = whenMs(baseline.Finish);
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
            p.Rectangle(GUTTER, HEADER + rowOf[drag.to] * ROW_H, width - GUTTER, ROW_H);
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
        p.MoveTo(x(now), HEADER - 4);
        p.LineTo(x(now), height);
        p.Stroke();
        p.LineDash = [];
    }
}
