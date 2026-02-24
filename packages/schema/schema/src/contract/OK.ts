export interface OK<Data> {
    success: true
    type: "OK"
    data: Data
}

export type OK_JSON<Data = any> = OK<Data>

export const OK = {
    /**
     * Type discriminator for OK results
     */
    TYPE: "OK" as const,

    /**
     * Check if a value is an OK JSON response
     */
    isJson(value: unknown): value is OK_JSON {
        return typeof value === "object"
            && value !== null
            && "success" in value
            && value.success === true
            && "type" in value
            && value.type === "OK"
    }
}