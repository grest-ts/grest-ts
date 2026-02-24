import {GGSchema, Opt} from "../GGSchema";
import {DiscriminatedDef} from "../Definition";

type InferDiscriminated<V extends GGSchema<any>> = V extends GGSchema<infer U> ? U : never;

export interface DiscriminatedDefImpl extends DiscriminatedDef {
    readonly variantMapFactory?: () => ReadonlyMap<string | number | boolean, GGSchema<any>>;
}

export class DiscriminatedSchema<T = unknown> extends GGSchema<T, DiscriminatedDefImpl> {

    constructor(def: DiscriminatedDefImpl) {
        super(def);
        if (!def.variantMap && !def.variantMapFactory) {
            throw new Error("DiscriminatedSchema must be created with variants via IsDiscriminated()");
        }
        // Only check size if variantMap is provided directly (not via factory, which is resolved lazily)
        if (def.variantMap && def.variantMap.size < 2) {
            throw new Error("IsDiscriminated requires at least two variants");
        }
    }

    protected derive<NewT = T>(changes: Partial<DiscriminatedDefImpl>): DiscriminatedSchema<NewT> {
        return new DiscriminatedSchema<NewT>({...this.def, ...changes});
    }

    get orUndefined(): DiscriminatedSchema<T | undefined> & Opt {
        return super.orUndefined as any
    }

    get orNull(): DiscriminatedSchema<T | null> {
        return super.orNull as any
    }

    protected _toCompilerDef(): DiscriminatedDef & { variantArray: GGSchema<any>[] } {
        let variantMap: ReadonlyMap<string | number | boolean, GGSchema<any>>;

        if (this.def.variantMapFactory) {
            variantMap = this.def.variantMapFactory();
            if (variantMap.size < 2) {
                throw new Error("IsDiscriminated requires at least two variants");
            }
        } else if (this.def.variantMap) {
            variantMap = this.def.variantMap;
        } else {
            throw new Error("DiscriminatedSchema must be created with variants via IsDiscriminated()");
        }

        const variantArray = Array.from(variantMap.values());
        const hasNonJsonData = variantArray.some(v => v.toCompilerDef().hasNonJsonData);
        return {...this.def, variantMap, variantArray, hasNonJsonData};
    }

}

// Helper to convert variants record to Map
function variantsToMap(variants: Record<string | number, GGSchema<any>>): Map<string | number | boolean, GGSchema<any>> {
    // Object.entries converts numeric keys to strings, so convert back if applicable
    return new Map<string | number | boolean, GGSchema<any>>(
        Object.entries(variants).map(([key, validator]) => {
            const numKey = Number(key);
            return [!isNaN(numKey) && String(numKey) === key ? numKey : key, validator];
        })
    );
}

export function IsDiscriminated<V extends GGSchema<any>>(
    discriminator: string,
    variantsOrFactory: Record<string | number, V> | (() => Record<string | number, V>)
): DiscriminatedSchema<InferDiscriminated<V>> {
    // Check if second argument is a factory function
    if (typeof variantsOrFactory === 'function') {
        return new DiscriminatedSchema<InferDiscriminated<V>>({
            type: 'discriminated',
            discriminator,
            variantMapFactory: () => variantsToMap(variantsOrFactory())
        });
    } else {
        const variantMap = variantsToMap(variantsOrFactory);
        return new DiscriminatedSchema<InferDiscriminated<V>>({type: 'discriminated', discriminator, variantMap});
    }
}
