import {IsArray} from "../schemas/IsArray";
import {IsObject} from "../schemas/IsObject";
import {IsString} from "../schemas/IsString";
import {IsAny} from "../schemas/IsAny";
import {IsRecord} from "../schemas/IsRecord";
import {ERROR} from "./ERROR";
// IsLocaleString matches IsLocale's pattern/docs without the brand — these are output — usedLanguage/expectedLanguage are output fields
// produced by runtime code, so we document the format without enforcing the brand.
const IsLocaleString = IsString
    .regex(/^[a-z]{2}(-[A-Z]{2})?$/)
    .docs({title: "Locale code", description: "BCP 47 language or language-region format", example: "en-US"});

const IsValidationIssue = IsObject({
    path: IsString.nonEmpty
        .docs({description: "Dot-separated field path within the request body", example: "user.address.zip"}),
    code: IsString.nonEmpty
        .docs({description: "Dot-separated issue key identifying the rule that failed", example: "invalid.string.minLength"}),
    message: IsString.nonEmpty
        .docs({description: "Human-readable error message, localised to the client locale if available", example: "Minimum 8 characters required"}),
    params: IsRecord(IsString, IsAny).orUndefined
        .docs({description: "Template variables substituted into the message template", example: {min: 8}}),
    usedLanguage: IsLocaleString.orUndefined
        .docs({description: "Locale actually used to render the message (may differ from requested if translation is missing)", example: "en"}),
    expectedLanguage: IsLocaleString.orUndefined
        .docs({description: "Locale requested by the client via Accept-Language", example: "de"}),
}).docs({
    title: "Validation issue",
    description: "A single field-level validation failure. One request can produce multiple issues.",
    example: {
        path: "password",
        code: "invalid.string.minLength",
        message: "Minimum 8 characters required",
        params: {min: 8},
        usedLanguage: "en",
        expectedLanguage: "de"
    }
});

export const VALIDATION_ERROR = ERROR.define("VALIDATION_ERROR", 422, IsArray(IsValidationIssue))

export const NOT_AUTHORIZED = ERROR.define("NOT_AUTHORIZED", 401)

export const FORBIDDEN = ERROR.define("FORBIDDEN", 403)

export const BAD_REQUEST = ERROR.define("BAD_REQUEST", 400)

export const NOT_FOUND = ERROR.define("NOT_FOUND", 404)

export const EXISTS = ERROR.define("EXISTS", 409)

export const PAYLOAD_TOO_LARGE = ERROR.define("PAYLOAD_TOO_LARGE", 413)

export const ROUTE_NOT_FOUND = ERROR.define("ROUTE_NOT_FOUND", 404)
