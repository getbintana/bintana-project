/*
 * What the plan says about itself: how long it runs, what it costs, how far
 * along it is and what it is late on. Every number here is read or derived
 * from the shape and **none of it is written anywhere** -- the file's own
 * numbers win where it has them (`assignmentCost`), and the rest is this app's
 * arithmetic, which is why the dialog that shows it is a reading and not an
 * edit: it has no OK, and saving the file after opening it changes nothing.
 *
 * What is counted, and what is left out, is said here rather than left to the
 * dialog, because a statistic that hides its rules is a guess with a number
 * on it:
 *
*   - **A summary is not a task and a blank row is not either.** One carries
 *     the span of its children and the other is structure, so neither has work
 *     of its own to add up. Both are counted apart, so the plan's shape is
 *     visible next to the work inside it.
 *   - **The percentage is weighed by work**, because a task with a thousand
 *     hours is worth a thousand tasks with none. A task that carries no work
 *     at all weighs nothing -- and a plan where *no* task carries work has no
 *     weights to weigh with, so it gets the plain average of its tasks' own
 *     percentages instead. That is a real file: a plan of milestones, or one
 *     that was never costed.
 *   - **Days are calendar days** -- the instants a schedule keeps -- and work
 *     is in hours, because a work field is working time and a date is not.
 *   - **Elapsed and remaining are read at the status date** when the file
 *     wrote one, which is the plan's own "today", and at the machine's today
 *     when it did not. Both are the desktop's calendar.
 *   - **A slip is measured against the file's own promise**: the baseline
 *     finish where the task carries one, its `Deadline` otherwise, and
 *     nothing at all when it carries neither. The promise is read against the
 *     date itself without counting working time, because a holiday in between
 *     does not make a task late any sooner -- and it is the same reading
 *     `recalculate` counts, so this dialog and the log cannot disagree.
 *   - **A constraint is read off the dates the file carries, and only the
 *     soft half of them** (`SNLT`, `FNLT`): the four hard ones are honored or
 *     they are a conflict in the file, and the engine counts those. The dialog
 *     counts what the schedule missed; it never schedules, or a reading of the
 *     plan would be a second `Recalculate` wearing a quieter name.
 */
"use strict";

/* The number `Edit → Save Baseline` writes, which is the one the chart draws
 * and the one "the baseline" means everywhere in this app. It lives here
 * beside `baselineOf`, which reads it. */
const BASELINE = 0;

/* Which of two instants came first and which came last, where both are an
 * instant or `null` -- and `null` here is "the file never wrote this date",
 * which is not the same as the date zero and is the ordinary case for a plan
 * that was never scheduled. */
function earlierOf(a, b) {
    if (a === null) return b;
    if (b === null) return a;
    return a < b ? a : b;
}

function laterOf(a, b) {
    if (a === null) return b;
    if (b === null) return a;
    return a > b ? a : b;
}

/* Whole days between two instants, which is how a delay reads: a task that
 * finished on the Wednesday when it was due on the Tuesday is **one** day
 * late, and counting the day it landed in as well would say two. A span wants
 * the other count and says so where it asks for this. */
function daysBetween(from, to) {
    const midnight = (ms) => {
        const d = new Date(ms);
        d.setHours(0, 0, 0, 0);
        return d.getTime();
    };
    return Math.round((midnight(to) - midnight(from)) / DAY_MS);
}

/* Working days between two instants on one calendar, which is the calendar's
 * own arithmetic over the working time in between read as days of whatever
 * the file says a day is. Zero when either end is missing or the span is
 * backwards: there is no work between nothing and something. */
function workingDays(project, calendar, from, to) {
    if (from === null || to === null || to <= from) return 0;
    const perDay = project.MinutesPerDay || 480;
    return Math.round(calendar.between(from, to) / perDay * 10) / 10;
}

/*
 * Every number the dialog shows, in one pass over the shape. It answers zero
 * and null, and both are true: a plan with no cost has a cost of zero, and a
 * plan that never wrote a start date has none.
 */
