import {GGRuntime} from "@grest-ts/runtime"
import {GGHttpServer} from "@grest-ts/http"
import {GGOpenApiServer, toOpenApi} from "@grest-ts/openapi"
import {ShowcaseApi} from "./api/OpenApiShowcaseApi"
import {readFileSync} from "fs"
import {join, dirname} from "path"
import {createRequire} from "module"
import {GGLocatorKey} from "@grest-ts/locator"
import {ConfigTestApi} from "./api/ConfigTestApi"
import {MetricsTestApi} from "./api/MetricsTestApi"
import {HttpMetricsTestApi} from "./api/HttpMetricsTestApi"
import {ConfigTestSocketApi} from "./api/ConfigTestSocketApi"
import {EventsTestApi} from "./api/EventsTestApi"
import {LanguageTestApi} from "./api/LanguageTestApi"
import {MiddlewareTestApi} from "./api/MiddlewareTestApi"
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

        const httpServer = new GGHttpServer();
        ConfigTestApi.register(configTestService);
        MetricsTestApi.register(metricsTestService);
        HttpMetricsTestApi.register(httpMetricsTestService);
        EventsTestApi.register(eventsTestService);
        LanguageTestApi.register(languageTestService);
        MiddlewareTestApi.register(middlewareTestService);
        FileUploadTestApi.register(fileUploadTestService);
        BenchmarkApi.register(benchmarkService);
        ConfigTestSocketApi.register(configTestService.handleSocketConnection);

        new GGOpenApiServer(httpServer, {title: "Grest Test API", version: "1.0.0", specPath: "/openapi.json", docsPath: "/docs"})
            .registerWith(httpServer);

        // Showcase API — only active when PORT env is explicitly set (i.e. real server run, not tests)
        if (process.env.PORT) {
            const showcasePort = Number(process.env.PORT) + 1;
            const showcaseServer = new GGHttpServer({
                port: showcasePort,
                key: new GGLocatorKey('showcase-server')
            });
            const showcaseSpec = toOpenApi([ShowcaseApi], {
                title: "Showcase API",
                version: "1.0.0",
                description: "Rich demo covering discriminated unions, file upload/download, bearer auth, branded types, docs, defaults, enums, tuples, and more.",
            });
            const specJson = JSON.stringify(showcaseSpec, null, 2);
            const _req = createRequire(import.meta.url);
            const swaggerDist = dirname(_req.resolve('swagger-ui-dist/swagger-ui-bundle.js'));
            const swaggerBundle = readFileSync(join(swaggerDist, 'swagger-ui-bundle.js'));
            const swaggerCss = readFileSync(join(swaggerDist, 'swagger-ui.css'));
            showcaseServer.registerRoute("GET", "/openapi.json", async (_req, res) => {
                res.writeHead(200, {"Content-Type": "application/json", "Content-Length": Buffer.byteLength(specJson)});
                res.end(specJson);
            });
            showcaseServer.registerRoute("GET", "/docs", async (_req, res) => {
                const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><title>Showcase API Docs</title><link rel="stylesheet" href="/docs/assets/swagger-ui.css"/></head><body><div id="swagger-ui"></div><script src="/docs/assets/swagger-ui-bundle.js"></script><script>SwaggerUIBundle({url:"/openapi.json",dom_id:"#swagger-ui",presets:[SwaggerUIBundle.presets.apis,SwaggerUIBundle.SwaggerUIStandalonePreset],layout:"BaseLayout",deepLinking:true});</script></body></html>`;
                res.writeHead(200, {"Content-Type": "text/html; charset=utf-8"});
                res.end(html);
            });
            showcaseServer.registerRoute("GET", "/docs/assets/swagger-ui-bundle.js", async (_req, res) => {
                res.writeHead(200, {"Content-Type": "application/javascript", "Cache-Control": "public, max-age=86400"});
                res.end(swaggerBundle);
            });
            showcaseServer.registerRoute("GET", "/docs/assets/swagger-ui.css", async (_req, res) => {
                res.writeHead(200, {"Content-Type": "text/css", "Cache-Control": "public, max-age=86400"});
                res.end(swaggerCss);
            });
            // showcaseServer registered with GGLocator, started automatically by runtime
        }

        // new GGHttp()
        //     .http(ConfigTestApi, configTestService)
        //     .http(MetricsTestApi, metricsTestService)
        //     .http(HttpMetricsTestApi, httpMetricsTestService)
        //     .http(EventsTestApi, eventsTestService)
        //     .http(LanguageTestApi, languageTestService)
        //     .http(MiddlewareTestApi, middlewareTestService)
        //     .websocket(ConfigTestSocketApi, configTestService.handleSocketConnection.bind(configTestService))

    }
}

MainRuntime.cli(import.meta.url).then();
