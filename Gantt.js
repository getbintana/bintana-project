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
        strip:   !!g.strip,
    };
}

/* The plan's own rows, in file order: every task, summaries included, and no
 * blank row -- IsNull is nothing. **This is the whole plan, not the view**: the
 * chart draws the rows it is handed, and what it is handed is whatever the
 * table is showing, so a filtered list takes its rows out of the chart too. */
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
 * `rows` is **the table's own list**, not the plan: the two panes are two views
 * of the same rows, and a filter that takes rows out of the list takes them out
 * of the chart. `geom` is the table's too: where the plot starts, how tall a
 * row is, how tall the heading is and how far down the list is scrolled. Row
 * `i` is at `headH + i * rowH - scrollY`, which is the y the table draws it at,
 * so the two panes need not know about each other to agree.
 */
function ganttGeometry(rows, width, height, step, geom) {
    const g = chartGeometry(geom);
    const range = ganttRange(rows || []);
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
                 headH: g.headH, rowH: g.rowH, scrollY: g.scrollY, strip: g.strip,
                 x: () => 0, msAt: () => 0, rowAt: () => -1 };
    }

    const plotX = g.plotX, plotW = Math.max(width - g.plotX - 8, 50);
    const spanDays = (range.to - range.from) / DAY_MS;
    const dayW = plotW / spanDays;

    return {
        rows, range, plotX, plotW, dayW,
        headH: g.headH, rowH: g.rowH, scrollY: g.scrollY, strip: g.strip,
        x: (ms) => plotX + (ms - range.from) / (range.to - range.from) * plotW,
        msAt: (px) => range.from + (px - plotX) / plotW * (range.to - range.from),
        rowAt,
    };
}

/* A colour at an opacity: `#rrggbb`, or `rgb()`/`rgba()` the way the painter
 * reports its ink. Anything else comes back as it came. */
function fade(color, alpha) {
    const s = String(color || "");
    let m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(s);
    if (m) {
        const [r, g, b] = m.slice(1).map((h) => parseInt(h, 16));
        return `rgba(${r},${g},${b},${alpha})`;
    }
    m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(s);
    if (m) {
        const a = (m[4] === undefined ? 1 : Number(m[4])) * alpha;
        return `rgba(${m[1]},${m[2]},${m[3]},${a})`;
    }
    return color;
}

/*
 * The palette, in one place and named by role. **The ink is the theme's** --
 * `Painter.Foreground` is the resolved text colour of the widget, which is the
 * theme's unless a form set one -- and everything that is a *shade* rather than
 * a colour is an `rgba()` over whatever ground the widget has, so the chart
 * follows a light or a dark theme and the user's own accent instead of guessing
 * a background to sit on. What is left is the chart's own palette: two
 * coherent sets, one per ground, and every colour a frame can draw is here.
 */
function ganttPalette(p) {
    const dark = p.Dark;
    const ink = p.Foreground || (dark ? "#eeeeec" : "#2e3436");
    return {
        ink,
        /* A column heading's type: the theme's ink at 40%, the way Adwaita
         * writes it (`color-mix(currentColor 40%, transparent)`). */
        headInk:  fade(ink, 0.4),
        dim:      dark ? "rgba(255,255,255,0.13)" : "rgba(0,0,0,0.12)",
        faint:    dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)",
        head:     dark ? "rgba(255,255,255,0.045)" : "rgba(0,0,0,0.035)",
        idle:     dark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
        select:   dark ? "rgba(53,132,228,0.20)" : "rgba(28,113,216,0.13)",
        bar:      dark ? "#3584e4" : "#1c71d8",
        late:     dark ? "#e01b24" : "#c01c28",   // critical, as Project reads
        done:     dark ? "#1a5fb4" : "#0b4ea2",
        link:     dark ? "rgba(255,255,255,0.34)" : "rgba(0,0,0,0.34)",
        baseline: dark ? "rgba(255,255,255,0.42)" : "rgba(0,0,0,0.40)",
        today:    dark ? "#ff6b6b" : "#e01b24",
        /* Only a *file* gets a ground of its own, and only because a file has
         * none to inherit: the pane is the toolkit's and a picture is not. It is
         * a derivation, and it is the same one the runtime states for `Dark` --
         * if the ink is light the ground is dark -- rather than a guess at the
         * theme's, which no painter can ask for. */
        paper:    dark ? "#1e1e1e" : "#ffffff",
    };
}

