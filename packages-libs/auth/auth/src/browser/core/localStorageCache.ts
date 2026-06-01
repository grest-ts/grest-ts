/// <reference lib="dom" />
import type {SharedCache, StoredAuth} from "./types"

export function localStorageSharedCache(key: string): SharedCache {
    return {
        read(): StoredAuth | undefined {
            try {
                const raw = localStorage.getItem(key)
                if (!raw) return undefined
                return JSON.parse(raw) as StoredAuth
            } catch {
                return undefined
            }
        },
        write(v: StoredAuth | undefined): void {
            if (v === undefined) {
                localStorage.removeItem(key)
            } else {
                localStorage.setItem(key, JSON.stringify(v))
            }
        },
        subscribe(cb: (v: StoredAuth | undefined) => void): () => void {
            const handler = (event: StorageEvent) => {
                if (event.key !== key) return
                try {
                    const v = event.newValue ? (JSON.parse(event.newValue) as StoredAuth) : undefined
                    cb(v)
                } catch {
                    cb(undefined)
                }
            }
            window.addEventListener("storage", handler)
            return () => window.removeEventListener("storage", handler)
        },
    }
}
