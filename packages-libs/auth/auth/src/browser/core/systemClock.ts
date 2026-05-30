/// <reference lib="dom" />
import type {Clock} from "./types"

export const systemClock: Clock = {now: () => Date.now()}
