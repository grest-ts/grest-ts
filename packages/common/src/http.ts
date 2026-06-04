import {enumOf} from "./enumOf";
import type {Values} from "./types";

export const HttpStatusCode = enumOf({
    OK200: 200,
    /**
     * Completely fails to handle the request
     */
    BadRequest400: 400,
    /**
     * User must send auth headers or in other ways be "logged in".
     */
    Unauthorized401: 401,
    /**
     * User does not have access to resource
     */
    Forbidden403: 403,
    /**
     * Entity not found
     */
    NotFound404: 404,
    /**
     * Duplicate entity somewhere
     */
    Exists409: 409,
    /**
     * These are validation errors - automatic or manual.
     */
    ValidationError422: 422,
    /**
     * Method not allowed on this resource.
     */
    MethodNotAllowed405: 405,
    /**
     * Generic "something went wrong".
     */
    InternalServerError500: 500,
    /**
     * Bad Gateway - proxy/gateway received invalid response.
     */
    BadGateway502: 502,
    /**
     * Server is shutting down and is not able to handle the request.
     */
    ServerTemporarilyNotAvailable503: 503,

    /**
     * Non standard HTTP error! This is used in the test framework in case request failes because of some testing check.
     * Request itself maybe succeeded, but some check caused it to still fail. This never comes up in production, only in automated tests.
     */
    TestingError: 800,
});
export type HttpStatusCode = Values<typeof HttpStatusCode>;

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "OPTIONS";