/* The type of a ruler is not the type of a list: an axis wants a small one, and
 * the heading is 25 pixels tall whatever the theme says. **The two bands are
 * the point of the ruler -- a week over a month -- so the type gives way
 * before a band does**, down this ladder, and only a heading that cannot hold
 * two lines of the smallest of them loses the month. */
const RULER_FONTS = ["Sans 9", "Sans 8", "Sans 7"];

/* What a line of each of those needs, measured: the toolkit answers 19 pixels
 * for one line of the widget's own 13-point face, and a line of 9 points is
 * thirteen, of 8 is twelve, of 7 is eleven. Written down rather than asked for
 * in the loop below, because a painter's font and the measurement of it do not
 * take effect in the same turn -- the ladder is measured here, once, and the
 * frame only compares numbers. */
const RULER_LINE = [13, 12, 11];

/* The bands of the heading, the way Project reads a timescale: a week over a
 * month, and a day's gridlines falling from the week's edge. A band whose labels
 * would not fit is left out rather than drawn on top of each other. */
function ganttTimescaleBands(dayW) {
    const bands = [];
    if (dayW >= 6) bands.push({ step: 7, label: (d) => `${d.getDate()}/${d.getMonth() + 1}` });
    if (dayW >= 3) bands.push({ step: 30, label: (d) =>
        d.getMonth() === 0 ? `${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`
                           : `${d.getMonth() + 1}` });
    return bands;
}

/*
 * The days in the range the project's calendar does not work, as spans of
 * instants -- the shade behind the rows that makes a chart of a plan read as a
 * plan and not as a bar chart. It is the *project's* calendar, which is what
 * Project shades, and it is the file's own: a plan worked Monday to Friday gets
 * the weekend and nothing else, one worked Saturdays gets those.
 *
 * Capped at 2000 days, and the cap is the honest end of it: a file with a task
 * in 1970 and another in 2100 has a range no ruler could show either, and a
 * frame is not the place to find out. The grid has the same cap for the same
 * reason, and the two use the same day boundaries, so a shaded day is always a
 * ruled day.
 */
function ganttIdleDays(range, calendar) {
    const spans = [];
    if (!calendar || !range) return spans;

    const dayMs = DAY_MS;
    let t = Math.floor(range.from / dayMs) * dayMs;
    let open = null;
    for (let n = 0; n < 2000 && t <= range.to; n++, t += dayMs) {
        const idle = calendar.between(t, t + dayMs) <= 0;
        if (idle && open === null) open = t;
        if (!idle && open !== null) { spans.push([open, t]); open = null; }
    }
    if (open !== null) spans.push([range.to, t]);
    return spans;
}

/*
 * The timescale, in the band the table's column headings occupy.
 *
 * **On screen that band is a control**, the strip above the chart, which wears
 * the `view` class -- the ground a column view's heading sits on (its own
 * buttons are transparent, with dimmed type; `button` painted a grey
 * button instead). So the two headings are the same kind of thing rather
 * than one real and one drawn, and they cannot drift: same class, same height.
 * `strip` says the band is painted for us and only the marks are ours to draw.
 *
 * Where there is no strip -- a file, which carries its ruler in its own frame --
 * the band is drawn here as a shade over the ground, so it sits on the theme's
 * rather than guessing one.
 */
