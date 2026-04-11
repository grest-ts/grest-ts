import {GGTest} from "@grest-ts/testkit";
import {MainRuntime} from "../src/main";
import {MainConfigApi} from "../src/MainConfig.api";

describe("config auto-restore preserves beforeAll overrides", () => {

    const t = GGTest.startWorker({main: MainRuntime});

    beforeAll(async () => {
        await t.main.config.update(MainConfigApi.settings.objectConfig, {
            name: "set-in-beforeAll",
            maxRetries: 42,
            enabled: false
        });
    });

    test('first test modifies a different key (timeout)', async () => {
        const obj = await t.main.config.get(MainConfigApi.settings.objectConfig);
        expect(obj.name).toBe("set-in-beforeAll");

        await t.main.config.update(MainConfigApi.settings.timeout, 99999);
    });

    test('second test still sees beforeAll override after reset', async () => {
        const obj = await t.main.config.get(MainConfigApi.settings.objectConfig);
        expect(obj.name).toBe("set-in-beforeAll");
        expect(obj.maxRetries).toBe(42);
        expect(obj.enabled).toBe(false);

        const timeout = await t.main.config.get(MainConfigApi.settings.timeout);
        expect(timeout).toBe(5000);
    });
});
