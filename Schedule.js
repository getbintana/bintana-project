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
 * predecessor's latest dates back and zero slack marks a task critical; and
 * then a summary is the span of the deeper tasks that follow it. A `Deadline`
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

/* A local instant as the `YYYY-MM-DDTHH:MM:SS` Project writes. */
function isoLocal(ms) {
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T` +
           `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function whenMs(text) {
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
         * and inherits the rest. A file with no calendar at all gets the
         * schema's own day: Monday to Friday, 08:00 to 17:00. */
        const chain = [];
        let cal = byUID[uid] || null, guard = 0;
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
                    const from = clockMinutes(wt.FromTime), to = clockMinutes(wt.ToTime);
                    if (from !== null && to !== null && to > from) spans.push([from, to]);
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
                    const a = clockMinutes(wt.FromTime), b = clockMinutes(wt.ToTime);
                    if (a !== null && b !== null && b > a) spans.push([a, b]);
                }
                for (const day = new Date(from); day.getTime() <= to; day.setDate(day.getDate() + 1))
                    this.exceptions[this.#dayKey(day.getTime())] = ex.DayWorking ? spans : null;
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
            t = end + MIN_MS;
        }
        return t;
    }

    /* `minutes` of work before `finish`, the mirror of `add`. */
    subtract(finish, minutes) {
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
            t = from - MIN_MS;
        }
        return t;
    }

    /* The first working moment at or after `ms`: a task never starts in the
     * middle of the night or at the end of a shift. */
    startAfter(ms) {
        const end = this.#spanEndAt(ms);
        if (end !== null && ms < end) return ms;
        return this.#nextWorking(end === null ? ms : end + MIN_MS);
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
            t = Math.min(end, b) + MIN_MS;
        }
        return total;
    }

    #dayKey(ms) {
        const d = new Date(ms);
        const p = (n) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }

    #dayStart(ms) {
        const d = new Date(ms);
        d.setHours(0, 0, 0, 0);
        return d.getTime();
    }

    #spansOn(ms) {
        const key = this.#dayKey(ms);
        if (key in this.exceptions) return this.exceptions[key] || [];
        return this.days[new Date(ms).getDay() + 1] || [];
    }

    /* The end of the span `ms` sits in **or ends**, or null when it is
     * outside every span. An end counts: 17:00 has no work left today. */
    #spanEndAt(ms) {
        const day = this.#dayStart(ms);
        for (const [from, to] of this.#spansOn(day)) {
            const a = day + from * MIN_MS, b = day + to * MIN_MS;
            if (ms >= a && ms <= b) return b;
        }
        return null;
    }

    #spanStartAt(ms) {
        const day = this.#dayStart(ms);
        for (const [from, to] of this.#spansOn(day)) {
            const a = day + from * MIN_MS, b = day + to * MIN_MS;
            if (ms >= a && ms <= b) return a;
        }
        return null;
    }

    #nextWorking(ms) {
        let t = ms;
        for (let guard = 0; guard < 3660; guard++) {
            const day = this.#dayStart(t);
            for (const [from, to] of this.#spansOn(day)) {
                const b = day + to * MIN_MS;
                if (b > t) return Math.max(t, day + from * MIN_MS);
            }
            t = day + DAY_MS;
        }
        return ms;
    }

    #previousWorking(ms) {
        let t = ms;
        for (let guard = 0; guard < 3660; guard++) {
            const end = this.#spanEndAt(t);
            if (end !== null) return Math.min(t, end);
            const day = this.#dayStart(t);
            const spans = this.#spansOn(day);
            for (let i = spans.length - 1; i >= 0; i--) {
                const b = day + spans[i][1] * MIN_MS;
                if (b <= t) return b;
            }
            t = day - MIN_MS;
        }
        return ms;
    }
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
        const key = String(uid || project.CalendarUID || 0);
        if (!cache[key]) cache[key] = new WorkCalendar(project, uid || project.CalendarUID);
        return cache[key];
    };

    /* The assignments each task carries, read once: the work identity is
     * applied per task and walking the whole list per task is quadratic. */
    const assignmentsOf = {};
    for (const assignment of project.Assignments) {
        if (!assignmentsOf[assignment.TaskUID]) assignmentsOf[assignment.TaskUID] = [];
        assignmentsOf[assignment.TaskUID].push(assignment);
    }

    const done = {};
    let placed = 0, skipped = 0, notMet = 0, guard = 0;
    while (placed + skipped < roots && guard++ <= tasks.length + 1) {
        let moved = false;
        for (const task of tasks) {
            if (task.Summary || done[task.UID]) continue;

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
            let startFloor = null, finishFloor = null;
            for (const link of task.Links) {
                const pred = byUID[link.PredecessorUID];
                if (!pred) continue;
                if (!pred.Summary && !done[pred.UID]) { ready = false; break; }
                const ps = whenMs(pred.Start), pf = whenMs(pred.Finish);
                if (ps === null || pf === null) continue;

                /* `LinkLag` is tenths of a minute, and the lag is working
                 * time on the successor's own calendar. */
                const lag  = (link.LinkLag || 0) / 10;
                const kind = linkKind(link);
                if (kind === 0 || kind === 2) {
                    const target = work.add(kind === 0 ? pf : ps, lag);
                    if (finishFloor === null || target > finishFloor) finishFloor = target;
                } else {
                    const base = work.add(kind === 1 ? pf : ps, lag);
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

            if (startFloor === null && finishFloor === null) startFloor = start;

            if (finishFloor !== null) {
                const implied = startBefore(finishFloor);
                if (startFloor === null || implied > startFloor) startFloor = implied;
            }
            if (startFloor === null) startFloor = start;

            /* A task starts at a working moment; a milestone is zero duration
             * and may sit on the instant its predecessor ends -- Project shows
             * it on the finish date, not the morning after. */
            const from = duration > 0 ? work.startAfter(startFloor)
                                      : work.add(startFloor, 0);
            let   to   = duration > 0 ? (elapsed ? from + span : work.add(from, duration))
                                      : from;
            if (finishFloor !== null && to < finishFloor) to = finishFloor;

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
    let finish = null;
    for (const task of scheduled) {
        const f = whenMs(task.Finish);
        if (f !== null && (finish === null || f > finish)) finish = f;
    }
    if (finish !== null && scheduled.length) {
        /* Each task's links, read from the successor's side. */
        const successors = {};
        for (const succ of scheduled)
            for (const link of succ.Links) {
                const pred = byUID[link.PredecessorUID];
                if (!pred || pred.Summary || !done[pred.UID]) continue;
                if (!successors[pred.UID]) successors[pred.UID] = [];
                successors[pred.UID].push({ link, succ });
            }

        const late = {}, lateDone = {};
        let count = 0, back = 0;
        while (count < scheduled.length && back++ <= scheduled.length + 1) {
            let moved = false;
            for (let i = scheduled.length - 1; i >= 0; i--) {
                const task = scheduled[i];
                if (lateDone[task.UID]) continue;

                const links = successors[task.UID] || [];
                let ready = true;
                for (const { succ } of links)
                    if (!lateDone[succ.UID]) { ready = false; break; }
                if (!ready) continue;

                const work = workOf(task.CalendarUID);
                const duration = mspdiMinutes(task.Duration) || 0;
                let lf = null, ls = null;

                if (!links.length) {
                    lf = finish;
                } else {
                    for (const { link, succ } of links) {
                        const L    = late[succ.UID];
                        const lag  = (link.LinkLag || 0) / 10;
                        const kind = linkKind(link);
                        let v;
                        if (kind === 1) {               // FS bounds the finish
                            v = work.subtract(L.ls, lag);
                            if (lf === null || v < lf) lf = v;
                        } else if (kind === 3) {        // SS bounds the start
                            v = work.subtract(L.ls, lag);
                            if (ls === null || v < ls) ls = v;
                        } else if (kind === 0) {        // FF bounds the finish
                            v = work.subtract(L.lf, lag);
                            if (lf === null || v < lf) lf = v;
                        } else {                        // SF bounds the start
                            v = work.subtract(L.lf, lag);
                            if (ls === null || v < ls) ls = v;
                        }
                    }
                }
                if (lf === null && ls === null) lf = finish;
                if (lf === null) lf = work.add(ls, duration);
                if (ls === null) ls = work.subtract(lf, duration);

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
            task.Critical = workOf(task.CalendarUID).between(ef, L.lf) <= 0;
        }
    }

    /* A summary is the span of the deeper tasks that follow it. */
    for (let i = 0; i < tasks.length; i++) {
        if (!tasks[i].Summary) continue;
        let from = null, to = null;
        for (let k = i + 1; k < tasks.length && tasks[k].OutlineLevel > tasks[i].OutlineLevel; k++) {
            const s = whenMs(tasks[k].Start), f = whenMs(tasks[k].Finish);
            if (s === null || f === null) continue;
            if (from === null || s < from) from = s;
            if (to === null || f > to) to = f;
        }
        if (from !== null) {
            tasks[i].Start  = isoLocal(from);
            tasks[i].Finish = isoLocal(to);
        }
    }
    return { placed, skipped, notMet };
}
