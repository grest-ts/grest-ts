import {IsArray} from "../schemas/IsArray";
import {IsObject} from "../schemas/IsObject";
import {IsString} from "../schemas/IsString";
import {IsAny} from "../schemas/IsAny";
import {IsRecord} from "../schemas/IsRecord";
import {ERROR} from "./ERROR";
import {IsLocale} from "../custom/IsLocale";

const IsValidationIssue = IsObject({
    path: IsString.nonEmpty
        .docs({description: "Dot-separated field path within the request body, e.g. \"user.address.zip\""}),
    code: IsString.nonEmpty
        .docs({description: "Dot-separated issue key identifying the rule that failed, e.g. \"invalid.string.type\""}),
    message: IsString.nonEmpty
        .docs({description: "Human-readable error message, localised to the client locale if available"}),
    params: IsRecord(IsString, IsAny).orUndefined
        .docs({description: "Template variables used in the message, e.g. {min: 8} for \"Minimum {min} characters\""}),
    usedLanguage: IsLocale.orUndefined
        .docs({description: "Locale that was actually used to render the message (may differ from requested if translation is missing)"}),
    expectedLanguage: IsLocale.orUndefined
        .docs({description: "Locale requested by the client via Accept-Language"}),
}).docs({
    title: "Validation issue",
    description: "A single field-level validation failure. One request can produce multiple issues."
});

export const VALIDATION_ERROR = ERROR.define("VALIDATION_ERROR", 422, IsArray(IsValidationIssue))

export const NOT_AUTHORIZED = ERROR.define("NOT_AUTHORIZED", 401)

export const FORBIDDEN = ERROR.define("FORBIDDEN", 403)

export const BAD_REQUEST = ERROR.define("BAD_REQUEST", 400)

export const NOT_FOUND = ERROR.define("NOT_FOUND", 404)

export const EXISTS = ERROR.define("EXISTS", 409)

export const ROUTE_NOT_FOUND = ERROR.define("ROUTE_NOT_FOUND", 404)
