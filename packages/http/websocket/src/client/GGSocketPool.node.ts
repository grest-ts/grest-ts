import {GGLocator} from "@grest-ts/locator"
import {_initPoolStorage} from "./GGSocketPoolStorage"
import {GGSocketPool} from "./GGSocketPool"

// Fallback for top-level Node scripts that run outside a GGRuntime scope.
const fallback: Map<string, unknown> = new Map()
const scopedBuckets = new WeakMap<object, Map<string, unknown>>()

_initPoolStorage({
    getBucket() {
        const scope = GGLocator.tryGetScope()
        if (!scope) return fallback
        let bucket = scopedBuckets.get(scope)
        if (!bucket) {
            bucket = new Map()
            scopedBuckets.set(scope, bucket)
            // Close all pooled connections when this scope's runtime shuts down.
            scope.addTeardown(() => GGSocketPool.closeAll(true))
        }
        return bucket
    }
})
