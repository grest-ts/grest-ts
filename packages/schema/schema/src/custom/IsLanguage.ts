// Language (ISO 639-1)
import {GGIssueInvalid} from "../issue/issues/GGIssueInvalid";
import {IsString} from "../schemas/IsString";

const languageError = new GGIssueInvalid("language", "Expected ISO 639-1 language code (e.g., 'en', 'de')");

/**
 * Coerce various language formats to ISO 639-1:
 * - "en-US" → "en" (extract language from locale)
 * - "en,de,fr" → "en" (take first from Accept-Language header)
 * - "EN" → "en" (lowercase)
 * - "*" → "*" (pass through, validation will fail)
 */
const coerceLanguage = (lang: string): string => {
    if (typeof lang !== 'string') return lang;
    if (!lang || lang === '*' || lang.trim() === '') return lang;
    return lang.split(',')[0].split('-')[0]?.toLowerCase() ?? lang;
};

export const IsLanguage = Object.assign(
    IsString
        .coerce(coerceLanguage)
        .regex(/^[a-z]{2}$/, languageError)
        .brand("language")
        .docs({
            title: "Language code",
            description: "ISO 639-1",
            example: "en"
        }),
    {languageError}
);
export type tLanguage = typeof IsLanguage.infer;
