/**
 * The config itself could not be read or is invalid (fetch, parse, validation), as opposed to a bug in a store.
 * Only this error pauses startup under GGConfigLocatorOptions.startupRetryMs.
 */
export class GGConfigLoadError extends Error {
    public override readonly name = "GGConfigLoadError";
}
