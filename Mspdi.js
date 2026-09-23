/*
 * MSPDI, the shapes and the two roads.
 *
 * MS Project's XML interchange format (mspdi_pj12.xsd) is a **document**:
 * `xsd:sequence` order matters, the official schema and the files disagree
 * about the namespace URI, and durations arrive as `PT…S` text. So each shape
 * is a `Record` mapped onto its element (`static Xml`), and `LoadXml` stays
 * lenient: what the shape does not model lands on `Problems`, never in the
 * bin. `SaveXml` writes back into the tree it was handed and touches only
 * what the shape models -- which is what an interchange round trip needs.
 *
 * What is deliberately **not** modelled yet: baselines, timephased data,
 * resources' rates beyond the two shown, and the monthly/yearly recurrences of
 * a calendar exception -- the dates a file writes are what the engine reads.
 * Each of those is a field away, and `Problems` says exactly which file asked
 * for one.
 *
 * Custom fields are generic here: `ExtendedAttribute` defs and values are
 * modelled by FieldID and nothing assumes what a file puts in them. UID/WBS/
 * OutlineNumber are display, **never** identity -- Project reassigns UIDs when
 * appending/merging, and WBS is positional.
 */
"use strict";

/* <PredecessorLink>, repeated bare under its task (no wrapper).
 *
 * `Type` is one of the few fields the schema gives no default: there is no
 * value an absent one can be taken to mean, so the shape starts at -1 ("the
 * file did not say") and a present 0 -- one of the four real values --
 * survives the round trip. */
class MspLink extends Record {
    static Xml = { Root: "PredecessorLink" };
    static Fields = {
        PredecessorUID: Field.Int({ key: true }),
        Type:           Field.Int({ def: -1 }),
        LinkLag:        Field.Int(),
        LagFormat:      Field.Int(),
    };
}

/* One baseline: the plan as it was when it was saved. `Number` says which
 * baseline it is; 0 is the one Project's "Set Baseline" writes. */
class MspBaseline extends Record {
    static Xml = { Root: "Baseline" };
    static Fields = {
        Number: Field.Int({ key: true }),
        Start:  Field.DateTime(),
        Finish: Field.DateTime(),
        Work:   Field.Text(),
        Cost:   Field.Number(),
    };
}

/* A custom-field value on a task: FieldID + Value, nothing else. The
 * ValueGUID/Ltuid half belongs to lookup-table fields, which a plain text
 * custom field is not. */
class MspFieldValue extends Record {
    static Xml = { Root: "ExtendedAttribute" };
    static Fields = {
        FieldID: Field.Text({ key: true }),
        Value:   Field.Text(),
    };
}

/* A custom-field definition, under <ExtendedAttributes>. Same element name
 * as the value, different class: each is used in its own place, so the two
 * never meet. */
class MspFieldDef extends Record {
    static Xml = { Root: "ExtendedAttribute" };
    static Fields = {
        FieldID:   Field.Text({ key: true }),
        FieldName: Field.Text(),
        Alias:     Field.Text(),
    };
}

class MspTask extends Record {
    static Xml = { Root: "Task" };
    static Fields = {
        UID:              Field.Int({ key: true }),
        ID:               Field.Int(),
        Name:             Field.Text(),
        /* 0 Fixed Units, 1 Fixed Duration, 2 Fixed Work -- and -1 for a file
         * that left it out, which the schema says means the project's
         * `DefaultTaskType`, not Fixed Units. */
        Type:             Field.Int({ def: -1 }),
        IsNull:           Field.Bool(),
        WBS:              Field.Text(),
        OutlineNumber:    Field.Text(),
        OutlineLevel:     Field.Int(),
        Priority:         Field.Int(),
        Start:            Field.DateTime(),
        Finish:           Field.DateTime(),
        Duration:         Field.Text(),
        DurationFormat:   Field.Int(),
        Work:             Field.Text(),
        /* Effort-driven has no default in the schema; Project writes it in
         * every task and a file that omits it reads as false, which is what a
         * reader that does not know the file assumes. */
        EffortDriven:     Field.Bool(),
        /* Estimated is the one flag whose absence reads as true -- Project's
         * own default for a new task -- so a file that wrote 0 (not
         * estimated) keeps it and the `true` Project always writes is the
         * omission. */
        Estimated:        Field.Bool(true),
        /* Manually scheduled: its dates are the user's and the pass leaves
         * them alone. Absent means automatic, which is what a file older than
         * the flag can only mean. */
        Manual:           Field.Bool(),
        Milestone:        Field.Bool(),
        Summary:          Field.Bool(),
        Critical:         Field.Bool(),
        PercentComplete:  Field.Int(),
        ActualStart:      Field.DateTime(),
        ActualFinish:     Field.DateTime(),
        ConstraintType:   Field.Int(),
        CalendarUID:      Field.Int(),
        ConstraintDate:   Field.DateTime(),
        Deadline:         Field.DateTime(),
        HyperlinkAddress: Field.Text(),
        Notes:            Field.Text(),
        Links:            Field.List(MspLink),
        Attributes:       Field.List(MspFieldValue),
        Baselines:        Field.List(MspBaseline),
    };
}

