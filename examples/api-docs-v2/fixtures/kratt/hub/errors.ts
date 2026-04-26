import {ERROR} from "@grest-ts/schema"

export const INVALID_CREDENTIALS = ERROR.define("INVALID_CREDENTIALS", 401)
export const UNAUTHORIZED = ERROR.define("UNAUTHORIZED", 401)
export const NO_ACCESS = ERROR.define("NO_ACCESS", 403)
export const NOT_FOUND = ERROR.define("NOT_FOUND", 404)
export const ALREADY_EXISTS = ERROR.define("ALREADY_EXISTS", 409)
export const AGENT_NOT_RUNNING = ERROR.define("AGENT_NOT_RUNNING", 400)
export const NAME_TAKEN = ERROR.define("NAME_TAKEN", 409)
