/*
 * Schedule: working time, and the calculation over it.
 *
 * MSPDI dates are instants and durations are working time: an 8h task that
 * starts Monday 08:00 finishes Monday 17:00, not Tuesday, and the task after
 * it starts the next working moment. `WorkCalendar` answers that arithmetic
 * for one calendar -- its week days, its working times, its exceptions, and
 * the base calendar it inherits from.
 *
 * `recalculate` is the pass Project runs with `ScheduleFromStart`: forward,
 * every task with no predecessor starts at the project start and every other
 * one as soon as its links allow, with the hard constraints (`ConstraintType`
 * MSO/MFO/SNET/FNET) applied on top; backward, every link pulls its
 * predecessor's latest dates back and the slack that leaves -- **which is kept,
 * as `LateStart`, `LateFinish`, `TotalSlack` and `FreeSlack`, the four fields
 * the file carries and the backward pass used to work out and throw away** --
 * and zero slack marks a task critical; and then a summary is the span of the
 * deeper tasks that follow it. A `Deadline`
 * is a target and not a constraint: it is modelled and never schedules
 * anything, and the same is true of the two "no later than" constraints --
 * those tasks are scheduled as early as their links allow and `notMet` counts
 * the dates they passed. ALAP keeps the dates the file wrote, because placing
 * it late is Project's backward pass and not this one. Resource calendars are
 * not here yet.
 */
"use strict";

const DAY_MS = 24 * 3600 * 1000;
const MIN_MS = 60 * 1000;
const HOUR_MS = 60 * MIN_MS;

/* MSPDI's constraint types. The forward pass honors MSO, MFO, SNET and FNET;
 * ALAP and the two "no later than" constraints need Project's own backward
 * scheduling, so a task carrying one keeps the dates the file wrote. */
const CONSTRAINT_ALAP = 1, CONSTRAINT_MSO = 2, CONSTRAINT_MFO = 3,
      CONSTRAINT_SNET = 4, CONSTRAINT_SNLT = 5, CONSTRAINT_FNET = 6,
      CONSTRAINT_FNLT = 7;

/* "08:00:00" or "08:00" as minutes from midnight. */
function clockMinutes(text) {
    const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(text || ""));
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]) + (m[3] ? Number(m[3]) / 60 : 0);
}

/* A `<WorkingTime>` as minutes from midnight, or null when it is not one. A
 * `ToTime` of midnight is the end of the day -- the built-in "24 Hours"
 * calendar writes 00:00 to 00:00 -- and not an empty span. */
function clockSpan(wt) {
    const from = clockMinutes(wt.FromTime);
    let to = clockMinutes(wt.ToTime);
    if (from === null || to === null) return null;
    if (to === 0) to = 1440;
    return to > from ? [from, to] : null;
}

/* A local instant as the `YYYY-MM-DDTHH:MM:SS` Project writes. */
function isoLocal(ms) {
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T` +
           `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/*
 * **A wall-clock moment, checked against the clock it names.** Turning local
 * fields into an instant is where a runtime has to know which offset applies,
 * and the QuickJS Bintana runs gets it wrong next to a change: it looks the
 * offset up at the wrong instant, so in America/Santiago, where the clocks go
 * back at midnight on 2026-04-05, `new Date(2026, 3, 5)` answers 23:00 of the
 * 4th. Node and the spec say 00:00 of the 5th. A day that starts on the
 * previous day never ends, and the calendar walk spun. So the answer is read
 * back, and when its fields are not the ones asked for, the hour either side
 * is tried; a moment the clock skips altogether keeps what the runtime said.
 */
function localMs(year, month, day, hours = 0, minutes = 0, seconds = 0) {
    const want = new Date(Date.UTC(year, month, day, hours, minutes, seconds));
    const fits = (ms) => {
        const d = new Date(ms);
        return d.getFullYear() === want.getUTCFullYear() &&
               d.getMonth()    === want.getUTCMonth()    &&
               d.getDate()     === want.getUTCDate()     &&
               d.getHours()    === want.getUTCHours()    &&
               d.getMinutes()  === want.getUTCMinutes();
    };
    const t = new Date(year, month, day, hours, minutes, seconds).getTime();
    if (fits(t)) return t;
    for (const step of [HOUR_MS, -HOUR_MS])
        if (fits(t + step)) return t + step;
    return t;
}

/* A file's `YYYY-MM-DDTHH:MM:SS`, read as the local moment it names. */
function whenMs(text) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(text || ""));
    if (m) return localMs(Number(m[1]), Number(m[2]) - 1, Number(m[3]),
                          Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
    const ms = new Date(String(text || "")).getTime();
    return isNaN(ms) ? null : ms;
}

class WorkCalendar {

    days = {};        // DayType 1..7 -> [[from, to], ...], minutes from midnight
    exceptions = {};  // "YYYY-MM-DD" -> spans, or null for a day that is not worked

