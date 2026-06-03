import {createLocalConfig} from "@grest-ts/config";
import {MainConfigApi} from "../MainConfig.api";

export default createLocalConfig(MainConfigApi, {
    settings: {
        timeout: 5000,
        objectConfig: {name: "default", maxRetries: 3, enabled: true}
    },
    publisher: {
        eventsTest: {
            settings: {},
            resource: {options: {}},
            providerConfig: {
                resource: {arn: "arn:aws:sns:eu-central-1:000000000000:events_test"},
                credentials: {accessKeyId: "test", secretAccessKey: "test"}
            }
        }
    }
})