/* One period of a resource's rates: `RatesFrom` inclusive, `RatesTo` the last
 * date it holds, and `RateTable` which of the five tables (0 A .. 4 E) the row
 * belongs to. The schema makes the two dates required, so every row has a
 * period and there is no open end to guess at. */
class MspRate extends Record {
    static Xml = { Root: "Rate" };
    static Fields = {
        RatesFrom:          Field.DateTime(),
        RatesTo:            Field.DateTime(),
        RateTable:          Field.Int(),
        StandardRate:       Field.Number(),
        StandardRateFormat: Field.Int(),
        OvertimeRate:       Field.Number(),
        OvertimeRateFormat: Field.Int(),
        CostPerUse:         Field.Number(),
    };
}

class MspResource extends Record {
    static Xml = { Root: "Resource" };
    static Fields = {
        UID:                Field.Int({ key: true }),
        ID:                 Field.Int(),
        Name:               Field.Text(),
        Type:               Field.Int(),
        IsNull:             Field.Bool(),
        Initials:           Field.Text(),
        Group:              Field.Text(),
        MaterialLabel:      Field.Text(),
        /* 1.0 is the schema's own default: an absent MaxUnits is one unit,
         * not none, and a file that wrote 1 loses only the number it already
         * meant. */
        MaxUnits:           Field.Number({ def: 1 }),
        AccrueAt:           Field.Int(),
        PercentWorkComplete: Field.Int(),
        StandardRate:       Field.Number(),
        StandardRateFormat: Field.Int(),
        Cost:               Field.Number(),
        OvertimeRate:       Field.Number(),
        OvertimeRateFormat: Field.Int(),
        OvertimeCost:       Field.Number(),
        CostPerUse:         Field.Number(),
        CalendarUID:        Field.Int(),
        Notes:              Field.Text(),
        /* After Notes and before TimephasedData, as the schema orders it: the
         * resource's rates over time, all five tables in one list. */
        Rates:              Field.List(MspRate, { in: "Rates" }),
    };
}

class MspAssignment extends Record {
    static Xml = { Root: "Assignment" };
    static Fields = {
        UID:                 Field.Int({ key: true }),
        TaskUID:             Field.Int(),
        ResourceUID:         Field.Int(),
        PercentWorkComplete: Field.Int(),
        ActualCost:          Field.Number(),
        Cost:                Field.Number(),
        CostRateTable:       Field.Int(),
        Finish:              Field.DateTime(),
        OvertimeCost:        Field.Number(),
        OvertimeWork:        Field.Text(),
        RegularWork:         Field.Text(),
        RemainingWork:       Field.Text(),
        Start:               Field.DateTime(),
        Units:               Field.Number(),
        Work:                Field.Text(),
        WorkContour:         Field.Int(),
    };
}

/* <WorkingTime>: a span of the day that is worked, `HH:MM[:SS]`. */
class MspWorkingTime extends Record {
    static Xml = { Root: "WorkingTime" };
    static Fields = {
        FromTime: Field.Time(),
        ToTime:   Field.Time(),
    };
}

/* One day of the week. MSPDI's `DayType` is 1 Sunday through 7 Saturday. */
class MspWeekDay extends Record {
    static Xml = { Root: "WeekDay" };
    static Fields = {
        DayType:      Field.Int(),
        DayWorking:   Field.Bool(),
        WorkingTimes: Field.List(MspWorkingTime, { in: "WorkingTimes" }),
    };
}

/* The dates an exception covers, inclusive. */
class MspTimePeriod extends Record {
    static Xml = { Root: "TimePeriod" };
    static Fields = {
        FromDate: Field.DateTime(),
        ToDate:   Field.DateTime(),
    };
}