    constructor(project, uid) {
        const byUID = {};
        for (const cal of project.Calendars) byUID[cal.UID] = cal;

        /* Base first, derived over it: a calendar overrides what it declares
         * and inherits the rest. The calendar is the task's own `CalendarUID`
         * when the file named one -- Project writes -1 for "the project's",
         * and that is the default here too -- and a file with no calendar at
         * all gets the schema's own day: Monday to Friday, 08:00 to 17:00. */
        const chain = [];
        let cal = byUID[uid] || byUID[project.CalendarUID] || null, guard = 0;
        while (cal && guard++ < 16) {
            chain.unshift(cal);
            cal = cal.BaseCalendarUID ? (byUID[cal.BaseCalendarUID] || null) : null;
        }
        if (!chain.length) {
            for (let d = 1; d <= 7; d++)
                this.days[d] = d === 1 || d === 7 ? [] : [[480, 1020]];
            return;
        }

        for (const step of chain) {
            for (const wd of step.WeekDays) {
                const spans = [];
                for (const wt of wd.WorkingTimes) {
                    const span = clockSpan(wt);
                    if (span) spans.push(span);
                }
                this.days[wd.DayType] = wd.DayWorking ? spans : [];
            }
            for (const ex of step.Exceptions) {
                const period = ex.TimePeriod;
                if (!period) continue;
                const from = whenMs(period.FromDate), to = whenMs(period.ToDate);
                if (from === null || to === null) continue;
                const spans = [];
                for (const wt of ex.WorkingTimes) {
                    const span = clockSpan(wt);
                    if (span) spans.push(span);
                }
                for (let day = this.#dayStart(from); day <= to; day = this.#nextDay(day))
                    this.exceptions[this.#dayKey(day)] = ex.DayWorking ? spans : null;
            }
        }
        for (let d = 1; d <= 7; d++) if (!this.days[d]) this.days[d] = [];

        /* A calendar that declares no working day at all -- a base calendar
         * the file left empty -- gets the schema's own week: Monday to
         * Friday, 08:00 to 17:00. Without this there is no working moment to
         * advance to and the arithmetic would spin. */
        let any = false;
        for (let d = 1; d <= 7; d++) if (this.days[d].length) any = true;
        if (!any)
            for (let d = 1; d <= 7; d++)
                this.days[d] = d === 1 || d === 7 ? [] : [[480, 1020]];
    }

    /* `minutes` of work after `start`. An instant at the end of a span has no
     * work left in it, so 8h from Monday 17:00 lands on Tuesday 17:00 and 0
     * minutes lands on the same instant -- which is what a finish-to-finish
     * link needs. */
    add(start, minutes) {
        /* A negative amount is a lead, and a lead is working time too: 8h
         * before Monday 10:00 is Friday 10:00, not Monday 02:00. */
        if (minutes < 0) return this.subtract(start, -minutes);
        let t = start, left = minutes;
        for (let guard = 0; guard < 100000; guard++) {
            let end = this.#spanEndAt(t);
            if (end === null) {
                t = this.#nextWorking(t);
                end = this.#spanEndAt(t);
            }
            const avail = (end - t) / MIN_MS;
            if (left <= avail) return t + left * MIN_MS;
            left -= avail;
            t = this.#nextWorking(end);
        }
        return t;
    }

    /* `minutes` of work before `finish`, the mirror of `add`. */
    subtract(finish, minutes) {
        if (minutes < 0) return this.add(finish, -minutes);
        let t = finish, left = minutes;
        for (let guard = 0; guard < 100000; guard++) {
            let from = this.#spanStartAt(t);
            if (from === null) {
                t = this.#previousWorking(t);
                from = this.#spanStartAt(t);
            }
            const avail = (t - from) / MIN_MS;
            if (left <= avail) return t - left * MIN_MS;
            left -= avail;
            t = this.#previousWorking(from);
        }
        return t;
    }

    /* The mirror of `startAfter`: the last working moment at or before `ms`
     * -- the **end** of a span. Monday 08:00 is the start of work and has none
     * of it before it, so it answers Friday 17:00: the same moment of work,
     * said the way a finish date is. */
    finishAt(ms) {
        const from = this.#spanStartAt(ms);
        if (from !== null && from < ms) return ms;
        return this.#previousWorking(from === null ? ms : from);
    }

    /* The first working moment at or after `ms`: a task never starts in the
     * middle of the night or at the end of a shift. */
    startAfter(ms) {
        const end = this.#spanEndAt(ms);
        if (end !== null && ms < end) return ms;
        return this.#nextWorking(end === null ? ms : end);
    }

    /* Working minutes between two instants, which is what a duration read off
     * two dates means. */
    between(a, b) {
        if (b <= a) return 0;
        let total = 0, t = a;
        for (let guard = 0; guard < 100000 && t < b; guard++) {
            let end = this.#spanEndAt(t);
            if (end === null) {
                t = this.#nextWorking(t);
                if (t >= b) break;
                end = this.#spanEndAt(t);
            }
            total += (Math.min(end, b) - t) / MIN_MS;
            if (end >= b) break;
            t = this.#nextWorking(end);
        }
        return total;
    }

    #dayKey(ms) {
        const d = new Date(ms);
        const p = (n) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }

    /* **Days are stepped on the calendar and spans read off the clock**, never
     * as multiples of 24 hours from midnight: on the day the clocks change a
     * day is 23 or 25 hours long, and midnight plus 24h was 23:00 of the same
     * day -- the walk stood still until its guard ran out and a task finished
     * in 1970. Every one goes through `localMs`, which checks the runtime's
     * answer (see there). */
    #dayStart(ms) {
        const d = new Date(ms);
        return localMs(d.getFullYear(), d.getMonth(), d.getDate());
    }

