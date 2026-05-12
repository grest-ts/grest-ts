/**
 * OpenApiShowcaseApi — a deliberately rich API definition used as a snapshot anchor.
 *
 * Every structurally interesting schema type is exercised here so that the OpenAPI
 * snapshot test in test/openapi.test.ts catches regressions in spec generation:
 *   - All primitive types (string, number, integer variants, boolean, bit)
 *   - Custom branded types (email, country, language, locale, url, phone,
 *     date, datetime, timestamp, latitude, longitude, currency, ip, password)
 *   - Composite types: object, array, record, union, discriminated union, tuple
 *   - Modifiers: nullable (.orNull), optional (.orUndefined), .default(), .docs()
 *   - File upload (GGFileUpload → multipart/form-data)
 *   - File download (GGFileDownload → binary 200 response)
 *   - GET with query params, path params, POST/PUT/DELETE
 *   - Error responses with typed data schemas
 */

import {GGContractClass, GGContractImplementation, GG_NO_PERMISSIONS } from "@grest-ts/schema";
import {
    IsString, IsNumber, IsBoolean, IsArray, IsObject, IsLiteral,
    IsUnion, IsRecord, IsTuple, IsAny, IsUnknown, IsBit,
    IsDiscriminated, IsInt, IsUint, ERROR, VALIDATION_ERROR, SERVER_ERROR
} from "@grest-ts/schema";
import {
    IsEmail, IsCountry, IsLanguage, IsLocale, IsUrl, IsPhone,
    IsDate, IsDateTime, IsTimestamp, IsCurrency, IsIp, IsLatitude, IsLongitude,
    IsBearerToken
} from "@grest-ts/schema";
import {GGFileUpload, GGFileDownload} from "@grest-ts/http-file";
import {IsFile} from "@grest-ts/schema-file";
import {httpSchema, GGRpc} from "@grest-ts/http";
import {IsPassword} from "@grest-ts/schema";

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export const RESOURCE_NOT_FOUND = ERROR.define("RESOURCE_NOT_FOUND", 404);
export const PROFILE_NOT_FOUND = ERROR.define("PROFILE_NOT_FOUND", 404);
export const CONFLICT = ERROR.define("CONFLICT", 409);

// Showcase auth middleware — demonstrates bearer security scheme generation
export const ShowcaseBearerAuth = {
    headers: {
        "authorization": IsBearerToken.docs({
            description: "JWT access token. Use the Authorize button to set."
        })
    },
    responseHeaders: {}
} as const;
export const RATE_LIMITED = ERROR.define("RATE_LIMITED", 429, IsObject({
    retryAfterSeconds: IsInt.docs({description: "Number of seconds to wait before retrying"})
}));

// ---------------------------------------------------------------------------
// Discriminated union — the most structurally important composite type
// ---------------------------------------------------------------------------

const IsBaseEvent = IsObject({
    id: IsString.nonEmpty.docs({description: "Event ID", example: "evt_abc123"}),
    occurredAt: IsTimestamp.docs({description: "When the event occurred"}),
});

const IsUserCreatedEvent = IsBaseEvent.extend({
    type: IsLiteral("user.created"),
    email: IsEmail,
    country: IsCountry,
}).docs({title: "User created event"});

const IsOrderPlacedEvent = IsBaseEvent.extend({
    type: IsLiteral("order.placed"),
    orderId: IsString.nonEmpty,
    totalCents: IsUint.docs({description: "Order total in cents"}),
    currency: IsCurrency,
}).docs({title: "Order placed event"});

const IsOrderCancelledEvent = IsBaseEvent.extend({
    type: IsLiteral("order.cancelled"),
    orderId: IsString.nonEmpty,
    reason: IsString.orUndefined.docs({description: "Optional cancellation reason"}),
}).docs({title: "Order cancelled event"});