/* A calendar exception: a holiday (`DayWorking` false) or a special working
 * day. The monthly and yearly recurrences are not modelled; the dates a file
 * writes are what the engine reads. */
class MspException extends Record {
    static Xml = { Root: "Exception" };
    static Fields = {
        EnteredByOccurrences: Field.Bool(),
        TimePeriod:           Field.Record(MspTimePeriod),
        Name:                 Field.Text(),
        Type:                 Field.Int(),
        Period:               Field.Int(),
        DaysOfWeek:           Field.Int(),
        DayWorking:           Field.Bool(),
        WorkingTimes:         Field.List(MspWorkingTime, { in: "WorkingTimes" }),
    };
}

class MspCalendar extends Record {
    static Xml = { Root: "Calendar" };
    static Fields = {
        UID:             Field.Int({ key: true }),
        Name:            Field.Text(),
        IsBaseCalendar:  Field.Bool(),
        BaseCalendarUID: Field.Int(),
        WeekDays:        Field.List(MspWeekDay, { in: "WeekDays" }),
        Exceptions:      Field.List(MspException, { in: "Exceptions" }),
    };
}

class MspProject extends Record {
    /* Declaration order is write order, so SaveVersion -- required by the
     * schema and first in it -- is declared first. */
    static Xml = { Root: "Project",
                   Namespace: ["http://schemas.microsoft.com/project",
                               "http://schemas.microsoft.com/project/2007"] };
    static Fields = {
        SaveVersion:       Field.Int(),
        Name:              Field.Text(),
        /* The document's own data, in the schema's order: what Project's
         * Project Information dialog edits. None of them has a default, so a
         * value the file wrote survives. */
        Title:             Field.Text(),
        Subject:           Field.Text(),
        Category:          Field.Text(),
        Company:           Field.Text(),
        Manager:           Field.Text(),
        Author:            Field.Text(),
        CreationDate:      Field.DateTime(),
        Revision:          Field.Int(),
        LastSaved:         Field.DateTime(),
        /* true, as the schema says: a file that means to schedule from the
         * finish writes `false`, and that is what is kept. `Field.Bool` takes
         * its default as the argument, not as an option. */
        ScheduleFromStart: Field.Bool(true),
        StartDate:         Field.DateTime(),
        FinishDate:        Field.DateTime(),
        FYStartDate:       Field.Int(),
        CriticalSlackLimit: Field.Int(),
        CurrencyDigits:    Field.Int(),
        CurrencySymbol:    Field.Text(),
        CurrencyCode:      Field.Text(),
        CurrencySymbolPosition: Field.Int(),
        CalendarUID:       Field.Int(),
        DefaultStartTime:  Field.Time(),
        DefaultFinishTime: Field.Time(),
        MinutesPerDay:     Field.Int(),
        MinutesPerWeek:    Field.Int(),
        DaysPerMonth:      Field.Int(),
        /* The schema's default is 1 (Fixed Duration), not 0: an absent one
         * means Fixed Duration and a file that wrote 0 (Fixed Units) keeps
         * its own word. */
        DefaultTaskType:   Field.Int({ def: 1 }),
        DefaultFixedCostAccrual: Field.Int(),
        DefaultStandardRate: Field.Number(),
        DefaultOvertimeRate: Field.Number(),
        DurationFormat:    Field.Int(),
        WorkFormat:        Field.Int(),
        /* The switches the schema declares a default for: a true is the
         * omission and a false is kept. */
        EditableActualCosts: Field.Bool(),
        HonorConstraints:  Field.Bool(true),
        EarnedValueMethod: Field.Int(),
        InsertedProjectsLikeSummary: Field.Bool(true),
        MultipleCriticalPaths: Field.Bool(),
        NewTasksEffortDriven: Field.Bool(true),
        NewTasksEstimated: Field.Bool(true),
        SplitsInProgressTasks: Field.Bool(true),
        SpreadActualCost:  Field.Bool(true),
        SpreadPercentComplete: Field.Bool(),
        TaskUpdatesResource: Field.Bool(),
        FiscalYearStart:   Field.Bool(),
        /* No default in the schema and Project writes its 0 (Sunday): a
         * present one is kept, an absent one reads as 0 at the call site. */
        WeekStartDay:      Field.Int({ def: -1 }),
        MoveCompletedEndsBack: Field.Bool(),
        MoveRemainingStartsBack: Field.Bool(),
        MoveRemainingStartsForward: Field.Bool(),
        MoveCompletedEndsForward: Field.Bool(),
        BaselineForEarnedValue: Field.Int(),
        AutoAddNewResourcesAndTasks: Field.Bool(true),
        StatusDate:        Field.DateTime(),
        CurrentDate:       Field.DateTime(),
        MicrosoftProjectServerURL: Field.Bool(),
        Autolink:          Field.Bool(),
        NewTaskStartDate:  Field.Int(),
        DefaultTaskEVMethod: Field.Int(),
        ProjectExternallyEdited: Field.Bool(),
        ExtendedCreationDate: Field.DateTime(),
        ActualsInSync:     Field.Bool(),
        RemoveFileProperties: Field.Bool(),
        AdminProject:      Field.Bool(),
        FieldDefs:         Field.List(MspFieldDef, { in: "ExtendedAttributes" }),
        Calendars:         Field.List(MspCalendar, { in: "Calendars" }),
        Tasks:             Field.List(MspTask, { in: "Tasks" }),
        Resources:         Field.List(MspResource, { in: "Resources" }),
        Assignments:       Field.List(MspAssignment, { in: "Assignments" }),
    };
};

