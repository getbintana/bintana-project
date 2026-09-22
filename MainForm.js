/*
 * bintana-project: MSPDI in a window, first cut.
 *
 * Import a Project XML file, show its tasks and their custom-field values,
 * write it back without touching what the model does not own (see Mspdi.js).
 *
 * With `check [file] [outdir]` on the command line
 * (`bintana/tests/try.sh bintana-project check tests/corpus/01-minimal.xml`
 * from anywhere, with the project dir in place of `bintana-project`) it runs
 * headless instead: loads the file, round-trips it through a scratch file,
 * re-reads it, prints what it found and what SaveXml touched, and quits with
 * 0/1. `check-corpus [dir] [outdir]` does that for every `*.xml` in the
 * folder, which is what `tests/run.sh` drives. That is the shape that lets a
 * virtual display verify what a window would show.
 */
"use strict";

class MainForm extends Form {

    /* What was read, and the document it came out of -- SaveXml writes into
     * that tree, so both travel together (see Mspdi.js). */
    holder = null;
    path   = "";
    rows   = [];

    Form_Open() {
        try {
            if (Application.Arguments.indexOf("check-corpus") >= 0) {
                this.checkCorpus();
                return;
            }
            if (Application.Arguments.indexOf("check") >= 0) {
                this.check();
                return;
            }
            this.openSample();
        } catch (e) {
            Message.Error("Cannot open the sample: {0}", e.message);
        }
    }

    /* The bundled sample, so an empty first screen is never the question. */
    openSample() {
        this.load(File.Join(Application.Directory, "tests", "corpus", "01-minimal.xml"));
    }

    load(path) {
        this.holder = readMspdi(path);
        this.path   = path;
        this.fill();
    }

    /* The records the list is showing, parallel to it by index -- a
     * TableView holds strings, so these hold what the strings came from. */
    fill() {
        const project = this.holder.project;
        this.rows = [];

        this.Tasks.Clear();
        for (const task of project.Tasks) {
            if (task.IsNull || task.Summary) continue;
            this.rows.push(task);
            this.Tasks.Add(this.cells(task));
        }

        const s = summarize(project);
        const problems = this.holder.problems.length;
        this.LblFile.Text = this.path;
        this.LblStatus.Text =
            `${s.tasks} tasks, ${s.milestones} milestones, ` +
            `${s.withAttrs} with attributes, ${s.links} links` +
            (problems ? ` -- ${problems} not modelled (see log)` : "");

        this.Log.Clear();
        this.log(`Opened ${File.Name(this.path)}: ${s.tasks} tasks, ` +
                 `${s.milestones} milestones, ${s.links} dependencies.`);
        for (const p of this.holder.problems) this.log(`not modelled: ${p}`);

        /* The data changed: the chart is a frame behind until asked. */
        this.Gantt.Redraw();
    }

    cells(task) {
        const pad = task.Milestone ? "" : "  ".repeat(Math.min(task.OutlineLevel, 6));
        return [pad + task.Name, shortDate(task.Start), shortDate(task.Finish),
                firstAttr(task)];
    }

    log(line) {
        this.Log.Append(line + "\n");
    }

    /* Every frame is drawn from the data; there is nothing to keep. */
    Gantt_Draw(p, width, height) {
        drawGantt(p, width, height, this.holder ? this.holder.project : null);
    }

    BtnOpen_Click() {
        Dialog.OpenFile("Open Project XML",
            { Folder: File.Join(Application.Directory, "tests", "corpus"),
              Filters: [["Project XML", "*.xml"], ["All files", "*"]] },
            (path) => {
                try {
                    this.load(path);
                } catch (e) {
                    Message.Error("Cannot open {0}: {1}", path, e.message);
                }
            });
    }

    BtnSave_Click() {
        if (!this.holder) return;
        Dialog.SaveFile("Save Project XML",
            { Folder: File.Directory(this.path), Name: File.Name(this.path),
              Filters: [["Project XML", "*.xml"]] },
            (path) => {
                try {
                    writeMspdi(path, this.holder);
                    this.path = path;
                    this.LblFile.Text = path;
                    this.log(`Saved ${path}.`);
                } catch (e) {
                    Message.Error("Cannot save {0}: {1}", path, e.message);
                }
            });
    }

    /*
     * The headless road: load, count, round-trip, re-read, compare, quit.
     * Every line it prints is the assertion; a throw quits nonzero.
     */
    check() {
        const args = Application.Arguments;
        const i    = args.indexOf("check");
        const path = this.resolve(args[i + 1] ||
                                  File.Join("tests", "corpus", "01-minimal.xml"));
        const out  = args[i + 2] ? this.resolve(args[i + 2]) : Environment.TempDirectory;
        const ok   = this.checkFile(path, out);
        print(ok ? "CHECK-OK" : "CHECK-FAILED");
        Application.Quit(ok ? 0 : 1);
    }

