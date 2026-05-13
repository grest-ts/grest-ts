import {GGSchema} from "../../../GGSchema";
import {CompilerState} from "../utils/CompilerState";
import {propAccess} from "../utils/helpers";
import type {AnyStandardSchemaDef, ArrayDef, DiscriminatedDef, GGSchemaBinaryData, LiteralDef, ObjectDef, RecordDef, TupleDef, UnionDef} from "../../../Definition";
import {isNonJsonDef} from "../../../Definition";

/**
 * Closure-based StringifyCompiler.
 * Generates pure functions with captured values - no `this` binding needed.
 *
 * Generated functions take (value, extras) where extras is an array that collects
 * non-JSON data (files, binary) encountered during serialization.
 */
export class AOT_Stringify {
    private readonly state = new CompilerState();

    /**
     * Compile schema to a stringify function.
     * The function takes (value, extras) and returns JSON string.
     * Non-JSON data promises are pushed to extras array and replaced with null in JSON.
     */
    compile<T>(schema: GGSchema<T>): (v: T, extras: Promise<GGSchemaBinaryData>[]) => string | undefined {
        this.state.reset();
        const body = this.visit(schema, 'v', '""');
        return this.state.buildFunction<(v: T, extras: Promise<GGSchemaBinaryData>[]) => string | undefined>(body, 'v', 'x');
    }

    /**
     * Compile schema to self-contained code string (for analysis/export).
     */
    compileToCode(schema: GGSchema<any>): string {
        this.state.reset();
        const body = this.visit(schema, 'v', '""');
        return this.state.getCode(body, 'v', 'x');
    }

