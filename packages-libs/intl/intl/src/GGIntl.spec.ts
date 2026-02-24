import {describe, it, expect, beforeAll} from "vitest";
import {GGIntl} from "./GGIntl";
import {GGIntlMessage} from "./GGIntlMessage";
import {GGLocatorScope} from "@grest-ts/locator";

// Define test messages once at module level to avoid registry conflicts
const TestMessages = {
    simple: new GGIntlMessage("spec.test.msg", "Test message"),
    count: new GGIntlMessage<{count: number}>(
        "spec.test.count",
        "{count} items",
        { count: "Number of items" }
    ),
    greeting: new GGIntlMessage("spec.greeting", "Hello!"),
    greetingName: new GGIntlMessage<{name: string}>(
        "spec.greeting.name",
        "Hello, {name}!",
        { name: "Name to greet" }
    ),
    serializable: new GGIntlMessage<{name: string}>(
        "spec.test.key",
        "Hello {name}",
        { name: "User name" }
    )
};

let intl: GGIntl;

beforeAll(async () => {
    // Set up locator scope for direct unit testing
    const scope = new GGLocatorScope("IntlTest").enter();
    scope.setLifecycleOwner(() => {});

    intl = new GGIntl({ systemLocale: 'en' });
    await intl.start();

    // Add test translations
    intl.addMessages('en', {
        'greeting': 'Hello!',
        'greeting.name': 'Hello, {name}!',
        'items.count': 'You have {count, plural, one {# item} other {# items}}',
        'spec.greeting': 'Hello!',
        'spec.greeting.name': 'Hello, {name}!'
    });
    intl.addMessages('de', {
        'greeting': 'Hallo!',
        'greeting.name': 'Hallo, {name}!',
        'items.count': 'Du hast {count, plural, one {# Artikel} other {# Artikel}}',
        'spec.greeting': 'Hallo!',
        'spec.greeting.name': 'Hallo, {name}!'
    });
    intl.addMessages('es', {
        'greeting': '¡Hola!',
        'greeting.name': '¡Hola, {name}!'
    });
});

describe("GGIntl", () => {

    describe("t()", () => {
        it("should translate simple key", () => {
            expect(intl.t('greeting')).toBe('Hello!');
        });

        it("should interpolate parameters", () => {
            expect(intl.t('greeting.name', { name: 'World' })).toBe('Hello, World!');
        });

        it("should handle ICU plural format", () => {
            expect(intl.t('items.count', { count: 1 })).toBe('You have 1 item');
            expect(intl.t('items.count', { count: 5 })).toBe('You have 5 items');
            expect(intl.t('items.count', { count: 0 })).toBe('You have 0 items');
        });
    });

    describe("format()", () => {
        it("should translate with explicit locale", () => {
            expect(intl.format('en', 'greeting')).toBe('Hello!');
            expect(intl.format('de', 'greeting')).toBe('Hallo!');
            expect(intl.format('es', 'greeting')).toBe('¡Hola!');
        });

        it("should interpolate with explicit locale", () => {
            expect(intl.format('en', 'greeting.name', { name: 'Alice' })).toBe('Hello, Alice!');
            expect(intl.format('de', 'greeting.name', { name: 'Alice' })).toBe('Hallo, Alice!');
            expect(intl.format('es', 'greeting.name', { name: 'Alice' })).toBe('¡Hola, Alice!');
        });

        it("should handle plurals with explicit locale", () => {
            expect(intl.format('en', 'items.count', { count: 1 })).toBe('You have 1 item');
            expect(intl.format('de', 'items.count', { count: 1 })).toBe('Du hast 1 Artikel');
        });
    });

    describe("system()", () => {
        it("should use system locale", () => {
            expect(intl.system('greeting')).toBe('Hello!');
        });
    });

    describe("exists()", () => {
        it("should return true for existing keys", () => {
            expect(intl.exists('greeting')).toBe(true);
            expect(intl.exists('greeting', 'de')).toBe(true);
        });

        it("should return false for non-existing keys", () => {
            expect(intl.exists('nonexistent.key')).toBe(false);
        });
    });

    describe("locale getters", () => {
        it("should return system locale", () => {
            expect(intl.getSystemLocale()).toBe('en');
        });

        it("should return current locale", () => {
            expect(intl.getLocale()).toBe('en');
        });
    });
});

describe("GGIntlMessage", () => {

    describe("constructor", () => {
        it("should create message without params", () => {
            expect(TestMessages.simple.key).toBe("spec.test.msg");
            expect(TestMessages.simple.defaultMessage).toBe("Test message");
            expect(TestMessages.simple.paramDescriptions).toBeUndefined();
        });

        it("should create message with params", () => {
            expect(TestMessages.count.key).toBe("spec.test.count");
            expect(TestMessages.count.defaultMessage).toBe("{count} items");
            expect(TestMessages.count.paramDescriptions).toEqual({ count: "Number of items" });
        });
    });

    describe("t()", () => {
        it("should translate registered message", () => {
            expect(TestMessages.greeting.t()).toBe("Hello!");
        });

        it("should translate with params", () => {
            expect(TestMessages.greetingName.t({ name: "Bob" })).toBe("Hello, Bob!");
        });
    });

    describe("format()", () => {
        it("should translate with specific locale", () => {
            expect(TestMessages.greeting.format("en")).toBe("Hello!");
            expect(TestMessages.greeting.format("de")).toBe("Hallo!");
        });
    });

    describe("toJSON()", () => {
        it("should serialize message", () => {
            expect(TestMessages.serializable.toJSON()).toEqual({
                key: "spec.test.key",
                defaultMessage: "Hello {name}",
                params: { name: "User name" }
            });
        });
    });
});
