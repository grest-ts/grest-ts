import {GGTest} from "@grest-ts/testkit";
import {MainRuntime} from "../src/main";
import {MainConfigApi} from "../src/MainConfig.api";

describe("config isolation between nested describes", () => {

    const t = GGTest.startWorker({main: MainRuntime});

    describe("group1 sets objectConfig in beforeAll", () => {

        beforeAll(async () => {
            await t.main.config.update(MainConfigApi.settings.objectConfig, {
                name: "group1-value",
                maxRetries: 77,
                enabled: false
            });
        });

        test('group1 test sees its beforeAll config', async () => {
            const obj = await t.main.config.get(MainConfigApi.settings.objectConfig);
            expect(obj.name).toBe("group1-value");
        });
    });

    describe("group2 expects default config (no beforeAll)", () => {

        test('group2 should NOT see group1 beforeAll leak', async () => {
            const obj = await t.main.config.get(MainConfigApi.settings.objectConfig);
            expect(obj.name).toBe("default");
            expect(obj.maxRetries).toBe(3);
            expect(obj.enabled).toBe(true);
        });
    });

    describe("group3 sets its own beforeAll", () => {

        beforeAll(async () => {
            await t.main.config.update(MainConfigApi.settings.timeout, 11111);
        });

        test('group3 sees its own override', async () => {
            const timeout = await t.main.config.get(MainConfigApi.settings.timeout);
            expect(timeout).toBe(11111);
        });

        test('group3 test modifies objectConfig, timeout survives', async () => {
            await t.main.config.update(MainConfigApi.settings.objectConfig, {
                name: "modified-in-test",
                maxRetries: 1,
                enabled: false
            });

            const timeout = await t.main.config.get(MainConfigApi.settings.timeout);
            expect(timeout).toBe(11111);
        });

        test('group3 next test: objectConfig reverted, timeout still from beforeAll', async () => {
            const obj = await t.main.config.get(MainConfigApi.settings.objectConfig);
            expect(obj.name).toBe("default");

            const timeout = await t.main.config.get(MainConfigApi.settings.timeout);
            expect(timeout).toBe(11111);
        });
    });

    describe("group4 expects all defaults after group3", () => {

        test('group4 sees defaults (group3 timeout reverted)', async () => {
            const obj = await t.main.config.get(MainConfigApi.settings.objectConfig);
            expect(obj.name).toBe("default");

            const timeout = await t.main.config.get(MainConfigApi.settings.timeout);
            expect(timeout).toBe(5000);
        });
    });
});
