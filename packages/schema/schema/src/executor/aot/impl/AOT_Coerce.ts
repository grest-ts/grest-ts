import {GGSchema} from "../../../GGSchema";
import {CompilerState} from "../utils/CompilerState";
import {propAccess} from "../utils/helpers";
import type {
    ArrayDef,
    DiscriminatedDef,
    NumberDef,
    ObjectDef,
    RecordDef,
    AnyStandardSchemaDef,
    StringDef,
    TupleDef,
    UnionDef
} from "../../../Definition";
import {roundToMultipleOf} from "../../standard/impl/CODE_Is";

/**
 * AOT_Coerce - Compiles coercion functions that apply both built-in type coercion
 * and user-defined coercions.
 *
 * Called when parse(..., coerce=true) is used.
 */
export class AOT_Coerce {
    private readonly state = new CompilerState();

    compile<T>(schema: GGSchema<T>): (v: unknown) => unknown {
        this.state.reset();
        const body = this.visit(schema, 'v');
        return this.state.buildFunction<(v: unknown) => unknown>(body);
    }

    /**
     * Compile schema to self-contained code string (for analysis/export).
     */
    compileToCode(schema: GGSchema<any>): string {
        this.state.reset();
        const body = this.visit(schema, 'v');
        return this.state.getCode(body);
    }

    private visit(schema: GGSchema<any>, v: string): string {
        const def = schema.toCompilerDef() as AnyStandardSchemaDef;

        // Check for recursion
        const existingFunc = this.state.getRecursiveFunc(schema);
        if (existingFunc) {
            return `${existingFunc}(${v})`;
        }

        let coerced = this.visitType(schema, def, v);

        // Apply user-defined coercions with try/catch for safety
        // If a coercion throws, skip it and keep the current value
        if (def.coercions && def.coercions.length > 0) {
            const coercionVars = def.coercions.map((fn, i) => {
                return this.state.capture(fn, `_cf${i}`);
            });
            // Wrap each coercion in try/catch: try { v = cf(v) } catch {}
            const tryWraps = coercionVars.map(cfVar =>
                `try{_cv=${cfVar}(_cv)}catch{}`
            ).join(';');
            coerced = `((_cv)=>{${tryWraps};return _cv})(${coerced})`;
        }

        // Wrap with null/undefined passthrough
        if (def.optional || def.nullable) {
            return `(${v}==null?${v}:${coerced})`;
        }
        return coerced;
    }

