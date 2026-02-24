import {GGSchema} from "../../../GGSchema";
import {GGIssuesList} from "../../../issue/GGIssuesList";
import {GGIssueKey} from "../../../issue/GGIssueKey";
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
import {
    IsArrayErrors,
    IsBitErrors,
    IsBooleanErrors,
    IsDiscriminatedErrors,
    IsLiteralErrors,
    IsNumberErrors,
    IsObjectErrors,
    IsRecordErrors,
    IsStringErrors,
    IsTupleErrors,
    IsUnionErrors
} from "../../../Errors";

export type ValidateFn = (value: unknown, issues: GGIssuesList, path: string) => boolean;

/**
 * AOT_Validate - Compiles validation functions with error collection.
 *
 * Pattern: (check || error.add(value, issues, path)) & ...
 * All checks run (no short-circuit), all errors collected.
 */
export class AOT_Validate {
    private readonly state = new CompilerState();
    private reqVar = '';

    compile(schema: GGSchema<any>): ValidateFn {
        this.state.reset();
        // Capture the GGIssue.required for required checks
        this.reqVar = this.state.capture(GGIssueKey.required, '_req');
        const body = this.visit(schema, 'v', 'p');
        return this.state.buildFunction<ValidateFn>(body, 'v', 'i', 'p');
    }

    /**
     * Compile schema to self-contained code string (for analysis/export).
     */
    compileToCode(schema: GGSchema<any>): string {
        this.state.reset();
        this.reqVar = this.state.capture(GGIssueKey.required, '_req');
        const body = this.visit(schema, 'v', 'p');
        return this.state.getCode(body, 'v', 'i', 'p');
    }

    private visit(schema: GGSchema<any>, v: string, path: string): string {
        const def = schema.toCompilerDef() as AnyStandardSchemaDef;

        // Check for recursion
        const existingFunc = this.state.getRecursiveFunc(schema);
        if (existingFunc) {
            return `${existingFunc}(${v},i,${path})`;
        }

        // Handle undefined/null first
        const checks: string[] = [];
        const req = this.reqVar;

        // Build undefined/null guards
        if (def.optional && def.nullable) {
            // Both optional and nullable - just pass through
            checks.push(`(${v}==null||${this.visitType(schema, def, v, path)})`);
        } else if (def.optional) {
            // Optional but not nullable
            checks.push(`(${v}===undefined||(${v}!==null||${req}.add(${v},i,${path}))&&${this.visitType(schema, def, v, path)})`);
        } else if (def.nullable) {
            // Nullable but not optional
            checks.push(`((${v}!==undefined||${req}.add(${v},i,${path}))&&(${v}===null||${this.visitType(schema, def, v, path)}))`);
        } else {
            // Neither optional nor nullable
            checks.push(`(${v}!=null||${req}.add(${v},i,${path}))&&(${v}==null||${this.visitType(schema, def, v, path)})`);
        }

        // Refinements - only run if type check passed
        if (def.refinements) {
            for (const r of def.refinements) {
                const refCheck = this.state.capture(r.check, '_r');
                const refError = this.state.capture(r.error, '_re');
                checks.push(`(${v}==null||${refCheck}(${v})||${refError}.add(${v},i,${path}))`);
            }
        }

        return checks.length === 1 ? checks[0] : `(${checks.join('&&')})`;
    }

