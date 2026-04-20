import {GGIssueInvalid} from "../issue/issues/GGIssueInvalid";
import {IsString} from "../schemas/IsString";

const bearerTokenError = new GGIssueInvalid(
    "bearer.format",
    "Expected a Bearer token in the format 'Bearer <token>'"
);

/**
 * HTTP Authorization header value carrying a Bearer token.
 * Validates the 'Bearer <token>' format.
 * Use with format:"bearer" to emit a Swagger UI Authorize button:
 *
 * @example
 * headers: {
 *     "authorization": IsBearerToken
 * }
 */
export const IsBearerToken = Object.assign(
    IsString
        .nonEmpty
        .refine(v => v.startsWith('Bearer ') && v.length > 7, bearerTokenError)
        .brand("bearerToken")
        .docs({
            title: "Bearer token",
            format: "bearer",
            description: "HTTP Authorization header with a Bearer token",
            example: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyXzEifQ.signature"
        }),
    {bearerTokenError}
);
export type tBearerToken = typeof IsBearerToken.infer;
