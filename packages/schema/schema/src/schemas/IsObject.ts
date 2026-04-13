import {GGSchema, Opt} from "../GGSchema";
import {IsLiteral} from "./IsLiteral";
import {ObjectDef, ShapeInput} from "../Definition";
import type {GGSchemaDescription, GGSchemaNodeKind} from "../GGSchemaDescription";

type Shape = Record<string, GGSchema<any>>;

// Extract type from schema or return literal type directly
type InferValue<V> =
    V extends string ? V :
        V extends number ? V :
            V extends boolean ? V :
                V extends { infer: infer U } ? U :
                    never;

// Schemas with __opt: true (i.e. Type includes undefined) produce optional fields
type InferShapeInput<S extends ShapeInput> = DeepPrettify<
    { [K in keyof S as S[K] extends { readonly __opt: true } ? never : K]: InferValue<S[K]> } &
    { [K in keyof S as S[K] extends { readonly __opt: true } ? K : never]?: InferValue<S[K]> }
>;

/**
 * Helper to prettify tuple elements while preserving tuple structure
 */
type DeepPrettifyTuple<T extends readonly unknown[]> =
    T extends readonly [infer First, ...infer Rest]
        ? [DeepPrettify<First>, ...DeepPrettifyTuple<Rest>]
        : [];

/**
 * Recursively prettify types for clean IDE display.
 * Preserves branded primitives, only expands plain object shapes.
 * Strips readonly modifiers for mutable types.
 */
export type DeepPrettify<T> =
    T extends Number ? T :
        T extends String ? T :
            T extends Boolean ? T :
                T extends Function ? T :
                    T extends readonly [unknown, ...unknown[]] ? DeepPrettifyTuple<T> :
                        T extends (infer U)[] ? DeepPrettify<U>[] :
                            T extends object ? { -readonly [K in keyof T]: DeepPrettify<T[K]> } & {} :
                                T;

export interface ObjectDefImpl extends ObjectDef {
    readonly shapeFactory?: () => ShapeInput;
}

export class ObjectSchema<T extends object | undefined | null = object> extends GGSchema<T, ObjectDefImpl> {

    get orUndefined(): ObjectSchema<T | undefined> & Opt {
        return super.orUndefined as any
    }

    get orNull(): ObjectSchema<T | null> {
        return super.orNull as any
    }

    protected _buildDerived<NewT extends T | undefined | null = T>(changes: Partial<ObjectDefImpl>): ObjectSchema<NewT> {
        return new ObjectSchema<NewT>({...this.def, ...changes});
    }

    // --------------------------------------------------------------------------------------

    extend<const S extends ShapeInput>(shape: S): ObjectSchema<T & InferShapeInput<S>> {
        const currentShape = this.toCompilerDef().shape! as Shape;
        return new ObjectSchema<T & InferShapeInput<S>>({
            type: 'object',
            shape: {...currentShape, ...shape}
        });
    }

    merge<U extends object>(other: ObjectSchema<U>): ObjectSchema<T & U> {
        const currentShape = this.toCompilerDef().shape! as Shape;
        const otherShape = other.toCompilerDef().shape! as Shape;
        return new ObjectSchema<T & U>({
            type: 'object',
            shape: {...currentShape, ...otherShape}
        });
    }

    pick<K extends keyof T>(...keys: K[]): ObjectSchema<Pick<T, K>> {
        const currentShape = this.toCompilerDef().shape! as Shape;
        const newShape: Shape = {};
        for (const key of keys) {
            if (key in currentShape) {
                newShape[key as string] = currentShape[key as string];
            }
        }
        return new ObjectSchema<Pick<T, K>>({
            type: 'object',
            shape: newShape
        });
    }

    omit<K extends keyof T>(...keys: K[]): ObjectSchema<Omit<T, K>> {
        const currentShape = this.toCompilerDef().shape! as Shape;
        const keysSet = new Set(keys as string[]);
        const newShape: Shape = {};
        for (const key of Object.keys(currentShape)) {
            if (!keysSet.has(key)) {
                newShape[key] = currentShape[key];
            }
        }
        return new ObjectSchema<Omit<T, K>>({
            type: 'object',
            shape: newShape
        });
    }

    // --------------------------------------------------------------------------------------

    protected _buildSchemaNode(): GGSchemaNodeKind {
        const shape = this.toCompilerDef().shape! as Shape;
        const properties: Record<string, GGSchemaDescription> = {};
        const required: string[] = [];
        for (const k of Object.keys(shape)) {
            const child = shape[k];
            properties[k] = child.toSchemaDescription();
            if (!child.def.optional) required.push(k);
        }
        return {kind: 'object', properties, required, additionalProperties: false};
    }

    protected _toCompilerDef(): ObjectDefImpl {
        let raw: ShapeInput;
        if (this.def.shapeFactory) {
            raw = this.def.shapeFactory();
        } else if (this.def.shape) {
            raw = this.def.shape;
        } else {
            throw new Error("ObjectSchema must be created with either shape or shapeFactory");
        }

        let hasNonJsonData = false;
        for (const key in raw) {
            const value = raw[key];
            if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                (raw as any)[key] = IsLiteral(value);
            } else if (value instanceof GGSchema && value.toCompilerDef().hasNonJsonData) {
                hasNonJsonData = true;
            }
        }

        return {...this.def, shape: raw as Shape, hasNonJsonData};
    }
}

export const IsObject = <const S extends ShapeInput>(shape: S | (() => S)): ObjectSchema<InferShapeInput<S>> => {
    if (typeof shape === 'function') {
        return new ObjectSchema({type: 'object', shapeFactory: shape as any});
    } else {
        return new ObjectSchema({type: 'object', shape: shape as any});
    }
}

