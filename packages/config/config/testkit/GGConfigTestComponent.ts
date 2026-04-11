import {GGTestComponent, GGTestRunner} from "@grest-ts/testkit";
import {GGConfigIPC} from "./GGConfigCommands";

export class GGConfigTestComponent implements GGTestComponent {

    private readonly runner: GGTestRunner;

    constructor(runner: GGTestRunner) {
        this.runner = runner;
    }

    async beforeAll(): Promise<void> {
        await this.runner.sendCommand(GGConfigIPC.worker.pushUndoFrame, undefined);
    }

    async afterAll(): Promise<void> {
        await this.runner.sendCommand(GGConfigIPC.worker.popUndoFrame, undefined);
    }

    async beforeEach(): Promise<void> {
        await this.runner.sendCommand(GGConfigIPC.worker.pushUndoFrame, undefined);
    }

    async afterEach(): Promise<void> {
        await this.runner.sendCommand(GGConfigIPC.worker.popUndoFrame, undefined);
    }
}

GGTestRunner.registerExtension(GGConfigTestComponent);
