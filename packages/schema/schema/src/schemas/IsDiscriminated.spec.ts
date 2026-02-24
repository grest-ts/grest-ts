import {describe, expect, it} from 'vitest';
import {DiscriminatedSchema, IsDiscriminated} from './IsDiscriminated';
import {IsObject} from './IsObject';
import {IsString} from './IsString';
import {IsNumber} from './IsNumber';
import {IsArray} from './IsArray';
import {GGIssueKey} from "../issue/GGIssueKey";
import {GGIssuesList} from "../issue/GGIssuesList";
import {GGIssueInvalid} from "../issue/issues/GGIssueInvalid";
import {testObjectValidation, testStringify, testUtils} from "../utils/testUtils";
import {IsDiscriminatedErrors} from "../Errors";

const testRefineError = new GGIssueInvalid("test.refine", "Refinement failed");
const testAdminRefineError = new GGIssueInvalid("test.disc.adminRefine", "Admin refinement failed");
const testMinLenError = new GGIssueInvalid("test.disc.minLen", "Too short");
const testMaxLenError = new GGIssueInvalid("test.disc.maxLen", "Too long");
const testCodeMinError = new GGIssueInvalid("test.disc.codeMin", "Code too short");

// Common schemas used across tests
const UserSchema = IsObject({
    type: 'user' as const,
    name: IsString
});

const AdminSchema = IsObject({
    type: 'admin' as const,
    name: IsString,
    level: IsNumber
});

const GuestSchema = IsObject({
    type: 'guest' as const,
    sessionId: IsString
});