export const IsEvent = IsDiscriminated("type", {
    "user.created": IsUserCreatedEvent,
    "order.placed": IsOrderPlacedEvent,
    "order.cancelled": IsOrderCancelledEvent,
}).docs({
    title: "Event",
    description: "Discriminated union of all domain events keyed by type"
});

// ---------------------------------------------------------------------------
// Rich object schemas
// ---------------------------------------------------------------------------

export const IsAddress = IsObject({
    street: IsString.nonEmpty.docs({description: "Street address", example: "123 Main St"}),
    city: IsString.nonEmpty.docs({example: "Tallinn"}),
    country: IsCountry,
    zip: IsString.orUndefined.docs({description: "Postal code", example: "10001"}),
}).docs({title: "Postal address"});

export const IsUserProfile = IsObject({
    id: IsString.nonEmpty.docs({example: "usr_abc123"}),
    email: IsEmail,
    name: IsString.nonEmpty.docs({example: "Jane Doe"}),
    phone: IsPhone.orUndefined,
    language: IsLanguage,
    locale: IsLocale.orUndefined,
    website: IsUrl.orUndefined,
    bio: IsString.maxLength(500).orUndefined.docs({description: "Short biography"}),
    address: IsAddress.orUndefined,
    joinedAt: IsDate.docs({description: "Registration date"}),
    lastActiveAt: IsTimestamp.orUndefined,
    isVerified: IsBoolean.default(false),
    role: IsLiteral("admin", "user", "moderator").default("user"),
    tags: IsArray(IsString.nonEmpty).default([]),
    coordinates: IsTuple(IsLatitude, IsLongitude).orUndefined
        .docs({description: "Location as [latitude, longitude]"}),
    metadata: IsRecord(IsString, IsAny).orUndefined
        .docs({description: "Arbitrary key-value metadata"}),
    ipAddress: IsIp.orUndefined,
    deprecatedField: IsString.orUndefined.docs({deprecated: true, description: "Use email instead"}),
}).docs({
    title: "User profile",
    description: "Complete user profile returned from GET /users/:id"
});

export const IsSearchQuery = IsObject({
    q: IsString.nonEmpty.docs({description: "Full-text search query", example: "Jane"}),
    country: IsCountry.orUndefined,
    currency: IsCurrency.orUndefined,
    roles: IsArray(IsLiteral("admin", "user", "moderator")).orUndefined,
    minJoined: IsDate.orUndefined,
    limit: IsUint.default(20 as any).docs({description: "Results per page", example: 20}),
    offset: IsUint.default(0 as any),
}).docs({title: "User search query"});

export const IsCreateUserRequest = IsObject({
    email: IsEmail,
    name: IsString.nonEmpty,
    password: IsPassword({minLength: 8, strength: "medium"}),
    country: IsCountry,
    language: IsLanguage.default("en" as any),
    inviteCode: IsString.orUndefined.docs({description: "Optional referral / invite code"}),
}).docs({title: "Create user request"});

export const IsUpdateProfileRequest = IsObject({
    name: IsString.nonEmpty.orUndefined,
    bio: IsString.maxLength(500).orUndefined,
    website: IsUrl.orUndefined,
    address: IsAddress.orUndefined,
    coordinates: IsTuple(IsLatitude, IsLongitude).orUndefined,
}).docs({title: "Update profile request"});

export const IsStatsResponse = IsObject({
    totalUsers: IsUint,
    verifiedUsers: IsUint,
    countriesRepresented: IsUint,
    topCountries: IsArray(IsObject({
        country: IsCountry,
        count: IsUint,
    })),
    topLanguages: IsRecord(IsString, IsUint)
        .docs({description: "Language code → user count"}),
    serverTime: IsTimestamp,
    serverDateTime: IsDateTime,
    avgLatitude: IsLatitude.orNull,
    avgLongitude: IsLongitude.orNull,
    bitFlag: IsBit.docs({description: "1 = healthy, 0 = degraded"}),
    unknownData: IsUnknown.docs({description: "Passthrough field for extensions"}),
    anyData: IsAny.docs({description: "Unchecked partner-supplied payload"}),
    recentEvent: IsEvent.orNull.docs({description: "Most recent domain event, if any"}),
    unionsExample: IsUnion(IsString, IsNumber, IsBoolean)
        .docs({description: "Mixed union field for demo purposes"}),
}).docs({title: "Platform statistics"});