    checkCorpus() {
        const args = Application.Arguments;
        const i    = args.indexOf("check-corpus");
        const dir  = this.resolve(args[i + 1] || File.Join("tests", "corpus"));
        const out  = args[i + 2] ? this.resolve(args[i + 2]) : Environment.TempDirectory;
        let ok = true, files = 0;
        for (const path of Directory.Files(dir, "*.xml")) {
            files++;
            if (!this.checkFile(path, out)) ok = false;
        }
        print(`corpus files=${files}`);
        print(ok && files > 0 ? "CHECK-OK" : "CHECK-FAILED");
        Application.Quit(ok && files > 0 ? 0 : 1);
    }

    /* A path from the command line may be relative to the project. */
    resolve(path) {
        return path.charAt(0) === "/" ? path : File.Join(Application.Directory, path);
    }

    /*
     * One file's whole trip. The file is read twice: one tree is left alone
     * as the "before", the other is handed to SaveXml, and the difference
     * between them is exactly what the round trip touched.
     */
    checkFile(path, outDir) {
        const name = File.Name(path);
        try {
            const pristine = readMspdi(path);
            const holder   = readMspdi(path);
            this.holder = holder;
            this.path   = path;
            this.fill();   // the same road the window takes: table, log, status

            const before = summarize(holder.project);
            print(`file=${name} tasks=${before.tasks} milestones=${before.milestones} ` +
                  `withAttrs=${before.withAttrs} links=${before.links} ` +
                  `problems=${holder.problems.length}`);

            const out = File.Join(outDir, "bintana-project-check-" + name);
            writeMspdi(out, holder);
            print(`out=${out}`);

            const second  = readMspdi(out);
            const after   = summarize(second.project);
            const touched = treeDiff(pristine.doc.Root, second.doc.Root);
            print(`roundtrip tasks=${after.tasks} withAttrs=${after.withAttrs} ` +
                  `links=${after.links} problems=${second.problems.length} ` +
                  `touched=${touched.length}`);

            if (Application.Arguments.indexOf("dump-problems") >= 0) {
                for (const p of holder.problems) print(`problem-in: ${p}`);
                for (const p of second.problems) print(`problem-out: ${p}`);
            }
            if (Application.Arguments.indexOf("dump-touched") >= 0) {
                for (const t of touched) print(`touched: ${t}`);
            }

            const same = before.tasks === after.tasks &&
                         before.withAttrs === after.withAttrs &&
                         before.links === after.links;
            const ok = same && this.checkGantt();
            print(`check ${name}: ${ok ? "ok" : "FAILED"}`);
            return ok;
        } catch (e) {
            print(`check ${name}: ERROR ${e.message}`);
            return false;
        }
    }

    /*
     * The chart ran to the end: the same Draw into a PNG (explicit size --
     * a surface never shown has none of its own), then the file's weight
     * and the frame's own dump. A handler that threw halfway writes no
     * file and leaves a dump with no closing Pop.
     */
    checkGantt() {
        const png  = File.Join(Environment.TempDirectory, "bintana-project-gantt.png");
        this.Gantt.Save(png, 900, 320);
        const info = File.Info(png);
        const dump = this.Gantt.Dump();
        const calls = dump ? dump.split("\n").length : 0;
        const rows = ganttRows(this.holder.project);
        let names = rows.length > 0;
        for (let i = 0; i < Math.min(rows.length, 2); i++) {
            if (dump.indexOf(rows[i].Name) < 0) names = false;
        }
        print(`gantt ${File.Name(this.path)} png=${info ? info.Size : -1} ` +
              `calls=${calls} names=${names ? "yes" : "no"}`);
        if (Application.Arguments.indexOf("dump-gantt") >= 0) print(dump);
        return info && info.Size > 0 && calls > 10 && names;
    }
}

/* "2026-10-01T17:00:00" reads better as "2026-10-01 17:00" in a row. */
function shortDate(when) {
    return String(when || "").slice(0, 16).replace("T", " ");
}

/*
 * What SaveXml changed, leaf by leaf, keyed by `path/Name[n]` so a removed
 * or inserted sibling never shifts the ones after it. Containers are not
 * compared by text: an element's `Text` is all the character data under it,
 * and indentation alone would report every one of them.
 */
function leafValues(el, path, out) {
    const kids = el.Children;
    if (!kids.length) {
        out.push(`${path}=${JSON.stringify(el.Text || "")}`);
        return;
    }
    const seen = {};
    for (const kid of kids) {
        const n = seen[kid.Name] = (seen[kid.Name] || 0) + 1;
        leafValues(kid, `${path}/${kid.Name}[${n}]`, out);
    }
}

function treeDiff(before, after) {
    const a = [], b = [];
    if (before) leafValues(before, "/" + before.Name, a);
    if (after) leafValues(after, "/" + after.Name, b);
    const inA = {}, inB = {};
    for (const line of a) inA[line.slice(0, line.indexOf("="))] = line.slice(line.indexOf("=") + 1);
    for (const line of b) inB[line.slice(0, line.indexOf("="))] = line.slice(line.indexOf("=") + 1);
    const out = [];
    for (const key in inA) {
        if (!(key in inB)) out.push(`${key}: removed (was ${inA[key]})`);
        else if (inA[key] !== inB[key]) out.push(`${key}: ${inA[key]} -> ${inB[key]}`);
    }
    for (const key in inB) {
        if (!(key in inA)) out.push(`${key}: added (${inB[key]})`);
    }
    return out;
}
