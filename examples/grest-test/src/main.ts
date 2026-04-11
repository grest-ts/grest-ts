import {GGRuntime} from "@grest-ts/runtime"
import {GGHttpServer} from "@grest-ts/http"
import {GGOpenApiServer} from "@grest-ts/openapi"
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
