/*
 * One custom-field definition: its `FieldID` -- the identity the values on the
 * tasks are keyed by --, the `FieldName` the file gives it, the `Alias` a
 * person reads, and the value list when the field is one. A new one starts on
 * the first free Project text field (Text1 is 188743731 and they run to
 * Text30), because that is what a custom field is in Project's own numbering;
 * on an existing field the `FieldID` is fixed, since another ID would orphan
 * every value already written with it.
 *
 * The entries of a list are the rows of a table -- the `Value` the task's
 * drop-down shows and a description Project keeps for a hand -- and the two
 * boxes add a row or update the picked one, like the calendar's exceptions.
 * The IDs are not the dialog's business; the command that writes the
 * definition hands a fresh row the next number free in the plan, because that
 * is what keeps every task's pointer meaning something.
 */
"use strict";

const TEXT_FIELD_FIRST = 188743731;
const TEXT_FIELD_COUNT = 30;

/* The first text field the plan does not define, with the name Project gives
 * it -- or an empty one when all thirty are taken. */
function nextTextField(defs) {
    for (let i = 0; i < TEXT_FIELD_COUNT; i++) {
        const fieldID = String(TEXT_FIELD_FIRST + i);
        if (!defs.some((d) => d.FieldID === fieldID))
            return { FieldID: fieldID, FieldName: `Text${i + 1}` };
    }
    return { FieldID: "", FieldName: "" };
}

class FieldForm extends Form {

    static open(field, defs, onSaved) {
        const dlg = new FieldForm();

        dlg.field   = field;
        dlg.defs    = defs;
        dlg.onSaved = onSaved;
        dlg.Modal   = true;

        dlg.Text = Locale.Text(field ? "Edit custom field" : "New custom field");
        dlg.entries = field
                    ? (field.ValueList || []).map((entry) => ({
                          ID: entry.ID, Value: entry.Value,
                          Description: entry.Description }))
                    : [];
        if (field) {
            dlg.TxtFieldID.Text     = field.FieldID;
            dlg.TxtFieldID.ReadOnly = true;
            dlg.TxtFieldName.Text   = field.FieldName;
            dlg.TxtFieldAlias.Text  = field.Alias;
        } else {
            const next = nextTextField(defs);
            dlg.TxtFieldID.Text   = next.FieldID;
            dlg.TxtFieldName.Text = next.FieldName;
        }

        /* The tick is set with the flag on: a `CheckButton` raises `Click` on
         * an assignment, and the handler would answer a fill as a click. */
        dlg.filling = true;
        dlg.ChkList.Active = dlg.entries.length > 0;
        dlg.ListBox.Visible = dlg.ChkList.Active;
        dlg.filling = false;
        dlg.fill();

        dlg.Show();
        dlg.TxtFieldAlias.SetFocus();
        return dlg;
    }

    fill() {
        this.FieldValues.Clear();
        for (const entry of this.entries)
            this.FieldValues.Add([entry.Value, entry.Description]);
        this.BtnValDel.Enabled = false;
    }

    /* The picked row is the editor's: its two say what the boxes say. */
    FieldValues_Select() {
        const entry = this.FieldValues.Index >= 0
                    ? this.entries[this.FieldValues.Index] : null;
        this.BtnValDel.Enabled = !!entry;
        if (!entry) return;
        this.TxtValValue.Text       = entry.Value;
        this.TxtValDescription.Text = entry.Description;
    }

    ChkList_Click() {
        if (this.filling) return;
        this.ListBox.Visible = this.ChkList.Active;
    }

    /* Add, or update the one picked -- the boxes are the editor for both. */
    BtnValAdd_Click() {
        const value = this.TxtValValue.Text;
        if (value.trim() === "") {
            Message.Error("A list value cannot be empty.");
            return;
        }
        const was = this.FieldValues.Index >= 0
                  ? this.entries[this.FieldValues.Index] : null;
        const entry = { ID: was ? was.ID : 0,
                        Value: value,
                        Description: this.TxtValDescription.Text };
        if (was) this.entries[this.FieldValues.Index] = entry;
        else     this.entries.push(entry);
        this.fill();
    }

    BtnValDel_Click() {
        const at = this.FieldValues.Index;
        if (at < 0) return;
        this.entries.splice(at, 1);
        this.fill();
    }

    BtnOk_Click() {
        const fieldID = this.TxtFieldID.Text.trim();
        if (!/^\d+$/.test(fieldID)) {
            Message.Error("The field's ID must be a number.");
            return;
        }
        if (!this.field && this.defs.some((d) => d.FieldID === fieldID)) {
            Message.Error("That field is already defined.");
            return;
        }

        const values = { FieldID:   fieldID,
                         FieldName: this.TxtFieldName.Text.trim(),
                         Alias:     this.TxtFieldAlias.Text.trim(),
                         ValueList: this.ChkList.Active ? this.entries : [] };
        try {
            new MspFieldDef({ FieldID: values.FieldID,
                              FieldName: values.FieldName,
                              Alias: values.Alias });
        } catch (e) {
            Message.Error("Cannot apply: {0}", e.message);
            return;
        }

        this.Close();
        if (this.onSaved) this.onSaved(values);
    }

    BtnCancel_Click() { this.Close(); }
}