    private visitType(schema: GGSchema<any>, def: AnyStandardSchemaDef, v: string, path: string): string {
        switch (def.type) {
            case 'object':
                return this.visitObject(schema, def, v, path);
            case 'array':
                return this.visitArray(def, v, path);
            case 'tuple':
                return this.visitTuple(schema, def, v, path);
            case 'record':
                return this.visitRecord(def, v, path);
            case 'union':
                return this.visitUnion(def, v, path);
            case 'discriminated':
                return this.visitDiscriminated(schema, def, v, path);
            case 'literal':
                return this.visitLiteral(def, v, path);
            case 'string':
                return this.visitString(def, v, path);
            case 'boolean':
                return this.visitBoolean(v, path);
            case 'bit':
                return this.visitBit(v, path);
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
                return this.visitNumber(def, v, path);
            case 'any':
            case 'unknown':
                return 'true';
            default: {
                const miscDef = def as GGSchemaDefinition;
                if (miscDef.isWithErrors) {
                    const customCheck = this.state.capture(miscDef.isWithErrors, '_cv');
                    return `${customCheck}(${v},i,${path})`;
                }
                throw new Error(`Custom schema type "${(def as GGSchemaDefinition).type}" must implement isWithErrors for validation to work correctly.`);
            }
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Primitives
    // ──────────────────────────────────────────────────────────────────────────

    private visitString(def: StringDef, v: string, path: string): string {
        const typeErr = this.state.capture(IsStringErrors.typeError, '_sTE');
        const checks: string[] = [`(typeof ${v}==='string'||${typeErr}.add(${v},i,${path}))`];

        // After type check, collect all constraint errors
        const constraints: string[] = [];

        if (def.nonEmpty) {
            const err = this.state.capture(IsStringErrors.nonEmptyError, '_sNE');
            constraints.push(`(${v}.length>0||${err}.add(${v},i,${path}))`);
        }
        if (def.minLength !== undefined && def.maxLength !== undefined) {
            const err = this.state.capture(IsStringErrors.rangeError, '_sRE');
            constraints.push(`((${v}.length>=${def.minLength}&&${v}.length<=${def.maxLength})||${err}.add(${v},i,${path},{min:${def.minLength},max:${def.maxLength}}))`);
        } else {
            if (def.minLength !== undefined) {
                const err = this.state.capture(IsStringErrors.minLengthError, '_sMinE');
                constraints.push(`(${v}.length>=${def.minLength}||${err}.add(${v},i,${path},{min:${def.minLength}}))`);
            }
            if (def.maxLength !== undefined) {
                const err = this.state.capture(IsStringErrors.maxLengthError, '_sMaxE');
                constraints.push(`(${v}.length<=${def.maxLength}||${err}.add(${v},i,${path},{max:${def.maxLength}}))`);
            }
        }
        if (def.pattern) {
            const patternVar = this.state.capture(def.pattern, '_p');
            const err = this.state.capture(IsStringErrors.patternError, '_sPE');
            constraints.push(`(${patternVar}.test(${v})||${err}.add(${v},i,${path}))`);
        }

        if (constraints.length === 0) {
            return checks[0];
        }
        // Only run constraints if type check passed
        return `(typeof ${v}!=='string'?${typeErr}.add(${v},i,${path}):(${constraints.join('&&')}))`
    }

    private visitNumber(def: NumberDef, v: string, path: string): string {
        const typeErr = this.state.capture(IsNumberErrors.typeError, '_nTE');
        const typeCheck = GGSchema.FAST_NUMBER_CHECK
            ? `typeof ${v}==='number'`
            : `(typeof ${v}==='number'&&Number.isFinite(${v}))`;

        const constraints: string[] = [];

        if (def.integer) {
            const err = this.state.capture(IsNumberErrors.integerError, '_nIE');
            constraints.push(`(Number.isInteger(${v})||${err}.add(${v},i,${path}))`);
        }

        if (def.min !== undefined && def.max !== undefined) {
            const err = this.state.capture(IsNumberErrors.rangeError, '_nRE');
            constraints.push(`((${v}>=${def.min}&&${v}<=${def.max})||${err}.add(${v},i,${path},{min:${def.min},max:${def.max}}))`);
        } else {
            if (def.min !== undefined) {
                const err = this.state.capture(IsNumberErrors.minError, '_nMinE');
                constraints.push(`(${v}>=${def.min}||${err}.add(${v},i,${path},{min:${def.min}}))`);
            }
            if (def.max !== undefined) {
                const err = this.state.capture(IsNumberErrors.maxError, '_nMaxE');
                constraints.push(`(${v}<=${def.max}||${err}.add(${v},i,${path},{max:${def.max}}))`);
            }
        }

        if (def.multipleOf !== undefined) {
            const fn = this.state.capture(isMultipleOf, '_mO');
            const err = this.state.capture(IsNumberErrors.multipleOfError, '_nME');
            constraints.push(`(${fn}(${v},${def.multipleOf})||${err}.add(${v},i,${path},{multipleOf:${def.multipleOf}}))`);
        }

        if (constraints.length === 0) {
            return `(${typeCheck}||${typeErr}.add(${v},i,${path}))`;
        }

        return `(${typeCheck}?(${constraints.join('&&')}):${typeErr}.add(${v},i,${path}))`;
    }

    private visitBoolean(v: string, path: string): string {
        const err = this.state.capture(IsBooleanErrors.typeError, '_bTE');
        return `(typeof ${v}==='boolean'||${err}.add(${v},i,${path}))`;
    }

    private visitBit(v: string, path: string): string {
        const err = this.state.capture(IsBitErrors.typeError, '_btTE');
        return `((${v}===0||${v}===1)||${err}.add(${v},i,${path}))`;
    }

    private visitLiteral(def: LiteralDef, v: string, path: string): string {
        const err = this.state.capture(IsLiteralErrors.invalidError, '_lE');
        const values = def.values;
        // Format expected values as "val1, val2, val3" (without quotes around strings)
        const expected = values.map(x => String(x)).join(', ');

        if (values.length > 10) {
            const setVar = this.state.capture(new Set(values), '_ls');
            return `(${setVar}.has(${v})||${err}.add(${v},i,${path},{expected:${JSON.stringify(expected)}}))`;
        }

        const check = values.length === 1
            ? `${v}===${JSON.stringify(values[0])}`
            : `(${values.map(val => `${v}===${JSON.stringify(val)}`).join('||')})`;

        return `(${check}||${err}.add(${v},i,${path},{expected:${JSON.stringify(expected)}}))`;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Structural
    // ──────────────────────────────────────────────────────────────────────────

    private visitObject(schema: GGSchema<any>, def: ObjectDef, v: string, path: string): string {
        // Check for recursion
        const existingFunc = this.state.getRecursiveFunc(schema);
        if (existingFunc) {
            return `${existingFunc}(${v},i,${path})`;
        }

        const typeErr = this.state.capture(IsObjectErrors.typeError, '_oTE');
        const shape = def.shape!;
        const keys = Object.keys(shape);

        if (keys.length === 0) {
            return `(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})||${typeErr}.add(${v},i,${path}))`;
        }

        // Register for recursion detection
        const funcName = this.state.freshVar('_vo');
        const innerVar = this.state.freshVar('_v');
        const innerPath = this.state.freshVar('_pp');
        this.state.registerCompiling(schema, funcName);

        try {
            const fieldChecks: string[] = [];

            for (const k of keys) {
                const fieldSchema = shape[k] as GGSchema<any>;
                const fieldPath = `${innerPath}+(${innerPath}?'.':'')+${JSON.stringify(k)}`;
                const check = this.visit(fieldSchema, propAccess(innerVar, k), fieldPath);
                fieldChecks.push(check);
            }

            // Use & to avoid short-circuit and collect all errors
            // Wrap each check in parens to prevent && precedence issues with &
            const body = fieldChecks.length === 1
                ? fieldChecks[0]
                : `(${fieldChecks.map(c => `(${c})`).join('&')})`;

            const fullBody = `(typeof ${innerVar}==='object'&&${innerVar}!==null&&!Array.isArray(${innerVar})?(${body}):${typeErr}.add(${innerVar},i,${innerPath}))`;

            return this.state.wrapIfRecursiveValidate(fullBody, funcName, innerVar, innerPath, v, path);
        } finally {
            this.state.unregisterCompiling(schema);
        }
    }

    private visitArray(def: ArrayDef, v: string, path: string): string {
        const typeErr = this.state.capture(IsArrayErrors.typeError, '_aTE');
        const element = def.element!;

        // Build length constraint checks
        let lengthCheck = '';
        if (def.minLength !== undefined && def.maxLength !== undefined) {
            const err = this.state.capture(IsArrayErrors.rangeError, '_aRE');
            lengthCheck = `((${v}.length>=${def.minLength}&&${v}.length<=${def.maxLength})||${err}.add(${v},i,${path},{min:${def.minLength},max:${def.maxLength}}))`;
        } else if (def.minLength !== undefined) {
            const err = this.state.capture(IsArrayErrors.minLengthError, '_aMinE');
            lengthCheck = `(${v}.length>=${def.minLength}||${err}.add(${v},i,${path},{min:${def.minLength}}))`;
        } else if (def.maxLength !== undefined) {
            const err = this.state.capture(IsArrayErrors.maxLengthError, '_aMaxE');
            lengthCheck = `(${v}.length<=${def.maxLength}||${err}.add(${v},i,${path},{max:${def.maxLength}}))`;
        }

        // Element validation - use unique variable names for nested arrays
        const aeVar = this.state.freshVar('_ae');
        const aiVar = this.state.freshVar('_ai');
        const arVar = this.state.freshVar('_ar');
        // Handle empty path case: empty path + index = just index, otherwise path.index
        const elemCheck = this.visit(element, aeVar, `(${path}?${path}+'.':'')+${aiVar}`);

        const loopBody = `${v}.reduce((${arVar},${aeVar},${aiVar})=>(${arVar}&(${elemCheck})),1)`;

        if (lengthCheck) {
            return `(Array.isArray(${v})?(${lengthCheck})&${loopBody}:${typeErr}.add(${v},i,${path}))`;
        }
        return `(Array.isArray(${v})?${loopBody}:${typeErr}.add(${v},i,${path}))`;
    }

    private visitTuple(schema: GGSchema<any>, def: TupleDef, v: string, path: string): string {
        const existingFunc = this.state.getRecursiveFunc(schema);
        if (existingFunc) {
            return `${existingFunc}(${v},i,${path})`;
        }

        const typeErr = this.state.capture(IsTupleErrors.typeError, '_tTE');
        const lengthErr = this.state.capture(IsTupleErrors.lengthError, '_tLE');
        const elements = def.elements!;

        const funcName = this.state.freshVar('_vt');
        const innerVar = this.state.freshVar('_v');
        const innerPath = this.state.freshVar('_pp');
        this.state.registerCompiling(schema, funcName);

        try {
            const elemChecks: string[] = [];
            for (let i = 0; i < elements.length; i++) {
                const elemPath = `${innerPath}+'.${i}'`;
                elemChecks.push(this.visit(elements[i], `${innerVar}[${i}]`, elemPath));
            }

            const body = elemChecks.length === 1
                ? elemChecks[0]
                : `(${elemChecks.map(c => `(${c})`).join('&')})`;

            const lengthCheck = `(${innerVar}.length===${elements.length}||${lengthErr}.add(${innerVar},i,${innerPath},{expected:${elements.length},actual:${innerVar}.length}))`;

            // Use && to short-circuit: only check elements if length matches (matches CODE_Validate behavior)
            const fullBody = `(Array.isArray(${innerVar})?(${lengthCheck})&&${body}:${typeErr}.add(${innerVar},i,${innerPath}))`;

            return this.state.wrapIfRecursiveValidate(fullBody, funcName, innerVar, innerPath, v, path);
        } finally {
            this.state.unregisterCompiling(schema);
        }
    }

    private visitRecord(def: RecordDef, v: string, path: string): string {
        const typeErr = this.state.capture(IsRecordErrors.typeError, '_rTE');
        // Use unique variable names for nested records
        const rkVar = this.state.freshVar('_rk');
        const rvVar = this.state.freshVar('_rv');
        const rrVar = this.state.freshVar('_rr');
        // Key path: path.keyName[key], Value path: path.keyName
        const keyCheck = this.visit(def.key, rkVar, `${path}+'.'+${rkVar}+'[key]'`);
        const valueCheck = this.visit(def.value, rvVar, `${path}+'.'+${rkVar}`);

        return `(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})?Object.entries(${v}).reduce((${rrVar},[${rkVar},${rvVar}])=>${rrVar}&(${keyCheck})&(${valueCheck}),1):${typeErr}.add(${v},i,${path}))`;
    }

    private visitUnion(def: UnionDef, v: string, path: string): string {
        const err = this.state.capture(IsUnionErrors.unionError, '_uE');
        // For unions, we need each variant's full is() check including constraints
        // Capture each variant's is() method (compiled by AOTExecutor)
        const checks = def.variants.map((variant) => {
            // Bind the schema's is method so it's callable as a standalone function
            const isFunc = variant.is.bind(variant);
            const isVar = this.state.capture(isFunc, '_ui');
            return `${isVar}(${v})`;
        });
        return `((${checks.join('||')})||${err}.add(${v},i,${path}))`;
    }

    private visitDiscriminated(schema: GGSchema<any>, def: DiscriminatedDef, v: string, path: string): string {
        // Check for recursion first
        const existingFunc = this.state.getRecursiveFunc(schema);
        if (existingFunc) {
            return `${existingFunc}(${v},i,${path})`;
        }

        const notObjErr = this.state.capture(IsDiscriminatedErrors.notObjectError, '_dNO');
        const missingErr = this.state.capture(IsDiscriminatedErrors.missingDiscriminatorError, '_dMD');
        const unknownErr = this.state.capture(IsDiscriminatedErrors.unknownVariantError, '_dUV');

        const disc = def.discriminator;
        const variantMap = def.variantMap!;

        // Register for recursion detection
        const funcName = this.state.freshVar('_vd');
        const innerVar = this.state.freshVar('_v');
        const innerPath = this.state.freshVar('_pp');
        this.state.registerCompiling(schema, funcName);

        try {
            const discAccess = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(disc) ? `${innerVar}.${disc}` : `${innerVar}[${JSON.stringify(disc)}]`;

            // Build variant cases
            const cases: string[] = [];
            for (const [key, variantSchema] of variantMap) {
                const keyCheck = typeof key === 'string' ? JSON.stringify(key) : key;
                // Validate the variant (skip type check since we already know it's an object)
                const variantDef = variantSchema.toCompilerDef() as ObjectDef;
                const variantCheck = this.visitObjectFields(variantSchema, variantDef, innerVar, innerPath, disc);
                // Also apply variant-level refinements
                const refinementChecks: string[] = [variantCheck];
                if (variantDef.refinements) {
                    for (const r of variantDef.refinements) {
                        const refCheck = this.state.capture(r.check, '_r');
                        const refError = this.state.capture(r.error, '_re');
                        refinementChecks.push(`(${refCheck}(${innerVar})||${refError}.add(${innerVar},i,${innerPath}))`);
                    }
                }
                const fullVariantCheck = refinementChecks.length === 1 ? refinementChecks[0] : `(${refinementChecks.join('&&')})`;
                cases.push(`${discAccess}===${keyCheck}?${fullVariantCheck}`);
            }

            // Chain: check object -> check discriminator exists -> check variant
            const discField = JSON.stringify(disc);
            const fullBody = `(typeof ${innerVar}==='object'&&${innerVar}!==null&&!Array.isArray(${innerVar})?(${discAccess}!=null?(${cases.join(':')}:${unknownErr}.add(${innerVar},i,${innerPath},{field:${discField},value:String(${discAccess})})):${missingErr}.add(${innerVar},i,${innerPath},{field:${discField}})):${notObjErr}.add(${innerVar},i,${innerPath}))`;

            return this.state.wrapIfRecursiveValidate(fullBody, funcName, innerVar, innerPath, v, path);
        } finally {
            this.state.unregisterCompiling(schema);
        }
    }

    /**
     * visitObjectFields - validate object fields without type check (for discriminated variants)
     */
    private visitObjectFields(schema: GGSchema<any>, def: ObjectDef, v: string, path: string, skipKey?: string): string {
        const shape = def.shape!;
        const keys = Object.keys(shape).filter(k => k !== skipKey);

        if (keys.length === 0) return 'true';

        const fieldChecks: string[] = [];
        for (const k of keys) {
            const fieldSchema = shape[k] as GGSchema<any>;
            const fieldPath = `${path}+(${path}?'.':'')+${JSON.stringify(k)}`;
            const check = this.visit(fieldSchema, propAccess(v, k), fieldPath);
            fieldChecks.push(check);
        }

        return fieldChecks.length === 1 ? fieldChecks[0] : `(${fieldChecks.map(c => `(${c})`).join('&')})`;
    }
}
