import {GGSchema} from "../../../GGSchema";
import {CompilerState} from "../utils/CompilerState";
import {propAccess} from "../utils/helpers";
import {isMultipleOf} from "../../standard/impl/CODE_Is";
import type {
    ArrayDef,
    DiscriminatedDef,
    GGSchemaDefinition,
    LiteralDef,
    NumberDef,
    ObjectDef,
    RecordDef,
    AnyStandardSchemaDef,
    StringDef,
    TupleDef,
    UnionDef
} from "../../../Definition";

/**
 * Closure-based IsCompiler.
 * Generates pure functions with captured values - no `this` binding needed.
 */
export class AOT_Is {
    private readonly state = new CompilerState();

    compile(schema: GGSchema<any>): (v: unknown) => boolean {
        this.state.reset();
        const body = this.visit(schema, 'v');
        return this.state.buildFunction<(v: unknown) => boolean>(body);
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
            const call = `${existingFunc}(${v})`;
            // Still apply nullable/optional handling for recursive calls
            const or: string[] = [];
            if (def.optional) or.push(`${v}===undefined`);
            if (def.nullable) or.push(`${v}===null`);
            if (or.length === 0) return call;
            or.push(call);
            return `(${or.join('||')})`;
        }

        let check = this.visitType(schema, def, v);

        // IsAny/IsUnknown return 'true' - need explicit null/undefined guards
        if (check === 'true') {
            const guards: string[] = [];
            if (!def.optional) guards.push(`${v}!==undefined`);
            if (!def.nullable) guards.push(`${v}!==null`);
            check = guards.length > 0 ? guards.join('&&') : 'true';
        }

        // Refinements - capture check functions directly
        if (def.refinements) {
            const refs = def.refinements.map((r) => {
                const refVar = this.state.capture(r.check, '_r');
                return `${refVar}(${v})`;
            });
            check = `${check}&&${refs.join('&&')}`;
        }

        // Optionality/Nullable
        const or: string[] = [];
        if (def.optional) or.push(`${v}===undefined`);
        if (def.nullable) or.push(`${v}===null`);
        or.push(check);

        return or.length === 1 ? check : `(${or.join('||')})`;
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
            case 'union':
                return this.visitUnion(def, v);
            case 'discriminated':
                return this.visitDiscriminated(schema, def, v);
            case 'literal':
                return this.visitLiteral(def, v);
            case 'string':
                return this.visitString(def, v);
            case 'boolean':
                return `typeof ${v}==='boolean'`;
            case 'bit':
                return `(${v}===0||${v}===1)`;
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
                return this.visitNumber(def, v);
            case 'any':
            case 'unknown':
                return 'true';
            default: {
                // Custom types (e.g., file) use def.is callback
                const baseDef = def as GGSchemaDefinition;
                if (baseDef.is) {
                    const customCheck = this.state.capture(baseDef.is, '_c');
                    return `${customCheck}(${v})`;
                }
                return 'false';
            }
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Primitives
    // ──────────────────────────────────────────────────────────────────────────

    private visitString(def: StringDef, v: string): string {
        const checks: string[] = [`typeof ${v}==='string'`];
        if (def.trim) checks.push(`${v}.trim()===${v}`);
        if (def.nonEmpty) checks.push(`${v}.length>0`);
        if (def.minLength !== undefined) checks.push(`${v}.length>=${def.minLength}`);
        if (def.maxLength !== undefined) checks.push(`${v}.length<=${def.maxLength}`);
        if (def.pattern) {
            const patternVar = this.state.capture(def.pattern, '_p');
            checks.push(`${patternVar}.test(${v})`);
        }
        return checks.join('&&');
    }

    private visitNumber(def: NumberDef, v: string): string {
        const checks: string[] = [GGSchema.FAST_NUMBER_CHECK ? `typeof ${v}==='number'` : `Number.isFinite(${v})`];
        if (def.integer) checks.push(`Number.isInteger(${v})`);
        if (def.min !== undefined) checks.push(`${v}>=${def.min}`);
        if (def.max !== undefined) checks.push(`${v}<=${def.max}`);
        if (def.multipleOf !== undefined) {
            const fn = this.state.capture(isMultipleOf, '_mO');
            checks.push(`${fn}(${v},${def.multipleOf})`);
        }
        return checks.join('&&');
    }