    private visit(schema: GGSchema<any>, v: string, path: string): string {
        const def = schema.toCompilerDef() as AnyStandardSchemaDef;

        // Handle non-JSON leaf node: push encode promise to extras, return null
        if (isNonJsonDef(def)) {
            const encodeVar = this.state.capture(def.encodeToRaw.bind(def), '_enc');
            return `(x.push(${encodeVar}(${v},${path})),'null')`;
        }

        let code = this.visitType(schema, def, v, path);

        // Wrap with optional/nullable handling
        if (def.optional && def.nullable) {
            code = `(${v}===null?'null':${v}===undefined?undefined:${code})`;
        } else if (def.optional) {
            code = `(${v}===undefined?undefined:${code})`;
        } else if (def.nullable) {
            code = `(${v}===null?'null':${code})`;
        }
        return code;
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
            case 'discriminated':
                return this.visitDiscriminated(def, v, path);
            case 'union':
                return this.visitUnion(def, v, path);
            case 'literal':
                return this.visitLiteral(def, v);
            case 'string':
                return this.visitString(v);
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
            case 'bit':
                return v; // Numbers/bits stringify as themselves
            case 'boolean':
                return v; // Booleans stringify as themselves
            default:
                return `JSON.stringify(${v})`;
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Primitives
    // ──────────────────────────────────────────────────────────────────────────

    private visitString(v: string): string {
        // Use JSON.stringify directly - V8 optimizes it well and avoids regex overhead
        return `JSON.stringify(${v})`;
    }

    private visitLiteral(def: LiteralDef, v: string): string {
        const values = def.values;
        if (values.length === 1) {
            const val = values[0];
            return typeof val === 'string' ? JSON.stringify(JSON.stringify(val)) : String(val);
        }
        return values.some((val) => typeof val === 'string') ? `JSON.stringify(${v})` : v;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Object
    // ──────────────────────────────────────────────────────────────────────────

    private visitObject(schema: GGSchema<any>, def: ObjectDef, v: string, path: string): string {
        // Check for recursion
        const existingFunc = this.state.getRecursiveFunc(schema);
        if (existingFunc) {
            return `${existingFunc}(${v},${path})`;
        }

        const shape = def.shape!;
        const keys = Object.keys(shape);

        if (keys.length === 0) return `'{}'`;

        // Register for recursion detection with a fresh inner variable
        const funcName = this.state.freshVar('_s');
        const innerVar = this.state.freshVar('_v');
        const innerPath = this.state.freshVar('_p');
        this.state.registerCompiling(schema, funcName);

        try {
            const hasOptional = keys.some(k => {
                const fieldSchema = shape[k];
                return fieldSchema && typeof fieldSchema === 'object' && 'def' in fieldSchema && fieldSchema.def.optional;
            });

            let body: string;

            if (!hasOptional) {
                const parts: string[] = [];
                for (let i = 0; i < keys.length; i++) {
                    const k = keys[i];
                    const keyJson = JSON.stringify(JSON.stringify(k));
                    const fieldSchema = shape[k] as GGSchema<any>;
                    const fieldPath = this.buildPathConditional(innerPath, k);
                    const valueCode = this.visit(fieldSchema, propAccess(innerVar, k), fieldPath);
                    const prefix = i === 0 ? `'{'+${keyJson}+':'` : `','+${keyJson}+':'`;
                    parts.push(`${prefix}+${valueCode}`);
                }
                body = `(${parts.join('+')}+'}')`;
            } else {
                // Has optional - comma flag pattern
                const fieldParts: string[] = [];
                for (const k of keys) {
                    const fieldSchema = shape[k] as GGSchema<any>;
                    const fieldExpr = propAccess(innerVar, k);
                    const fieldPath = this.buildPathConditional(innerPath, k);
                    const valueCode = this.visit(fieldSchema, fieldExpr, fieldPath);
                    const keyWithColon = JSON.stringify(JSON.stringify(k) + ':');

                    if (fieldSchema.def.optional) {
                        fieldParts.push(`(${fieldExpr}===undefined?'':(c?',':((c=true),''))+${keyWithColon}+${valueCode})`);
                    } else {
                        fieldParts.push(`(c?',':((c=true),''))+${keyWithColon}+${valueCode}`);
                    }
                }
                body = `((c)=>'{'+${fieldParts.join('+')}+'}')(false)`;
            }

            return this.wrapIfRecursiveWithPath(body, funcName, innerVar, innerPath, v, path);
        } finally {
            this.state.unregisterCompiling(schema);
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Array
    // ──────────────────────────────────────────────────────────────────────────

    private visitArray(def: ArrayDef, v: string, path: string): string {
        const element = def.element!;
        const elemDef = element.toCompilerDef() as AnyStandardSchemaDef;

        // Fast paths for primitive arrays (no extras possible)
        if (!elemDef.hasNonJsonData) {
            if (elemDef.type === 'string' || elemDef.type === 'boolean') {
                return `JSON.stringify(${v})`;
            }
            if (elemDef.type === 'number' || elemDef.type === 'int' || elemDef.type === 'uint' ||
                elemDef.type === 'posInt' || elemDef.type === 'int8' || elemDef.type === 'int16' ||
                elemDef.type === 'int32' || elemDef.type === 'uint8' || elemDef.type === 'uint16' ||
                elemDef.type === 'uint32' || elemDef.type === 'bit') {
                return `'['+${v}.join(',')+']'`;
            }
        }

        // General case with path tracking for extras
        const elemPath = this.buildPathDynamic(path, 'i');
        const elemCode = this.visit(element, '_e', elemPath);
        const first = elemCode.replace(/\b_e\b/g, 'a[0]').replace(/\+i\b/g, '+0');
        const loop = elemCode.replace(/\b_e\b/g, 'a[i]');

        return `((a)=>{if(!a.length)return'[]';var i=0,r='['+${first};for(i=1;i<a.length;i++)r+=','+${loop};return r+']';})(${v})`;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Tuple
    // ──────────────────────────────────────────────────────────────────────────

    private visitTuple(schema: GGSchema<any>, def: TupleDef, v: string, path: string): string {
        const existingFunc = this.state.getRecursiveFunc(schema);
        if (existingFunc) {
            return `${existingFunc}(${v},${path})`;
        }

        const elements = def.elements!;

        if (elements.length === 0) return `'[]'`;

        const funcName = this.state.freshVar('_t');
        const innerVar = this.state.freshVar('_v');
        const innerPath = this.state.freshVar('_p');
        this.state.registerCompiling(schema, funcName);

        try {
            const parts: string[] = [];
            for (let i = 0; i < elements.length; i++) {
                const elemPath = this.buildPath(innerPath, String(i));
                const elemCode = this.visit(elements[i], `${innerVar}[${i}]`, elemPath);
                parts.push(i === 0 ? `'['+${elemCode}` : `','+${elemCode}`);
            }

            const body = `(${parts.join('+')}+']')`;
            return this.wrapIfRecursiveWithPath(body, funcName, innerVar, innerPath, v, path);
        } finally {
            this.state.unregisterCompiling(schema);
        }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Record
    // ──────────────────────────────────────────────────────────────────────────

    private visitRecord(def: RecordDef, v: string, path: string): string {
        const valuePath = this.buildPathDynamic(path, '_k');
        const valueCode = this.visit(def.value, '_rv', valuePath);

        return `((o)=>{const e=Object.entries(o);if(!e.length)return'{}';` +
            `var r='{'+JSON.stringify(e[0][0])+':'+(((_k,_rv)=>${valueCode})(...e[0]));` +
            `for(var i=1;i<e.length;i++)r+=','+JSON.stringify(e[i][0])+':'+(((_k,_rv)=>${valueCode})(...e[i]));` +
            `return r+'}';})(${v})`;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Discriminated
    // ──────────────────────────────────────────────────────────────────────────

    private visitDiscriminated(def: DiscriminatedDef, v: string, path: string): string {
        const disc = def.discriminator;
        const variantMap = def.variantMap!;
        const discAccess = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(disc) ? `${v}.${disc}` : `${v}[${JSON.stringify(disc)}]`;

        // Capture valid discriminator values in a Set for O(1) lookup
        const validKeys = new Set([...variantMap.keys()]);
        const setVar = this.state.capture(validKeys, '_ds');

        const cases: string[] = [];
        for (const [key, variantSchema] of variantMap) {
            const keyCheck = typeof key === 'string' ? JSON.stringify(key) : key;
            const inlineCode = this.visit(variantSchema, v, path);
            cases.push(`${discAccess}===${keyCheck}?${inlineCode}`);
        }
        // Check Set first for O(1) rejection of invalid discriminators
        return `(${setVar}.has(${discAccess})?(${cases.join(':')}:undefined):undefined)`;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Union
    // ──────────────────────────────────────────────────────────────────────────

    private visitUnion(def: UnionDef, v: string, path: string): string {
        const variants = def.variants;
        if (!variants || variants.length === 0) return `JSON.stringify(${v})`;

        const cases: string[] = [];
        for (const variant of variants) {
            const isVar = this.state.capture(variant.is.bind(variant), '_uis');
            const variantCode = this.visit(variant, v, path);
            cases.push(`${isVar}(${v})?${variantCode}`);
        }
        cases.push(`JSON.stringify(${v})`);
        return `(${cases.join(':')})`;
    }

    // ──────────────────────────────────────────────────────────────────────────
    // Helpers
    // ──────────────────────────────────────────────────────────────────────────

    private buildPath(basePath: string, key: string): string {
        return basePath === '""' ? `"${key}"` : `${basePath}+".${key}"`;
    }

    private buildPathDynamic(basePath: string, keyExpr: string): string {
        return basePath === '""' ? keyExpr : `${basePath}+'.'+${keyExpr}`;
    }

    private buildPathConditional(basePath: string, key: string): string {
        return basePath === '""' ? `"${key}"` : `(${basePath}?${basePath}+'.':'')+\"${key}\"`;
    }

    private wrapIfRecursiveWithPath(body: string, funcName: string, innerVar: string, innerPath: string, v: string, path: string): string {
        if (this.state.isRecursive(funcName)) {
            return `(${funcName}=((${innerVar},${innerPath})=>${body}))(${v},${path})`;
        }
        let result = body.split(innerVar).join(v).split(innerPath).join(path);
        if (path === '""') {
            result = result.replace(/\(""\?""\+'\.':''\)\+/g, '');
        }
        return result;
    }
}
