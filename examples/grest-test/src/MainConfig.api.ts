import {GGConfig, GGSetting} from "@grest-ts/config";
import {IsBoolean, IsNumber, IsObject, IsPosInt, IsString} from "@grest-ts/schema";
import {EventsTestPublisher} from "./events/EventsTestEvents";

export const IsTestObjectSettings = IsObject({
    name: IsString,
    maxRetries: IsNumber,
    enabled: IsBoolean,
    optionalField: IsString.orUndefined
})
export type TestObjectSettings = typeof IsTestObjectSettings.infer

export const MainConfigApi = GGConfig.define("/config_test/", () => ({
    settings: {
        timeout: new GGSetting("timeout", IsPosInt, 5000, 'Test timeout value in ms',),
        objectConfig: new GGSetting<TestObjectSettings>("object_config", IsTestObjectSettings, {
            name: "default",
            maxRetries: 3,
            enabled: true
        }, 'Test object configuration')
    },
    publisher: {
        eventsTest: EventsTestPublisher.config()
    }
}))