/*
 * An MSPDI duration ("PT80H0M0S", "PT30M0S") as minutes, or null when it is
 * not one. The schema's `xsd:duration` spelling with weeks or months
 * ("P2W") is refused by the parser underneath, so files carry the
 * PT-normalised form and so does this.
 */
function mspdiMinutes(text) {
    const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(String(text || ""));
    if (!m || m[0] === "P" || m[0] === "PT") return null;
    return (m[1] ? Number(m[1]) * 480 : 0) +
           (m[2] ? Number(m[2]) * 60 : 0) +
           (m[3] ? Number(m[3]) : 0) +
           (m[4] ? Number(m[4]) / 60 : 0);
}

/*
 * `DurationFormat`'s units, by MSPDI's own numbering: the elapsed half of the
 * family counts calendar time -- weekends and nights included -- and the `?`
 * half is the estimated spelling. 19/20/51/52 are percent, not a duration.
 */
const DURATION_FORMATS = {
    3:  { unit: "m",  per: 1,     elapsed: false, estimated: false },
    4:  { unit: "m",  per: 1,     elapsed: true,  estimated: false },
    5:  { unit: "h",  per: 60,    elapsed: false, estimated: false },
    6:  { unit: "h",  per: 60,    elapsed: true,  estimated: false },
    7:  { unit: "d",  per: 480,   elapsed: false, estimated: false },
    8:  { unit: "d",  per: 1440,  elapsed: true,  estimated: false },
    9:  { unit: "w",  per: 2400,  elapsed: false, estimated: false },
    10: { unit: "w",  per: 10080, elapsed: true,  estimated: false },
    11: { unit: "mo", per: 9600,  elapsed: false, estimated: false },
    12: { unit: "mo", per: 43200, elapsed: true,  estimated: false },
    35: { unit: "m",  per: 1,     elapsed: false, estimated: true },
    36: { unit: "m",  per: 1,     elapsed: true,  estimated: true },
    37: { unit: "h",  per: 60,    elapsed: false, estimated: true },
    38: { unit: "h",  per: 60,    elapsed: true,  estimated: true },
    39: { unit: "d",  per: 480,   elapsed: false, estimated: true },
    40: { unit: "d",  per: 1440,  elapsed: true,  estimated: true },
    41: { unit: "w",  per: 2400,  elapsed: false, estimated: true },
    42: { unit: "w",  per: 10080, elapsed: true,  estimated: true },
    43: { unit: "mo", per: 9600,  elapsed: false, estimated: true },
    44: { unit: "mo", per: 43200, elapsed: true,  estimated: true },
};

/*
 * The units a duration is read and written in; a format outside the table is
 * the schema's own default, working days. The working units are the project's
 * own -- a day is `MinutesPerDay`, a week `MinutesPerWeek` and a month a
 * month of days -- while the elapsed ones are calendar time and do not move.
 */
function durationFormat(format, project) {
    const f = DURATION_FORMATS[format] || DURATION_FORMATS[7];
    if (f.elapsed || !project) return f;

    const day   = project.MinutesPerDay || 480;
    const week  = project.MinutesPerWeek || 2400;
    const month = day * (project.DaysPerMonth || 20);
    return { unit: f.unit, elapsed: false, estimated: f.estimated,
             per: f.unit === "m" ? 1 : f.unit === "h" ? 60
                : f.unit === "d" ? day : f.unit === "w" ? week : month };
}

