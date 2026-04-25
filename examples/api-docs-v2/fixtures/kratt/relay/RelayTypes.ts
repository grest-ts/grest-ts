import {IsObject, IsBoolean, IsNumber} from "@grest-ts/schema"
import {IsServiceName} from "../hub/schemas.js"

export const IsServiceStatus = IsObject({
    name: IsServiceName,
    port: IsNumber,
    running: IsBoolean,
    exposed: IsBoolean,
})

export type ServiceStatus = typeof IsServiceStatus.infer
