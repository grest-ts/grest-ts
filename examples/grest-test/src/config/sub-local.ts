import {createLocalConfig} from "@grest-ts/config";
import {SubConfigApi} from "../SubConfig.api";

// Subscriber providerConfig is typed as unknown (events system limitation), cast needed
export default createLocalConfig(SubConfigApi, {
    subscriber: {
        eventsTest: {
            providerConfig: {
                resource: {arn: "arn:aws:sqs:eu-central-1:000000000000:events_subscriber"},
                credentials: {accessKeyId: "test", secretAccessKey: "test"}
            }
        } as any // @TODO This is kind of bad, but overall events package itself is experimental, so no point to fix now.
    }
});
