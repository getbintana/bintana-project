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
 * What is deliberately **not** modelled yet: calendars beyond UID/Name
 * (WeekDays/Exceptions are reported, not taken), baselines, timephased data,
 * resources' rates beyond the two shown. Each of those is a field away, and
 * `Problems` says exactly which file asked for one.
 *
 * Custom fields are generic here: `ExtendedAttribute` defs and values are
 * modelled by FieldID and nothing assumes what a file puts in them. UID/WBS/
 * OutlineNumber are display, **never** identity -- Project reassigns UIDs when
 * appending/merging, and WBS is positional.
 */
"use strict";

/* <PredecessorLink>, repeated bare under its task (no wrapper). */
class MspLink extends Record {
    static Xml = { Root: "PredecessorLink" };
    static Fields = {
        PredecessorUID: Field.Int({ key: true }),
        Type:           Field.Int(),
        LinkLag:        Field.Int(),
        LagFormat:      Field.Int(),
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
        Type:             Field.Int(),
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
        Milestone:        Field.Bool(),
        Summary:          Field.Bool(),
        Critical:         Field.Bool(),
        PercentComplete:  Field.Int(),
        CalendarUID:      Field.Int(),
        HyperlinkAddress: Field.Text(),
        Links:            Field.List(MspLink),
        Attributes:       Field.List(MspFieldValue),
    };
}

class MspResource extends Record {
    static Xml = { Root: "Resource" };
    static Fields = {
        UID:           Field.Int({ key: true }),
        Name:          Field.Text(),
        Type:          Field.Int(),
        Initials:      Field.Text(),
        Group:         Field.Text(),
        MaterialLabel: Field.Text(),
        MaxUnits:      Field.Number(),
        StandardRate:  Field.Number(),
        CalendarUID:   Field.Int(),
    };
}

class MspAssignment extends Record {
    static Xml = { Root: "Assignment" };
    static Fields = {
        UID:          Field.Int({ key: true }),
        TaskUID:      Field.Int(),
        ResourceUID:  Field.Int(),
        Units:        Field.Number(),
        Work:         Field.Text(),
        RegularWork:  Field.Text(),
        Start:        Field.DateTime(),
        Finish:       Field.DateTime(),
    };
}

class MspCalendar extends Record {
    static Xml = { Root: "Calendar" };
    static Fields = {
        UID:  Field.Int({ key: true }),
        Name: Field.Text(),
    };
}

class MspProject extends Record {
    /* Declaration order is write order, so SaveVersion -- required by the
     * schema and first in it -- is declared first. */
    static Xml = { Root: "Project",
                   Namespace: ["http://schemas.microsoft.com/project",
                               "http://schemas.microsoft.com/project/2007"] };
    static Fields = {
        SaveVersion:  Field.Int(),
        Name:         Field.Text(),
        StartDate:    Field.DateTime(),
        FinishDate:   Field.DateTime(),
        CalendarUID:  Field.Int(),
        FieldDefs:    Field.List(MspFieldDef, { in: "ExtendedAttributes" }),
        Calendars:    Field.List(MspCalendar, { in: "Calendars" }),
        Tasks:        Field.List(MspTask, { in: "Tasks" }),
        Resources:    Field.List(MspResource, { in: "Resources" }),
        Assignments:  Field.List(MspAssignment, { in: "Assignments" }),
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

/* The first custom-field value a task carries, or "" when it carries none.
 * Only the list shows this today; the field's meaning is the file's. */
function firstAttr(task) {
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
    File.SaveXml(path, holder.project.SaveXml(holder.doc.Root));
}
