import {GGMysqlConfig} from "@grest-ts/db-mysql";
import {GGPostgresConfig} from "@grest-ts/db-postgre";
import {GGConfig, GGSetting} from "@grest-ts/config";
import {UserEventsPublisher} from "../common/events/UserEvents";
import {IsBoolean, IsPosInt} from "@grest-ts/schema";
import {resolvePath} from "../common/resolvePath";

export const ChecklistConfig = GGConfig.define("/checklist/", () => ({
    resources: {
        // PostgreSQL - primary database
        postgres: new GGPostgresConfig("db", resolvePath("./schema/checklist.postgres.sql", import.meta.url)),
        // MySQL - alternative database (easy swap)
        mysql: new GGMysqlConfig("db_mysql", resolvePath("./schema/checklist.sql", import.meta.url))
    },
    publisher: {
        userEvents: UserEventsPublisher.config()
    },
    settings: {
        request: {
            timeout: new GGSetting("request/timeout", IsPosInt, 5000, 'HTTP request timeout in ms')
        },
        feature: {
            notification: new GGSetting("feature_my_notification", IsBoolean, true, 'Enable push notifications')
        }
    }
}))