    private visitType(schema: GGSchema<any>, def: AnyStandardSchemaDef, v: string): string {
        switch (def.type) {
            case 'string':
                return this.visitString(def, v);
            case 'number':
            case 'int':
            case 'uint':
            case 'posInt':
            case 'int8':
            case 'int16':
            case 'int32':
            case 'uint8':
            case 'uint16':
            case 'uint32':
                return this.visitNumber(def as NumberDef, v);
            case 'boolean':
                return this.visitBoolean(v);
            case 'bit':
                return this.visitBit(v);
            case 'object':
                return this.visitObject(schema, def, v);
            case 'array':
                return this.visitArray(def, v);
            case 'tuple':
                return this.visitTuple(schema, def, v);
            case 'record':
                return this.visitRecord(def, v);
            case 'union':
                return this.visitUnion(def, v);
            case 'discriminated':
                return this.visitDiscriminated(def, v);
            // Literals and others don't need coercion
            default:
                return v;
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Primitives - Built-in coercion
    // ──────────────────────────────────────────────────────────────────────────

    private visitString(def: StringDef, v: string): string {
        // Coerce number/boolean to string
        const coerced = `(typeof ${v}==='number'&&!isNaN(${v})?String(${v}):typeof ${v}==='boolean'?String(${v}):${v})`;
        // Apply trim if configured
        if (def.trim) {
            return `(typeof (${coerced})==='string'?(${coerced}).trim():${coerced})`;
        }
        return coerced;
    }

    private visitNumber(def: NumberDef, v: string): string {
        // Coerce string to number
        let coerced = `(typeof ${v}==='string'?((_n)=>Number.isFinite(_n)?_n:${v})(Number(${v})):${v})`;
        // Round to multipleOf if configured
        if (def.multipleOf !== undefined) {
            const fn = this.state.capture(roundToMultipleOf, '_rM');
            coerced = `(typeof (${coerced})==='number'&&Number.isFinite(${coerced})?${fn}(${coerced},${def.multipleOf}):${coerced})`;
        }
        return coerced;
    }

    private visitBoolean(v: string): string {
        // Coerce various truthy/falsy values to boolean
        return `(${v}===true||${v}==='true'||${v}==='1'||${v}===1?true:${v}===false||${v}==='false'||${v}==='0'||${v}===0?false:${v})`;
    }

    private visitBit(v: string): string {
        // Coerce to 0 or 1
        return `(${v}===true||${v}==='true'||${v}==='1'||${v}===1?1:${v}===false||${v}==='false'||${v}==='0'||${v}===0?0:${v})`;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Structural - Recursive coercion
    // ──────────────────────────────────────────────────────────────────────────

    private visitObject(schema: GGSchema<any>, def: ObjectDef, v: string): string {
        const existingFunc = this.state.getRecursiveFunc(schema);
        if (existingFunc) {
            return `${existingFunc}(${v})`;
        }

        const shape = def.shape!;
        const keys = Object.keys(shape);

        if (keys.length === 0) return v;

        // Register for recursion detection
        const funcName = this.state.freshVar('_co');
        const innerVar = this.state.freshVar('_v');
        this.state.registerCompiling(schema, funcName);

        try {
            // Check if any field has coercions or defaults
            const hasCoercionsOrDefaults = keys.some(k => {
                const fieldSchema = shape[k];
                if (!(fieldSchema && typeof fieldSchema === 'object' && 'def' in fieldSchema)) return false;
                const fieldDef = fieldSchema.toCompilerDef() as AnyStandardSchemaDef;
                return fieldDef.defaultValue !== undefined || fieldSchema.def.coercions?.length > 0 || this.needsCoercion(fieldDef);
            });

            if (!hasCoercionsOrDefaults) {
                this.state.unregisterCompiling(schema);
                return v;
            }

            const hasOptional = keys.some(k => {
                const fieldSchema = shape[k];
                return fieldSchema && typeof fieldSchema === 'object' && 'def' in fieldSchema && fieldSchema.def.optional;
            });

            let body: string;

            if (!hasOptional) {
                const props: string[] = [];
                for (const k of keys) {
                    const safeKey = JSON.stringify(k);
                    const fieldSchema = shape[k] as GGSchema<any>;
                    const fieldDef = fieldSchema.toCompilerDef() as AnyStandardSchemaDef;
                    const valueExpr = this.visit(fieldSchema, propAccess(innerVar, k));
                    if (fieldDef.defaultValue !== undefined) {
                        const defaultVar = this.state.capture(fieldDef.defaultValue, '_d');
                        props.push(`${safeKey}:(${propAccess(innerVar, k)}==null?${defaultVar}:${valueExpr})`);
                    } else {
                        props.push(`${safeKey}:${valueExpr}`);
                    }
                }
                body = `({${props.join(',')}})`;
            } else {
                // Has optional - IIFE with imperative construction
                const requiredProps: string[] = [];
                const optionalAssigns: string[] = [];

                for (const k of keys) {
                    const safeKey = JSON.stringify(k);
                    const fieldSchema = shape[k] as GGSchema<any>;
                    const fieldDef = fieldSchema.toCompilerDef() as AnyStandardSchemaDef;
                    const valueExpr = this.visit(fieldSchema, propAccess('_$o', k));

                    if (fieldSchema.def.optional) {
                        if (fieldDef.defaultValue !== undefined) {
                            const defaultVar = this.state.capture(fieldDef.defaultValue, '_d');
                            optionalAssigns.push(`_$t[${safeKey}]=${propAccess('_$o', k)}==null?${defaultVar}:${valueExpr}`);
                        } else {
                            optionalAssigns.push(`if(${propAccess('_$o', k)}!==undefined)_$t[${safeKey}]=${valueExpr}`);
                        }
                    } else {
                        if (fieldDef.defaultValue !== undefined) {
                            const defaultVar = this.state.capture(fieldDef.defaultValue, '_d');
                            requiredProps.push(`${safeKey}:(${propAccess('_$o', k)}==null?${defaultVar}:${valueExpr})`);
                        } else {
                            requiredProps.push(`${safeKey}:${valueExpr}`);
                        }
                    }
                }

                body = `((_$o)=>{const _$t={${requiredProps.join(',')}};${optionalAssigns.join(';')};return _$t})(${innerVar})`;
            }

            // Add object type check
            body = `(typeof ${innerVar}==='object'&&${innerVar}!==null&&!Array.isArray(${innerVar})?${body}:${innerVar})`;

            return this.state.wrapIfRecursive(body, funcName, innerVar, v);
        } finally {
            this.state.unregisterCompiling(schema);
        }
    }

    private visitArray(def: ArrayDef, v: string): string {
        const element = def.element!;
        const elemCoerce = this.visit(element, '_e');

        if (elemCoerce === '_e') {
            return v;
        }
        return `(Array.isArray(${v})?${v}.map(_e=>${elemCoerce}):${v})`;
    }

    private visitTuple(schema: GGSchema<any>, def: TupleDef, v: string): string {
        const existingFunc = this.state.getRecursiveFunc(schema);
        if (existingFunc) {
            return `${existingFunc}(${v})`;
        }

        const elements = def.elements!;
        const funcName = this.state.freshVar('_ct');
        const innerVar = this.state.freshVar('_v');
        this.state.registerCompiling(schema, funcName);

        try {
            const constructs = elements.map((e, i) =>
                this.visit(e, `${innerVar}[${i}]`)
            );

            if (constructs.every((c, i) => c === `${innerVar}[${i}]`)) {
                this.state.unregisterCompiling(schema);
                return v;
            }

            const body = `(Array.isArray(${innerVar})?[${constructs.join(',')}]:${innerVar})`;
            return this.state.wrapIfRecursive(body, funcName, innerVar, v);
        } finally {
            this.state.unregisterCompiling(schema);
        }
    }

    private visitRecord(def: RecordDef, v: string): string {
        const valueCoerce = this.visit(def.value, '_rv');

        if (valueCoerce === '_rv') return v;
        return `(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})?Object.fromEntries(Object.entries(${v}).map(([_k,_rv])=>[_k,${valueCoerce}])):${v})`;
    }

    private visitUnion(def: UnionDef, v: string): string {
        // For unions with coercion:
        // 1. First try to find a variant where value already matches
        // 2. If none match, try coercing with each variant and check if result is valid
        const variants = def.variants;
        const uVar = this.state.freshVar('_uv');

        // Capture is() functions and coercion expressions for each variant
        const variantData = variants.map((variant, i) => {
            const isFunc = variant.is.bind(variant);
            const isVar = this.state.capture(isFunc, `_ui${i}`);
            const coerceExpr = this.visit(variant, uVar);
            return {isVar, coerceExpr};
        });

        // Build the coercion logic as an IIFE that:
        // 1. Checks if value matches any variant as-is
        // 2. If not, tries coercing with each variant and returns first valid result
        const matchChecks = variantData.map(({isVar}, i) =>
            `if(${isVar}(${uVar}))return ${this.visit(variants[i], uVar)}`
        ).join(';');

        const coerceChecks = variantData.map(({isVar, coerceExpr}, i) => {
            const tempVar = `_t${i}`;
            return `${tempVar}=${coerceExpr};if(${isVar}(${tempVar}))return ${tempVar}`;
        }).join(';');

        const tempDecls = variantData.map((_, i) => `_t${i}`).join(',');

        return `((${uVar})=>{${matchChecks};let ${tempDecls};${coerceChecks};return ${uVar}})(${v})`;
    }

    private visitDiscriminated(def: DiscriminatedDef, v: string): string {
        const disc = def.discriminator;
        const variantMap = def.variantMap!;
        const discAccess = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(disc) ? `${v}.${disc}` : `${v}[${JSON.stringify(disc)}]`;

        const cases: string[] = [];
        for (const [key, variantSchema] of variantMap) {
            const keyCheck = typeof key === 'string' ? JSON.stringify(key) : key;
            const coerceExpr = this.visit(variantSchema, v);
            cases.push(`${discAccess}===${keyCheck}?${coerceExpr}`);
        }

        return `(typeof ${v}==='object'&&${v}!==null?(${cases.join(':')}:${v}):${v})`;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Helpers
    // ──────────────────────────────────────────────────────────────────────────

    private needsCoercion(def: AnyStandardSchemaDef): boolean {
        // Check if this type needs built-in coercion
        switch (def.type) {
            case 'string':
            case 'number':
            case 'int':
            case 'uint':
            case 'posInt':
            case 'int8':
            case 'int16':
            case 'int32':
            case 'uint8':
            case 'uint16':
            case 'uint32':
            case 'boolean':
            case 'bit':
                return true;
            case 'object':
            case 'array':
            case 'tuple':
            case 'record':
            case 'union':
            case 'discriminated':
                return true; // Might have nested coercions
            default:
                return false;
        }
    }
}
