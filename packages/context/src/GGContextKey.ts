import {GGContextStore} from "./GGContextStore";
import {GGCodec, GGSchema} from "@grest-ts/schema";

export interface GGContextMeta<T> {
    description?: string
    defaultValue?: T
    mutable?: boolean
}

export class GGContextKey<Type> {

    public readonly name: string
    public readonly schema: GGSchema<Type>
    public readonly description?: string
    public readonly defaultValue?: Type
    public readonly mutable: boolean
    private codecs: Map<string, GGCodec<any, Type>>

    constructor(name: string, schema: GGSchema<Type>, meta?: GGContextMeta<Type>) {
        this.name = name
        this.schema = schema;
        this.description = meta?.description
        this.defaultValue = meta?.defaultValue
        this.mutable = meta?.mutable ?? false
    }

    public get(): Type | undefined {
        return GGContextStore.tryGetContext()?.get(this) ?? this.defaultValue
    }

    public has(): boolean {
        return GGContextStore.tryGetContext()?.has(this) ?? false
    }

    public set(value: Type): void {
        GGContextStore.getContext().set(this, value)
    }

    public delete(): void {
        GGContextStore.getContext().delete(this)
    }

    /**
     * Asserts that context value for this key exists. If not, throws Error.
     */
    public assert(): Type {
        if (!this.has()) {
            throw new Error(`Context named '${this.name}' is required, but not defined!`);
        }
        return this.get()
    }

    // ---------------------------------------------

    public addCodec(type: string, codec: GGCodec<any, Type>): void {
        if (!this.codecs) {
            this.codecs = new Map()
        }
        this.codecs.set(type, codec)
    }

    public getCodec(type: string): GGCodec<any, Type> | undefined {
        return this.codecs?.get(type)
    }
}
