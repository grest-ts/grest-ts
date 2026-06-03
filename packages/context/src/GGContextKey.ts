import {GGContextStore} from "./GGContextStore";
import {GGSchema} from "@grest-ts/schema";

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
        return this.get() as Type
    }
}
