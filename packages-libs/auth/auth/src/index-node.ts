import "./_dedupCheck";
export {AuthError} from "./node/errors"
export type {AuthErrorCode} from "./node/errors"

export type {SigningStrategy} from "./node/signing/SigningStrategy"
export {HmacSigner} from "./node/signing/HmacSigner"

export {IsRefreshTokenRecord} from "./node/refresh/RefreshTokenStore"
export type {RefreshTokenRecord, RefreshTokenStore} from "./node/refresh/RefreshTokenStore"
export {InMemoryRefreshTokenStore} from "./node/refresh/InMemoryRefreshTokenStore"

export {AuthToken} from "./node/token/AuthToken"
export type {AccessOnly, AccessPayload, AuthTokenOptions, NoClaims, RefreshedGrant, TokenPair} from "./node/token/AuthToken"

export {permissionsChecker} from "./node/permissions"

export {AuthGuard} from "./node/http/AuthGuard"
export type {AuthGuardOptions} from "./node/http/AuthGuard"
export {scopeResolver} from "./node/http/scopeResolver"

export {GoogleIdp} from "./node/idp/idp/google/GoogleIdp"
export type {GoogleIdpOptions} from "./node/idp/idp/google/GoogleIdp"
export {OidcIdp} from "./node/idp/OidcIdp"
export type {OidcIdpOptions} from "./node/idp/OidcIdp"
export {OktaIdp} from "./node/idp/OktaIdp"
export type {OktaIdpOptions} from "./node/idp/OktaIdp"
export {identityFromClaims} from "./node/idp/identity"
export type {ExternalIdentity, IdpStrategy} from "./node/idp/IdpStrategy"

export {PasswordIdp} from "./node/idp/idp/password/PasswordIdp"
export type {PasswordIdpOptions, PasswordCredential, PasswordRecord} from "./node/idp/idp/password/PasswordIdp"
export {BcryptHasher} from "./node/idp/idp/password/BcryptHasher"
export type {PasswordHasher} from "./node/idp/idp/password/PasswordHasher"
