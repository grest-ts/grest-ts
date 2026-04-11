import {IsArray} from "../schemas/IsArray";
import {IsObject} from "../schemas/IsObject";
import {IsString} from "../schemas/IsString";
import {IsAny} from "../schemas/IsAny";
import {IsRecord} from "../schemas/IsRecord";
import {ERROR} from "./ERROR";

export const VALIDATION_ERROR = ERROR.define("VALIDATION_ERROR", 422, IsArray(IsObject({
    path: IsString.nonEmpty,
    code: IsString.nonEmpty,
    message: IsString.nonEmpty,
    params: IsRecord(IsString, IsAny).orUndefined,
    usedLanguage: IsString.orUndefined,
    expectedLanguage: IsString.orUndefined
})))

export const NOT_AUTHORIZED = ERROR.define("NOT_AUTHORIZED", 401)

export const FORBIDDEN = ERROR.define("FORBIDDEN", 403)

export const BAD_REQUEST = ERROR.define("BAD_REQUEST", 400)

export const NOT_FOUND = ERROR.define("NOT_FOUND", 404)

export const EXISTS = ERROR.define("EXISTS", 409)

export const ROUTE_NOT_FOUND = ERROR.define("ROUTE_NOT_FOUND", 404)
