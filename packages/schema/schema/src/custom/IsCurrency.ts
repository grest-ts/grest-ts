// Currency (ISO 4217)
import {GGIssueInvalid} from "../issue/issues/GGIssueInvalid";
import {IsString} from "../schemas/IsString";

const currencyError = new GGIssueInvalid("currency", "Expected ISO 4217 currency code (e.g., 'USD', 'EUR')");
export const IsCurrency = Object.assign(
    IsString.regex(/^[A-Z]{3}$/, currencyError).brand("currency").docs({
        title: "Currency code",
        description: "ISO 4217",
        example: "USD"
    }),
    {currencyError}
);
export type tCurrency = typeof IsCurrency.infer;