    #nextDay(day) {
        const d = new Date(day);
        return localMs(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    }

    #previousDay(day) {
        const d = new Date(day);
        return localMs(d.getFullYear(), d.getMonth(), d.getDate() - 1);
    }

    /* `minutes` after midnight on `day`, as the wall clock reads them. */
    #clock(day, minutes) {
        const d = new Date(day);
        const whole = Math.floor(minutes);
        return localMs(d.getFullYear(), d.getMonth(), d.getDate(), 0, whole,
                       Math.round((minutes - whole) * 60));
    }

    #spansOn(ms) {
        const key = this.#dayKey(ms);
        if (key in this.exceptions) return this.exceptions[key] || [];
        return this.days[new Date(ms).getDay() + 1] || [];
    }

    /* The day's spans as instants. */
    #instantsOn(day) {
        return this.#spansOn(day).map(([from, to]) =>
            [this.#clock(day, from), this.#clock(day, to)]);
    }

    /* The end of the span `ms` sits in **or ends**, or null when it is
     * outside every span. An end counts: 17:00 has no work left today. Where
     * two spans touch, the instant between them belongs to the later one,
     * which is the one with work left in it. */
    #spanEndAt(ms) {
        const spans = this.#instantsOn(this.#dayStart(ms));
        for (const [a, b] of spans) if (ms >= a && ms < b) return b;
        for (const [, b] of spans) if (ms === b) return b;
        return null;
    }

    /* The mirror: where two spans touch, the instant belongs to the earlier
     * one, which is the one with work before it. */
    #spanStartAt(ms) {
        const day = this.#dayStart(ms);
        const spans = this.#instantsOn(day);
        for (const [a, b] of spans) if (ms > a && ms <= b) return a;
        /* **Midnight ends yesterday's span too**: a shift to 24:00 (the 24
         * Hours calendar, a night shift) has its work before 00:00, and
         * answering today's 00:00 left `subtract` standing still on it. */
        if (ms === day)
            for (const [a, b] of this.#instantsOn(this.#previousDay(day)))
                if (ms > a && ms <= b) return a;
        for (const [a] of spans) if (ms === a) return a;
        return null;
    }

    /* The first instant at or after `ms` with work after it. */
    #nextWorking(ms) {
        let day = this.#dayStart(ms);
        for (let guard = 0; guard < 3660; guard++) {
            for (const [a, b] of this.#instantsOn(day))
                if (b > ms) return Math.max(ms, a);
            day = this.#nextDay(day);
        }
        return ms;
    }

    /* The last instant at or before `ms` with work before it. */
    #previousWorking(ms) {
        let day = this.#dayStart(ms);
        for (let guard = 0; guard < 3660; guard++) {
            const spans = this.#instantsOn(day);
            for (let i = spans.length - 1; i >= 0; i--)
                if (spans[i][0] < ms) return Math.min(ms, spans[i][1]);
            day = this.#previousDay(day);
        }
        return ms;
    }
}

/*
 * **A link's lag, applied.** `LinkLag` is tenths of a minute whatever the
 * format; the format says whether those minutes are working time on the
 * calendar or clock time (an elapsed format, "2ed"), which goes through
 * nights and weekends alike.
 */
/* A lag in percent (19, 20, 51, 52) is a share of the predecessor's
 * duration, and what `LinkLag` holds for one is not documented -- the schema
 * says tenths of a minute for every format, which cannot be right for a
 * percentage -- and there is no file here with one to measure. It is **not
 * applied** (a lag of zero) instead of read as minutes, which would be a wrong
 * schedule that looks right; `recalculate` counts them so the log says so. */
const PERCENT_LAGS = [19, 20, 51, 52];
const isPercentLag = (link) => PERCENT_LAGS.includes(link.LagFormat) && !!link.LinkLag;

function lagAfter(work, t, link) {
    const lag = isPercentLag(link) ? 0 : (link.LinkLag || 0) / 10;
    return isElapsed(link.LagFormat) ? t + lag * MIN_MS : work.add(t, lag);
}

function lagBefore(work, t, link) {
    const lag = isPercentLag(link) ? 0 : (link.LinkLag || 0) / 10;
    return isElapsed(link.LagFormat) ? t - lag * MIN_MS : work.subtract(t, lag);
}

/*
 * The work identity `Type` describes, in minutes. A task with no assignments
 * is its own unit of work at a hundred per cent, so `before` is what the task
 * already carries and `after` what it carries once the resource is in -- both
 * at least one. An effort-driven task keeps its work and shortens as units
 * add up; Fixed Duration (1) ignores the flag, because its duration is the
 * point, and every other type keeps the duration and lets the work grow.
 */
