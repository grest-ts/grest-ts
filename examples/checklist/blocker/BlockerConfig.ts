import {GGMysqlConfig} from "@grest-ts/db-mysql";
import {GGPostgresConfig} from "@grest-ts/db-postgre";
import {GGConfig} from "@grest-ts/config";
import {UserEventsSubscriber} from "../common/events/UserEvents";
import {resolvePath} from "../common/resolvePath";

export const BlockerConfig = GGConfig.define("/blocker/", () => ({
    // PostgreSQL - primary database
    db: new GGPostgresConfig("db", resolvePath("./schema/blocker.postgres.sql", import.meta.url)),
    // MySQL - alternative database (easy swap)
    dbMysql: new GGMysqlConfig("db_mysql", resolvePath("./schema/blocker.sql", import.meta.url)),
    subscriber: {
        userEvents: UserEventsSubscriber.config({
            batchSize: 20
        })
    }
}))
