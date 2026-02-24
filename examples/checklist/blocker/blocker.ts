import {GGHttp, GGHttpServer} from "@grest-ts/http"
import {GGLog} from "@grest-ts/logger"
import {BlockerService} from "./services/BlockerService";
import {BlockerConfig} from "./BlockerConfig";
import {GGConfigLocator, GGConfigStoreLocal, GGResource, GGSecret, GGSetting} from "@grest-ts/config";
import {BlockerApi} from "../common/api-internal/BlockerApi";
import {MyRuntime} from "../shared/MyRuntime";
import localConfig from "./config/local.js";

export class BlockerRuntime extends MyRuntime {

    public static readonly NAME = "blocker"

    protected compose(): void {
        super.compose()

        new GGConfigLocator(BlockerConfig).add([GGResource, GGSecret, GGSetting], new GGConfigStoreLocal(BlockerConfig, localConfig))

        // Use PostgreSQL by default. To switch to MySQL, change to:
        // const blockerDb = BlockerConfig.dbMysql.newMysqlPool();
        const blockerDb = BlockerConfig.db.newPostgresPool();

        BlockerConfig.subscriber.userEvents.newSubscriber({
            registered: async (event) => {
                event.username
                GGLog.info(this, `New user registered: ${event.username} (${event.userId})`);
            },
            loggedIn: async () => {
            },
            passwordChanged: async () => {
            }
        });

        // BlockerApi uses InternalAuthUse for service-to-service auth
        // startServer auto-processes the use class
        new GGHttp(new GGHttpServer())
            .http(BlockerApi, new BlockerService(blockerDb))

    }
}

BlockerRuntime.cli(import.meta.url).then();
