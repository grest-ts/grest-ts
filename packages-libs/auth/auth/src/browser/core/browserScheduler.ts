/// <reference lib="dom" />
import type {Scheduler} from "./types"

export function browserScheduler(): Scheduler {
    return {
        schedule(delayMs: number, fn: () => void): () => void {
            const id = setTimeout(fn, delayMs)
            return () => clearTimeout(id)
        },
        onWake(listener: () => void): () => void {
            const onVisibility = () => {
                if (document.visibilityState === "visible") listener()
            }
            const onOnline = () => listener()
            document.addEventListener("visibilitychange", onVisibility)
            window.addEventListener("online", onOnline)
            return () => {
                document.removeEventListener("visibilitychange", onVisibility)
                window.removeEventListener("online", onOnline)
            }
        },
    }
}
