import {GGRuntime} from "@grest-ts/runtime"
import {GGHttp, GGHttpServer} from "@grest-ts/http"
import {PermissionsApi, TEST_SCOPES_WIRE_HANDLER} from "./api/PermissionsApi"
import {PermissionsTestService} from "./services/PermissionsTestService"
import {WsFeaturePermissionsApi, WsPermissionsApi} from "./api/WsPermissionsApi"
import {WsFeaturePermissionsService, WsPermissionsService} from "./services/WsPermissionsService"
import {GGOpenApiDocs} from "@grest-ts/openapi"
import {GGAsyncApiDocs} from "@grest-ts/asyncapi"
import {GGApiDocs} from "@grest-ts/api-docs"
import {ChatApiSchema, NotificationApiSchema} from "./api/AsyncApiShowcaseApi"
import {ShowcaseApi} from "./api/OpenApiShowcaseApi"
import {GGLocatorKey} from "@grest-ts/locator"
import {ConfigTestApi} from "./api/ConfigTestApi"
import {MetricsTestApi} from "./api/MetricsTestApi"
import {HttpMetricsTestApi} from "./api/HttpMetricsTestApi"
import {ConfigTestSocketApi} from "./api/ConfigTestSocketApi"
import {ClientTestSocketApi} from "./api/ClientTestSocketApi"
import {AuthedSocketApi} from "./api/AuthedSocketApi"
import {RawEchoApi} from "./api/RawEchoApi"
import {RawEchoService} from "./services/RawEchoService"
import {RawAdminApi} from "./api/RawAdminApi"
import {CustomClientProxyApi} from "./api/CustomClientProxyApi"
import {QuerySocketApi} from "./api/QuerySocketApi"
import {EventsTestApi} from "./api/EventsTestApi"
import {LanguageTestApi} from "./api/LanguageTestApi"
import {MiddlewareTestApi} from "./api/MiddlewareTestApi"
import {CookieTestApi} from "./api/CookieTestApi"
import {CookieTestService} from "./services/CookieTestService"
import {WS_SESSION_HANDLER, WsCookieApi} from "./api/WsCookieApi"
import {WsCookieService} from "./services/WsCookieService"
import {FileUploadTestApi} from "./api/FileUploadTestApi"
import {BenchmarkApi} from "./api/BenchmarkApi"
import {ConfigTestService} from "./services/ConfigTestService"
import {MetricsTestService} from "./services/MetricsTestService"
import {HttpMetricsTestService} from "./services/HttpMetricsTestService"
import {EventsTestService} from "./services/EventsTestService"
import {LanguageTestService} from "./services/LanguageTestService"
import {MiddlewareTestService} from "./services/MiddlewareTestService"
import {FileUploadTestService} from "./services/FileUploadTestService"
import {BenchmarkService} from "./services/BenchmarkService"
import {ClientTestSocketService} from "./services/ClientTestSocketService"
import {AuthedSocketService} from "./services/AuthedSocketService"
import {QuerySocketService} from "./services/QuerySocketService"
import {MessagingSocket} from "./api/ChatMessagingApi"
import {PresenceSocket} from "./api/ChatPresenceApi"
import {ChatMessagingService} from "./services/ChatMessagingService"
import {ChatPresenceService} from "./services/ChatPresenceService"
import {GGConfigLocator, GGConfigStoreFile, GGConfigStoreLocal, GGResource, GGSecret, GGSetting} from "@grest-ts/config";
import {GGMetricsLoader} from "@grest-ts/metrics";
import {MainConfigApi} from "./MainConfig.api";
import localConfig from "./config/local.js";
import {GGIntl, GGIntlTypeLocalizer} from "@grest-ts/intl";
import {GGIssueKey} from "@grest-ts/schema";

GGIssueKey.setLocalizer(GGIntlTypeLocalizer)

export class MainRuntime extends GGRuntime {

    public static readonly NAME = "configTest"