testUtils('IsDiscriminated', () => {

    // ==================== Factory Validation ====================

    describe('factory function', () => {
        it('should throw if less than two variants provided', () => {
            expect(() => IsDiscriminated('type', {
                user: UserSchema
            })).toThrow('IsDiscriminated requires at least two variants');
        });
    });

    // ==================== Basic Validation ====================

    describe('basic validation (two variants)', () => {
        const PersonSchema = IsDiscriminated('type', {
            user: UserSchema,
            admin: AdminSchema
        });

        testObjectValidation('validates matching variants', PersonSchema, [
            {value: {type: 'user', name: 'John'}, valid: true},
            {value: {type: 'admin', name: 'Jane', level: 5}, valid: true},
        ]);

        testObjectValidation('rejects unknown discriminator', PersonSchema, [
            {value: {type: 'guest', name: 'Bob'}, valid: false, issue: IsDiscriminatedErrors.unknownVariantError},
        ]);

        testObjectValidation('rejects missing discriminator', PersonSchema, [
            {value: {name: 'John'}, valid: false, issue: IsDiscriminatedErrors.missingDiscriminatorError},
        ]);

        testObjectValidation('rejects null discriminator', PersonSchema, [
            {value: {type: null, name: 'John'}, valid: false, issue: IsDiscriminatedErrors.missingDiscriminatorError},
        ]);

        testObjectValidation('rejects wrong structure for variant', PersonSchema, [
            {value: {type: 'admin', name: 'Jane'}, valid: false, path: 'root.level'}, // missing level
            {value: {type: 'user', name: 123}, valid: false, path: 'root.name'}, // wrong name type
        ]);

        testObjectValidation('rejects non-object values', PersonSchema, [
            {value: null, valid: false, issue: GGIssueKey.required},
            {value: undefined, valid: false, issue: GGIssueKey.required},
            {value: 'string', valid: false, issue: IsDiscriminatedErrors.notObjectError},
            {value: [], valid: false, issue: IsDiscriminatedErrors.notObjectError},
            {value: 123, valid: false, issue: IsDiscriminatedErrors.notObjectError},
        ]);
    });

    // ==================== Three+ Variants ====================

    describe('three variants', () => {
        const PersonSchema = IsDiscriminated('type', {
            user: UserSchema,
            admin: AdminSchema,
            guest: GuestSchema
        });

        testObjectValidation('validates all three variants', PersonSchema, [
            {value: {type: 'user', name: 'John'}, valid: true},
            {value: {type: 'admin', name: 'Jane', level: 5}, valid: true},
            {value: {type: 'guest', sessionId: 'abc123'}, valid: true},
        ]);

        testObjectValidation('rejects invalid variants', PersonSchema, [
            {value: {type: 'unknown', name: 'X'}, valid: false, issue: IsDiscriminatedErrors.unknownVariantError},
        ]);
    });

    // ==================== Many Variants ====================

    describe('many variants', () => {
        const Type1 = IsObject({kind: 'a' as const, v1: IsString});
        const Type2 = IsObject({kind: 'b' as const, v2: IsNumber});
        const Type3 = IsObject({kind: 'c' as const, v3: IsString});
        const Type4 = IsObject({kind: 'd' as const, v4: IsNumber});
        const Type5 = IsObject({kind: 'e' as const, v5: IsString});

        const schema = IsDiscriminated('kind', {
            a: Type1,
            b: Type2,
            c: Type3,
            d: Type4,
            e: Type5
        });

        testObjectValidation('validates all variants', schema, [
            {value: {kind: 'a', v1: 'hello'}, valid: true},
            {value: {kind: 'b', v2: 42}, valid: true},
            {value: {kind: 'c', v3: 'world'}, valid: true},
            {value: {kind: 'd', v4: 100}, valid: true},
            {value: {kind: 'e', v5: 'test'}, valid: true},
        ]);

        testObjectValidation('rejects invalid variants', schema, [
            {value: {kind: 'f', v6: 'unknown'}, valid: false, issue: IsDiscriminatedErrors.unknownVariantError},
            {value: {kind: 'a', v2: 42}, valid: false, path: 'root.v1'}, // wrong property for variant
        ]);
    });

    // ==================== Numeric Discriminator ====================

    describe('numeric discriminator', () => {
        const Type1Schema = IsObject({
            code: 1 as const,
            value: IsString
        });

        const Type2Schema = IsObject({
            code: 2 as const,
            value: IsNumber
        });

        const CodeSchema = IsDiscriminated('code', {
            1: Type1Schema,
            2: Type2Schema
        });

        testObjectValidation('validates numeric discriminator', CodeSchema, [
            {value: {code: 1, value: 'hello'}, valid: true},
            {value: {code: 2, value: 42}, valid: true},
        ]);

        testObjectValidation('rejects invalid numeric discriminator', CodeSchema, [
            {value: {code: 3, value: 'hello'}, valid: false, issue: IsDiscriminatedErrors.unknownVariantError},
        ]);
    });

    // ==================== Special Property Names ====================

    describe('special property names as discriminator', () => {
        const TypeA = IsObject({
            'my-type': 'a' as const,
            value: IsString
        });
        const TypeB = IsObject({
            'my-type': 'b' as const,
            value: IsNumber
        });
        const schema = IsDiscriminated('my-type', {
            a: TypeA,
            b: TypeB
        });

        testObjectValidation('validates with hyphenated discriminator', schema, [
            {value: {'my-type': 'a', value: 'hello'}, valid: true},
            {value: {'my-type': 'b', value: 42}, valid: true},
            {value: {'my-type': 'c', value: 'x'}, valid: false, issue: IsDiscriminatedErrors.unknownVariantError},
        ]);
    });

    // ==================== orUndefined / orNull ====================

    describe('orUndefined', () => {
        const PersonSchema = IsDiscriminated('type', {
            user: UserSchema,
            admin: AdminSchema
        }).orUndefined;

        testObjectValidation('accepts undefined', PersonSchema, [
            {value: undefined, valid: true},
            {value: {type: 'user', name: 'John'}, valid: true},
            {value: null, valid: false, issue: GGIssueKey.required},
        ]);
    });

    describe('orNull', () => {
        const PersonSchema = IsDiscriminated('type', {
            user: UserSchema,
            admin: AdminSchema
        }).orNull;

        testObjectValidation('accepts null', PersonSchema, [
            {value: null, valid: true},
            {value: {type: 'user', name: 'John'}, valid: true},
            {value: undefined, valid: false, issue: GGIssueKey.required},
        ]);
    });

    // ==================== Parse with Coercion ====================

    describe('parse with coercion', () => {
        const Schema = IsDiscriminated('type', {
            user: IsObject({
                type: 'user' as const,
                age: IsNumber
            }),
            admin: IsObject({
                type: 'admin' as const,
                level: IsNumber
            })
        });

        it('coerces values in the variant', () => {
            const issues = new GGIssuesList();
            const result = Schema._parse({type: 'user', age: '25'}, issues, 'test', true);
            expect(result).toEqual({type: 'user', age: 25});
            expect(issues.length).toBe(0);
        });

        it('fails if coercion fails', () => {
            const issues = new GGIssuesList();
            const result = Schema._parse({type: 'user', age: 'not-a-number'}, issues, 'test', true);
            expect(result).toBeUndefined();
            expect(issues.length).toBeGreaterThan(0);
        });
    });

    // ==================== Refinements ====================

    describe('variant refinements', () => {
        const Schema = IsDiscriminated('type', {
            user: IsObject({
                type: 'user' as const,
                name: IsString.refine(v => v.length > 0, testRefineError)
            }),
            admin: AdminSchema
        });

        testObjectValidation('applies variant refinements', Schema, [
            {value: {type: 'user', name: 'John'}, valid: true},
            {value: {type: 'user', name: ''}, valid: false, path: 'root.name'},
            {value: {type: 'admin', name: 'Jane', level: 5}, valid: true},
        ]);
    });

    describe('variant object-level refinements', () => {
        // Refine is on the variant OBJECT schema (not on a field, and not on the discriminated union itself)
        // This matches patterns like: IsObject({...}).refine(obj => ...) passed as a variant
        const UserWithRefine = IsObject({
            type: 'user' as const,
            name: IsString,
            code: IsString.orNull,
        }).refine(obj => !obj.code || obj.code.length >= 3, testRefineError);

        const Schema = IsDiscriminated('type', {
            user: UserWithRefine,
            admin: AdminSchema
        });

        testObjectValidation('validates variant with object-level refine', Schema, [
            {value: {type: 'user', name: 'John', code: 'ABC'}, valid: true},
            {value: {type: 'user', name: 'John', code: null}, valid: true},
            {value: {type: 'user', name: 'John', code: 'AB'}, valid: false, path: 'root'},
            {value: {type: 'admin', name: 'Jane', level: 5}, valid: true},
        ]);

        it('refinement error has correct code', () => {
            const issues = new GGIssuesList();
            Schema._parse({type: 'user', name: 'John', code: 'AB'}, issues, 'root');
            expect(issues.length).toBe(1);
            expect(issues.getIssue(0)?.code).toBe('invalid.test.refine');
        });

        it('field validation errors take priority over refinement', () => {
            // name is invalid (not a string) - refinement should not even matter
            const issues = new GGIssuesList();
            Schema._parse({type: 'user', name: 123, code: 'AB'}, issues, 'root');
            expect(issues.length).toBeGreaterThan(0);
            expect(issues.getPath(0)).toBe('root.name');
        });
    });

    describe('variant object-level refinements on multiple variants', () => {
        const UserWithRefine = IsObject({
            type: 'user' as const,
            name: IsString,
            code: IsString.orNull,
        }).refine(obj => !obj.code || obj.code.length >= 3, testRefineError);

        const AdminWithRefine = IsObject({
            type: 'admin' as const,
            name: IsString,
            level: IsNumber,
        }).refine(obj => obj.level > 0, testAdminRefineError);

        const Schema = IsDiscriminated('type', {
            user: UserWithRefine,
            admin: AdminWithRefine
        });

        testObjectValidation('each variant applies its own refinement', Schema, [
            {value: {type: 'user', name: 'John', code: 'ABC'}, valid: true},
            {value: {type: 'user', name: 'John', code: 'AB'}, valid: false, path: 'root'},
            {value: {type: 'admin', name: 'Jane', level: 5}, valid: true},
            {value: {type: 'admin', name: 'Jane', level: 0}, valid: false, path: 'root'},
        ]);
    });

    describe('variant with multiple chained refinements', () => {
        const UserWithChainedRefine = IsObject({
            type: 'user' as const,
            name: IsString,
            code: IsString.orNull,
        })
            .refine(obj => !obj.code || obj.code.length >= 3, testMinLenError)
            .refine(obj => !obj.code || obj.code.length <= 10, testMaxLenError);

        const Schema = IsDiscriminated('type', {
            user: UserWithChainedRefine,
            admin: AdminSchema
        });

        testObjectValidation('both chained refinements are applied', Schema, [
            {value: {type: 'user', name: 'John', code: 'ABC'}, valid: true},
            {value: {type: 'user', name: 'John', code: null}, valid: true},
            {value: {type: 'user', name: 'John', code: 'AB'}, valid: false},
            {value: {type: 'user', name: 'John', code: 'ABCDEFGHIJK'}, valid: false},
            {value: {type: 'admin', name: 'Jane', level: 5}, valid: true},
        ]);
    });

    describe('variant object-level refinement with coercion', () => {
        const UserWithRefine = IsObject({
            type: 'user' as const,
            name: IsString,
            age: IsNumber,
        }).refine(obj => obj.age >= 18, testRefineError);

        const Schema = IsDiscriminated('type', {
            user: UserWithRefine,
            admin: AdminSchema
        });

        it('coerces then applies refinement (pass)', () => {
            const issues = new GGIssuesList();
            const result = Schema._parse({type: 'user', name: 'John', age: '25'}, issues, 'root', true);
            expect(issues.length).toBe(0);
            expect(result).toEqual({type: 'user', name: 'John', age: 25});
        });

        it('coerces then applies refinement (fail)', () => {
            const issues = new GGIssuesList();
            const result = Schema._parse({type: 'user', name: 'John', age: '10'}, issues, 'root', true);
            expect(result).toBeUndefined();
            expect(issues.length).toBeGreaterThan(0);
        });
    });

    describe('schema-level refinements', () => {
        const PersonSchema = IsDiscriminated('type', {
            user: UserSchema,
            admin: AdminSchema
        }).refine(v => {
            // Custom rule: admin level must be > 0
            if (v.type === 'admin') {
                return (v as any).level > 0;
            }
            return true;
        }, testRefineError);

        it('applies refinement after variant validation', () => {
            expect(PersonSchema.is({type: 'user', name: 'John'})).toBe(true);
            expect(PersonSchema.is({type: 'admin', name: 'Jane', level: 5})).toBe(true);
            expect(PersonSchema.is({type: 'admin', name: 'Jane', level: 0})).toBe(false);
            expect(PersonSchema.is({type: 'admin', name: 'Jane', level: -1})).toBe(false);
        });

        it('adds refinement error during parse', () => {
            const issues = new GGIssuesList();
            expect(PersonSchema._parse({type: 'admin', name: 'Jane', level: 0}, issues, 'test')).toBeUndefined();
            expect(issues.getIssue(0)?.code).toBe('invalid.test.refine');
        });
    });

    // ==================== Stringify ====================

    describe('stringify', () => {
        const PersonSchema = IsDiscriminated('type', {
            user: UserSchema,
            admin: AdminSchema
        });

        testStringify('basic discriminated union', PersonSchema, [
            {value: {type: 'user', name: 'John'}, expected: {type: 'user', name: 'John'}},
            {value: {type: 'admin', name: 'Jane', level: 5}, expected: {type: 'admin', name: 'Jane', level: 5}},
        ]);
    });

    describe('stringify with optional fields', () => {
        const UserWithNickname = IsObject({
            type: 'user' as const,
            name: IsString,
            nickname: IsString.orUndefined
        });
        const AdminWithTitle = IsObject({
            type: 'admin' as const,
            name: IsString,
            title: IsString.orUndefined
        });

        const PersonSchema = IsDiscriminated('type', {
            user: UserWithNickname,
            admin: AdminWithTitle
        });

        testStringify('skips undefined optional fields', PersonSchema, [
            {value: {type: 'user', name: 'John', nickname: 'Johnny'}, expected: {type: 'user', name: 'John', nickname: 'Johnny'}},
            {value: {type: 'user', name: 'John', nickname: undefined}, expected: {type: 'user', name: 'John'}},
            {value: {type: 'admin', name: 'Jane', title: 'CTO'}, expected: {type: 'admin', name: 'Jane', title: 'CTO'}},
            {value: {type: 'admin', name: 'Jane', title: undefined}, expected: {type: 'admin', name: 'Jane'}},
        ]);
    });

    describe('stringify nullable schema', () => {
        const PersonSchema = IsDiscriminated('type', {
            user: UserSchema,
            admin: AdminSchema
        }).orNull;

        testStringify('nullable discriminated union', PersonSchema, [
            {value: {type: 'user', name: 'John'}, expected: {type: 'user', name: 'John'}},
            {value: null, expected: null},
        ]);
    });

    // ==================== Nested Discriminated Unions ====================

    describe('nested discriminated unions', () => {
        const LeafA = IsObject({
            leafKind: 'a' as const,
            value: IsString
        });

        const LeafB = IsObject({
            leafKind: 'b' as const,
            count: IsNumber
        });

        const InnerUnion = IsDiscriminated('leafKind', {
            a: LeafA,
            b: LeafB
        });

        const ContainerSchema = IsObject({
            id: IsNumber,
            leaf: InnerUnion
        });

        testObjectValidation('validates nested discriminated union', ContainerSchema, [
            {value: {id: 1, leaf: {leafKind: 'a', value: 'test'}}, valid: true},
            {value: {id: 1, leaf: {leafKind: 'b', count: 42}}, valid: true},
            {value: {id: 1, leaf: {leafKind: 'c', value: 'x'}}, valid: false, path: 'root.leaf'},
        ]);

        testStringify('stringifies nested discriminated union', ContainerSchema, [
            {value: {id: 1, leaf: {leafKind: 'a', value: 'test'}}, expected: {id: 1, leaf: {leafKind: 'a', value: 'test'}}},
            {value: {id: 1, leaf: {leafKind: 'b', count: 42}}, expected: {id: 1, leaf: {leafKind: 'b', count: 42}}},
        ]);
    });

    // ==================== Integration with Arrays ====================

    describe('array of discriminated unions', () => {
        const PersonSchema = IsDiscriminated('type', {
            user: UserSchema,
            admin: AdminSchema
        });

        const PeopleArray = IsArray(PersonSchema);

        testObjectValidation('validates array of discriminated unions', PeopleArray, [
            {value: [{type: 'user', name: 'John'}, {type: 'admin', name: 'Jane', level: 5}], valid: true},
            {value: [], valid: true},
            {value: [{type: 'user', name: 'John'}, {type: 'guest', name: 'Bob'}], valid: false},
        ]);

        testStringify('stringifies array of discriminated unions', PeopleArray, [
            {value: [{type: 'user', name: 'John'}, {type: 'admin', name: 'Jane', level: 5}], expected: [{type: 'user', name: 'John'}, {type: 'admin', name: 'Jane', level: 5}]},
            {value: [], expected: []},
        ]);
    });

    describe('stringify orUndefined', () => {
        const PersonSchema = IsDiscriminated('type', {
            user: UserSchema,
            admin: AdminSchema
        });

        it('orUndefined.stringify(undefined) returns undefined', () => {
            expect(PersonSchema.orUndefined.stringify(undefined)).toBe(undefined);
        });

        it('orUndefined.stringify(value) returns stringified value', () => {
            expect(PersonSchema.orUndefined.stringify({type: 'user', name: 'John'})).toBe('{"type":"user","name":"John"}');
        });
    });

    // ==================== Brand ====================

    describe('brand()', () => {
        const PersonSchema = IsDiscriminated('type', {
            user: UserSchema,
            admin: AdminSchema
        });

        const BrandedPerson = PersonSchema.brand('Person');

        testObjectValidation('validates branded discriminated union', BrandedPerson, [
            {value: {type: 'user', name: 'John'}, valid: true},
            {value: {type: 'admin', name: 'Jane', level: 5}, valid: true},
            {value: {type: 'guest', name: 'Bob'}, valid: false},
        ]);
    });

    // ==================== Docs ====================

    describe('docs()', () => {
        it('adds documentation', () => {
            const schema = IsDiscriminated('type', {
                user: UserSchema,
                admin: AdminSchema
            }).docs({
                title: 'Person',
                description: 'A person can be either a user or an admin'
            });

            expect(schema.def.docs?.title).toBe('Person');
            expect(schema.def.docs?.description).toBe('A person can be either a user or an admin');
        });

        it('merges documentation', () => {
            const schema = IsDiscriminated('type', {
                user: UserSchema,
                admin: AdminSchema
            })
                .docs({title: 'Person'})
                .docs({description: 'A person type'});

            expect(schema.def.docs?.title).toBe('Person');
            expect(schema.def.docs?.description).toBe('A person type');
        });
    });

    // ==================== Stringify strips extra properties ====================

    describe('parse strips extra properties', () => {
        const PersonSchema = IsDiscriminated('type', {
            user: UserSchema,
            admin: AdminSchema,
            guest: GuestSchema
        });

        it('strips extra properties from user variant', () => {
            const input = {type: 'user', name: 'John', EXTRA: 'should be stripped', another: 123};
            const issues = new GGIssuesList();
            const result = PersonSchema._parse(input, issues, '');
            expect(issues.length).toBe(0);
            expect(result).toEqual({type: 'user', name: 'John'});
            expect(result && 'EXTRA' in result).toBe(false);
            expect(result && 'another' in result).toBe(false);
        });

        it('strips extra properties from admin variant', () => {
            const input = {type: 'admin', name: 'Jane', level: 5, EXTRA: 'should be stripped'};
            const issues = new GGIssuesList();
            const result = PersonSchema._parse(input, issues, '');
            expect(issues.length).toBe(0);
            expect(result).toEqual({type: 'admin', name: 'Jane', level: 5});
            expect(result && 'EXTRA' in result).toBe(false);
        });

        it('strips extra properties from nested discriminated union', () => {
            const LeafA = IsObject({
                leafKind: 'a' as const,
                value: IsString
            });
            const LeafB = IsObject({
                leafKind: 'b' as const,
                count: IsNumber
            });
            const InnerUnion = IsDiscriminated('leafKind', {
                a: LeafA,
                b: LeafB
            });
            const ContainerSchema = IsObject({
                id: IsNumber,
                leaf: InnerUnion
            });

            const input = {
                id: 1,
                leaf: {leafKind: 'a', value: 'test', EXTRA: 'should be stripped'},
                EXTRA_OUTER: 'also stripped'
            };
            const issues = new GGIssuesList();
            const result = ContainerSchema._parse(input, issues, '');
            expect(issues.length).toBe(0);
            expect(result).toEqual({id: 1, leaf: {leafKind: 'a', value: 'test'}});
            expect(result && 'EXTRA_OUTER' in result).toBe(false);
            expect(result && result.leaf && 'EXTRA' in result.leaf).toBe(false);
        });
    });

    describe('stringify strips extra properties', () => {
        const PersonSchema = IsDiscriminated('type', {
            user: UserSchema,
            admin: AdminSchema,
            guest: GuestSchema
        });

        it('strips extra properties from user variant', () => {
            const input = {type: 'user', name: 'John', EXTRA: 'should be stripped', another: 123};
            const result = PersonSchema.stringify(input);
            const parsed = JSON.parse(result!);
            expect(parsed).toEqual({type: 'user', name: 'John'});
            expect(parsed.EXTRA).toBeUndefined();
            expect(parsed.another).toBeUndefined();
        });

        it('strips extra properties from admin variant', () => {
            const input = {type: 'admin', name: 'Jane', level: 5, EXTRA: 'should be stripped'};
            const result = PersonSchema.stringify(input);
            const parsed = JSON.parse(result!);
            expect(parsed).toEqual({type: 'admin', name: 'Jane', level: 5});
            expect(parsed.EXTRA).toBeUndefined();
        });

        it('strips extra properties from guest variant', () => {
            const input = {type: 'guest', sessionId: 'abc123', EXTRA: 'should be stripped'};
            const result = PersonSchema.stringify(input);
            const parsed = JSON.parse(result!);
            expect(parsed).toEqual({type: 'guest', sessionId: 'abc123'});
            expect(parsed.EXTRA).toBeUndefined();
        });

        it('strips extra properties from nested discriminated union', () => {
            const LeafA = IsObject({
                leafKind: 'a' as const,
                value: IsString
            });
            const LeafB = IsObject({
                leafKind: 'b' as const,
                count: IsNumber
            });
            const InnerUnion = IsDiscriminated('leafKind', {
                a: LeafA,
                b: LeafB
            });
            const ContainerSchema = IsObject({
                id: IsNumber,
                leaf: InnerUnion
            });

            const input = {
                id: 1,
                leaf: {leafKind: 'a', value: 'test', EXTRA: 'should be stripped'},
                EXTRA_OUTER: 'also stripped'
            };
            const result = ContainerSchema.stringify(input);
            const parsed = JSON.parse(result!);
            expect(parsed).toEqual({id: 1, leaf: {leafKind: 'a', value: 'test'}});
            expect(parsed.EXTRA_OUTER).toBeUndefined();
            expect(parsed.leaf.EXTRA).toBeUndefined();
        });
    });

    // ==================== Property Stripping ====================

    describe('strips extra properties from variants', () => {
        const PersonSchema = IsDiscriminated('type', {
            user: UserSchema,
            admin: AdminSchema
        });

        it('should strip extra properties from user variant', () => {
            const issues = new GGIssuesList();
            const input = {type: 'user', name: 'John', extra: 'ignored', password: 'secret'};
            const result = PersonSchema._parse(input, issues, 'person');

            expect(issues.length).toBe(0);
            expect(result).toBeDefined();
            expect(result).toEqual({type: 'user', name: 'John'});
            expect(Object.keys(result!)).toEqual(['type', 'name']);
        });

        it('should strip extra properties from admin variant', () => {
            const issues = new GGIssuesList();
            const input = {type: 'admin', name: 'Jane', level: 5, secret: 'hidden', apiKey: '123'};
            const result = PersonSchema._parse(input, issues, 'person');

            expect(issues.length).toBe(0);
            expect(result).toBeDefined();
            expect(result).toEqual({type: 'admin', name: 'Jane', level: 5});
            expect(Object.keys(result!)).toEqual(['type', 'name', 'level']);
        });

        it('should strip extra properties in array of discriminated unions', () => {
            const PeopleArray = IsArray(PersonSchema);
            const issues = new GGIssuesList();
            const input = [
                {type: 'user', name: 'John', extra: 'ignored'},
                {type: 'admin', name: 'Jane', level: 5, secret: 'hidden'}
            ];
            const result = PeopleArray._parse(input, issues, 'people');

            expect(issues.length).toBe(0);
            expect(result).toBeDefined();
            expect(result).toHaveLength(2);
            expect(result![0]).toEqual({type: 'user', name: 'John'});
            expect(result![1]).toEqual({type: 'admin', name: 'Jane', level: 5});
        });
    });

    // ==================== Discriminated of Discriminated ====================

    describe('discriminated union containing discriminated union variants', () => {
        // Inner discriminated unions with different discriminator
        const UserRoleUnion = IsDiscriminated('role', {
            admin: IsObject({role: 'admin' as const, permissions: IsArray(IsString)}),
            member: IsObject({role: 'member' as const, team: IsString})
        });

        const ItemKindUnion = IsDiscriminated('kind', {
            product: IsObject({kind: 'product' as const, price: IsNumber}),
            service: IsObject({kind: 'service' as const, duration: IsNumber})
        });

        // Outer discriminated union with variants being discriminated unions
        const EntitySchema = IsDiscriminated('category', {
            user: IsObject({category: 'user' as const, data: UserRoleUnion}),
            item: IsObject({category: 'item' as const, data: ItemKindUnion})
        });

        testObjectValidation('validates nested discriminated unions', EntitySchema, [
            {value: {category: 'user', data: {role: 'admin', permissions: ['read', 'write']}}, valid: true},
            {value: {category: 'user', data: {role: 'member', team: 'engineering'}}, valid: true},
            {value: {category: 'item', data: {kind: 'product', price: 99.99}}, valid: true},
            {value: {category: 'item', data: {kind: 'service', duration: 60}}, valid: true},
        ]);

        testObjectValidation('rejects invalid nested discriminated unions', EntitySchema, [
            {value: {category: 'user', data: {role: 'unknown', name: 'test'}}, valid: false, path: 'root.data'},
            {value: {category: 'item', data: {kind: 'unknown', value: 123}}, valid: false, path: 'root.data'},
            {value: {category: 'unknown', data: {}}, valid: false, issue: IsDiscriminatedErrors.unknownVariantError},
        ]);

        testStringify('stringifies nested discriminated unions', EntitySchema, [
            {value: {category: 'user', data: {role: 'admin', permissions: ['read']}}, expected: {category: 'user', data: {role: 'admin', permissions: ['read']}}},
            {value: {category: 'item', data: {kind: 'product', price: 50}}, expected: {category: 'item', data: {kind: 'product', price: 50}}},
        ]);

        it('strips extra properties from nested discriminated unions', () => {
            const issues = new GGIssuesList();
            const input = {
                category: 'user',
                data: {role: 'admin', permissions: ['read'], EXTRA: 'stripped'},
                OUTER_EXTRA: 'also stripped'
            };
            const result = EntitySchema._parse(input, issues, '');
            expect(issues.length).toBe(0);
            expect(result).toEqual({category: 'user', data: {role: 'admin', permissions: ['read']}});
        });
    });

    // ==================== Recursive Discriminated Union ====================

    describe('recursive discriminated union', () => {
        // Tree structure: leaf nodes have values, branch nodes have children
        type TreeNode = { type: 'leaf'; value: number } | { type: 'branch'; children: TreeNode[] };

        const TreeNodeSchema: DiscriminatedSchema<TreeNode> = IsDiscriminated('type', {
            leaf: IsObject({type: 'leaf' as const, value: IsNumber}),
            branch: IsObject(() => ({
                type: 'branch' as const,
                children: IsArray(TreeNodeSchema)
            }))
        });

        it('validates leaf nodes', () => {
            expect(TreeNodeSchema.is({type: 'leaf', value: 42})).toBe(true);
            expect(TreeNodeSchema.is({type: 'leaf', value: 'not a number'})).toBe(false);
        });

        it('validates branch nodes with leaf children', () => {
            const branch = {
                type: 'branch',
                children: [
                    {type: 'leaf', value: 1},
                    {type: 'leaf', value: 2}
                ]
            };
            expect(TreeNodeSchema.is(branch)).toBe(true);
        });

        it('validates deeply nested tree', () => {
            const deepTree = {
                type: 'branch',
                children: [
                    {type: 'leaf', value: 1},
                    {
                        type: 'branch',
                        children: [
                            {type: 'leaf', value: 2},
                            {
                                type: 'branch',
                                children: [{type: 'leaf', value: 3}]
                            }
                        ]
                    }
                ]
            };
            expect(TreeNodeSchema.is(deepTree)).toBe(true);
        });

        it('rejects invalid nested nodes', () => {
            const invalidTree = {
                type: 'branch',
                children: [
                    {type: 'leaf', value: 1},
                    {type: 'invalid', data: 'wrong'}
                ]
            };
            expect(TreeNodeSchema.is(invalidTree)).toBe(false);
        });

        it('parses and strips extra properties recursively', () => {
            const issues = new GGIssuesList();
            const input = {
                type: 'branch',
                children: [
                    {type: 'leaf', value: 1, EXTRA: 'stripped'},
                    {
                        type: 'branch',
                        children: [{type: 'leaf', value: 2, NESTED_EXTRA: 'also stripped'}],
                        BRANCH_EXTRA: 'stripped too'
                    }
                ],
                ROOT_EXTRA: 'stripped'
            };
            const result = TreeNodeSchema._parse(input, issues, '');
            expect(issues.length).toBe(0);
            expect(result).toEqual({
                type: 'branch',
                children: [
                    {type: 'leaf', value: 1},
                    {type: 'branch', children: [{type: 'leaf', value: 2}]}
                ]
            });
        });

        it('stringifies recursive structure', () => {
            const tree = {
                type: 'branch',
                children: [
                    {type: 'leaf', value: 1},
                    {type: 'branch', children: [{type: 'leaf', value: 2}]}
                ]
            };
            const result = TreeNodeSchema.stringify(tree as TreeNode);
            expect(JSON.parse(result!)).toEqual(tree);
        });
    });

    // ==================== Recursive via IsDiscriminated Factory ====================

    describe('recursive discriminated union via factory', () => {
        // Expression AST: literals or binary operations
        type Expr =
            | { kind: 'literal'; value: number }
            | { kind: 'binary'; op: string; left: Expr; right: Expr };

        // Using IsDiscriminated factory for full lazy resolution
        const ExprSchema: DiscriminatedSchema<Expr> = IsDiscriminated('kind', () => ({
            literal: IsObject({kind: 'literal' as const, value: IsNumber}),
            binary: IsObject({
                kind: 'binary' as const,
                op: IsString,
                left: ExprSchema,
                right: ExprSchema
            })
        }));

        it('validates literal expression', () => {
            expect(ExprSchema.is({kind: 'literal', value: 42})).toBe(true);
        });

        it('validates simple binary expression', () => {
            const expr: Expr = {
                kind: 'binary',
                op: '+',
                left: {kind: 'literal', value: 1},
                right: {kind: 'literal', value: 2}
            };
            expect(ExprSchema.is(expr)).toBe(true);
        });

        it('validates nested binary expression', () => {
            const expr: Expr = {
                kind: 'binary',
                op: '*',
                left: {
                    kind: 'binary',
                    op: '+',
                    left: {kind: 'literal', value: 1},
                    right: {kind: 'literal', value: 2}
                },
                right: {kind: 'literal', value: 3}
            };
            expect(ExprSchema.is(expr)).toBe(true);
        });

        it('rejects invalid expression kind', () => {
            expect(ExprSchema.is({kind: 'unknown', data: 123})).toBe(false);
        });

        it('rejects invalid nested expression', () => {
            const invalid = {
                kind: 'binary',
                op: '+',
                left: {kind: 'literal', value: 1},
                right: {kind: 'invalid', x: 2}
            };
            expect(ExprSchema.is(invalid)).toBe(false);
        });

        it('parses and strips extra properties', () => {
            const issues = new GGIssuesList();
            const input = {
                kind: 'binary',
                op: '+',
                left: {kind: 'literal', value: 1, EXTRA: 'stripped'},
                right: {kind: 'literal', value: 2, ALSO_EXTRA: 'stripped'},
                ROOT_EXTRA: 'stripped'
            };
            const result = ExprSchema._parse(input, issues, '');
            expect(issues.length).toBe(0);
            expect(result).toEqual({
                kind: 'binary',
                op: '+',
                left: {kind: 'literal', value: 1},
                right: {kind: 'literal', value: 2}
            });
        });

        it('stringifies expression tree', () => {
            const expr: Expr = {
                kind: 'binary',
                op: '+',
                left: {kind: 'literal', value: 1},
                right: {kind: 'literal', value: 2}
            };
            const result = ExprSchema.stringify(expr);
            expect(JSON.parse(result!)).toEqual(expr);
        });
    });

    // ==================== Field Defaults in Variants ====================

    describe('field defaults in variants', () => {
        const UserWithDefaults = IsObject({
            type: 'user' as const,
            name: IsString,
            bio: IsString.orNull.default(""),
        });
        const AdminWithDefaults = IsObject({
            type: 'admin' as const,
            name: IsString,
            level: IsNumber,
            notes: IsString.orUndefined.default("none"),
        });
        const SchemaWithDefaults = IsDiscriminated('type', {
            user: UserWithDefaults,
            admin: AdminWithDefaults,
        });

        it('applies default in user variant', () => {
            const issues = new GGIssuesList();
            const result = SchemaWithDefaults._parse({type: "user", name: "John", bio: null}, issues, 'test', true);
            expect(issues.length).toBe(0);
            expect(result).toStrictEqual({type: "user", name: "John", bio: ""});
        });

        it('applies default in admin variant', () => {
            const issues = new GGIssuesList();
            const result = SchemaWithDefaults._parse({type: "admin", name: "Jane", level: 5}, issues, 'test', true);
            expect(issues.length).toBe(0);
            expect(result).toStrictEqual({type: "admin", name: "Jane", level: 5, notes: "none"});
        });

        it('preserves actual value over default', () => {
            const issues = new GGIssuesList();
            const result = SchemaWithDefaults._parse({type: "user", name: "John", bio: "hello"}, issues, 'test');
            expect(issues.length).toBe(0);
            expect(result).toStrictEqual({type: "user", name: "John", bio: "hello"});
        });

        it('rejects unknown discriminator even with defaults in variants', () => {
            const issues = new GGIssuesList();
            const result = SchemaWithDefaults._parse({type: "guest", name: "Bob"}, issues, 'test');
            expect(result).toBeUndefined();
            expect(issues.getIssue(0)?.code).toBe(IsDiscriminatedErrors.unknownVariantError.code);
        });

        it('rejects non-object input even with defaults in variants', () => {
            const issues = new GGIssuesList();
            const result = SchemaWithDefaults._parse(42, issues, 'test');
            expect(result).toBeUndefined();
            expect(issues.getIssue(0)?.code).toBe(IsDiscriminatedErrors.notObjectError.code);
        });

        it('rejects null input even with defaults in variants', () => {
            const issues = new GGIssuesList();
            const result = SchemaWithDefaults._parse(null, issues, 'test');
            expect(result).toBeUndefined();
            expect(issues.getIssue(0)?.code).toBe(GGIssueKey.required.code);
        });

        it('parse result always passes is()', () => {
            const inputs: Record<string, unknown>[] = [
                {type: "user", name: "John", bio: null},
                {type: "user", name: "John", bio: "hello"},
                {type: "admin", name: "Jane", level: 5},
                {type: "admin", name: "Jane", level: 5, notes: undefined},
                {type: "admin", name: "Jane", level: 5, notes: "important"},
            ];
            for (const input of inputs) {
                const issues = new GGIssuesList();
                const result = SchemaWithDefaults._parse(input, issues, 'test', true);
                expect(issues.length).toBe(0);
                expect(SchemaWithDefaults.is(result)).toBe(true);
            }
        });

        it('is() checks values as-is, ignoring defaults', () => {
            // is() should reflect the schema constraints, not the parse-time defaults
            // bio is .orNull → null is valid for is()
            expect(SchemaWithDefaults.is({type: "user", name: "John", bio: null})).toBe(true);
            // notes is .orUndefined → undefined is valid, missing key means undefined
            expect(SchemaWithDefaults.is({type: "admin", name: "Jane", level: 5})).toBe(true);
            // wrong type for bio → invalid regardless of default
            expect(SchemaWithDefaults.is({type: "user", name: "John", bio: 123})).toBe(false);
        });

        it('default does not rescue wrong-type value in variant', () => {
            const issues = new GGIssuesList();
            const result = SchemaWithDefaults._parse({type: "user", name: "John", bio: 42}, issues, 'test');
            expect(result).toBeUndefined();
            expect(issues.length).toBeGreaterThan(0);
        });
    });

    // ==================== Variant Refinements with Defaults ====================

    describe('variant refinements with defaults', () => {
        const UserWithRefineAndDefault = IsObject({
            type: 'user' as const,
            name: IsString,
            code: IsString.orNull.default("AUTO"),
        }).refine(obj => obj.code.length >= 3, testCodeMinError);

        const AdminWithRefineAndDefault = IsObject({
            type: 'admin' as const,
            name: IsString,
            level: IsNumber,
            region: IsString.orUndefined.default("global"),
        }).refine(obj => obj.level > 0 || obj.region === "global", testAdminRefineError);

        const Schema = IsDiscriminated('type', {
            user: UserWithRefineAndDefault,
            admin: AdminWithRefineAndDefault,
        });

        it('variant refinement sees defaulted value', () => {
            // code is null → default "AUTO" → refinement sees "AUTO".length >= 3 → pass
            const issues = new GGIssuesList();
            const result = Schema._parse({type: "user", name: "John", code: null}, issues, 'test', true);
            expect(issues.length).toBe(0);
            expect(result).toStrictEqual({type: "user", name: "John", code: "AUTO"});
        });

        it('variant refinement fails on defaulted value when appropriate', () => {
            // region defaults to "global", level is 0 → refinement: 0 > 0 || "global" === "global" → pass
            const issues1 = new GGIssuesList();
            const result1 = Schema._parse({type: "admin", name: "Jane", level: 0}, issues1, 'test', true);
            expect(issues1.length).toBe(0);
            expect(result1).toStrictEqual({type: "admin", name: "Jane", level: 0, region: "global"});

            // region is explicit "local", level is 0 → refinement: 0 > 0 || "local" === "global" → fail
            const issues2 = new GGIssuesList();
            const result2 = Schema._parse({type: "admin", name: "Jane", level: 0, region: "local"}, issues2, 'test');
            expect(result2).toBeUndefined();
            expect(issues2.length).toBeGreaterThan(0);
        });

        it('variant refinement passes on explicit value', () => {
            // code is explicitly "XYZ" → no default → refinement: "XYZ".length >= 3 → pass
            const issues = new GGIssuesList();
            const result = Schema._parse({type: "user", name: "John", code: "XYZ"}, issues, 'test');
            expect(issues.length).toBe(0);
            expect(result).toStrictEqual({type: "user", name: "John", code: "XYZ"});
        });

        it('variant refinement fails on explicit short value', () => {
            // code is "AB" → refinement: "AB".length >= 3 → fail
            const issues = new GGIssuesList();
            const result = Schema._parse({type: "user", name: "John", code: "AB"}, issues, 'test');
            expect(result).toBeUndefined();
            expect(issues.length).toBeGreaterThan(0);
        });

        it('parse result with variant refinement + defaults passes is()', () => {
            const inputs: Record<string, unknown>[] = [
                {type: "user", name: "John", code: null},
                {type: "user", name: "John", code: "HELLO"},
                {type: "admin", name: "Jane", level: 5},
                {type: "admin", name: "Jane", level: 0, region: "global"},
            ];
            for (const input of inputs) {
                const issues = new GGIssuesList();
                const result = Schema._parse(input, issues, 'test', true);
                expect(issues.length).toBe(0);
                expect(Schema.is(result)).toBe(true);
            }
        });
    });
});