function assignmentDuration(project, task, before, after) {
    const minutes = mspdiMinutes(task.Duration) || 0;
    const effort  = task.EffortDriven && taskKind(project, task) !== 1;
    return effort && minutes > 0 ? Math.round(minutes * before / after) : minutes;
}

/*
 * The work identity the pass applies: a task with work resources carries
 * `Work = Duration × Units`, and the type says which of the three is pinned.
 * Fixed Duration keeps the duration and derives the work; every other keeps
 * the work and derives the duration. It answers the duration in minutes and
 * leaves the task's and its assignments' work in step -- so `recalculate`
 * schedules the duration the resources actually add up to. A task with no
 * work resource is left exactly as the file wrote it.
 */
function workDuration(project, task, minutes, mine) {
    const assignments = mine || project.Assignments.filter(
        (a) => a.TaskUID === task.UID);

    let units = 0, work = 0;
    for (const assignment of assignments) {
        const resource = resourceOf(project, assignment.ResourceUID);
        if (!resource || resource.Type !== 1) continue;
        units += assignment.Units || 0;
        work  += mspdiMinutes(assignment.Work) || 0;
    }
    if (units <= 0) return minutes;

    if (taskKind(project, task) === 1) work = Math.round(minutes * units);   // Fixed Duration
    else if (work > 0)          minutes = Math.round(work / units);
    else                        work = Math.round(minutes * units);

    task.Work = mspdiDuration(work);
    for (const assignment of assignments) {
        const resource = resourceOf(project, assignment.ResourceUID);
        if (!resource || resource.Type !== 1) continue;
        assignment.Work = mspdiDuration(Math.round(minutes * (assignment.Units || 0)));
        assignment.RegularWork = assignment.Work;
    }
    return minutes;
}

/*
 * **Free slack**: how long this task can slip before it moves something that
 * depends on it, where the total slack is how long it can slip before it moves
 * the plan's finish. Each successor bounds it and the least of those is the
 * answer, in the successor's own calendar.
 *
 * The bound depends on which end of each link is joined: the successor's
 * start (FS, SS) or finish (FF, SF), less the lag, is the latest our finish
 * (FS, FF) or our start (SS, SF) can reach without moving it. The room is
 * the working time from where that end of ours sits now to the bound -- for
 * SS it is zero only when the link is what placed the successor; another
 * link that pushed it later leaves room. The kinds are MSPDI's: 0 FF, 1 FS,
 * 2 SF, 3 SS.
 *
 * A task nothing depends on has all of its total as free: with no successor
 * there is no sooner moment to be late for. A task the file never dated, or a
 * successor the file never dated, keeps `NO_MINUTES` -- an answer nobody worked
 * out is not the same as an answer of zero.
 */
function freeSlack(task, links, work) {
    const es = whenMs(task.Start), ef = whenMs(task.Finish);
    if (ef === null) return NO_MINUTES;

    let least = null;
    for (const { link, succ } of links) {
        const kind  = linkKind(link);
        const until = kind === 0 || kind === 2 ? whenMs(succ.Finish)
                                               : whenMs(succ.Start);
        const ours  = kind === 2 || kind === 3 ? es : ef;
        if (until === null || ours === null) continue;
        const room = work.between(ours, lagBefore(work, until, link));
        if (least === null || room < least) least = room;
    }
    /* Tenths, the file's unit; the total is in them already. */
    return least === null ? task.TotalSlack : least * TENTHS;
}

/*
 * How far apart two dates are in working time, signed: **positive is late**,
 * the actual being the later of the two. `WorkCalendar.between` is one-signed
 * (it answers 0 for a span that goes backwards), so the order is what carries
 * the sign. In tenths of a minute, the unit the file keeps it in.
 *
 * `NO_MINUTES` when either side is missing, which is the honest answer for a
 * task whose baseline never dated it or that the file never dated: a plan that
 * was never baselined is not a plan that is exactly on its baseline.
 */
function varianceOf(work, promised, actual) {
    const a = whenMs(promised), b = whenMs(actual);
    if (a === null || b === null) return NO_MINUTES;
    return (b >= a ? work.between(a, b) : -work.between(b, a)) * TENTHS;
}

/*
 * The forward pass. Answers how many tasks it placed, or 0 when there is no
 * start to place them from. A link whose predecessor is not in the file is
 * ignored; a cycle is left where it was rather than hung on.
 */
