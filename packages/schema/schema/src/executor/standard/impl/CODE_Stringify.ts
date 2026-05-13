import type {AnyStandardSchemaDef, GGSchemaBinaryData} from "../../../Definition";
import {isNonJsonDef} from "../../../Definition";
import {CODE_Clean} from "./CODE_Clean";

export class CODE_Stringify {
    private static _instance: CODE_Stringify;

    static get instance(): CODE_Stringify {
        return this._instance ??= new CODE_Stringify();
    }

    stringify(def: AnyStandardSchemaDef, value: unknown, extras: Promise<GGSchemaBinaryData>[], path: string = ''): string | undefined {
        if (value === undefined) {
            return def.optional ? undefined : 'null';
        }
        if (value === null) {
            return 'null';
        }

        if (!def.hasNonJsonData) {
            return JSON.stringify(CODE_Clean.instance.clean(def, value, false));
        }

        return this.stringifySlow(def, value, extras, path);
    }

    private stringifySlow(def: AnyStandardSchemaDef, value: unknown, extras: Promise<GGSchemaBinaryData>[], path: string): string | undefined {
        if (value === undefined) return def.optional ? undefined : 'null';
        if (value === null) return 'null';

        if (!def.hasNonJsonData) {
            return JSON.stringify(CODE_Clean.instance.clean(def, value, false));
        }

        if (isNonJsonDef(def)) {
            extras.push(def.encodeToRaw(value, path));
            return 'null';
        }

        switch (def.type) {
            case 'string':
            case 'literal':
                return JSON.stringify(value);
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
                return String(value);
            case 'boolean':
                return value ? 'true' : 'false';
            case 'object':
                return this.stringifyObjectSlow(def, value as Record<string, unknown>, extras, path);
            case 'array':
                return this.stringifyArraySlow(def, value as unknown[], extras, path);
            case 'tuple':
                return this.stringifyTupleSlow(def, value as unknown[], extras, path);
            case 'record':
                return this.stringifyRecordSlow(def, value as Record<string, unknown>, extras, path);
            case 'discriminated':
                return this.stringifyDiscriminatedSlow(def, value as Record<string, unknown>, extras, path);
            case 'union':
                return this.stringifyUnionSlow(def, value, extras, path);
            default:
                return JSON.stringify(value);
        }
    }

    private stringifyObjectSlow(def: AnyStandardSchemaDef, value: Record<string, unknown>, extras: Promise<GGSchemaBinaryData>[], path: string): string {
        const shape = (def as any).shape;
        if (!shape) return '{}';

        const parts: string[] = [];
        for (const key of Object.keys(shape)) {
            const fieldDef = shape[key]?.toCompilerDef?.() ?? shape[key]?.def ?? shape[key];
            const fieldValue = value[key];
            if (fieldValue === undefined && fieldDef?.optional) continue;

            const fieldPath = path ? `${path}.${key}` : key;
            const stringified = this.stringifySlow(fieldDef, fieldValue, extras, fieldPath);
            if (stringified !== undefined) {
                parts.push(`${JSON.stringify(key)}:${stringified}`);
            }
        }
        return `{${parts.join(',')}}`;
    }

    private stringifyArraySlow(def: AnyStandardSchemaDef, value: unknown[], extras: Promise<GGSchemaBinaryData>[], path: string): string {
        const elementDef = (def as any).element?.toCompilerDef?.() ?? (def as any).element?.def;
        if (!elementDef) return JSON.stringify(value);

        const parts = value.map((item, i) => {
            const itemPath = path ? `${path}.${i}` : String(i);
            return this.stringifySlow(elementDef, item, extras, itemPath) ?? 'null';
        });
        return `[${parts.join(',')}]`;
    }

    private stringifyTupleSlow(def: AnyStandardSchemaDef, value: unknown[], extras: Promise<GGSchemaBinaryData>[], path: string): string {
        const elements = (def as any).elements;
        if (!elements) return JSON.stringify(value);

        const parts = elements.map((elemSchema: any, i: number) => {
            const elemDef = elemSchema?.toCompilerDef?.() ?? elemSchema?.def ?? elemSchema;
            const itemPath = path ? `${path}.${i}` : String(i);
            return this.stringifySlow(elemDef, value[i], extras, itemPath) ?? 'null';
        });
        return `[${parts.join(',')}]`;
    }

    private stringifyRecordSlow(def: AnyStandardSchemaDef, value: Record<string, unknown>, extras: Promise<GGSchemaBinaryData>[], path: string): string {
        const valueDef = (def as any).value?.toCompilerDef?.() ?? (def as any).value?.def;
        if (!valueDef) return JSON.stringify(value);

        const parts: string[] = [];
        for (const [key, val] of Object.entries(value)) {
            const fieldPath = path ? `${path}.${key}` : key;
            const stringified = this.stringifySlow(valueDef, val, extras, fieldPath);
            if (stringified !== undefined) {
                parts.push(`${JSON.stringify(key)}:${stringified}`);
            }
        }
        return `{${parts.join(',')}}`;
    }

    private stringifyUnionSlow(def: AnyStandardSchemaDef, value: unknown, extras: Promise<GGSchemaBinaryData>[], path: string): string {
        const variants = (def as any).variants;
        if (!variants) return JSON.stringify(value);

        for (const variant of variants) {
            if (variant.is(value)) {
                const variantDef = variant.toCompilerDef?.() ?? variant.def ?? variant;
                return this.stringifySlow(variantDef, value, extras, path) ?? 'null';
            }
        }
        return JSON.stringify(value);
    }

    private stringifyDiscriminatedSlow(def: AnyStandardSchemaDef, value: Record<string, unknown>, extras: Promise<GGSchemaBinaryData>[], path: string): string {
        const discriminator = (def as any).discriminator;
        const variantMap = (def as any).variantMap as Map<string | number | boolean, any> | undefined;
        if (!discriminator || !variantMap) return JSON.stringify(value);

        const discValue = value[discriminator];
        const variantSchema = variantMap.get(discValue as any);
        if (!variantSchema) return JSON.stringify(value);

        const variantDef = variantSchema?.toCompilerDef?.() ?? variantSchema?.def ?? variantSchema;
        return this.stringifySlow(variantDef, value, extras, path) ?? 'null';
    }
}
