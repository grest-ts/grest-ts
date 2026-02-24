// Country (ISO 3166-1 alpha-2)
import {GGIssueInvalid} from "../issue/issues/GGIssueInvalid";
import {IsString} from "../schemas/IsString";

const countryError = new GGIssueInvalid("country", "Expected ISO 3166-1 alpha-2 country code (e.g., 'US', 'EE')");
export const IsCountry = Object.assign(
    IsString.regex(/^[A-Z]{2}$/, countryError).brand("country").docs({
        title: "Country code",
        description: "ISO 3166-1 alpha-2",
        example: "US"
    }),
    {countryError}
);
export type tCountry = typeof IsCountry.infer;
