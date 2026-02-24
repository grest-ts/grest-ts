import {GGHttpRequest, GGHttpTransportMiddleware, GGRpc, httpSchema} from "@grest-ts/http"
import {GGContractClass, GGContractImplementation, IsBoolean, IsLiteral, IsObject, IsString, SERVER_ERROR, VALIDATION_ERROR} from "@grest-ts/schema";
import {GG_INTL_LOCALE} from "@grest-ts/intl"
import {GGContextKey} from "@grest-ts/context";

// ============================================================================
// Effects - Define request parsing and context extraction
// ============================================================================

/**
 * Client info type
 */
export interface ClientInfo {
    version: string;
    platform: 'web' | 'ios' | 'android';
}

export const GG_CLIENT_INFO = new GGContextKey<ClientInfo>('clientInfo', IsObject({
    version: IsString,
    platform: IsLiteral("web", "ios", "android")
}));

/**
 * Effect that extracts client info from custom headers
 */
export const ClientInfoEffect: GGHttpTransportMiddleware = {
    updateRequest(req: GGHttpRequest): void {
        const info = GG_CLIENT_INFO.get();
        if (info) {
            req.headers['x-client-version'] = info.version;
            req.headers['x-client-platform'] = info.platform;
        }
    },
    parseRequest(req: { headers: Record<string, string | string[]> }): void {
        GG_CLIENT_INFO.set({
            version: String(req.headers['x-client-version']) ?? 'unknown',
            platform: (req.headers['x-client-platform'] ?? 'web') as 'web' | 'ios' | 'android'
        });
    }
}

/**
 * Feature flags type
 */
export interface FeatureFlags {
    darkMode: boolean;
    betaFeatures: boolean;
}

export const GG_FEATURE_FLAGS = new GGContextKey<FeatureFlags>('features', IsObject({
    darkMode: IsBoolean,
    betaFeatures: IsBoolean
}));

/**
 * Effect that extracts feature flags from header
 */
export const FeatureFlagsEffect: GGHttpTransportMiddleware = {
    updateRequest(req: GGHttpRequest): void {
        const val = GG_FEATURE_FLAGS.get();
        req.headers['x-feature-flags'] = val ? JSON.stringify(val) : "";
    },
    parseRequest(req: { headers: Record<string, string | string[]> }): void {
        const data = String(req.headers['x-feature-flags']);
        const raw = data ? JSON.parse(data) : {};
        GG_FEATURE_FLAGS.set({
            darkMode: raw.darkMode ?? false,
            betaFeatures: raw.betaFeatures ?? false
        });
    }
};

// ============================================================================
// Type Schemas
// ============================================================================

export const IsMiddlewareTestRequest = IsObject({
    message: IsString
})
export type MiddlewareTestRequest = typeof IsMiddlewareTestRequest.infer

export const IsMiddlewareTestResponse = IsObject({
    message: IsString,
    language: IsString.orUndefined,
    clientVersion: IsString,
    clientPlatform: IsString,
    darkMode: IsBoolean,
    betaFeatures: IsBoolean
})
export type MiddlewareTestResponse = typeof IsMiddlewareTestResponse.infer

export const IsLanguageResponse = IsObject({
    language: IsString.orUndefined
})
export type LanguageResponse = typeof IsLanguageResponse.infer

// ============================================================================
// Contract & API Interface
// ============================================================================

export const MiddlewareTestApiContract = new GGContractClass("MiddlewareTestApi", {
    echo: {
        input: IsMiddlewareTestRequest,
        success: IsMiddlewareTestResponse,
        errors: [VALIDATION_ERROR, SERVER_ERROR]
    },
    getLanguage: {
        success: IsLanguageResponse,
        errors: [SERVER_ERROR]
    }
})

export type IMiddlewareTestApi = GGContractImplementation<typeof MiddlewareTestApiContract["methods"]>

/**
 * API with effect chain that accumulates context types
 */
export const MiddlewareTestApi = httpSchema(MiddlewareTestApiContract)
    .pathPrefix("api/middleware-test")
    .useHeader(GG_INTL_LOCALE)        // TContext = { locale: string }
    .use(ClientInfoEffect)            // TContext = { locale: string, clientInfo: ClientInfo }
    .use(FeatureFlagsEffect)          // TContext = { ..., features: FeatureFlags }
    .routes({
        echo: GGRpc.POST("echo"),
        getLanguage: GGRpc.GET("language"),
    })
