import {GGTestComponent, GGTestRunner} from "@grest-ts/testkit";
import {GGConfigIPC} from "./GGConfigCommands";

export class GGConfigTestComponent implements GGTestComponent {

    private readonly runner: GGTestRunner;

    constructor(runner: GGTestRunner) {
        this.runner = runner;
    }

    async beforeEach(): Promise<void> {
        await this.runner.sendCommand(GGConfigIPC.worker.beginTestTracking, undefined);
    }

    async afterEach(): Promise<void> {
        await this.runner.sendCommand(GGConfigIPC.worker.resetAfterTest, undefined);
    }
}

GGTestRunner.registerExtension(GGConfigTestComponent);
