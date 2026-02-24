import {callOn, GGTest} from "@grest-ts/testkit";
import {MainRuntime} from "../src/main";
import {LanguageTestApi} from "../src/api/LanguageTestApi";
import {tLocale, VALIDATION_ERROR} from "@grest-ts/schema";
import {GG_INTL_LOCALE} from "@grest-ts/intl";
import {GGContext} from "@grest-ts/context";
import {afterEach} from "vitest";

describe.shuffle("language", () => {

    GGTest.startWorker([MainRuntime, MainRuntime]);
    const scope = new GGContext("test");

    afterEach(() => {
        scope.reset();
    })

    test("language detection from Accept-Language header", async () => {
        // Test German - language is normalized to lowercase ISO 639-1

        scope.set(GG_INTL_LOCALE, {locale: "de" as tLocale});
        const client = callOn(LanguageTestApi, scope);
        const responseDe = await client.echo({name: "test", age: 25});
        expect(responseDe.detectedLanguage).toBe("de");

        // Test French
        scope.set(GG_INTL_LOCALE, {locale: "fr" as tLocale});
        const responseFr = await client.echo({name: "test", age: 25});
        expect(responseFr.detectedLanguage).toBe("fr");

        // Test no language header - should be undefined
        scope.set(GG_INTL_LOCALE, undefined);
        const responseDefault = await client.echo({name: "test", age: 25});
        expect(responseDefault.detectedLanguage).toBeUndefined();
    });

    test("validation errors include language context and translated messages", async () => {
        scope.set(GG_INTL_LOCALE, {locale: "de" as tLocale});
        const clientDe = callOn(LanguageTestApi, scope);

        const resultDe = await clientDe.echo({name: 123 as any, age: "invalid" as any})
            .toBeError(VALIDATION_ERROR);

        // Verify we got validation errors with German message
        expect(resultDe).toBeDefined();
        expect(resultDe.name?.__issue || resultDe.age?.__issue).toBeTruthy();

        // Check the __issue structure has usedLanguage
        const issue = resultDe.name?.__issue || resultDe.age?.__issue;
        expect(issue).toHaveProperty("usedLanguage");
        // Since we registered German translation for invalid.number.type, usedLanguage should be "de"
        // (name got number 123 when expecting string, age got string when expecting number)
    });

    test("validation error messages are translated when translation exists", async () => {
        scope.set(GG_INTL_LOCALE, {locale: "de" as tLocale});
        const client = callOn(LanguageTestApi, scope);

        // Send invalid age (string instead of number) to trigger invalid.number.type
        const result = await client.echo({name: "valid", age: "not-a-number" as any})
            .toBeError(VALIDATION_ERROR);

        // The age field should have German error message
        const ageIssue = result.age?.__issue;
        expect(ageIssue).toBeDefined();
        expect(ageIssue?.message).toBe("Wert muss eine Zahl sein");
        expect(ageIssue?.usedLanguage).toBe("de");
    });

    test("validation error falls back to English when translation missing", async () => {
        // Request with Spanish (no translations registered)
        scope.set(GG_INTL_LOCALE, {locale: "es" as tLocale});
        const client = callOn(LanguageTestApi, scope);

        const result = await client.echo({name: "valid", age: "not-a-number" as any})
            .toBeError(VALIDATION_ERROR);

        // Should fall back to English (system locale)
        const ageIssue = result.age?.__issue;
        expect(ageIssue).toBeDefined();
        expect(ageIssue?.message).toBe("Value must be a number"); // English fallback
        expect(ageIssue?.usedLanguage).toBe("en"); // Fell back to system locale
    });
});
