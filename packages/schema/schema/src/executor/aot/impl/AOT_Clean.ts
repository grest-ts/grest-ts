import {GGSchema} from "../../../GGSchema";
import {CompilerState} from "../utils/CompilerState";
import {propAccess} from "../utils/helpers";
import type {ArrayDef, DiscriminatedDef, ObjectDef, RecordDef, AnyStandardSchemaDef, TupleDef} from "../../../Definition";

/**
 * Closure-based CleanCompiler.
 * Generates pure functions with captured values - no `this` binding needed.
 *
 * Type guards on structural types ensure non-matching inputs pass through unchanged
 * (matching CODE_Clean behavior). This is important because parse() calls clean()
 * before is()/validate(), so clean must be safe for any input type.
 */
export class AOT_Clean {
    private readonly state = new CompilerState();

    compile<T>(schema: GGSchema<T>): (v: unknown) => T {
        this.state.reset();
        const body = this.visit(schema, 'v');
        return this.state.buildFunction<(v: unknown) => T>(body);
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
        const construct = this.visitType(schema, def, v);

        // Wrap with null/undefined passthrough if construction happens and schema is optional/nullable
        if (construct !== v && (def.optional || def.nullable)) {
            return `(${v}==null?${v}:${construct})`;
        }
        return construct;
    }

    private visitType(schema: GGSchema<any>, def: AnyStandardSchemaDef, v: string): string {
        switch (def.type) {
            case 'object':
                return this.visitObject(schema, def, v);
            case 'array':
                return this.visitArray(def, v);
            case 'tuple':
                return this.visitTuple(schema, def, v);
            case 'record':
                return this.visitRecord(def, v);
            case 'discriminated':
                return this.visitDiscriminated(def, v);
            // Primitives and others return identity - no construction needed
            default:
                return v;
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Helpers - type guards for structural types
    // ──────────────────────────────────────────────────────────────────────────

    /** Guard: pass non-objects through unchanged (matches CODE_Clean.cleanObject) */
    private objectGuard(v: string, body: string): string {
        return `(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})?${body}:${v})`;
    }

    /** Guard: pass non-arrays through unchanged (matches CODE_Clean.cleanArray/cleanTuple) */
    private arrayGuard(v: string, body: string): string {
        return `(Array.isArray(${v})?${body}:${v})`;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Object
    // ──────────────────────────────────────────────────────────────────────────

    private visitObject(schema: GGSchema<any>, def: ObjectDef, v: string): string {
        // Check for recursion
        const existingFunc = this.state.getRecursiveFunc(schema);
        if (existingFunc) {
            return `${existingFunc}(${v})`;
        }

        const shape = def.shape!;
        const keys = Object.keys(shape);

        if (keys.length === 0) return this.objectGuard(v, '({})');

        // Register for recursion detection with a fresh inner variable
        const funcName = this.state.freshVar('_o');
        const innerVar = this.state.freshVar('_v');
        this.state.registerCompiling(schema, funcName);

        try {
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
                    const valueExpr = this.visit(fieldSchema, propAccess(innerVar, k));
                    props.push(`${safeKey}:${valueExpr}`);
                }
                body = this.objectGuard(innerVar, `({${props.join(',')}})`);
            } else {
                // Has optional - IIFE with imperative construction
                const requiredProps: string[] = [];
                const optionalAssigns: string[] = [];

                for (const k of keys) {
                    const safeKey = JSON.stringify(k);
                    const fieldSchema = shape[k] as GGSchema<any>;
                    const valueExpr = this.visit(fieldSchema, propAccess('_$o', k));

                    if (fieldSchema.def.optional) {
                        optionalAssigns.push(`if(${propAccess('_$o', k)}!==undefined)_$t[${safeKey}]=${valueExpr}`);
                    } else {
                        requiredProps.push(`${safeKey}:${valueExpr}`);
                    }
                }

                const iife = `((_$o)=>{const _$t={${requiredProps.join(',')}};${optionalAssigns.join(';')};return _$t})(${innerVar})`;
                body = this.objectGuard(innerVar, iife);
            }

            return this.state.wrapIfRecursive(body, funcName, innerVar, v);
        } finally {
            this.state.unregisterCompiling(schema);
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Array
    // ──────────────────────────────────────────────────────────────────────────

    private visitArray(def: ArrayDef, v: string): string {
        const element = def.element!;
        const elemConstruct = this.visit(element, '_e');

        if (elemConstruct === '_e') {
            return this.arrayGuard(v, `${v}.slice()`);
        }
        return this.arrayGuard(v, `${v}.map(_e=>${elemConstruct})`);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Tuple
    // ──────────────────────────────────────────────────────────────────────────

    private visitTuple(schema: GGSchema<any>, def: TupleDef, v: string): string {
        const existingFunc = this.state.getRecursiveFunc(schema);
        if (existingFunc) {
            return `${existingFunc}(${v})`;
        }

        const elements = def.elements!;
        const funcName = this.state.freshVar('_t');
        const innerVar = this.state.freshVar('_v');
        this.state.registerCompiling(schema, funcName);

        try {
            const constructs = elements.map((e, i) =>
                this.visit(e, `${innerVar}[${i}]`)
            );

            if (constructs.every((c, i) => c === `${innerVar}[${i}]`)) {
                // No construction needed - just slice
                const body = this.arrayGuard(innerVar, `${innerVar}.slice()`);
                return this.state.wrapIfRecursive(body, funcName, innerVar, v);
            }

            const body = this.arrayGuard(innerVar, `[${constructs.join(',')}]`);
            return this.state.wrapIfRecursive(body, funcName, innerVar, v);
        } finally {
            this.state.unregisterCompiling(schema);
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Record
    // ──────────────────────────────────────────────────────────────────────────

    private visitRecord(def: RecordDef, v: string): string {
        const valueConstruct = this.visit(def.value, '_rv');

        if (valueConstruct === '_rv') return v;
        return this.objectGuard(v, `Object.fromEntries(Object.entries(${v}).map(([_k,_rv])=>[_k,${valueConstruct}]))`);
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Discriminated
    // ──────────────────────────────────────────────────────────────────────────

    private visitDiscriminated(def: DiscriminatedDef, v: string): string {
        const disc = def.discriminator;
        const variantMap = def.variantMap!;
        const discAccess = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(disc) ? `${v}.${disc}` : `${v}[${JSON.stringify(disc)}]`;

        // Capture valid discriminator values in a Set for O(1) lookup
        const validKeys = new Set([...variantMap.keys()]);
        const setVar = this.state.capture(validKeys, '_dc');

        const cases: string[] = [];
        for (const [key, variantSchema] of variantMap) {
            const keyCheck = typeof key === 'string' ? JSON.stringify(key) : key;
            const construct = this.visit(variantSchema, v);
            cases.push(`${discAccess}===${keyCheck}?${construct}`);
        }
        // Guard: pass non-objects through unchanged, unknown variants return value as-is
        const inner = `(${setVar}.has(${discAccess})?(${cases.join(':')}:${v}):${v})`;
        return this.objectGuard(v, inner);
    }
}
