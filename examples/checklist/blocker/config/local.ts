import {createLocalConfig} from "@grest-ts/config";
import {BlockerConfig} from "../BlockerConfig";

export const postgresLocal = {
    host: {database: "blocker"},
    user: {username: "postgres", password: "postgres"},
};

export const mysqlLocal = {
    host: {database: "blocker"},
    user: {username: "root", password: "root"},
};

// Subscriber providerConfig is typed as unknown (events system limitation), cast needed
export default createLocalConfig(BlockerConfig, {
    db: postgresLocal,
    dbMysql: mysqlLocal,
    subscriber: {
        userEvents: {
            providerConfig: {
                resource: {arn: "arn:aws:sqs:eu-central-1:000000000000:blocker_user_events"},
                credentials: {accessKeyId: "test", secretAccessKey: "test"}
            }
        }
    }
} as any);
