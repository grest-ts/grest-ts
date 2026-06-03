import {callOn, GGTest} from "@grest-ts/testkit";
import {MainRuntime} from "../src/main";
import {ClientInfo, GG_CLIENT_INFO, GG_FEATURE_FLAGS, MiddlewareTestApi} from "../src/api/MiddlewareTestApi";
import {GG_INTL_LOCALE} from "@grest-ts/intl";
import {GGContext} from "@grest-ts/context";
import {afterEach} from "vitest";
import {tLocale} from "@grest-ts/schema";

describe.shuffle("middleware", () => {

    GGTest.startInline(MainRuntime);
    const scope = new GGContext("test");

    afterEach(() => {
        scope.reset();
    })

    test("middleware extracts language from Accept-Language header", async () => {

        // Test German
        scope.set(GG_INTL_LOCALE, {locale: "de" as tLocale});
        const client = callOn(MiddlewareTestApi, scope);
        const responseDe = await client.getLanguage();
        expect(responseDe.language).toBe("de");

        // Test French
        scope.set(GG_INTL_LOCALE, {locale: "fr" as tLocale});
        const responseFr = await client.getLanguage();
        expect(responseFr.language).toBe("fr");

        // Test undefined (no language preference)
        scope.delete(GG_INTL_LOCALE);
        const responseDefault = await client.getLanguage();
        expect(responseDefault.language).toBeUndefined();
    });

    test("middleware chain accumulates all context values", async () => {
        // Create client with context for all effects

        scope.set(GG_INTL_LOCALE, {locale: "de" as tLocale});
        scope.set<ClientInfo>(GG_CLIENT_INFO, {version: '2.0.0', platform: 'ios'});
        scope.set(GG_FEATURE_FLAGS, {darkMode: true, betaFeatures: true});

        const client = callOn(MiddlewareTestApi, scope);

        const response = await client.echo({message: "Hello"});

        // Verify message was echoed
        expect(response.message).toBe("Hello");

        // Verify language middleware worked
        expect(response.language).toBe("de");

        // Verify clientInfo middleware worked
        expect(response.clientVersion).toBe("2.0.0");
        expect(response.clientPlatform).toBe("ios");

        // Verify async featureFlags middleware worked
        expect(response.darkMode).toBe(true);
        expect(response.betaFeatures).toBe(true);
    });

    test("middleware uses defaults when headers are missing", async () => {
        scope.set<ClientInfo>(GG_CLIENT_INFO, {version: 'unknown', platform: 'web'});

        const client = callOn(MiddlewareTestApi, scope);
        const response = await client.echo({message: "Test"});

        // Defaults - language is undefined when not set
        expect(response.language).toBeUndefined();
        expect(response.clientVersion).toBe("unknown");
        expect(response.clientPlatform).toBe("web");
        expect(response.darkMode).toBe(false);
        expect(response.betaFeatures).toBe(false);
    });

    test("async middleware works correctly", async () => {
        // Test with only dark-mode flag
        scope.set(GG_FEATURE_FLAGS, {darkMode: true, betaFeatures: false});
        const clientDark = callOn(MiddlewareTestApi, scope);
        const responseDark = await clientDark.echo({message: "dark"});
        expect(responseDark.darkMode).toBe(true);
        expect(responseDark.betaFeatures).toBe(false);

        // Test with only beta flag
        scope.set(GG_FEATURE_FLAGS, {darkMode: false, betaFeatures: true});
        const clientBeta = callOn(MiddlewareTestApi, scope);
        const responseBeta = await clientBeta.echo({message: "beta"});
        expect(responseBeta.darkMode).toBe(false);
        expect(responseBeta.betaFeatures).toBe(true);
    });

    test("different clients have isolated contexts", async () => {
        // Two different clients with different settings

        // @TODO This test should be restored, but only when you can actually run the clients in two contexts
        // @TODO Right now client runs in the test context, you can branch, but still not get the client to execute its calls within that bracnhed context.

        // const scope1 = GGLocator.getScope().branch("ClientA")
        // GG_LANGUAGE.set("en");
        // GG_CLIENT_INFO.set({version: '1.0.0', platform: 'web'});
        // const clientA = MiddlewareTestApi.createTestClient();
        //
        // GG_LANGUAGE.set("fr");
        // GG_CLIENT_INFO.set({version: '1.0.0', platform: 'android'});
        // const clientB = MiddlewareTestApi.createTestClient();
        //
        // // Make concurrent requests
        // const [responseA, responseB] = await Promise.all([
        //     clientA.echo({message: "A"}),
        //     clientB.echo({message: "B"})
        // ]);
        //
        // // Verify contexts are isolated
        // expect(responseA.language).toBe("en");
        // expect(responseA.clientPlatform).toBe("web");
        // expect(responseA.message).toBe("A");
        //
        // expect(responseB.language).toBe("fr");
        // expect(responseB.clientPlatform).toBe("android");
        // expect(responseB.message).toBe("B");
    });
});
