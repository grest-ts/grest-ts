import {GGTestComponent, GGTestRunner} from "@grest-ts/testkit";
import {GGConfigIPC} from "./GGConfigCommands";

export class GGConfigTestComponent implements GGTestComponent {

    private readonly runner: GGTestRunner;
    private configModifiedInTest = false;

    constructor(runner: GGTestRunner) {
        this.runner = runner;
    }

    async markConfigModified(): Promise<void> {
        if (this.configModifiedInTest) return;
        this.configModifiedInTest = true;
        await this.runner.sendCommand(GGConfigIPC.worker.beginTestTracking, undefined);
    }

    async afterEach(): Promise<void> {
        if (!this.configModifiedInTest) return;
        await this.runner.sendCommand(GGConfigIPC.worker.resetAfterTest, undefined);
        this.configModifiedInTest = false;
    }
}

GGTestRunner.registerExtension(GGConfigTestComponent);
