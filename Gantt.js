/*
 * Gantt: the project as bars on a timescale. Pure drawing over `Mspdi.js`.
 *
 * One deliberate simplification runs through it: the chart lays out its own
 * rows (every non-summary task, in file order) and never tries to line up
 * with the `TableView` beside it. Two controls sharing one row height is a
 * coupling that breaks on every theme; a chart that owns its geometry is a
 * `Save()` away from a PNG and a `Dump()` away from an assertion.
 *
 * Dates are instants (`new Date("2026-10-01T17:00:00")` reads local, which
 * is what a plan drawn on this machine means); durations never enter, only
 * Start/Finish. The header step adapts: days while they fit, weeks below
 * 16 px a day, months below 6.
 */
"use strict";

const GUTTER = 170;   // names live here, clipped
const HEADER = 24;    // the timescale's own row
const ROW_H  = 24;
const BAR_H  = 12;

/* What gets drawn, in file order. Summaries are structure and blank rows
 * are nothing: neither is a bar. */
function ganttRows(project) {
    const rows = [];
    for (const task of project.Tasks) {
        if (task.IsNull || task.Summary) continue;
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

function drawGantt(p, width, height, project) {
    const rows = project ? ganttRows(project) : [];
    if (!rows.length) {
        p.Text("No tasks", 12, 12);
        return;
    }
    const range = ganttRange(rows);
    if (!range) {
        p.Text("No dated tasks", 12, 12);
        return;
    }

    const dark  = p.Dark;
    const ink   = dark ? "#eeeeec" : "#2e3436";
    const grid  = dark ? "#3d3d3d" : "#d6d6d6";
    const bar   = dark ? "#78aeed" : "#1c71d8";
    const done  = dark ? "#1c71d8" : "#0b4ea2";
    const link  = dark ? "#9a9996" : "#5e5c64";
    const today = "#e01b24";

    const plotX = GUTTER, plotW = Math.max(width - GUTTER - 8, 50);
    const x = (ms) => plotX + (ms - range.from) / (range.to - range.from) * plotW;
    const cy = (i) => HEADER + i * ROW_H + ROW_H / 2;

    /* The grid and its labels, stepped to what fits. */
    const dayMs = 24 * 3600 * 1000;
    const spanDays = (range.to - range.from) / dayMs;
    const dayW = plotW / spanDays;
    const step = dayW >= 16 ? 1 : dayW >= 6 ? 7 : 30;
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

    /* By UID, for the dependency elbows below. */
    const rowOf = {};
    for (let i = 0; i < rows.length; i++) rowOf[rows[i].UID] = i;

    /* The bars: a milestone is a diamond, a zero span a tick, the rest a
     * bar with its PercentComplete painted over in a darker shade. */
    for (let i = 0; i < rows.length; i++) {
        const task = rows[i];
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

        if (task.Milestone) {
            const cx = x(s), midY = cy(i), r = 7;
            p.Color = bar;
            p.Polygon([cx, midY - r, cx + r, midY, cx, midY + r, cx - r, midY]);
            p.Fill();
            continue;
        }
        if (x1 - x0 < 2) {
            p.Color = bar;
            p.LineWidth = 3;
            p.MoveTo(x0, y);
            p.LineTo(x0, y + BAR_H);
            p.Stroke();
            p.LineWidth = 1;
            continue;
        }
        p.Color = bar;
        p.Rectangle(x0, y, x1 - x0, BAR_H);
        p.Fill();
        if (task.PercentComplete > 0) {
            p.Color = done;
            p.Rectangle(x0, y, (x1 - x0) * Math.min(task.PercentComplete, 100) / 100, BAR_H);
            p.Fill();
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