// File upload schema
const IsAvatarUpload = IsObject({
    avatar: IsFile.accept("image/*").maxSize(2 * 1024 * 1024)
        .docs({description: "Profile image — JPEG, PNG, or WebP, max 2 MB"}),
    crop: IsString.orUndefined
        .docs({description: "JSON-serialised crop rectangle: {x,y,w,h}"}),
}).docs({title: "Avatar upload"});

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

export const ShowcaseApiContract = new GGContractClass("ShowcaseApi", {
    // GET with query params
    listUsers: {
        input: IsSearchQuery,
        success: IsObject({
            users: IsArray(IsUserProfile),
            total: IsUint,
        }),
        errors: [VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    // GET with path param
    getUser: {
        input: IsObject({
            id: IsString.nonEmpty.docs({description: "User ID", example: "usr_abc123"})
        }),
        success: IsUserProfile,
        errors: [RESOURCE_NOT_FOUND, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    // POST with JSON body
    createUser: {
        input: IsCreateUserRequest,
        success: IsUserProfile,
        errors: [VALIDATION_ERROR, CONFLICT, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    // PUT with path + JSON body
    updateProfile: {
        input: IsUpdateProfileRequest.extend({
            id: IsString.nonEmpty.docs({description: "User ID to update"})
        }),
        success: IsUserProfile,
        errors: [VALIDATION_ERROR, RESOURCE_NOT_FOUND, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    // DELETE with path param, no success body
    deleteUser: {
        input: IsObject({
            id: IsString.nonEmpty
        }),
        errors: [RESOURCE_NOT_FOUND, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    // GET with no input
    getStats: {
        success: IsStatsResponse,
        errors: [SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    // Multiple errors at same 404 status — tests oneOf merging in OpenAPI output
    multiError: {
        errors: [RESOURCE_NOT_FOUND, PROFILE_NOT_FOUND, RATE_LIMITED, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    // File upload (multipart/form-data)
    uploadAvatar: {
        input: IsAvatarUpload,
        success: IsObject({url: IsUrl, width: IsUint, height: IsUint}),
        errors: [VALIDATION_ERROR, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    // File download (binary response)
    downloadAvatar: {
        input: IsObject({
            id: IsString.nonEmpty,
            format: IsLiteral("jpeg", "png", "webp").default("jpeg")
        }),
        success: IsFile,
        errors: [RESOURCE_NOT_FOUND, SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
    // Event stream: discriminated union in success
    getLatestEvent: {
        success: IsEvent,
        errors: [SERVER_ERROR],
        permission: GG_NO_PERMISSIONS
    },
});

export const ShowcaseApi = httpSchema(ShowcaseApiContract)
    .pathPrefix("api/showcase")
    .use(ShowcaseBearerAuth)
    .routes({
        listUsers: GGRpc.GET("users"),
        getUser: GGRpc.GET("users/:id"),
        createUser: GGRpc.POST("users"),
        updateProfile: GGRpc.PUT("users/:id"),
        deleteUser: GGRpc.DELETE("users/:id"),
        getStats: GGRpc.GET("stats"),
        multiError: GGRpc.GET("multi-error"),
        uploadAvatar: GGFileUpload.POST("users/:id/avatar"),
        downloadAvatar: GGFileDownload.GET("users/:id/avatar"),
        getLatestEvent: GGRpc.GET("events/latest"),
    });

export type IShowcaseApi = GGContractImplementation<typeof ShowcaseApiContract["methods"]>;