    protected compose(): void {

        new GGConfigLocator(MainConfigApi)
            .add([GGResource, GGSecret], new GGConfigStoreLocal(MainConfigApi, localConfig))
            .add(GGSetting, new GGConfigStoreFile("../config/settings.json", import.meta.url))

        new GGMetricsLoader();

        const intl = new GGIntl({systemLocale: 'en'});
        intl.addMessages("en", {
            "invalid.string.type": "Value must be a string",
            "invalid.number.type": "Value must be a number",
            "invalid.boolean.type": "Value must be a boolean",
            "invalid.object.type": "Value must be an object",
            "invalid.array.type": "Value must be an array",
            "required": "This field is required",
        });
        intl.addMessages("de", {
            "invalid.string.type": "Wert muss eine Zeichenkette sein",
            "invalid.number.type": "Wert muss eine Zahl sein",
            "invalid.boolean.type": "Wert muss ein Boolean sein",
            "invalid.object.type": "Wert muss ein Objekt sein",
            "invalid.array.type": "Wert muss ein Array sein",
            "required": "Dieses Feld ist erforderlich",
        });

        const configTestService = new ConfigTestService();
        const metricsTestService = new MetricsTestService();
        const httpMetricsTestService = new HttpMetricsTestService();
        const eventsTestService = new EventsTestService(MainConfigApi.publisher.eventsTest.newPublisher());
        const languageTestService = new LanguageTestService();
        const middlewareTestService = new MiddlewareTestService();
        const fileUploadTestService = new FileUploadTestService();
        const benchmarkService = new BenchmarkService();
        const clientTestSocketService = new ClientTestSocketService();
        const authedSocketService = new AuthedSocketService();
        const querySocketService = new QuerySocketService();

        const httpServer = new GGHttpServer()

        TEST_SCOPES_WIRE_HANDLER.create({});
        WS_SESSION_HANDLER.create({});

        new GGHttp(httpServer)
            .http(ConfigTestApi, configTestService)
            .http(MetricsTestApi, metricsTestService)
            .http(HttpMetricsTestApi, httpMetricsTestService)
            .http(EventsTestApi, eventsTestService)
            .http(LanguageTestApi, languageTestService)
            .http(MiddlewareTestApi, middlewareTestService)
            .http(FileUploadTestApi, fileUploadTestService)
            .http(BenchmarkApi, benchmarkService)
            .http(PermissionsApi, new PermissionsTestService())
            .http(CookieTestApi, new CookieTestService())
            .ws(ConfigTestSocketApi, configTestService.handleSocketConnection)
            .ws(ClientTestSocketApi, clientTestSocketService.handleConnection)
            .ws(AuthedSocketApi, authedSocketService.handleConnection)
            .wsRaw(RawEchoApi, new RawEchoService().handleConnection)
            .ws(QuerySocketApi, querySocketService.handleConnection)
            .ws(WsCookieApi, new WsCookieService().handleConnection)
            .wsRaw(RawAdminApi, (socket) => { socket.onMessage((data) => socket.send(data)) })
            .wsRaw(CustomClientProxyApi, (socket, _query, upgrade) => {
                socket.onMessage((_data, isBinary) => socket.send(`${isBinary ? "bin" : "txt"} ${upgrade.path} ${upgrade.remoteAddress}`));
            })
            .ws(WsPermissionsApi, new WsPermissionsService().handleConnection)
            .ws(WsFeaturePermissionsApi, new WsFeaturePermissionsService().handleConnection)
            .ws(MessagingSocket, new ChatMessagingService().handle)
            .ws(PresenceSocket, new ChatPresenceService().handle)

        GGOpenApiDocs.register({http: httpServer, title: "Grest Test API", version: "1.0.0", specPath: "/openapi.json", docsPath: "/docs"});

        // AsyncAPI for real registered WebSocket schemas (ConfigTestSocketApi)
        GGAsyncApiDocs.register({
            http: httpServer,
            title: "Grest Test Events",
            version: "1.0.0",
            description: "WebSocket APIs in the grest-test service",
            specPath: "/asyncapi.json",
            docsPath: "/asyncapi-docs"
        });

        // HTTP Showcase API — rich OpenAPI demo on PORT+1
        const showcasePort = process.env.PORT ? Number(process.env.PORT) + 1 : 0;
        const showcaseServer = new GGHttpServer({port: showcasePort, key: new GGLocatorKey('showcase-server')});
        GGOpenApiDocs.register({
            http: showcaseServer,
            schemas: [ShowcaseApi],
            title: "Showcase API",
            version: "1.0.0",
            description: "Rich demo: discriminated unions, file upload/download, bearer auth, branded types, docs, defaults, tuples, and more.",
            specPath: "/openapi.json",
            docsPath: "/docs",
        });

        // AsyncAPI Showcase — rich WebSocket demo on PORT+2
        const asyncShowcasePort = process.env.PORT ? Number(process.env.PORT) + 2 : 0;
        const asyncShowcaseServer = new GGHttpServer({port: asyncShowcasePort, key: new GGLocatorKey('asyncapi-showcase-server')});
        GGAsyncApiDocs.register({
            http: asyncShowcaseServer,
            schemas: [ChatApiSchema, NotificationApiSchema],
            title: "WebSocket Showcase",
            version: "1.0.0",
            description: "Rich WebSocket demo: chat (request/response + fire-and-forget + server push), notifications, bearer auth, named schemas, discriminated unions.",
            specPath: "/asyncapi.json",
            docsPath: "/asyncapi-docs",
        });

        // Unified Showcase — both protocols in one page on PORT+3
        const unifiedShowcasePort = process.env.PORT ? Number(process.env.PORT) + 3 : 0;
        const unifiedShowcaseServer = new GGHttpServer({port: unifiedShowcasePort, key: new GGLocatorKey('unified-showcase-server')});
        GGApiDocs.register({
            httpServer: unifiedShowcaseServer,
            docsPath: "/docs",
            docs: [{
                slug: "unified",
                title: "Unified Showcase",
                version: "1.0.0",
                description: "Mixed HTTP + WebSocket APIs rendered natively from grest-ts contracts — brand intersection types, typed errors, reuse detection, color-coded WS direction.",
                groups: {
                    "HTTP": {http: [ShowcaseApi]},
                    "Realtime": {ws: [ChatApiSchema, NotificationApiSchema]},
                },
            }],
        });
    }
}

MainRuntime.cli(import.meta.url).then();
