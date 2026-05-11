import "./_dedupCheck";
// Core
import {StandardExecutor} from "./executor/standard/StandardExecutor";
import {GGSchema} from "./GGSchema";

try {
    new Function('v', 'return v===undefined');
} catch (e) {
    GGSchema.EXECUTOR = StandardExecutor.instance;
}

// Contract
export * from "./contract/GGContractClass";
export * from "./contract/GGContractFunction";
export * from "./contract/GGContractExecutor";
export * from "./contract/ERROR";
export * from "./contract/GGPromise";
export * from "./contract/standardErrors";
export * from "./contract/OK";

// Permission
export * from "./contract/permission/GGPermission";
export * from "./contract/permission/satisfies";
export * from "./contract/permission/GGPermissionChecker";
export * from "./contract/permission/validatePermission";

// Common
export * from "./GGSchema";
export * from "./GGSchemaDescription";
export * from "./GGCodec";
export * from "./GGTransform";
export * from "./Definition";

// Issue
export * from "./issue/types";
export * from "./issue/GGIssueKey";
export * from "./issue/GGIssuesList";
export * from "./issue/GGIssueRegistry";
export * from "./issue/issues/GGIssueInvalid";
export * from "./issue/issues/GGRangeIssue";

// Executor (no TypeCompiler — it imports 'fs' which is not available in browsers)
export * from "./executor/aot/AOTExecutor";
export * from "./executor/standard/StandardExecutor";

// Schemas
export * from "./schemas/IsString";
export * from "./schemas/IsNumber";
export * from "./schemas/IsBoolean";
export * from "./schemas/IsBit";
export * from "./schemas/IsObject";
export * from "./schemas/IsArray";
export * from "./schemas/IsLiteral";
export * from "./schemas/IsUnion";
export * from "./schemas/IsAny";
export * from "./schemas/IsUnknown";
export * from "./schemas/IsEnum";
export * from "./schemas/IsDiscriminated";
export * from "./schemas/IsRecord";
export * from "./schemas/IsTuple";
export * from "./custom/IsDate";
export * from "./custom/IsDateTime";
export {type tInt32, IsInt32, type tInt16, IsInt16, type tInt8, IsInt8, type tUint32, IsUint32, type tUint16, IsUint16, type tUint8, IsUint8, type tUint, IsUint, type tInt, IsInt, type tPosInt, IsPosInt} from "./custom/IsInt";
export {type tLatitude, IsLatitude} from "./custom/IsLatitude";
export {type tLongitude, IsLongitude} from "./custom/IsLongitude";
export {type tEmail, IsEmail} from "./custom/IsEmail";
export {type tPassword, IsPassword} from "./custom/IsPassword";
export {type tLanguage, IsLanguage} from "./custom/IsLanguage";
export {type tCountry, IsCountry} from "./custom/IsCountry";
export {type tLocale, IsLocale} from "./custom/IsLocale";
export {type tUrl, IsUrl} from "./custom/IsUrl";
export {type tPhone, IsPhone} from "./custom/IsPhone";
export {type tBearerToken, IsBearerToken} from "./custom/IsBearerToken";
export {IsTimestamp, type tTimestamp, IsTimestampMs, type tTimestampMs} from "./custom/IsTimestamp";
export {type tCurrency, IsCurrency} from "./custom/IsCurrency";
export {type tIp, IsIp} from "./custom/IsIp";
