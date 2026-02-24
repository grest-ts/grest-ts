import {GGRuntime} from "@grest-ts/runtime"
import {GGLog} from "@grest-ts/logger"
import {GGConfigLocator, GGConfigStoreLocal, GGResource, GGSecret, GGSetting} from "@grest-ts/config";
import {GGMetricsLoader} from "@grest-ts/metrics";
import {SubConfigApi} from "./SubConfig.api";
import localConfig from "./config/sub-local.js";

export class SubRuntime extends GGRuntime {

    public static readonly NAME = "eventsSubscriber"

    protected compose(): void {

        new GGConfigLocator(SubConfigApi).add([GGResource, GGSecret, GGSetting], new GGConfigStoreLocal(SubConfigApi, localConfig))
        new GGMetricsLoader();

        SubConfigApi.subscriber.eventsTest.newSubscriber({
            created: async (event) => {
                GGLog.info(this, `Test created: ${event.testName} (${event.testId})`);
            },
            started: async (event) => {
                GGLog.info(this, `Test started: ${event.testId}`);
            },
            completed: async (event) => {
                GGLog.info(this, `Test completed: ${event.testId}`);
            }
        });
    }
}

SubRuntime.cli(import.meta.url).then();