function recalculate(project) {
    const tasks = project.Tasks.filter((t) => !t.IsNull);
    const byUID = {};
    let roots = 0;
    for (const task of tasks) {
        byUID[task.UID] = task;
        if (!task.Summary) roots++;
    }

    let start = whenMs(project.StartDate);
    if (start === null) {
        for (const task of tasks) {
            const t = whenMs(task.Start);
            if (t !== null && (start === null || t < start)) start = t;
        }
    }
    if (start === null) return { placed: 0, skipped: 0 };

    const cache = {};
    const workOf = (uid) => {
        const at  = uid > 0 ? uid : project.CalendarUID;
        const key = String(at || 0);
        if (!cache[key]) cache[key] = new WorkCalendar(project, at);
        return cache[key];
    };

    /* The assignments each task carries, read once: the work identity is
     * applied per task and walking the whole list per task is quadratic. */
    const assignmentsOf = {};
    for (const assignment of project.Assignments) {
        if (!assignmentsOf[assignment.TaskUID]) assignmentsOf[assignment.TaskUID] = [];
        assignmentsOf[assignment.TaskUID].push(assignment);
    }

    /* A manually scheduled summary pins its branch: an unlinked descendant
     * starts no earlier than the latest manual summary above it. Project
     * keeps those dates and schedules the children inside them. */
    const floorOf = {};
    for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        let level = task.OutlineLevel, floor = null;
        for (let k = i - 1; k >= 0 && level > 0; k--) {
            const up = tasks[k];
            if (up.OutlineLevel >= level) continue;
            level = up.OutlineLevel;
            if (!up.Summary || !up.Manual) continue;
            const at = whenMs(up.Start);
            if (at !== null && (floor === null || at > floor)) floor = at;
        }
        if (floor !== null) floorOf[task.UID] = floor;
    }

    /*
     * **Links to and from a summary.** A summary has no dates of its own to
     * schedule -- it is the span of its branch -- so a link that touches one is
     * a link that touches the leaves under it:
     *
     *  - a link **into** a summary (FS or SS) bounds every leaf of the branch,
     *    which is what holding the summary back means. FF and SF into a summary
     *    bound only the branch's last finish and are left alone;
     *  - a link **from** a summary reads the summary's span, so the summary is
     *    rolled up -- and the successor waits for it -- as soon as every task
     *    under it is placed, not at the end of the pass.
     *
     * `incoming` is that, per leaf. A link between a summary and its own
     * branch is a loop and Project does not allow it: it is dropped.
     */
    const index = {};
    tasks.forEach((t, i) => { index[t.UID] = i; });
    const endOf = tasks.map((t, i) => {
        let k = i + 1;
        if (t.Summary) while (k < tasks.length && tasks[k].OutlineLevel > t.OutlineLevel) k++;
        return k;
    });
    const within  = (i, j) => j > i && j < endOf[i];
    const leavesOf = (i) => {
        const out = [];
        for (let k = i + 1; k < endOf[i]; k++) if (!tasks[k].Summary) out.push(tasks[k]);
        return out;
    };
    const incoming = {};
    tasks.forEach((task, i) => {
        for (const link of task.Links) {
            const pred = byUID[link.PredecessorUID];
            if (!pred) continue;
            const pi = index[pred.UID], kind = linkKind(link);
            let into;
            if (!task.Summary) into = [task];
            else if (task.Manual || (kind !== 1 && kind !== 3)) continue;
            else into = leavesOf(i);
            if (pred.Summary && within(pi, i)) continue;
            if (task.Summary && within(i, pi)) continue;
            for (const leaf of into) {
                if (leaf === pred) continue;
                if (!incoming[leaf.UID]) incoming[leaf.UID] = [];
                incoming[leaf.UID].push({ link, pred });
            }
        }
    });

    /* A summary is the span of the tasks under it -- unless it is manually
     * scheduled, where the dates are the user's too. */
    const rollup = (i) => {
        if (!tasks[i].Summary || tasks[i].Manual) return;
        let from = null, to = null;
        for (let k = i + 1; k < endOf[i]; k++) {
            const s = whenMs(tasks[k].Start), f = whenMs(tasks[k].Finish);
            if (s === null || f === null) continue;
            if (from === null || s < from) from = s;
            if (to === null || f > to) to = f;
        }
        if (from !== null) {
            tasks[i].Start  = isoLocal(from);
            tasks[i].Finish = isoLocal(to);
        }
    };

    const finished = (task) => whenMs(task.ActualFinish) !== null;

    const done = {};
    let placed = 0, skipped = 0, notMet = 0, guard = 0;
    while (guard++ <= tasks.length + 1) {
        let moved = false;
        for (const task of tasks) {
            if (done[task.UID]) continue;

            /* A summary is closed when everything under it is: then its span
             * is final and what links from it can read it. */
            if (task.Summary) {
                const i = index[task.UID];
                let open = false;
                if (!task.Manual)
                    for (let k = i + 1; k < endOf[i]; k++)
                        if (!done[tasks[k].UID]) { open = true; break; }
                if (open) continue;
                rollup(i);
                done[task.UID] = true;
                moved = true;
                continue;
            }

            /* A manually scheduled task keeps the dates it was given --
             * Project does not move it either, and warns instead -- and its
             * successors link to those dates. So does a task that finished:
             * history is not rescheduled, and the actual dates are what the
             * successors link to. */
            if (task.Manual || whenMs(task.ActualFinish) !== null) {
                done[task.UID] = true;
                skipped++;
                moved = true;
                continue;
            }

            /* ALAP is what Project places with the backward pass; here the
             * task keeps the dates the file wrote, and its successors link to
             * those. The two "no later than" constraints are soft -- they do
             * not pin anything -- so those tasks are scheduled like any other
             * and the dates are checked against them afterwards. */
            const type = task.ConstraintType || 0;
            if (type === CONSTRAINT_ALAP) {
                done[task.UID] = true;
                skipped++;
                moved = true;
                continue;
            }

            const work = workOf(task.CalendarUID);

            /* What the resources add up to, before the dates are laid out. */
            const before = mspdiMinutes(task.Duration) || 0;
            const duration = workDuration(project, task, before,
                                          assignmentsOf[task.UID]);
            if (duration !== before) task.Duration = mspdiDuration(duration);

            /* An elapsed duration counts calendar time -- weekends and nights
             * included -- where `work.add`/`work.subtract` count working
             * time. The span is the same in minutes either way. */
            const elapsed = isElapsed(task.DurationFormat);
            const span = duration * MIN_MS;
            const startBefore = (finish) => elapsed ? finish - span
                                                    : work.subtract(finish, duration);
            let ready = true;

            /* FS and SS bound the start; FF and SF bound the finish. A task
             * with no link starts at the project start -- one with links is
             * placed by them, and an SF link can put a task before the
             * project start, which is what SF is for. */
            let startFloor = null, finishFloor = null, startsEarly = false;
            for (const { link, pred } of incoming[task.UID] || []) {
                if (!done[pred.UID]) { ready = false; break; }
                const ps = whenMs(pred.Start), pf = whenMs(pred.Finish);
                if (ps === null || pf === null) continue;

                /* The lag is working time on the successor's own calendar,
                 * unless its format is an elapsed one. */
                const kind = linkKind(link);
                if (kind === 2) startsEarly = true;
                if (kind === 0 || kind === 2) {
                    const target = lagAfter(work, kind === 0 ? pf : ps, link);
                    if (finishFloor === null || target > finishFloor) finishFloor = target;
                } else {
                    const base = lagAfter(work, kind === 1 ? pf : ps, link);
                    const candidate = duration > 0 ? work.startAfter(base) : base;
                    if (startFloor === null || candidate > startFloor) startFloor = candidate;
                }
            }
            if (!ready) continue;

            /* The constraint the forward pass can honor, its date normalized
             * to a working instant: MSO pins the start, MFO the finish, SNET
             * a floor under the start and FNET one under the finish. */
            const when = whenMs(task.ConstraintDate);
            let atConstraint = null;
            if (when !== null) {
                const at = work.add(when, 0);
                atConstraint = at;
                if (type === CONSTRAINT_MSO) {
                    startFloor = at;
                } else if (type === CONSTRAINT_MFO) {
                    if (finishFloor === null || at > finishFloor) finishFloor = at;
                    const implied = startBefore(at);
                    if (startFloor === null || implied > startFloor) startFloor = implied;
                } else if (type === CONSTRAINT_SNET) {
                    if (startFloor === null || at > startFloor) startFloor = at;
                } else if (type === CONSTRAINT_FNET) {
                    if (finishFloor === null || at > finishFloor) finishFloor = at;
                }
            }

            if (startFloor === null && finishFloor === null) {
                const floor = floorOf[task.UID];
                startFloor = floor !== undefined && floor > start ? floor : start;
            }

            if (finishFloor !== null) {
                let implied = startBefore(finishFloor);
                /* **A finish-bound link does not push the start before the
                 * plan's.** An FF to a predecessor that ends early lets the
                 * task finish when the link says, but it starts where an
                 * unlinked one would and ends later -- Project leaves it at
                 * the project start. An SF link is the exception: starting
                 * early is what it is for. */
                if (!startsEarly) {
                    const floor = floorOf[task.UID];
                    const base  = floor !== undefined && floor > start ? floor : start;
                    if (implied < base) implied = base;
                }
                if (startFloor === null || implied > startFloor) startFloor = implied;
            }
            if (startFloor === null) startFloor = start;

            /* A task starts at a working moment; a milestone is zero duration
             * and may sit on the instant its predecessor ends -- Project shows
             * it on the finish date, not the morning after. */
            let   from = duration > 0 ? work.startAfter(startFloor)
                                      : work.add(startFloor, 0);
            let   to   = duration > 0 ? (elapsed ? from + span : work.add(from, duration))
                                      : from;
            if (finishFloor !== null && to < finishFloor) to = finishFloor;

            /* **A task that has started started when it did.** Its links
             * move what is left of it and not the history: the start is the
             * actual one, the finish follows from it, and a finish-bound link
             * can still stretch the end. Without this, a predecessor that
             * slipped dragged a started task's `Start` to after the day it
             * really began. */
            const began = whenMs(task.ActualStart);
            if (began !== null) {
                from = duration > 0 ? work.startAfter(began) : work.add(began, 0);
                to   = duration > 0 ? (elapsed ? from + span : work.add(from, duration))
                                    : from;
                if (finishFloor !== null && to < finishFloor) to = finishFloor;
            }

            /* A constraint the schedule did not meet. The two "no later than"
             * ones are the soft half -- they never pin anything, and this is
             * what Project shows as a violation -- and MSO/MFO can lose to a
             * link, which is a conflict in the file and not a bug here. */
            if (atConstraint !== null) {
                /* The "no later than" pair is read against the date itself:
                 * a holiday in between does not move the promise. */
                if (type === CONSTRAINT_MSO && from !== atConstraint) notMet++;
                else if (type === CONSTRAINT_MFO && to !== atConstraint) notMet++;
                else if (type === CONSTRAINT_SNLT && from > when) notMet++;
                else if (type === CONSTRAINT_FNLT && to > when) notMet++;
            }

            task.Start  = isoLocal(from);
            task.Finish = isoLocal(to);
            done[task.UID] = true;
            placed++;
            moved = true;
        }
        if (!moved) break;   // a cycle, or links to tasks the file does not have
    }

    /*
     * The backward pass. From the project finish -- the latest earliest
     * finish -- every link pulls its predecessor's latest dates back, and the
     * slack a task has is the working time between its earliest and latest
     * finish. Zero slack is critical; `CriticalSlackLimit` is not modelled.
     * Summaries keep the flag the file gave them: Project derives it.
     */
    const scheduled = tasks.filter((t) => !t.Summary && done[t.UID]);
    /* Where the backward pass starts: the latest finish in the plan,
     * manual and soft-placed tasks and the summaries included -- they are on
     * the calendar even when the pass did not move them, and a manual
     * summary can end later than anything under it. **Not the file's `FinishDate`**: it is
     * what the plan said before this pass, and an edit that shortens the plan
     * left every task with room and no critical path. Project recalculates it
     * and so does this, below. */
    let finish = null;
    for (const task of tasks) {
        const f = whenMs(task.Finish);
        if (f !== null && (finish === null || f > finish)) finish = f;
    }
    if (finish !== null) project.FinishDate = isoLocal(finish);
    if (finish !== null && scheduled.length) {
        /* Each task's links, read from the successor's side. */
        const successors = {};
        for (const succ of scheduled)
            for (const { link, pred } of incoming[succ.UID] || []) {
                if (!done[pred.UID]) continue;
                /* **A task nobody moves bounds nobody's total slack**: a
                 * manual one keeps its dates and a finished one is history,
                 * so a link into either pulls no predecessor's late dates
                 * back -- measured against Project's own file, a predecessor
                 * of a manual task has all the room to the plan's finish.
                 * The *free* slack does count them: it is the room before
                 * the successor's dates, and those are fixed. */
                const fixed = succ.Manual || finished(succ);
                /* A summary as predecessor stands for its leaves: all of them
                 * cap their late dates for a finish-bound link, the ones that
                 * open the branch for a start-bound one. Only the leaf that
                 * sets the summary's edge keeps it as a successor for the
                 * *free* slack -- the others have room Project does not take
                 * away (measured against its own file). */
                let from = [{ leaf: pred, weak: false }];
                if (pred.Summary) {
                    const kind = linkKind(link);
                    const byFinish = kind === 1 || kind === 0;
                    const edge = whenMs(byFinish ? pred.Finish : pred.Start);
                    /* A manual summary is the user's span, not its leaves':
                     * its link bounds nothing underneath, as in Project. */
                    from = [];
                    if (!pred.Manual)
                        for (const leaf of leavesOf(index[pred.UID])) {
                            if (!done[leaf.UID]) continue;
                            const sets = whenMs(byFinish ? leaf.Finish : leaf.Start) === edge;
                            if (byFinish || sets) from.push({ leaf, weak: !sets });
                        }
                }
                for (const { leaf, weak } of from) {
                    if (!successors[leaf.UID]) successors[leaf.UID] = [];
                    successors[leaf.UID].push({ link, succ, weak, fixed });
                }
            }

        const late = {}, lateDone = {};
        let count = 0, back = 0;
        while (count < scheduled.length && back++ <= scheduled.length + 1) {
            let moved = false;
            for (let i = scheduled.length - 1; i >= 0; i--) {
                const task = scheduled[i];
                if (lateDone[task.UID]) continue;

                /* A finished task has no late dates of its own: they are the
                 * ones it had, and its slack is nothing. */
                if (finished(task)) {
                    const es = whenMs(task.Start), ef = whenMs(task.Finish);
                    if (es !== null && ef !== null) {
                        late[task.UID] = { lf: ef, ls: es };
                        lateDone[task.UID] = true;
                        count++;
                        moved = true;
                        continue;
                    }
                }

                const links = (successors[task.UID] || []).filter((e) => !e.fixed);
                let ready = true;
                for (const { succ } of links)
                    if (!lateDone[succ.UID]) { ready = false; break; }
                if (!ready) continue;

                const work = workOf(task.CalendarUID);
                const duration = mspdiMinutes(task.Duration) || 0;
                /* The duration back and forth as the forward pass laid it:
                 * an elapsed one is clock time. */
                const elapsed = isElapsed(task.DurationFormat);
                const after  = (t) => elapsed ? t + duration * MIN_MS
                                              : work.add(t, duration);
                const before = (t) => elapsed ? t - duration * MIN_MS
                                              : work.subtract(t, duration);
                let lf = null, ls = null;

                if (!links.length) {
                    lf = finish;
                } else {
                    for (const { link, succ } of links) {
                        const L    = late[succ.UID];
                        const kind = linkKind(link);
                        let v;
                        if (kind === 1) {               // FS bounds the finish
                            v = lagBefore(work, L.ls, link);
                            if (lf === null || v < lf) lf = v;
                        } else if (kind === 3) {        // SS bounds the start
                            v = lagBefore(work, L.ls, link);
                            if (ls === null || v < ls) ls = v;
                        } else if (kind === 0) {        // FF bounds the finish
                            v = lagBefore(work, L.lf, link);
                            if (lf === null || v < lf) lf = v;
                        } else {                        // SF bounds the start
                            v = lagBefore(work, L.lf, link);
                            if (ls === null || v < ls) ls = v;
                        }
                    }
                }
                if (lf === null && ls === null) lf = finish;
                if (lf === null) lf = after(ls);
                if (ls === null) ls = before(lf);

                /* **Both ends bound the task at once**: an FS successor caps
                 * the finish and an SS one the start, and each cap reaches the
                 * other end through the duration. Only a cap that is working
                 * time earlier moves the other end -- Friday 17:00 and Monday
                 * 08:00 are the same moment of work. */
                const lsOf = before(lf), lfOf = after(ls);
                if (work.between(lsOf, ls) > 0) ls = lsOf;
                if (work.between(lfOf, lf) > 0) lf = lfOf;

                late[task.UID] = { lf, ls };
                lateDone[task.UID] = true;
                count++;
                moved = true;
            }
            if (!moved) break;
        }

        for (const task of scheduled) {
            const L = late[task.UID];
            if (!L) continue;
            const ef = whenMs(task.Finish);
            if (ef === null) continue;
            const work = workOf(task.CalendarUID);
            /* **The backward pass's answer is what the file keeps**, and until now
             * it was computed and thrown away: `LateStart` and `LateFinish` are
             * the dates Project shows in the Tracking tab, and the slack is the
             * working time between the early finish and this one -- read once
             * here because `Critical` is the same number at zero. */
            task.LateStart    = isoLocal(L.ls);
            /* The latest finish is the **end** of the last working span, the
             * Friday 17:00 Project shows, and not the Monday 08:00 that is the
             * same moment of work: `finishAt` steps back off a span's start
             * onto the previous end. */
            task.LateFinish   = isoLocal(finished(task) ? L.lf : work.finishAt(L.lf));
            const total       = work.between(ef, L.lf);
            task.TotalSlack   = total * TENTHS;
            task.Critical     = total <= 0 && !finished(task);
            /* Free slack counts the successors that still have dates to meet:
             * a manual one does, a finished one -- history -- does not, and
             * a finished task has none of its own. */
            task.FreeSlack    = finished(task) ? 0
                : freeSlack(task, (successors[task.UID] || []).filter(
                      (e) => !e.weak && !finished(e.succ)), work);
        }
    }

    /* The summaries once more: the backward pass and the leaves do not move
     * them, but a summary the forward pass never closed (a cycle) still gets
     * the span of what was placed. */
    for (let i = 0; i < tasks.length; i++) rollup(i);

    /*
     * **The variance, last**, because it compares two dates and this is the
     * point where both are final: the ones the baseline caught, and the ones
     * the plan has now. Signed working minutes on the task's own calendar, the
     * same calendar its slack was measured in, because a task that slipped over
     * a weekend did not slip eight hours.
     *
     * A task with no baseline, or with a date missing on either side, keeps the
     * sentinel: there is no answer, and writing `0` would claim the task is
     * exactly on a plan that never caught one.
     */
    for (const task of tasks) {
        const base = baselineOf(task, BASELINE);
        if (!base) continue;
        const work = workOf(task.CalendarUID);
        task.StartVariance  = varianceOf(work, base.Start,  task.Start);
        task.FinishVariance = varianceOf(work, base.Finish, task.Finish);
    }

    /*
     * **And the assignments, against their task's baseline.**
     *
     * The same measurement one level down, and against the same baseline: an
     * assignment has none of its own, so it inherits the task's. It is not
     * redundant with the task's variance -- a task can start on time while one
     * of its three resources starts a week later, and that difference is the
     * one an assignment's own two numbers are for.
     *
     * Written after the task pass on purpose, so it reads the dates the task
     * pass has already fixed rather than the ones it started with.
     */
    for (const assignment of project.Assignments) {
        const task = taskOf(project, assignment.TaskUID);
        if (!task) continue;
        const base = baselineOf(task, BASELINE);
        if (!base) continue;
        const work = workOf(task.CalendarUID);
        assignment.StartVariance  = varianceOf(work, base.Start,  assignment.Start);
        assignment.FinishVariance = varianceOf(work, base.Finish, assignment.Finish);
    }
    let percentLags = 0;
    for (const task of tasks)
        for (const link of task.Links) if (isPercentLag(link)) percentLags++;
    return { placed, skipped, notMet, percentLags };
}