function isElapsed(format) {
    return durationFormat(format).elapsed;
}

/* The format a typed unit names: "d" is working days, "ed" elapsed days. */
function formatOfUnit(unit) {
    const name = unit.replace(/^e/, "");
    const elapsed = unit.charAt(0) === "e";
    for (const code in DURATION_FORMATS) {
        const f = DURATION_FORMATS[code];
        if (f.unit === name && f.elapsed === elapsed) return Number(code);
    }
    return 7;
}

/* Minutes back into the `PT…S` spelling, hours and minutes the way Project
 * writes them: PT16H0M0S, PT30M0S. */
function mspdiDuration(minutes) {
    const h = Math.floor(minutes / 60), m = minutes % 60;
    if (minutes === 0) return "PT0H0M0S";
    if (h === 0) return `PT${m}M0S`;
    if (m === 0) return `PT${h}H0M0S`;
    return `PT${h}H${m}M0S`;
}

/* MSPDI's link types: 0 FF, 1 FS, 2 SF, 3 SS. A file that left `Type` out
 * gets FS, the relation a reader assumes and the one Project draws. */
function linkKind(link) {
    const type = link ? link.Type : -1;
    return type >= 0 && type <= 3 ? type : 1;
}

/* A task's type (0 Fixed Units, 1 Fixed Duration, 2 Fixed Work). A file that
 * left it out falls back to the project's `DefaultTaskType`, which is what
 * the schema makes of an absent `Type`. */
function taskKind(project, task) {
    const type = task ? task.Type : -1;
    if (type >= 0 && type <= 2) return type;
    const fallback = project ? project.DefaultTaskType : 0;
    return fallback >= 0 && fallback <= 2 ? fallback : 0;
}

/* MSPDI's resource types: 0 material, 1 work, 2 cost. */
const RESOURCE_TYPES = ["Material", "Work", "Cost"];

function resourceOf(project, uid) {
    for (const resource of project.Resources)
        if (resource.UID === uid) return resource;
    return null;
}

function taskOf(project, uid) {
    for (const task of project.Tasks)
        if (task.UID === uid) return task;
    return null;
}

/* The rows of one rate table (0 A .. 4 E), in date order. A row with no
 * `RateTable` is table A, which is the one Project writes and the one an
 * assignment uses until it says otherwise. */
function rateRows(resource, table) {
    const rows = [];
    for (const rate of resource.Rates)
        if ((rate.RateTable || 0) === table) rows.push(rate);
    rows.sort((a, b) => whenMs(a.RatesFrom) - whenMs(b.RatesFrom));
    return rows;
}

/* The row in effect at an instant: the last one whose `RatesFrom` has come,
 * the first when the instant is before all of them, null with no rows. */
function rateAt(rows, when) {
    let picked = null;
    for (const row of rows) {
        const from = whenMs(row.RatesFrom);
        if (from === null || from <= when) picked = row;
    }
    return picked || rows[0] || null;
}

/*
 * What an assignment costs: the file's own number when it has one, and
 * otherwise the resource's standard rate applied the way its type says -- a
 * material by the units assigned, a work resource by the hours worked -- plus
 * its cost per use. A work resource may carry a rate table: the work is spread
 * evenly over the assignment's working time and each rate period takes the
 * share that happens inside it, which is what a date in the middle of a task
 * means. Overtime and accrual are not modelled, so a file that means them
 * keeps the `Cost` Project wrote.
 */
