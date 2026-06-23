export interface GGPoolStorageStrategy {
    getBucket(): Map<string, unknown>
}

class BrowserPoolStorage implements GGPoolStorageStrategy {
    private readonly bucket: Map<string, unknown> = new Map()
    getBucket(): Map<string, unknown> { return this.bucket }
}

let _strategy: GGPoolStorageStrategy = new BrowserPoolStorage()

export function _initPoolStorage(strategy: GGPoolStorageStrategy): void {
    _strategy = strategy
}

export function getPoolBucket(): Map<string, unknown> {
    return _strategy.getBucket()
}
