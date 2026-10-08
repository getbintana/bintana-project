/*
 * The plan's resources, administered: the list and the editor of the one
 * picked -- name, type, units, rates, calendar -- with New, Apply, Delete and
 * the rate tables. A resource is the file's, like a calendar, and not the
 * selected task's: the side panel only *assigns* them, so this is where they
 * come from and the dialog is opened from the Project menu.
 *
 * It is not an editor of its own: every change calls back into the
 * application, which runs it through `Edit`, so each is one undo.
 */
"use strict";

class ResourcesForm extends Form {

    static open(project, actions) {
        const dlg = new ResourcesForm();

        dlg.project = project;
        dlg.actions = actions;
        dlg.Modal   = true;

        /* The calendars a resource may name, the plan's own in front. */
        dlg.calChoices = [-1];
        const names = [Locale.Text("Project default")];
        for (const calendar of project.Calendars) {
            dlg.calChoices.push(calendar.UID);
            names.push(calendar.Name);
        }
        dlg.CmbResCalendar.Items = names;

        dlg.rows = [];
        dlg.selectedUID = null;
        dlg.fill();
        dlg.Show();
        return dlg;
    }

    /* The resources with the cost of their assignments added up. UID 0 is
     * Project's "Unassigned": nobody edits or assigns it, so it is not listed. */
    fill() {
        this.Resources.Clear();
        this.rows = [];
        for (const resource of this.project.Resources) {
            if (resource.IsNull || resource.UID === 0) continue;
            this.rows.push(resource);
            this.Resources.Add([
                resource.Name,
                String(resource.MaxUnits),
                String(resourcePeak(this.project, resource)),
                String(resource.StandardRate),
                Locale.Number(resourceCost(this.project, resource), 2),
            ]);
        }
        this.LblResEmpty.Visible = this.rows.length === 0;
        this.selectedUID = null;
        this.Resources_Select();
    }

    pick(uid) {
        const at = this.rows.findIndex((r) => r.UID === uid);
        if (at < 0) return;
        this.Resources.Select(at);
        this.Resources_Select();
    }

    /* A resource picked: the editor shows it, so Apply updates it. With none
     * the fields are those of a new one, and Apply adds. */
    Resources_Select() {
        const resource = this.Resources.Index >= 0
                       ? this.rows[this.Resources.Index] : null;
        this.selectedUID        = resource ? resource.UID : null;
        this.TxtResName.Text    = resource ? resource.Name : "";
        this.CmbResType.Index   = resource ? (resource.Type || 0) : 1;
        this.TxtResMax.Text     = resource ? String(resource.MaxUnits) : "1";
        this.TxtResRate.Text    = resource ? String(resource.StandardRate) : "";
        this.TxtResCostUse.Text = resource ? String(resource.CostPerUse) : "0";
        this.BtnResDel.Enabled   = !!resource;
        this.BtnResRates.Enabled = !!resource;
        const atCal = resource
                    ? this.calChoices.indexOf(resource.CalendarUID > 0
                                              ? resource.CalendarUID : -1)
                    : 0;
        this.CmbResCalendar.Index = atCal >= 0 ? atCal : 0;
    }

    BtnResNew_Click() {
        this.Resources.DeselectAll();
        this.Resources_Select();
        this.TxtResName.SetFocus();
    }

    BtnResApply_Click() {
        const values = {
            Name:          this.TxtResName.Text,
            Type:          Math.max(this.CmbResType.Index, 0),
            MaxUnits:      resourceNumber(this.TxtResMax.Text),
            StandardRate:  resourceNumber(this.TxtResRate.Text),
            CostPerUse:    resourceNumber(this.TxtResCostUse.Text),
            CalendarUID:   this.calChoices[this.CmbResCalendar.Index] !== undefined
                         ? this.calChoices[this.CmbResCalendar.Index] : -1,
        };
        if (values.Name === "" || isNaN(values.MaxUnits) ||
            isNaN(values.StandardRate) || isNaN(values.CostPerUse)) {
            Message.Error("A resource needs a name, and its numbers must be numbers.");
            return;
        }
        try {
            const probe = new MspResource();
            for (const name in values) probe[name] = values[name];
        } catch (e) {
            Message.Error("Cannot apply: {0}", e.message);
            return;
        }

        const resource = this.selectedUID === null
                       ? this.actions.add(values)
                       : this.actions.set(this.selectedUID, values);
        this.fill();
        if (resource) this.pick(resource.UID);
    }

    BtnResDel_Click() {
        if (this.selectedUID === null) return;
        const resource = this.rows.find((r) => r.UID === this.selectedUID);
        if (!resource) return;
        ConfirmForm.ask(Locale.Text("Delete resource"),
            Locale.Text('Delete "{0}" and its assignments?', resource.Name),
            Locale.Text("Delete"), () => {
                this.actions.remove(resource.UID);
                this.fill();
            });
    }

    /* The resource's rate tables, in their own dialog: the list comes back
     * whole and it is one undo like any edit. */
    BtnResRates_Click() {
        const uid = this.selectedUID;
        const resource = uid === null ? null : this.rows.find((r) => r.UID === uid);
        if (!resource) return;

        RatesForm.open(resource, (rates) => {
            if (!this.actions.setRates(uid, rates)) return;
            this.fill();
            this.pick(uid);
        });
    }

    BtnClose_Click() { this.Close(); }
}