function assignmentCost(project, assignment) {
    if (assignment.Cost) return assignment.Cost;
    const resource = resourceOf(project, assignment.ResourceUID);
    if (!resource) return 0;

    const hours = (mspdiMinutes(assignment.Work) || 0) / 60;
    const base  = resource.StandardRate || 0;

    if (resource.Type === 0)
        return (assignment.Units || 0) * base + (resource.CostPerUse || 0);

    let rows = rateRows(resource, assignment.CostRateTable || 0);
    if (!rows.length)
        return hours * base + (resource.CostPerUse || 0);

    const task = taskOf(project, assignment.TaskUID);
    let start = whenMs(assignment.Start), finish = whenMs(assignment.Finish);
    if (start === null && task) start = whenMs(task.Start);
    if (finish === null && task) finish = whenMs(task.Finish);
    if (start === null || finish === null || finish <= start)
        return hours * base + (resource.CostPerUse || 0);

    const work = new WorkCalendar(project, (task && task.CalendarUID) ||
                                           project.CalendarUID);
    const span = work.between(start, finish);
    if (span <= 0) return hours * base + (resource.CostPerUse || 0);

    let cost = 0, covered = 0;
    for (const row of rows) {
        const from = whenMs(row.RatesFrom), to = whenMs(row.RatesTo);
        const a = Math.max(start, from === null ? start : from);
        const b = Math.min(finish, to === null ? finish : to);
        if (b <= a) continue;

        const share = work.between(a, b) / span;
        const rate  = row.StandardRate || base;
        cost += hours * share * rate;
        covered += share;
    }
    if (covered < 1) cost += hours * (1 - covered) * base;   // a gap in the table

    const at = rateAt(rows, start);
    return cost + ((at ? at.CostPerUse : resource.CostPerUse) || 0);
}

/*
 * The most units a resource has assigned at once: the assignments whose tasks
 * overlap add up there, which is what over-allocation is. It answers 0 when
 * nothing is dated. It reports and never reschedules -- leveling is not here.
 */
function resourcePeak(project, resource) {
    const spans = [];
    for (const assignment of project.Assignments) {
        if (assignment.ResourceUID !== resource.UID) continue;

        const task = taskOf(project, assignment.TaskUID);
        if (!task) continue;

        const from = whenMs(task.Start), to = whenMs(task.Finish);
        if (from === null || to === null) continue;
        spans.push({ from, to, units: assignment.Units || 0 });
    }

    let peak = 0;
    for (const at of spans) {
        let total = 0;
        for (const span of spans)
            if (span.from <= at.from && span.to >= at.from) total += span.units;
        if (total > peak) peak = total;
    }
    return peak;
}

/* Every assignment of one task, added up: what the task costs. */
function taskCost(project, task) {
    let total = 0;
    for (const assignment of project.Assignments)
        if (assignment.TaskUID === task.UID)
            total += assignmentCost(project, assignment);
    return total;
}

/* Every assignment of one resource, added up. */
function resourceCost(project, resource) {
    let total = 0;
    for (const assignment of project.Assignments)
        if (assignment.ResourceUID === resource.UID)
            total += assignmentCost(project, assignment);
    return total;
}

/* The whole plan, added up. */
function projectCost(project) {
    let total = 0;
    for (const assignment of project.Assignments)
        total += assignmentCost(project, assignment);
    return total;
}

/* The baseline a task carries under one number -- 0 is the one Project's Set
 * Baseline writes first, up to 10 -- or null when it has none. */
function baselineOf(task, number) {
    for (const baseline of task.Baselines)
        if (baseline.Number === number) return baseline;
    return null;
}

/* A custom-field value by `FieldID`, or the first one when no field is asked
 * for; "" when the task carries none. The field's meaning is the file's. */
function attrOf(task, fieldID) {
    if (fieldID) {
        for (const attr of task.Attributes)
            if (attr.FieldID === fieldID) return attr.Value;
        return "";
    }
    return task.Attributes.length ? task.Attributes[0].Value : "";
}

/* One paragraph about a file, for the log and the status line. */
function summarize(project) {
    let tasks = 0, milestones = 0, withAttrs = 0, links = 0;
    for (const task of project.Tasks) {
        if (task.IsNull || task.Summary) continue;
        tasks++;
        if (task.Milestone) milestones++;
        if (task.Attributes.length) withAttrs++;
        links += task.Links.length;
    }
    return { tasks, milestones, withAttrs, links };
}

/*
 * The two roads. The document is kept beside the record it was read into:
 * `SaveXml` writes into that tree and leaves everything the shapes do not
 * model (calendars' working times, baselines, comments) exactly where it
 * was -- which is the whole of what makes a round trip an interchange and
 * not a rewrite.
 */
function readMspdi(path) {
    const doc     = File.LoadXml(path);
    const project = MspProject.LoadXml(doc.Root);
    return { doc, project, problems: project.Problems };
}

function writeMspdi(path, holder) {
    holder.project.SaveXml(holder.doc.Root);
    /* The whole document, not just the root: a comment before it is a node in
     * the tree too, and `Xml.Stringify` takes a document. */
    File.SaveXml(path, holder.doc);
}