function projectStats(project) {
    /* The plan's own calendar -- what a task gets when it names none, and
     * what the whole plan's spans are measured on. */
    const calendar = new WorkCalendar(project, -1);

    /* The cost is per assignment, and the totals are three views of the same
     * numbers, so it is walked once: `assignmentCost` is the expensive part
     * and it is not walked again per task on top of it. */
    const byTask = {}, byKind = [0, 0, 0];
    let cost = 0;
    for (const assignment of project.Assignments) {
        const own = assignmentCost(project, assignment);
        if (!own) continue;
        cost += own;
        byTask[assignment.TaskUID] = (byTask[assignment.TaskUID] || 0) + own;

        /* 0 material, 1 work, 2 cost -- the three a file can name. A kind
         * outside the three is money nobody can attribute, so it is counted
         * with the work rather than lost. */
        const resource = resourceOf(project, assignment.ResourceUID);
        byKind[resource && resource.Type >= 0 && resource.Type <= 2
                   ? resource.Type : 1] += own;
    }

    /* The plan's span is the project's own dates when it wrote them and the
     * tasks' when it did not -- which is the same fallback `recalculate`
     * makes, so the two never disagree about when the plan starts. */
    let start = whenMs(project.StartDate), finish = whenMs(project.FinishDate);
    let work = 0, earned = 0, percentSum = 0;
    let baselineCost = 0, baselined = 0;
    let named = 0, summaries = 0, milestones = 0, critical = 0;
    let done = 0, running = 0, waiting = 0;
    let lateDeadline = 0, lateBaseline = 0, notMet = 0, late = [];

    for (const task of project.Tasks) {
        if (task.IsNull) continue;
        if (task.Summary) { summaries++; continue; }
        named++;

        const from = whenMs(task.Start), to = whenMs(task.Finish);
        start  = earlierOf(start, from);
        finish = laterOf(finish, to);
        if (task.Critical) critical++;
        if (task.Milestone) milestones++;

        /* Progress is the file's own percentage, weighed by the work the task
         * says it has -- a task with a thousand hours is worth a thousand
         * tasks with none. A finished task is one at a hundred per cent
         * however the file spells that: `PercentComplete` and an actual
         * finish are two words for one thing, and a plan that wrote only the
         * second is finished. A task with no work weighs nothing, which is
         * also why the return value needs the average for a plan where no
         * task has any. */
        const percent = task.ActualFinish ? 100 : (task.PercentComplete || 0);
        if (percent >= 100) done++;
        else if (percent > 0) running++;
        else waiting++;
        percentSum += percent;

        const minutes = mspdiMinutes(task.Work);
        if (minutes !== null && minutes > 0) {
            work   += minutes;
            earned += minutes * percent;
        }

        /* The baseline is the file's own snapshot of what the task was worth
         * when the plan was set, and only the cost of it -- which is the one
         * number a variance can be read against. */
        const base = baselineOf(task, BASELINE);
        if (base) {
            baselined++;
            if (base.Cost) baselineCost += base.Cost;
        }

        /* Two promises and two counts, read the way `recalculate` reads them:
         * a deadline is about the finish, a baseline finish is about the
         * finish too, and neither cares what happens in between. */
        const deadline = whenMs(task.Deadline);
        const planned  = base ? whenMs(base.Finish) : null;
        const finished = to !== null ? to : from;
        if (deadline !== null && finished !== null && finished > deadline)
            lateDeadline++;
        if (planned !== null && finished !== null && finished > planned)
            lateBaseline++;

        /* Only the soft half, as the header says: the two "no later than"
         * constraints are the ones a schedule misses on its own, and both are
         * read off raw instants, which is what the engine compares too. */
        const at = whenMs(task.ConstraintDate);
        if (at !== null) {
            if (task.ConstraintType === CONSTRAINT_SNLT && from !== null && from > at)
                notMet++;
            else if (task.ConstraintType === CONSTRAINT_FNLT && to !== null && to > at)
                notMet++;
        }

        /* One row per task that broke a promise, and only for those: the
         * table is the delay, not the plan. */
        const promise = earlierOf(deadline, planned);
        if (promise === null || finished === null || finished <= promise) continue;
        late.push({ Name: task.Name || String(task.UID), Promised: promise,
                    Finished: finished, Late: daysBetween(promise, finished),
                    Cost: byTask[task.UID] || 0 });
    }

    /* The worst slip first, then the most expensive, then by name -- a table
     * a person reads twice wants the same plan in the same order twice. */
    late.sort((a, b) => b.Late - a.Late || b.Cost - a.Cost ||
                       Locale.Compare(a.Name, b.Name));

    /* Over-allocation is `resourcePeak` over every resource: what the Peak
     * column shows and the log counts, said again where the plan is read as a
     * whole. */
    let over = 0;
    for (const resource of project.Resources) {
        if (resource.IsNull || !resource.UID || !(resource.MaxUnits > 0)) continue;
        if (resourcePeak(project, resource) > resource.MaxUnits) over++;
    }

    /* The plan is read at its own status date when it wrote one -- which is
     * what Project calls "today" for a plan -- and at this machine's today
     * when it did not. */
    const status = whenMs(project.StatusDate);
    const readAt = status !== null ? status : new Date().getTime();

    return {
        start: start, finish: finish, status: status, readAt: readAt,

        /* The span three ways: working time on the project's calendar, the
         * calendar days the plan touches -- the two dates plus the day each
         * lands in, which is what a plan that starts and ends on one date is
         * -- and where the reading sits inside it: the work done, the work
         * left, and the days the plan is past its own finish, which is zero
         * unless it is late. */
        workingDays:  workingDays(project, calendar, start, finish),
        calendarDays: (start === null || finish === null)
                          ? null : daysBetween(start, finish) + 1,
        elapsed:  workingDays(project, calendar, start, readAt),
        remaining: workingDays(project, calendar, readAt, finish),
        behind: (start !== null && finish !== null && readAt > finish)
                     ? daysBetween(finish, readAt) : 0,

        tasks: named, summaries: summaries, milestones: milestones,
        critical: critical, done: done, running: running, waiting: waiting,
        /* The work-weighted advance, and the plain average for the plan whose
         * tasks carry no work at all -- which is a real file: a plan of
         * milestones, or one that was never costed. */
        percent: work > 0 ? earned / work : (named ? percentSum / named : 0),

        cost: cost, baselineCost: baselineCost, baselined: baselined,
        work: mspdiDuration(work),
        kindWork: byKind[1], kindMaterial: byKind[0], kindCost: byKind[2],
        overAllocated: over,

        late: late, lateDeadline: lateDeadline, lateBaseline: lateBaseline,
        notMet: notMet, worstLate: late.length ? late[0].Late : 0,
    };
}