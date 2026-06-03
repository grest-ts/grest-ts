import {createLocalConfig} from "@grest-ts/config";
import {ChecklistConfig} from "../ChecklistConfig";

export const postgresLocal = {
    host: {database: "checklist"},
    user: {username: "postgres", password: "postgres"},
};

export const mysqlLocal = {
    host: {database: "checklist"},
    user: {username: "root", password: "root"},
};

export default createLocalConfig(ChecklistConfig, {
    resources: {
        postgres: postgresLocal,
        mysql: mysqlLocal,
    },
    publisher: {
        userEvents: {
            settings: {},
            resource: {options: {}},
            providerConfig: {
                resource: {arn: "arn:aws:sns:eu-central-1:000000000000:user_events"},
                credentials: {accessKeyId: "test", secretAccessKey: "test"}
            }
        }
    },
    settings: {
        request: {
            timeout: 5000
        },
        feature: {
            notification: true
        }
    }
})