function drawGanttRuler(p, width, g, c) {
    const headH = g.headH;
    if (!(headH > 0)) return;
    /* The range is the geometry's, or the rows' own -- a file's frame carries
     * the one, a strip's the other, and both come from the same call. */
    const range = g.range || ganttRange(g.rows);
    const dayMs = DAY_MS;
    const dayW = g.dayW;

    if (!g.strip) {
        p.Color = c.head;
        p.Rectangle(0, 0, width, headH);
        p.Fill();
        p.Color = c.dim;
        p.LineWidth = 1;
        p.MoveTo(0, headH - 0.5);
        p.LineTo(width, headH - 0.5);
        p.Stroke();
    } else {
        /* The list's heading sits on the ground with a rule under it. */
        p.Color = c.dim;
        p.LineWidth = 1;
        p.MoveTo(0, headH - 0.5);
        p.LineTo(width, headH - 0.5);
        p.Stroke();
    }

    /* **The type gives way before a band does**, down the ladder above, and a
     * label that does not fit its own cell is not drawn at all: a month squeezed
     * into six pixels is four labels on top of each other, which is what the
     * first ruler did at a narrow timescale. */
    const bodyFont = p.Font;
    const bands = ganttTimescaleBands(dayW);
    let font = 0;
    while (font < RULER_FONTS.length - 1 &&
           bands.length > 1 && headH / bands.length < RULER_LINE[font]) font++;
    /* On screen the type is in the family the list writes in (a description
     * with no family is Pango's `Sans`, not the theme's). A file keeps the
     * ladder as written. */
    const family = String(bodyFont || "").replace(/\s+[\d.]+(px)?$/, "");
    p.Font = g.strip && family
        ? RULER_FONTS[font].replace(/^Sans/, family) : RULER_FONTS[font];
    while (bands.length > 1 && headH / bands.length < RULER_LINE[font]) bands.pop();
    const bandH = bands.length ? headH / bands.length : 0;
    const t0 = Math.floor(range.from / dayMs) * dayMs;
    p.LineWidth = 1;

    for (let b = 0; b < bands.length; b++) {
        const band = bands[b];
        const y = bandH * (b + 1);
        p.Color = c.faint;
        p.MoveTo(g.plotX, y);
        p.LineTo(width, y);
        p.Stroke();
        p.Color = c.dim;
        for (let t = t0, n = 0; t <= range.to; t += band.step * dayMs, n++) {
            if (n > 400) break;   // a corrupt range must not hang the frame
            const at = g.x(t);
            if (at > width) continue;
            p.MoveTo(at, y);
            p.LineTo(at, headH);
            p.Stroke();
            const label = band.label(new Date(t));
            if (p.TextWidth(label) + 6 <= band.step * dayW) {
                p.Color = g.strip ? c.headInk : c.ink;
                p.Text(label, at + 3, y - bandH + 2);
            }
        }
    }
    p.Font = bodyFont;
}

