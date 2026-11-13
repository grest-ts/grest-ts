import {GG_TEST_RUNTIME_WORKER} from "../GGTestRuntimeWorkerKey";

// The Date shim's slot: the setup file installs it (installTestClock) before anything else runs.
const SETUP_FILE_LOADED = Symbol.for("@grest-ts/testkit:GGDateShim");

/** The error for test-side API used where it can't work, saying which of the usual mistakes it is. */
export function outsideTestkitError(what: string): Error {
    if (GG_TEST_RUNTIME_WORKER.tryGet()) {
        return new Error(`${what} is test-side API, and this code runs inside a runtime: call it from the test, not from code a runtime runs.`);
    }
    if (!(globalThis as any)[SETUP_FILE_LOADED]) {
        return new Error(
            `${what} needs the testkit's vitest setup, which isn't loaded. vitest.config needs ` +
            `setupFiles: ["@grest-ts/testkit-vitest"] + globalSetup: ["@grest-ts/testkit-vitest/globalSetup"].`
        );
    }
    return new Error(
        `${what} works only within the testkit's describe, tests and hooks, not at a file's top level. A file that ` +
        `imports \`describe\` or a hook (\`afterEach\`, …) from "vitest" bypasses them: drop that import, or use a GGTestContext's hooks.`
    );
}
