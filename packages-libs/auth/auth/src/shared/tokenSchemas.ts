import {IsObject, IsString, IsTimestampMs} from "@grest-ts/schema"

export const IsGGRefreshToken = IsString.nonEmpty.brand("GGAuth.refreshToken")
export const IsGGRefreshTokenData = IsObject({token: IsGGRefreshToken, expiresAt: IsTimestampMs}).brand("GGAuth.refreshTokenData")

export const IsGGAccessToken = IsString.nonEmpty.brand("GGAuth.accessToken")
export const IsGGAccessTokenData = IsObject({token: IsGGAccessToken, expiresAt: IsTimestampMs}).brand("GGAuth.accessTokenData")

export const IsGGAuthTokenResult = IsObject({access: IsGGAccessTokenData})
export type GGAuthTokenResult = typeof IsGGAuthTokenResult.infer

export const IsGGAuthTokensResult = IsObject({access: IsGGAccessTokenData, refresh: IsGGRefreshTokenData})
export type GGAuthTokensResult = typeof IsGGAuthTokensResult.infer
