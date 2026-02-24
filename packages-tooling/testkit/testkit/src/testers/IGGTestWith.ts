import {IGGTestInterceptor} from "./IGGTestInterceptor";

export interface IGGTestWith {
    createInterceptor(): IGGTestInterceptor;

    /**
     * Returns true if this expectation requires async processing and must be used with `.waitFor()`.
     * When true, using with `.with()` will throw an error guiding the developer to use `.waitFor()`.
     *
     * Example: SQS message processing is async (happens after HTTP response), so SQS
     * interceptors require `.waitFor()`.
     */
    requiresWaitFor?(): boolean;
}

