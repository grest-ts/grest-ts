## Localization

Validation error messages can be localized for different languages.

### Issue Registry

All issue keys are automatically registered in `GGIssueRegistry` when created. Use this to generate translation files:

```typescript
import {GGIssueRegistry} from "@grest-ts/schema"

// Get all registered issue keys as JSON
const allIssues = GGIssueRegistry.toJSON();
// {
//   string: {
//     type: { $value: { code: "string.type", message: "Value must be a string" } },
//     tooShort: { $value: { code: "string.tooShort", message: "Minimum {min} characters", params: { min: "Minimum length" } } }
//   },
//   number: {
//     type: { $value: { code: "number.type", message: "Value must be a number" } }
//   },
//   ...
// }

// Use this to generate translation files for your i18n system
```

### Static Localizer

For simple setups, set a static localizer function on `GGIssueKey`:

```typescript
import {GGIssueKey, ValidationIssueJson} from "@grest-ts/schema"

const translations: Record<string, Record<string, string>> = {
    de: {
        "string.type": "Wert muss eine Zeichenkette sein",
        "number.type": "Wert muss eine Zahl sein",
        "string.tooShort": "Mindestens {min} Zeichen erforderlich"
    },
    fr: {
        "string.type": "La valeur doit etre une chaine",
        "number.type": "La valeur doit etre un nombre"
    }
};

// Set localizer - mutates the issue JSON in place
GGIssueKey.setLocalizer((issue: ValidationIssueJson) => {
    const lang = getCurrentLanguage(); // Your language detection logic
    const translated = translations[lang]?.[issue.code];
    if (translated) {
        // Interpolate params into translated message
        issue.message = translated.replace(/\{(\w+)\}/g, (_, key) =>
            String((issue.params as any)?.[key] ?? `{${key}}`)
        );
        issue.usedLanguage = lang;
    }
});
```

### Async Context Localization with GGLocator

For request-scoped localization (different users, different languages), integrate with `@grest-ts/locator`:

```typescript
import {GGIssueKey, ValidationIssueJson} from "@grest-ts/schema"
import {GGLocatorKey} from "@grest-ts/locator"
import {GGIntl} from "@grest-ts/intl"

// Define a locator key for the intl service
const IntlKey = new GGLocatorKey<GGIntl>("GG_INTL");

// Set localizer that reads from async context
GGIssueKey.setLocalizer((issue: ValidationIssueJson) => {
    const intl = IntlKey.tryGet();
    if (intl) {
        const translated = intl.t(`validation.${issue.code}`, issue.params);
        if (translated) {
            issue.message = translated;
            issue.usedLanguage = intl.locale;
        }
    }
});

// In your request handler, bind the intl service to async context
async function handleRequest(req: Request) {
    const userLocale = req.headers["accept-language"] || "en";
    const intl = new GGIntl(userLocale, translations);

    await IntlKey.run(intl, async () => {
        // All validation errors in this context will use userLocale
        const result = IsUser.safeParse(req.body, true);
        if (!result.success) {
            return {errors: result.issues.toJSON()}; // Localized messages
        }
    });
}
```

### ValidationIssueJson Structure

Localized issues include language metadata:

```typescript
interface ValidationIssueJson {
    path: string;           // Field path (e.g., "user.email")
    code: string;           // Issue code (e.g., "string.tooShort")
    message: string;        // Localized message with params interpolated
    params?: object;        // Original params (e.g., { min: 8 })
    usedLanguage?: string;  // Language actually used for translation
    expectedLanguage?: string; // Language that was requested
}
```
