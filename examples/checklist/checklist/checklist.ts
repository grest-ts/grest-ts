import {GGHttp, GGHttpServer} from "@grest-ts/http"
import "@grest-ts/openapi"
import {GGAsyncApiDocs} from "@grest-ts/asyncapi"
import {UserService} from "./services/UserService"
import {ChecklistService} from "./services/ChecklistService"
import {BlockerApi, BlockUserRequest} from "../common/api-internal/BlockerApi";
import {ChecklistConfig} from "./ChecklistConfig";
import {StatusApi} from "../common/api-user-public/PurePublicApi"
import {UserPublicApi} from "../common/api-user-public/UserPublicApi"
import {UserAuthApi} from "../common/api-user/UserAuthApi"
import {ChecklistApi} from "../common/api-user/ChecklistApi"
import {BlockerUserApi} from "../common/api-user/BlockerUserApi";
import {ChecklistNotificationApi} from "../common/api-user/ChecklistNotificationApi";
import {UserContextMiddleware} from "./UserContext";
import {NotificationService} from "./services/NotificationService";
import {MyRuntime} from "../shared/MyRuntime";
import {GGConfigLocator, GGConfigStoreFile, GGConfigStoreLocal, GGResource, GGSecret, GGSetting} from "@grest-ts/config";
import {GGLocatorKey} from "@grest-ts/locator";
import localConfig from "./config/local.js";

export class ChecklistRuntime extends MyRuntime {

    public static readonly NAME = "checklist"

    protected compose(): void {
        super.compose();

        new GGConfigLocator(ChecklistConfig)
            .add([GGResource, GGSecret], new GGConfigStoreLocal(ChecklistConfig, localConfig))
            .add(GGSetting, new GGConfigStoreFile("./config/settings.json", import.meta.url))

        const checklistDb = ChecklistConfig.resources.postgres.newPostgresPool();

        const userEventsPublisher = ChecklistConfig.publisher.userEvents.newPublisher();
        const blockerClient = BlockerApi.createClient();
        const userService = new UserService(checklistDb, blockerClient, userEventsPublisher);
        const checklistService = new ChecklistService();

        new GGHttp(new GGHttpServer())
            .http(UserPublicApi, userService)
            .http(StatusApi, {
                status: async () => {
                    return {status: true}
                }
            })
            .openApi({title: "Checklist Public API", version: "1.0.0", specPath: "/openapi.json", docsPath: "/docs"})

        new GGHttp(new GGHttpServer({key: new GGLocatorKey("two")}))
            .use(new UserContextMiddleware(userService))
            .http(ChecklistApi, checklistService)
            .http(UserAuthApi, userService)
            .http(BlockerUserApi, {
                blockUser: async (request: BlockUserRequest) => {
                    await blockerClient.blockUser(request);
                }
            })
            .openApi({title: "Checklist Auth API", version: "1.0.0", specPath: "/openapi.json", docsPath: "/docs"})

        ChecklistNotificationApi.register(new NotificationService(checklistService).handleConnection, {
            middlewares: [new UserContextMiddleware(userService)]
        });

        // AsyncAPI docs — dedicated server for WebSocket API documentation
        const asyncApiDocsServer = new GGHttpServer({key: new GGLocatorKey("asyncapi-docs")});
        new GGAsyncApiDocs(asyncApiDocsServer, {
            schemas: [ChecklistNotificationApi],
            title: "Checklist Events",
            version: "1.0.0",
            description: "Real-time checklist item notifications over WebSocket",
            specPath: "/asyncapi.json",
            docsPath: "/asyncapi-docs",
        });
    }
}

ChecklistRuntime.cli(import.meta.url).then();