    private visitLiteral(def: LiteralDef, v: string): string {
        const values = def.values;
        if (values.length > 10) {
            const setVar = this.state.capture(new Set(values), '_s');
            return `${setVar}.has(${v})`;
        }
        return values.length === 1
            ? `${v}===${JSON.stringify(values[0])}`
            : `(${values.map((val) => `${v}===${JSON.stringify(val)}`).join('||')})`;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Structural
    // ──────────────────────────────────────────────────────────────────────────

    private visitObject(schema: GGSchema<any>, def: ObjectDef, v: string, opts?: { skipTypeCheck?: boolean; skipKey?: string }): string {
        // Check for recursion
        const existingFunc = this.state.getRecursiveFunc(schema);
        if (existingFunc) {
            return `${existingFunc}(${v})`;
        }

        const shape = def.shape!;
        const keys = Object.keys(shape).filter(k => k !== opts?.skipKey);

        if (opts?.skipTypeCheck && keys.length === 0) return 'true';

        // Register for recursion detection with a fresh inner variable
        const funcName = this.state.freshVar('_o');
        const innerVar = this.state.freshVar('_v');
        this.state.registerCompiling(schema, funcName);

        try {
            const checks: string[] = [];

            if (!opts?.skipTypeCheck) {
                checks.push(`typeof ${innerVar}==='object'`, `${innerVar}!==null`);
                const hasRequired = keys.some(k => {
                    const fieldSchema = shape[k];
                    return fieldSchema && typeof fieldSchema === 'object' && 'def' in fieldSchema && !fieldSchema.def.optional;
                });
                if (!hasRequired) checks.push(`!Array.isArray(${innerVar})`);
            }

            for (const k of keys) {
                const fieldSchema = shape[k] as GGSchema<any>;
                const check = this.visit(fieldSchema, propAccess(innerVar, k));
                checks.push(check);
            }

            if (checks.length === 0) return 'true';

            const body = `(${checks.join('&&')})`;
            return this.state.wrapIfRecursive(body, funcName, innerVar, v);
        } finally {
            this.state.unregisterCompiling(schema);
        }
    }

    private visitArray(def: ArrayDef, v: string): string {
        const element = def.element!;

        const checks: string[] = [`Array.isArray(${v})`];
        if (def.minLength !== undefined) checks.push(`${v}.length>=${def.minLength}`);
        if (def.maxLength !== undefined) checks.push(`${v}.length<=${def.maxLength}`);

        const elemCheck = this.visit(element, '_e');
        checks.push(`${v}.every(_e=>${elemCheck})`);

        return checks.join('&&');
    }

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
            const checks: string[] = [
                `Array.isArray(${innerVar})`,
                `${innerVar}.length===${elements.length}`
            ];

            for (let i = 0; i < elements.length; i++) {
                checks.push(this.visit(elements[i], `${innerVar}[${i}]`));
            }

            const body = `(${checks.join('&&')})`;
            return this.state.wrapIfRecursive(body, funcName, innerVar, v);
        } finally {
            this.state.unregisterCompiling(schema);
        }
    }

    private visitRecord(def: RecordDef, v: string): string {
        const keyCheck = this.visit(def.key, '_k');
        const valueCheck = this.visit(def.value, '_rv');

        return `(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})&&Object.entries(${v}).every(([_k,_rv])=>(${keyCheck})&&(${valueCheck})))`;
    }

    private visitUnion(def: UnionDef, v: string): string {
        const checks = def.variants.map((variant) => this.visit(variant, v));
        return `(${checks.join('||')})`;
    }

    private visitDiscriminated(schema: GGSchema<any>, def: DiscriminatedDef, v: string): string {
        const disc = def.discriminator;
        const variantMap = def.variantMap!;

        const discAccess = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(disc) ? `${v}.${disc}` : `${v}[${JSON.stringify(disc)}]`;

        // Use direct checks with || chain instead of IIFE (avoids function creation overhead)
        const cases: string[] = [];
        for (const [key, variantSchema] of variantMap) {
            const variantDef = variantSchema.toCompilerDef() as ObjectDef;
            let check = this.visitObject(variantSchema, variantDef, v, {skipTypeCheck: true, skipKey: disc});
            // Also apply variant-level refinements
            if (variantDef.refinements) {
                const refs = variantDef.refinements.map((r) => {
                    const refVar = this.state.capture(r.check, '_r');
                    return `${refVar}(${v})`;
                });
                check = `${check}&&${refs.join('&&')}`;
            }
            const keyCheck = typeof key === 'string' ? JSON.stringify(key) : key;
            cases.push(`${keyCheck}===${discAccess}&&${check}`);
        }

        return `(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})&&(${cases.join('||')}))`;
    }
}