function drawGantt(p, width, height, rows, selected, step, drag, baseline, geom) {
    const g = ganttGeometry(rows, width, height, step, geom);
    rows = g.rows;
    if (!rows.length) {
        p.Text(Locale.Text("No tasks"), 12, 12);
        return;
    }
    if (!g.range) {
        p.Text(Locale.Text("No dated tasks"), 12, 12);
        return;
    }
    const range = g.range;
    const c = ganttPalette(p);

    const plotX = g.plotX, plotW = g.plotW;
    const x = g.x;
    const headH = g.headH, rowH = g.rowH;
    const top = (i) => headH + i * rowH - g.scrollY;      // row i's first pixel
    const cy = (i) => top(i) + rowH / 2;
    /* A bar is a fraction of the row rather than a constant: the row is the
     * theme's and a fixed 12 is a third of one theme's row and half of
     * another's. */
    const barH = Math.max(6, Math.min(14, Math.round(rowH * 0.38)));

    /* By UID, for the dependency elbows and the selection below. */
    const rowOf = {};
    for (let i = 0; i < rows.length; i++) rowOf[rows[i].UID] = i;

    /* A chart on the screen has no ground of its own -- the widget's is
     * transparent and the scroll view it is in is the surface a list is on --
     * but a chart written to a file has nothing behind it at all, so the file
     * carries one, put down before anything else. */
    if (geom.paper) {
        p.Color = c.paper;
        p.Rectangle(0, 0, width, height);
        p.Fill();
    }

    /* The heading: the same band the table's column headings sit in, with the
     * timescale in it, filled to the height the table says it is. It is a shade
     * and not a colour -- and the widget's own background is left alone, so the
     * chart and the list are on the *same ground* and the band is a tint of it
     * rather than a second surface with a seam down the divider.
     *
     * The ground is not drawn here at all: the chart wears the theme's own
     * `view` class, which is the class a theme paints a surface with and the
     * one a `GtkColumnView` wears itself -- the theme writes the list as
     * `columnview.view`, which is how this was found, on a real screen, after
     * two declarations of a colour that changed nothing.
     *
     * **The class and not a value, twice over.** A drawing area paints no
     * background of its own, so a `Background` set on it is a no-op -- and a
     * *drawn* one would be worse than no-op: the runtime writes a colour set on a
     * control into a stylesheet above the theme's, so it would mask the class
     * that works and the two would fight. The ink follows the same way round:
     * `.view` sets `color` as well as `background-color`, and `Painter.Foreground`
     * is the resolved ink of the widget, so the chart's text is the list's text
     * because the chart is the same kind of node.
     *
     * **The hairline under it is what makes the two headers read as one strip.**
     * A tinted band that stops without an edge looks like two panels; a rule
     * under both is the one thing that says they are a header, and it is the
     * rule GTK draws under a column view's own. */
    if (headH > 0) drawGanttRuler(p, width, g, c);

    /* The days that are not worked, behind the rows and behind the heading: the
     * same shade in both, so a shaded column reads as one column. */
    p.Color = c.idle;
    for (const [from, to] of ganttIdleDays(range, geom.calendar)) {
        const x0 = x(from), x1 = x(to);
        if (x1 <= plotX || x0 >= width) continue;
        p.Rectangle(x0, 0, Math.max(x1 - x0, 1), height);
        p.Fill();
    }

    /* One line per step the rows are ruled by, which is a week while a week fits
     * and whatever else does. */
    const dayMs = DAY_MS;
    const t0 = Math.floor(range.from / dayMs) * dayMs;
    if (!step) step = g.dayW >= 16 ? 1 : g.dayW >= 6 ? 7 : 30;
    p.Color = c.dim;
    for (let t = t0, n = 0; t <= range.to; t += step * dayMs, n++) {
        if (n > 400) break;
        p.MoveTo(x(t), headH);
        p.LineTo(x(t), height);
        p.Stroke();
    }

    /* The selected row, behind its bar. It is the row the table is
     * highlighting and it is painted where the table paints it, which is what a
     * chart beside a list is for. */
    const selRow = selected === null || selected === undefined
                 ? undefined : rowOf[selected];
    if (selRow !== undefined && top(selRow) < height && top(selRow) + rowH > headH) {
        p.Color = c.select;
        p.Rectangle(0, top(selRow), width, rowH);
        p.Fill();
    }

    /* Dependencies as elbows: out of the predecessor's end, down/across, into
     * the successor's start. **Under the bars and not over them** -- an elbow
     * crossing a bar is the one thing that made a dense plan unreadable, and
     * Project draws its arrows the same way round. */
    p.Color = c.link;
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

    /* The bars: a summary is a bracket over its dates, a milestone a diamond, a
     * zero span a tick, the rest a bar with its PercentComplete painted over in
     * a darker shade. Critical is red and the rest blue, as Project reads a
     * plan. */
    for (let i = 0; i < rows.length; i++) {
        const task = rows[i];
        const colour = task.Critical ? c.late : c.bar;
        const s = whenMs(task.Start), f = whenMs(task.Finish);
        const first = top(i);
        const y = first + (rowH - barH) / 2;

        /* A row that is off the pane draws nothing: the list scrolls and this
         * is the same scroll, so a plan of two thousand tasks is not a frame of
         * two thousand bars clipped to the ones that fit. */
        if (first + rowH <= headH || first >= height) continue;

        /* The name, only where there is a gutter to hold it -- which is a chart
         * that travels on its own, since the file of an export has no list. */
        if (plotX >= 120) {
            p.Push();
            p.ClipRectangle(0, 0, plotX - 8, height);
            p.Color = c.ink;
            p.Text(task.Milestone ? `◆ ${task.Name}` : task.Name, 8, first + 4);
            p.Pop();
        }

        if (s === null || f === null) continue;
        const x0 = x(Math.min(s, f)), x1 = x(Math.max(s, f));

        /* The baseline the view asked for, when the file carries it: a thin bar
         * under the task's own, which is what a slip is read against. */
        const kept = baselineOf(task, baseline || 0);
        if (kept) {
            const bs = whenMs(kept.Start), bf = whenMs(kept.Finish);
            if (bs !== null && bf !== null) {
                const gx0 = x(Math.min(bs, bf)), gx1 = x(Math.max(bs, bf));
                p.Color = c.baseline;
                p.Rectangle(gx0, y + barH + 1, Math.max(gx1 - gx0, 2), 2);
                p.Fill();
            }
        }

        /* A deadline the task is past, marked where it was promised: the little
         * red arrow Project draws over the bar. */
        const deadline = whenMs(task.Deadline);
        if (deadline !== null && deadline < f) {
            p.Color = c.late;
            const arrow = Math.max(5, barH * 0.55);
            p.Polygon([x(deadline), y - 1, x(deadline) + arrow / 2, y - 1 - arrow,
                       x(deadline) - arrow / 2, y - 1 - arrow]);
            p.Fill();
        }

        if (task.Summary) {
            const cap = y + 1, drop = Math.max(5, barH * 0.7);
            p.Color = colour;
            p.LineWidth = 2;
            p.Polyline([x0, cap, x0, cap + drop, x1, cap + drop, x1, cap]);
            p.Stroke();
            p.LineWidth = 1;
            continue;
        }
        if (task.Milestone) {
            const cx = x(s), midY = cy(i), r = Math.max(5, Math.round(barH * 0.62));
            p.Color = colour;
            p.Polygon([cx, midY - r, cx + r, midY, cx, midY + r, cx - r, midY]);
            p.Fill();
            continue;
        }
        if (x1 - x0 < 2) {
            p.Color = colour;
            p.LineWidth = 3;
            p.MoveTo(x0, y);
            p.LineTo(x0, y + barH);
            p.Stroke();
            p.LineWidth = 1;
            continue;
        }
        p.Color = colour;
        p.Rectangle(x0, y, x1 - x0, barH);
        p.Fill();
        /* The progress is a thinner band inside the bar, not a repaint of it: at
         * 100% a critical task is still visibly critical. */
        if (task.PercentComplete > 0) {
            const band = Math.max(2, Math.round(barH * 0.34));
            p.Color = c.done;
            p.Rectangle(x0, y + (barH - band) / 2,
                        (x1 - x0) * Math.min(task.PercentComplete, 100) / 100, band);
            p.Fill();
        }

        /* What the pointer is doing: an outline where the bar would land. The
         * model is not touched until the button is let go, so this is the whole
         * of the feedback and the whole of the undo. */
        if (drag && drag.uid === task.UID && drag.mode !== "link") {
            const px0 = x(Math.min(drag.start, drag.finish));
            const px1 = x(Math.max(drag.start, drag.finish));
            p.Color = c.ink;
            p.LineWidth = 2;
            p.Rectangle(px0, y - 2, Math.max(px1 - px0, 2), barH + 4);
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
                p.Color = c.link;
                p.LineWidth = 2;
                p.Polyline([x(f), cy(from), drag.px, cy(from), drag.px, drag.py]);
                p.Stroke();
                p.LineWidth = 1;
            }
        }
        if (drag.to !== null && drag.to !== undefined &&
            rowOf[drag.to] !== undefined) {
            p.Color = c.ink;
            p.Rectangle(plotX, top(rowOf[drag.to]), width - plotX, rowH);
            p.Stroke();
        }
    }

    /* Today, when it is on the chart. Dashed, so it reads as a ruler rather than
     * as a task. */
    const now = new Date().getTime();
    if (now >= range.from && now <= range.to) {
        p.Color = c.today;
        p.LineWidth = 1;
        p.LineDash = [4, 3];
        p.MoveTo(x(now), 0);
        p.LineTo(x(now), height);
        p.Stroke();
        p.LineDash = [];
    }
}
