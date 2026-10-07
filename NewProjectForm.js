/*
 * What a new project is made of, before it is a file: the plan's name, the line
 * Project shows over it, the date the whole schedule hangs off, and where the
 * file goes.
 *
 * **A plan with no name is not a plan**, so the name is the first field and the
 * only one that cannot be empty -- everything else has an honest default: no
 * title is a plan with no subtitle, and a start that is not typed is today,
 * which is what the blank plan wrote before this dialog existed.
 *
 * The folder is a text field with an icon that opens the chooser, rather than
 * the chooser on its own: **the path stays visible before accepting**, which is
 * where the file is going to be, and that is worth being able to correct by
 * typing. The hint below says the whole path and, when it is taken, why Create
 * is greyed.
 */
"use strict";

/* A file name is a name in a folder: it cannot carry a separator, and a "." or
 * ".." is not one. The same refusal as the IDE's folder names, for the same
 * reason -- a path that goes somewhere else is not what the field says. */
const BAD_FILE = /[/\\]/

class NewProjectForm extends Form {

    /* `folder` is where the last file came from, which is where a new one belongs
     * until somebody says otherwise; the caller reads it, so this only has a
     * home to fall back on. */
    static ask(folder, onAccept) {
        const dlg = new NewProjectForm();

        dlg.TxtFolder.Text = folder || Environment.HomeDirectory;
        dlg.TxtFile.Text   = "plan.xml";
        dlg.TxtStart.Text  = Day.Today;
        dlg.onAccept       = onAccept;
        dlg.Modal          = true;

        dlg.Show();
        dlg.TxtName.SetFocus();
        dlg.updateHint();
        return dlg;
    }

    /* What the four fields add up to, or nothing: the answer is asked here and
     * in `accept`, because the hint is shown while it is still wrong and Create
     * is greyed, and a question answered twice is a question that can disagree
     * with itself. */
    values() {
        const name   = trim(this.TxtName.Text);
        const folder = trim(this.TxtFolder.Text);
        const file   = trim(this.TxtFile.Text);
        const start  = trim(this.TxtStart.Text);
        if (!name || !folder || !file || BAD_FILE.test(file)) return null;
        return { Name: name, Title: trim(this.TxtTitle.Text),
                 Start: start, Folder: folder, File: file };
    }

    /* The whole path, and the one thing that can be wrong with it: **a file
     * that is already there is not a new project**, and `File.Save` would
     * replace it without asking. Shown before accepting rather than refused
     * after, because a greyed Create says why. */
    updateHint() {
        /* Reachable while the form is still being built -- the `.form` fills the
         * fields in order and a handler can arrive with a later one still unset,
         * so this reads what it needs and gives up rather than throwing. */
        if (!this.TxtName || !this.TxtFolder || !this.TxtFile ||
            !this.TxtStart || !this.LblHint || !this.BtnCreate) return;

        const v = this.values();
        if (!v) {
            this.LblHint.Text = "";
            this.BtnCreate.Enabled = false;
            return;
        }

        const path = File.Join(v.Folder, v.File);
        if (!File.IsDir(v.Folder)) {
            this.LblHint.Text = Locale.Text("That folder does not exist.");
        } else if (File.Exists(path)) {
            this.LblHint.Text = Locale.Text("There is already a file there.");
        } else if (v.Start && !planStartable(v.Start)) {
            this.LblHint.Text = Locale.Text("{0} is not a date this plan can use.",
                                            v.Start);
        } else {
            this.LblHint.Text = path;
        }
        this.BtnCreate.Enabled = this.LblHint.Text === path;
    }

    accept() {
        const v = this.values();
        if (!v) return;

        if (!File.IsDir(v.Folder)) {
            Message.Error("That folder does not exist:\n{0}",
                          v.Folder);
            return;
        }
        const path = File.Join(v.Folder, v.File);
        if (File.Exists(path)) {
            Message.Error("There is already a file at {0}.", path);
            return;
        }
        /* The date the whole schedule hangs off, asked of the shape itself: a
         * start this engine cannot schedule is a plan whose every task is a lie,
         * and the shape is what will have to say so. */
        if (v.Start && !planStartable(v.Start)) {
            Message.Error("{0} is not a date this plan can use.",
                          v.Start);
            return;
        }

        this.Close();
        if (this.onAccept) this.onAccept(v);
    }

    TxtName_Change()   { this.updateHint(); }
    TxtTitle_Change()  { this.updateHint(); }
    TxtStart_Change()  { this.updateHint(); }
    TxtFolder_Change() { this.updateHint(); }
    TxtFile_Change()   { this.updateHint(); }

    TxtFolder_IconClick() {
        /* The chooser, not the answer: whichever folder comes back stays in the
         * field and stays editable, and the hint re-reads it. */
        Dialog.SelectFolder(Locale.Text("Folder"), (dir) => {
            this.TxtFolder.Text = dir;
            this.updateHint();
        });
    }

    BtnCreate_Click() { this.accept(); }
    BtnCancel_Click() { this.Close(); }
}

/* Whether the shape will take this as a start, which is the only authority on
 * what a date is here: a hand-typed "next tuesday" is not an error to be
 * reported twice, it is a field that is not filled yet. */
function planStartable(text) {
    try {
        const probe = new MspProject({ StartDate: planStart(text) });
        return !!probe.StartDate;
    } catch (e) {
        return false;
    }
}