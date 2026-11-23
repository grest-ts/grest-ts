import {GGContextKey} from "../src/GGContextKey"

export const defineElsewhere = (name: string): GGContextKey<string> => new GGContextKey<string>(name, undefined as never)
