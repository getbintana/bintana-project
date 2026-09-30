"use strict";
class ProbeForm extends Form {
    Form_Open() {
        for (let i = 0; i < 8; i++) this.Tasks.Add([`Tarea ${i}`]);
        this.Note.Text = "";
        Timer.After(250, () => {
            print(`table:  ${this.Tasks.ResolvedBackground}`);
            print(`chart:  ${this.Chart.ResolvedBackground}`);
            print(`label:  ${this.Note.ResolvedBackground}`);
            print(`chart declared: "${this.Chart.Background}"`);
            this.Chart.Background = "rgba(0,0,0,0)";
            this.Chart.Background = "";
            this.Chart.Background = "#ff0000";
            Timer.After(200, () => {
                print(`chart after #ff0000: ${this.Chart.ResolvedBackground}`);
                this.Chart.Background = "";
                Timer.After(200, () => {
                    print(`chart back to the theme's: ${this.Chart.ResolvedBackground}`);
                    Application.Quit(0);
                });
            });
        });
    }
}
