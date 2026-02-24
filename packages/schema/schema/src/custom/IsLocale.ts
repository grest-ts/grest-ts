// Locale (BCP 47 language-region format)
import {GGIssueInvalid} from "../issue/issues/GGIssueInvalid";
import {IsString} from "../schemas/IsString";

const localeError = new GGIssueInvalid("locale", "Expected BCP 47 locale code (e.g., 'en', 'en-US')");

export const IsLocale = Object.assign(
    IsString.regex(/^[a-z]{2}(-[A-Z]{2})?$/, localeError).brand("locale").docs({
        title: "Locale code",
        description: "BCP 47 language or language-region format",
        example: "en-US"
    }),
    {localeError}
);
export type tLocale = typeof IsLocale.infer;
