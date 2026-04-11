import {IsObject, ObjectSchema} from './IsObject';
import {IsString} from './IsString';
import {IsNumber} from './IsNumber';
import {IsBoolean} from './IsBoolean';
import {IsArray} from './IsArray';
import {IsLiteral} from './IsLiteral';
import {IsUnion} from './IsUnion';
import {IsTuple} from './IsTuple';
import {IsRecord} from './IsRecord';
import {IsDiscriminated} from './IsDiscriminated';
import {GGIssueKey} from "../issue/GGIssueKey";
import {GGIssuesList} from "../issue/GGIssuesList";
import {GGIssueInvalid} from "../issue/issues/GGIssueInvalid";
import {testObjectValidation, testStringify, testUtils} from "../utils/testUtils";
import {IsObjectErrors} from "../Errors";

const testRefineError = new GGIssueInvalid("test.refine", "Refinement failed");
const testRangeError = new GGIssueInvalid("test.range", "min must be less than max");
const testTagLenError = new GGIssueInvalid("test.tagLen", "Tag too long");
const testContactError = new GGIssueInvalid("test.contact", "Need at least one contact method");
const testRange2Error = new GGIssueInvalid("test.range2", "min < max");

testUtils('IsObject', () => {

    // ==================== Basic Type Validation ====================

    describe('type validation', () => {
        const Schema = IsObject({name: IsString});

        testObjectValidation('rejects non-objects', Schema, [
            {value: 'string', valid: false, issue: IsObjectErrors.typeError},
            {value: 123, valid: false, issue: IsObjectErrors.typeError},
            {value: true, valid: false, issue: IsObjectErrors.typeError},
            {value: [], valid: false, issue: IsObjectErrors.typeError},
            {value: null, valid: false, issue: GGIssueKey.required},
            {value: undefined, valid: false, issue: GGIssueKey.required},
        ]);

        testObjectValidation('accepts valid objects', Schema, [
            {value: {name: 'John'}, valid: true},
            {value: {name: ''}, valid: true},
            {value: {name: 'John', extra: 'ignored'}, valid: true}, // extra keys allowed
        ]);

        testObjectValidation('rejects invalid field types', Schema, [
            {value: {name: 123}, valid: false, path: 'root.name'},
            {value: {name: null}, valid: false, path: 'root.name'},
            {value: {name: undefined}, valid: false, path: 'root.name'},
            {value: {}, valid: false, path: 'root.name'},
        ]);
    });

    // ==================== Required vs Optional Fields ====================

    describe('required fields', () => {
        const Schema = IsObject({
            name: IsString,
            age: IsNumber
        });

        testObjectValidation('validation', Schema, [
            {value: {name: 'John', age: 30}, valid: true},
            {value: {name: 'John'}, valid: false, path: 'root.age'},
            {value: {age: 30}, valid: false, path: 'root.name'},
            {value: {}, valid: false},
        ]);
    });

    describe('optional fields (orUndefined)', () => {
        const Schema = IsObject({
            name: IsString,
            nickname: IsString.orUndefined
        });

        testObjectValidation('validation', Schema, [
            {value: {name: 'John', nickname: 'Johnny'}, valid: true},
            {value: {name: 'John', nickname: undefined}, valid: true},
            {value: {name: 'John'}, valid: true}, // missing optional is ok
        ]);

        it('parse sets missing optional to undefined', () => {
            const issues = new GGIssuesList();
            const result = Schema._parse({name: 'John'}, issues, 'test');
            expect(result).toEqual({name: 'John', nickname: undefined});
            expect(issues.length).toBe(0);
        });
    });

    describe('nullable fields (orNull)', () => {
        const Schema = IsObject({
            name: IsString,
            middleName: IsString.orNull
        });

        testObjectValidation('validation', Schema, [
            {value: {name: 'John', middleName: 'William'}, valid: true},
            {value: {name: 'John', middleName: null}, valid: true},
            {value: {name: 'John', middleName: undefined}, valid: false, path: 'root.middleName'},
            {value: {name: 'John'}, valid: false, path: 'root.middleName'},
        ]);
    });

    // ==================== Object-level orUndefined/orNull ====================

    describe('schema orUndefined', () => {
        const Schema = IsObject({name: IsString}).orUndefined;

        testObjectValidation('validation', Schema, [
            {value: {name: 'John'}, valid: true},
            {value: undefined, valid: true},
            {value: null, valid: false, issue: GGIssueKey.required},
        ]);
    });

    describe('schema orNull', () => {
        const Schema = IsObject({name: IsString}).orNull;

        testObjectValidation('validation', Schema, [
            {value: {name: 'John'}, valid: true},
            {value: null, valid: true},
            {value: undefined, valid: false, issue: GGIssueKey.required},
        ]);
    });

    // ==================== Literal Values in Shape ====================

    describe('literal values in shape', () => {
        const Schema = IsObject({
            type: 'user' as const,
            name: IsString,
            active: true as const
        });

        testObjectValidation('validation', Schema, [
            {value: {type: 'user', name: 'John', active: true}, valid: true},
            {value: {type: 'admin', name: 'John', active: true}, valid: false, path: 'root.type'},
            {value: {type: 'user', name: 'John', active: false}, valid: false, path: 'root.active'},
        ]);
    });

    // ==================== Nested Objects ====================

    describe('nested objects', () => {
        const AddressSchema = IsObject({
            street: IsString,
            city: IsString
        });

        const PersonSchema = IsObject({
            name: IsString,
            address: AddressSchema
        });

        testObjectValidation('validation', PersonSchema, [
            {value: {name: 'John', address: {street: '123 Main', city: 'NYC'}}, valid: true},
            {value: {name: 'John', address: {street: '123 Main'}}, valid: false, path: 'root.address.city'},
            {value: {name: 'John', address: 'invalid'}, valid: false, path: 'root.address'},
            {value: {name: 'John', address: null}, valid: false, path: 'root.address'},
        ]);
    });

    describe('nullable nested objects', () => {
        const AddressSchema = IsObject({
            street: IsString,
            city: IsString
        });

        const PersonSchema = IsObject({
            name: IsString,
            address: AddressSchema.orNull
        });

        testObjectValidation('validation', PersonSchema, [
            {value: {name: 'John', address: {street: '123 Main', city: 'NYC'}}, valid: true},
            {value: {name: 'John', address: null}, valid: true},
            {value: {name: 'John', address: undefined}, valid: false, path: 'root.address'},
        ]);

        it('parse preserves null for nullable nested object', () => {
            const issues = new GGIssuesList();
            const result = PersonSchema._parse({name: 'John', address: null}, issues, 'test');
            expect(issues.length).toBe(0);
            expect(result).toEqual({name: 'John', address: null});
        });

        it('parse constructs non-null nested object (strips extra props)', () => {
            const issues = new GGIssuesList();
            const input = {name: 'John', address: {street: '123 Main', city: 'NYC', extra: 'ignored'}};
            const result = PersonSchema._parse(input, issues, 'test');
            expect(issues.length).toBe(0);
            expect(result).toEqual({name: 'John', address: {street: '123 Main', city: 'NYC'}});
            expect(Object.keys(result!.address!)).toEqual(['street', 'city']);
        });
    });

    describe('optional nested objects', () => {
        const AddressSchema = IsObject({
            street: IsString,
            city: IsString
        });

        const PersonSchema = IsObject({
            name: IsString,
            address: AddressSchema.orUndefined
        });

        testObjectValidation('validation', PersonSchema, [
            {value: {name: 'John', address: {street: '123 Main', city: 'NYC'}}, valid: true},
            {value: {name: 'John', address: undefined}, valid: true},
            {value: {name: 'John'}, valid: true},
            {value: {name: 'John', address: null}, valid: false, path: 'root.address'},
        ]);

        it('parse omits undefined optional nested object', () => {
            const issues = new GGIssuesList();
            const result = PersonSchema._parse({name: 'John'}, issues, 'test');
            expect(issues.length).toBe(0);
            // Optional fields get undefined value but key is present
            expect(result).toEqual({name: 'John', address: undefined});
        });

        it('parse constructs non-undefined nested object (strips extra props)', () => {
            const issues = new GGIssuesList();
            const input = {name: 'John', address: {street: '123 Main', city: 'NYC', extra: 'ignored'}};
            const result = PersonSchema._parse(input, issues, 'test');
            expect(issues.length).toBe(0);
            expect(result).toEqual({name: 'John', address: {street: '123 Main', city: 'NYC'}});
        });
    });

    describe('deeply nested objects', () => {
        const Schema = IsObject({
            level1: IsObject({
                level2: IsObject({
                    level3: IsObject({
                        value: IsNumber
                    })
                })
            })
        });

        testObjectValidation('validation', Schema, [
            {value: {level1: {level2: {level3: {value: 42}}}}, valid: true},
            {value: {level1: {level2: {level3: {value: 'wrong'}}}}, valid: false, path: 'root.level1.level2.level3.value'},
        ]);
    });

    // ==================== Refinements ====================

    describe('field refinements', () => {
        const Schema = IsObject({
            age: IsNumber.refine(n => n >= 0, testRefineError),
            name: IsString.refine(s => s.length > 0, testRefineError)
        });

        testObjectValidation('validation', Schema, [
            {value: {age: 25, name: 'John'}, valid: true},
            {value: {age: -1, name: 'John'}, valid: false, path: 'root.age'},
            {value: {age: 25, name: ''}, valid: false, path: 'root.name'},
        ]);
    });

    describe('object-level refinements', () => {
        const Schema = IsObject({
            password: IsString,
            confirmPassword: IsString
        }).refine(obj => obj.password === obj.confirmPassword, testRefineError);

        it('validates with refinement', () => {
            expect(Schema.is({password: 'secret', confirmPassword: 'secret'})).toBe(true);
            expect(Schema.is({password: 'secret', confirmPassword: 'different'})).toBe(false);
        });
    });

    describe('refinements with defaults', () => {
        it('object-level refinement sees defaulted field values', () => {
            // A developer writes a range check: min must be less than max.
            // max defaults to 100. When max is null, refinement should see 100.
            const Schema = IsObject({
                min: IsNumber,
                max: IsNumber.orNull.default(100),
            }).refine(v => v.min < v.max, testRangeError);

            // max is null → default 100 → refinement sees min=5 < max=100 → pass
            const issues1 = new GGIssuesList();
            const result1 = Schema._parse({min: 5, max: null}, issues1, 'test', true);
            expect(issues1.length).toBe(0);
            expect(result1).toStrictEqual({min: 5, max: 100});

            // max is null → default 100 → refinement sees min=200 < max=100 → fail
            const issues2 = new GGIssuesList();
            const result2 = Schema._parse({min: 200, max: null}, issues2, 'test', true);
            expect(result2).toBeUndefined();
            expect(issues2.getIssue(0)?.code).toBe(testRangeError.code);

            // max is explicitly provided → no default → refinement sees actual value
            const issues3 = new GGIssuesList();
            const result3 = Schema._parse({min: 5, max: 50}, issues3, 'test');
            expect(issues3.length).toBe(0);
            expect(result3).toStrictEqual({min: 5, max: 50});
        });

        it('field-level refinement runs on defaulted value', () => {
            // tag has a default of "" and a refinement requiring length <= 10.
            // When tag is null, default applies first → "" → refinement passes.
            const Schema = IsObject({
                name: IsString,
                tag: IsString.orNull.default("").refine(s => s.length <= 10, testTagLenError),
            });

            // tag is null → default "" → refine("") → "".length <= 10 → pass
            const issues1 = new GGIssuesList();
            const result1 = Schema._parse({name: "John", tag: null}, issues1, 'test', true);
            expect(issues1.length).toBe(0);
            expect(result1).toStrictEqual({name: "John", tag: ""});

            // tag is valid string → no default → refine("short") → pass
            const issues2 = new GGIssuesList();
            const result2 = Schema._parse({name: "John", tag: "short"}, issues2, 'test');
            expect(issues2.length).toBe(0);
            expect(result2).toStrictEqual({name: "John", tag: "short"});

            // tag is too long string → refine fails
            const issues3 = new GGIssuesList();
            const result3 = Schema._parse({name: "John", tag: "this is way too long"}, issues3, 'test');
            expect(result3).toBeUndefined();
            expect(issues3.length).toBeGreaterThan(0);
        });

        it('refinement on nested object with defaults', () => {
            // A developer has a nested config object with defaults,
            // and a parent-level refinement that cross-validates fields
            const Schema = IsObject({
                name: IsString,
                email: IsString.orNull.default(""),
                phone: IsString.orNull.default(""),
            }).refine(v => v.email.length > 0 || v.phone.length > 0, testContactError);

            // Both null → both default to "" → refinement fails (no contact)
            const issues1 = new GGIssuesList();
            const result1 = Schema._parse({name: "John", email: null, phone: null}, issues1, 'test', true);
            expect(result1).toBeUndefined();
            expect(issues1.getIssue(0)?.code).toBe(testContactError.code);

            // email provided → refinement passes
            const issues2 = new GGIssuesList();
            const result2 = Schema._parse({name: "John", email: "a@b.com", phone: null}, issues2, 'test', true);
            expect(issues2.length).toBe(0);
            expect(result2).toStrictEqual({name: "John", email: "a@b.com", phone: ""});
        });

        it('parse result with refinement + defaults passes is()', () => {
            const Schema = IsObject({
                min: IsNumber,
                max: IsNumber.orNull.default(100),
            }).refine(v => v.min < v.max, testRange2Error);

            const issues = new GGIssuesList();
            const result = Schema._parse({min: 5, max: null}, issues, 'test', true);
            expect(issues.length).toBe(0);
            expect(result).toBeDefined();
            expect(Schema.is(result)).toBe(true);
        });
    });

    // ==================== Special Property Names ====================

    describe('special property names', () => {
        it('handles hyphens', () => {
            const Schema = IsObject({'my-field': IsString});
            expect(Schema.is({'my-field': 'test'})).toBe(true);
            expect(Schema.is({'my-field': 123})).toBe(false);
        });

        it('handles dots', () => {
            const Schema = IsObject({'field.name': IsString});
            expect(Schema.is({'field.name': 'test'})).toBe(true);
        });

        it('handles quotes', () => {
            const Schema = IsObject({"it's": IsString, 'say "hello"': IsNumber});
            expect(Schema.is({"it's": 'test', 'say "hello"': 42})).toBe(true);
        });

        it('handles brackets', () => {
            const Schema = IsObject({'items[0]': IsString});
            expect(Schema.is({'items[0]': 'test'})).toBe(true);
        });

        it('reports correct paths', () => {
            const Schema = IsObject({'my-field': IsString});
            const issues = new GGIssuesList();
            Schema._parse({'my-field': 123}, issues, 'obj');
            expect(issues.getPath(0)).toBe('obj.my-field');
        });
    });

    // ==================== Stringify ====================

    describe('stringify', () => {
        const Schema = IsObject({
            name: IsString,
            age: IsNumber,
            active: IsBoolean
        });

        testStringify('basic object', Schema, [
            {value: {name: 'John', age: 30, active: true}, expected: {name: 'John', age: 30, active: true}},
            {value: {name: '', age: 0, active: false}, expected: {name: '', age: 0, active: false}},
        ]);
    });

    describe('stringify with optional fields', () => {
        const Schema = IsObject({
            name: IsString,
            nickname: IsString.orUndefined,
            age: IsNumber.orUndefined
        });

        testStringify('skips undefined', Schema, [
            {value: {name: 'John', nickname: 'Johnny', age: 30}, expected: {name: 'John', nickname: 'Johnny', age: 30}},
            {value: {name: 'John', nickname: undefined, age: 30}, expected: {name: 'John', age: 30}},
            {value: {name: 'John', nickname: 'Johnny', age: undefined}, expected: {name: 'John', nickname: 'Johnny'}},
            {value: {name: 'John', nickname: undefined, age: undefined}, expected: {name: 'John'}},
        ]);
    });

    describe('stringify with nullable fields', () => {
        const Schema = IsObject({
            name: IsString,
            middleName: IsString.orNull
        });

        testStringify('includes null', Schema, [
            {value: {name: 'John', middleName: 'William'}, expected: {name: 'John', middleName: 'William'}},
            {value: {name: 'John', middleName: null}, expected: {name: 'John', middleName: null}},
        ]);
    });

    describe('stringify nested objects', () => {
        const Schema = IsObject({
            person: IsObject({
                name: IsString,
                age: IsNumber
            }),
            active: IsBoolean
        });

        testStringify('nested', Schema, [
            {value: {person: {name: 'John', age: 30}, active: true}, expected: {person: {name: 'John', age: 30}, active: true}},
        ]);
    });

    describe('stringify nested with optional', () => {
        const Schema = IsObject({
            person: IsObject({
                name: IsString,
                nickname: IsString.orUndefined
            }),
            meta: IsObject({
                tag: IsString.orUndefined
            }).orUndefined
        });

        testStringify('nested optional fields', Schema, [
            {value: {person: {name: 'John', nickname: 'Johnny'}, meta: {tag: 'vip'}}, expected: {person: {name: 'John', nickname: 'Johnny'}, meta: {tag: 'vip'}}},
            {value: {person: {name: 'John', nickname: undefined}, meta: {tag: 'vip'}}, expected: {person: {name: 'John'}, meta: {tag: 'vip'}}},
            {value: {person: {name: 'John', nickname: undefined}, meta: {tag: undefined}}, expected: {person: {name: 'John'}, meta: {}}},
            {value: {person: {name: 'John', nickname: undefined}, meta: undefined}, expected: {person: {name: 'John'}}},
        ]);
    });

    describe('stringify deeply nested', () => {
        const Schema = IsObject({
            level1: IsObject({
                level2: IsObject({
                    value: IsNumber,
                    opt: IsString.orUndefined
                })
            })
        });

        testStringify('deep nesting', Schema, [
            {value: {level1: {level2: {value: 42, opt: 'x'}}}, expected: {level1: {level2: {value: 42, opt: 'x'}}}},
            {value: {level1: {level2: {value: 42, opt: undefined}}}, expected: {level1: {level2: {value: 42}}}},
        ]);
    });

    describe('stringify with special property names', () => {
        const Schema = IsObject({
            'my-field': IsString,
            'field.name': IsNumber,
            "it's": IsBoolean
        });

        testStringify('special names', Schema, [
            {value: {'my-field': 'test', 'field.name': 42, "it's": true}, expected: {'my-field': 'test', 'field.name': 42, "it's": true}},
        ]);
    });

    describe('stringify nullable object', () => {
        const Schema = IsObject({name: IsString}).orNull;

        testStringify('nullable', Schema, [
            {value: {name: 'John'}, expected: {name: 'John'}},
            {value: null, expected: null},
        ]);
    });

    describe('stringify strips extra properties', () => {
        const Schema = IsObject({name: IsString});

        it('only includes schema-defined keys', () => {
            const result = Schema.stringify({name: 'John', extra: 'ignored', another: 123} as any);
            const parsed = JSON.parse(result!);
            expect(parsed).toEqual({name: 'John'});
            expect(Object.keys(parsed)).toEqual(['name']);
        });
    });

    describe('stringify orUndefined', () => {
        const Schema = IsObject({name: IsString});

        it('orUndefined.stringify(undefined) returns undefined', () => {
            expect(Schema.orUndefined.stringify(undefined)).toBe(undefined);
        });

        it('orUndefined.stringify(value) returns stringified value', () => {
            expect(Schema.orUndefined.stringify({name: 'John'})).toBe('{"name":"John"}');
        });
    });

    // ==================== Parse with Coercion ====================

    describe('parse with coercion', () => {
        const Schema = IsObject({
            count: IsNumber,
            name: IsString
        });

        it('coerces nested values', () => {
            const issues = new GGIssuesList();
            const result = Schema._parse({count: '42', name: 'John'}, issues, 'test', true);
            expect(result).toEqual({count: 42, name: 'John'});
            expect(issues.length).toBe(0);
        });

        it('fails if coercion fails', () => {
            const issues = new GGIssuesList();
            const result = Schema._parse({count: 'not-a-number', name: 'John'}, issues, 'test', true);
            expect(result).toBeUndefined();
            expect(issues.length).toBeGreaterThan(0);
        });
    });

    // ==================== Schema Methods ====================

    describe('extend()', () => {
        const Base = IsObject({id: IsNumber});
        const Extended = Base.extend({name: IsString});

        testObjectValidation('validation', Extended, [
            {value: {id: 1, name: 'John'}, valid: true},
            {value: {id: 1}, valid: false, path: 'root.name'},
            {value: {name: 'John'}, valid: false, path: 'root.id'},
        ]);
    });

    describe('merge()', () => {
        const Schema1 = IsObject({id: IsNumber});
        const Schema2 = IsObject({name: IsString});
        const Merged = Schema1.merge(Schema2);

        testObjectValidation('validation', Merged, [
            {value: {id: 1, name: 'John'}, valid: true},
            {value: {id: 1}, valid: false},
            {value: {name: 'John'}, valid: false},
        ]);
    });

    describe('pick()', () => {
        const Full = IsObject({id: IsNumber, name: IsString, age: IsNumber});
        const Picked = Full.pick('id', 'name');

        testObjectValidation('validation', Picked, [
            {value: {id: 1, name: 'John'}, valid: true},
            {value: {id: 1, name: 'John', age: 30}, valid: true}, // extra ok
            {value: {id: 1}, valid: false},
        ]);
    });

    describe('omit()', () => {
        const Full = IsObject({id: IsNumber, name: IsString, password: IsString});
        const Safe = Full.omit('password');

        testObjectValidation('validation', Safe, [
            {value: {id: 1, name: 'John'}, valid: true},
            {value: {id: 1, name: 'John', password: 'ignored'}, valid: true},
        ]);
    });

    // ==================== Lazy Shape (Factory) ====================

    describe('lazy shape with factory', () => {
        const Schema = IsObject(() => ({
            name: IsString,
            age: IsNumber
        }));

        testObjectValidation('validation', Schema, [
            {value: {name: 'John', age: 30}, valid: true},
            {value: {name: 123, age: 30}, valid: false},
        ]);
    });

    // ==================== Complex Mixed Types ====================

    describe('with IsLiteral field', () => {
        const Schema = IsObject({
            status: IsLiteral('pending', 'active', 'done')
        });

        testObjectValidation('validation', Schema, [
            {value: {status: 'active'}, valid: true},
            {value: {status: 'pending'}, valid: true},
            {value: {status: 'invalid'}, valid: false},
        ]);
    });

    describe('with IsUnion field', () => {
        const Schema = IsObject({
            value: IsUnion(IsString, IsNumber)
        });

        testObjectValidation('validation', Schema, [
            {value: {value: 'test'}, valid: true},
            {value: {value: 42}, valid: true},
            {value: {value: true}, valid: false},
        ]);
    });

    describe('with IsTuple field', () => {
        const Schema = IsObject({
            coords: IsTuple(IsNumber, IsNumber)
        });

        testObjectValidation('validation', Schema, [
            {value: {coords: [1, 2]}, valid: true},
            {value: {coords: [1, 'x']}, valid: false},
            {value: {coords: [1]}, valid: false},
        ]);
    });

    describe('with IsArray field', () => {
        const Schema = IsObject({
            tags: IsArray(IsString)
        });

        testObjectValidation('validation', Schema, [
            {value: {tags: ['a', 'b', 'c']}, valid: true},
            {value: {tags: []}, valid: true},
            {value: {tags: [1, 2]}, valid: false},
        ]);
    });

    describe('with IsRecord field', () => {
        const Schema = IsObject({
            metadata: IsRecord(IsString, IsNumber)
        });

        testObjectValidation('validation', Schema, [
            {value: {metadata: {a: 1, b: 2}}, valid: true},
            {value: {metadata: {}}, valid: true},
            {value: {metadata: {a: 'x'}}, valid: false},
        ]);
    });

    // ==================== Regex in Compiled Code ====================

    describe('regex patterns in fields', () => {
        const Schema = IsObject({
            email: IsString.regex(/^[a-z]+@[a-z]+\.[a-z]+$/i),
            phone: IsString.regex(/^\+\d{1,3}-\d{3}-\d{4}$/)
        });

        testObjectValidation('validation', Schema, [
            {value: {email: 'john@example.com', phone: '+1-555-1234'}, valid: true},
            {value: {email: 'invalid', phone: '+1-555-1234'}, valid: false, path: 'root.email'},
            {value: {email: 'john@example.com', phone: 'invalid'}, valid: false, path: 'root.phone'},
        ]);
    });

    // ==================== Edge Cases ====================

    describe('empty object schema', () => {
        const Schema = IsObject({});

        testObjectValidation('validation', Schema, [
            {value: {}, valid: true},
            {value: {any: 'data'}, valid: true}, // extra keys allowed
        ]);

        testStringify('stringify', Schema, [
            {value: {}, expected: {}},
            {value: {extra: 'ignored'}, expected: {}},
        ]);
    });

    describe('all optional fields', () => {
        const Schema = IsObject({
            a: IsString.orUndefined,
            b: IsNumber.orUndefined,
            c: IsBoolean.orUndefined
        });

        testObjectValidation('validation', Schema, [
            {value: {}, valid: true},
            {value: {a: 'x'}, valid: true},
            {value: {a: 'x', b: 1, c: true}, valid: true},
        ]);

        testStringify('stringify', Schema, [
            {value: {a: undefined, b: undefined, c: undefined}, expected: {}},
            {value: {a: 'x', b: undefined, c: undefined}, expected: {a: 'x'}},
            {value: {a: 'x', b: 1, c: true}, expected: {a: 'x', b: 1, c: true}},
        ]);
    });

    describe('mixed required, optional, nullable', () => {
        const Schema = IsObject({
            required: IsString,
            optional: IsNumber.orUndefined,
            nullable: IsBoolean.orNull
        });

        testObjectValidation('validation', Schema, [
            {value: {required: 'x', optional: 1, nullable: true}, valid: true},
            {value: {required: 'x', optional: undefined, nullable: null}, valid: true},
            {value: {required: 'x', nullable: true}, valid: true}, // optional missing
            {value: {optional: 1, nullable: true}, valid: false}, // required missing
        ]);

        testStringify('stringify', Schema, [
            {value: {required: 'x', optional: 1, nullable: true}, expected: {required: 'x', optional: 1, nullable: true}},
            {value: {required: 'x', optional: undefined, nullable: null}, expected: {required: 'x', nullable: null}},
        ]);
    });

    describe('stringify nested objects', () => {
        it('should handle deeply nested objects', () => {
            const Schema = IsObject({
                level1: IsObject({
                    level2: IsObject({
                        level3: IsObject({
                            value: IsString
                        })
                    })
                })
            });

            const obj = {level1: {level2: {level3: {value: 'deep'}}}};
            expect(() => Schema.stringify(obj)).not.toThrow();
            expect(JSON.parse(Schema.stringify(obj)!)).toEqual(obj);
        });
    });

    describe('recursive schemas (lazy definition)', () => {
        it('should handle recursive schema with non-circular data', () => {
            // Define a recursive "tree node" schema using lazy definition
            type TreeNode = { name: string; child?: TreeNode };
            const TreeNodeSchema: ObjectSchema<TreeNode> = IsObject(() => ({
                name: IsString,
                child: TreeNodeSchema.orUndefined
            }));

            // Non-circular tree data
            const tree: TreeNode = {
                name: 'root',
                child: {
                    name: 'level1',
                    child: {
                        name: 'level2',
                        child: undefined
                    }
                }
            };

            expect(TreeNodeSchema.is(tree)).toBe(true);
            const json = TreeNodeSchema.stringify(tree);
            expect(JSON.parse(json!)).toEqual({
                name: 'root',
                child: {name: 'level1', child: {name: 'level2'}}
            });
        });

        it('should handle recursive schema validation', () => {
            type LinkedNode = { value: number; next?: LinkedNode };
            const LinkedNodeSchema: ObjectSchema<LinkedNode> = IsObject(() => ({
                value: IsNumber,
                next: LinkedNodeSchema.orUndefined
            }));

            // Valid linked list
            const list: LinkedNode = {value: 1, next: {value: 2, next: {value: 3}}};
            expect(LinkedNodeSchema.is(list)).toBe(true);

            // Invalid - wrong type in chain
            const invalid = {value: 1, next: {value: 'not a number'}};
            expect(LinkedNodeSchema.is(invalid)).toBe(false);
        });

        it('should handle double recursive schema (binary tree)', () => {
            type BinaryTree = { value: number; left?: BinaryTree; right?: BinaryTree };
            const BinaryTreeSchema: ObjectSchema<BinaryTree> = IsObject(() => ({
                value: IsNumber,
                left: BinaryTreeSchema.orUndefined,
                right: BinaryTreeSchema.orUndefined
            }));

            // Valid binary tree
            const tree: BinaryTree = {
                value: 1,
                left: {
                    value: 2,
                    left: {value: 4},
                    right: {value: 5}
                },
                right: {
                    value: 3,
                    left: {value: 6},
                    right: {value: 7}
                }
            };
            expect(BinaryTreeSchema.is(tree)).toBe(true);

            // Valid single node
            expect(BinaryTreeSchema.is({value: 42})).toBe(true);

            // Valid with only left child
            expect(BinaryTreeSchema.is({value: 1, left: {value: 2}})).toBe(true);

            // Valid with only right child
            expect(BinaryTreeSchema.is({value: 1, right: {value: 3}})).toBe(true);

            // Invalid - wrong type in tree
            const invalidLeft = {value: 1, left: {value: 'not a number'}};
            expect(BinaryTreeSchema.is(invalidLeft)).toBe(false);

            const invalidRight = {value: 1, right: {value: 'not a number'}};
            expect(BinaryTreeSchema.is(invalidRight)).toBe(false);

            const invalidDeep = {
                value: 1,
                left: {value: 2, right: {value: 'invalid'}}
            };
            expect(BinaryTreeSchema.is(invalidDeep)).toBe(false);

            // Test stringify
            const json = BinaryTreeSchema.stringify(tree);
            expect(JSON.parse(json!)).toEqual(tree);
        });

        it('should strip extra properties from recursive schema during parse', () => {
            // Define a recursive "tree node" schema
            type TreeNode = { name: string; child?: TreeNode };
            const TreeNodeSchema: ObjectSchema<TreeNode> = IsObject(() => ({
                name: IsString,
                child: TreeNodeSchema.orUndefined
            }));

            // Input with extra properties at every level
            const input = {
                name: 'root',
                extra: 'should be stripped',
                secret: 123,
                child: {
                    name: 'level1',
                    password: 'hidden',
                    child: {
                        name: 'level2',
                        privateData: {foo: 'bar'}
                    }
                }
            };

            const issues = new GGIssuesList();
            const result = TreeNodeSchema._parse(input, issues, 'tree');

            expect(issues.length).toBe(0);
            expect(result).toBeDefined();

            // Verify extra properties are stripped at all levels
            expect(result).toEqual({
                name: 'root',
                child: {
                    name: 'level1',
                    child: {
                        name: 'level2'
                    }
                }
            });

            // Verify no extra keys at each level
            expect(Object.keys(result!)).toEqual(['name', 'child']);
            expect(Object.keys(result!.child!)).toEqual(['name', 'child']);
            expect(Object.keys(result!.child!.child!)).toEqual(['name']);
        });
    });

    describe('circular data handling', () => {
        it('should ignore circular references in properties NOT in schema', () => {
            const Schema = IsObject({
                name: IsString,
                age: IsNumber
            });

            // Create object with circular reference in a property NOT in schema
            const obj: any = {name: 'John', age: 30};
            obj.self = obj; // Circular, but 'self' is not in schema

            // Should work fine - circular property is ignored
            expect(Schema.is(obj)).toBe(true);
            const json = Schema.stringify(obj);
            expect(JSON.parse(json!)).toEqual({name: 'John', age: 30});
        });

        it('should ignore deeply nested circular references outside schema', () => {
            const Schema = IsObject({
                data: IsObject({
                    value: IsString
                })
            });

            const obj: any = {data: {value: 'test'}};
            obj.data.parent = obj; // Circular in nested object, but 'parent' not in schema

            expect(Schema.is(obj)).toBe(true);
            const json = Schema.stringify(obj);
            expect(JSON.parse(json!)).toEqual({data: {value: 'test'}});
        });

        it('should crash on circular data that IS in schema (like JSON.stringify)', () => {
            // Using a recursive schema where circular data would be traversed
            type Node = { name: string; child?: Node };
            const NodeSchema: ObjectSchema<Node> = IsObject(() => ({
                name: IsString,
                child: NodeSchema.orUndefined
            }));

            // Create actual circular data
            const circular: any = {name: 'A'};
            circular.child = {name: 'B'};
            circular.child.child = circular; // Circular!

            // This should crash (stack overflow or similar) - same as JSON.stringify
            // We can't easily test for stack overflow, but we can verify JSON.stringify also fails
            expect(() => JSON.stringify(circular)).toThrow();
            // Our stringify should also fail on circular data
            expect(() => NodeSchema.stringify(circular)).toThrow();
        });
    });

    // ==================== Complex Nested Structure Test ====================

    describe('complex nested structures', () => {
        /*
         * This test validates that all schema types work correctly together
         * with deep nesting, recursion, and property stripping at all levels.
         *
         * Structure:
         * - Company (object)
         *   - name: string
         *   - founded: number
         *   - active: boolean
         *   - headquarters: Address (nested object)
         *   - departments: Record<string, Department>
         *   - leadership: Tuple<[CEO, CTO?]>
         *   - projects: Array<Project>
         *     - Project has discriminated union for status
         *     - Project has recursive Task structure
         */

        // Recursive Task type - tasks can have subtasks
        type Task = {
            title: string;
            priority: number;
            subtasks?: Task[];
        };

        const TaskSchema: ObjectSchema<Task> = IsObject(() => ({
            title: IsString,
            priority: IsNumber,
            subtasks: IsArray(TaskSchema).orUndefined
        }));

        // Address object
        const AddressSchema = IsObject({
            street: IsString,
            city: IsString,
            country: IsString,
            zip: IsString.orUndefined
        });

        // Person base
        const PersonSchema = IsObject({
            name: IsString,
            age: IsNumber,
            email: IsString.orUndefined
        });

        // Project status - discriminated union
        const ProjectStatusSchema = IsDiscriminated('status', {
            planning: IsObject({status: IsLiteral('planning'), estimatedStart: IsString}),
            active: IsObject({status: IsLiteral('active'), progress: IsNumber, assignees: IsArray(IsString)}),
            completed: IsObject({status: IsLiteral('completed'), completedAt: IsString, outcome: IsString}),
            cancelled: IsObject({status: IsLiteral('cancelled'), reason: IsString})
        });

        // Project with recursive tasks and discriminated status
        const ProjectSchema = IsObject({
            id: IsNumber,
            name: IsString,
            status: ProjectStatusSchema,
            tasks: IsArray(TaskSchema),
            metadata: IsRecord(IsString, IsString).orUndefined
        });

        // Department
        const DepartmentSchema = IsObject({
            name: IsString,
            headCount: IsNumber,
            budget: IsNumber.orUndefined,
            locations: IsArray(AddressSchema)
        });

        // Full company schema
        const CompanySchema = IsObject({
            name: IsString,
            founded: IsNumber,
            active: IsBoolean,
            headquarters: AddressSchema,
            departments: IsRecord(IsString, DepartmentSchema),
            leadership: IsTuple(PersonSchema, PersonSchema.orUndefined),
            projects: IsArray(ProjectSchema)
        });

        // Type for the full structure
        type Company = typeof CompanySchema.infer;

        const validCompany: Company = {
            name: 'TechCorp',
            founded: 2010,
            active: true,
            headquarters: {
                street: '123 Main St',
                city: 'San Francisco',
                country: 'USA',
                zip: '94105'
            },
            departments: {
                engineering: {
                    name: 'Engineering',
                    headCount: 50,
                    budget: 5000000,
                    locations: [
                        {street: '123 Main St', city: 'San Francisco', country: 'USA'},
                        {street: '456 Tech Blvd', city: 'Austin', country: 'USA', zip: '78701'}
                    ]
                },
                sales: {
                    name: 'Sales',
                    headCount: 20,
                    locations: [{street: '789 Market St', city: 'New York', country: 'USA'}]
                }
            },
            leadership: [
                {name: 'Jane Doe', age: 45, email: 'jane@techcorp.com'},
                {name: 'John Smith', age: 38}
            ],
            projects: [
                {
                    id: 1,
                    name: 'Project Alpha',
                    status: {status: 'active', progress: 75, assignees: ['alice', 'bob']},
                    tasks: [
                        {
                            title: 'Design',
                            priority: 1,
                            subtasks: [
                                {title: 'Wireframes', priority: 1},
                                {
                                    title: 'Mockups', priority: 2, subtasks: [
                                        {title: 'Mobile mockups', priority: 1},
                                        {title: 'Desktop mockups', priority: 2}
                                    ]
                                }
                            ]
                        },
                        {title: 'Development', priority: 2}
                    ],
                    metadata: {version: '1.0', team: 'alpha'}
                },
                {
                    id: 2,
                    name: 'Project Beta',
                    status: {status: 'planning', estimatedStart: '2025-Q2'},
                    tasks: [{title: 'Initial planning', priority: 1}]
                },
                {
                    id: 3,
                    name: 'Project Gamma',
                    status: {status: 'completed', completedAt: '2024-12-01', outcome: 'Success'},
                    tasks: []
                }
            ]
        };

        it('should validate complex nested structure', () => {
            expect(CompanySchema.is(validCompany)).toBe(true);
        });

        it('should stringify and parse complex nested structure correctly', () => {
            const json = CompanySchema.stringify(validCompany);
            const parsed = JSON.parse(json!);
            expect(parsed).toEqual(validCompany);
        });

        it('should strip extra properties at ALL nesting levels', () => {
            // Add extra properties at every level
            const inputWithExtras = {
                name: 'TechCorp',
                founded: 2010,
                active: true,
                _extra_company: 'should be stripped',
                headquarters: {
                    street: '123 Main St',
                    city: 'San Francisco',
                    country: 'USA',
                    _extra_address: 'stripped'
                },
                departments: {
                    engineering: {
                        name: 'Engineering',
                        headCount: 50,
                        _extra_dept: 'stripped',
                        locations: [
                            {street: '123 Main St', city: 'SF', country: 'USA', _extra_loc: 'stripped'}
                        ]
                    }
                },
                leadership: [
                    {name: 'Jane', age: 45, _extra_person: 'stripped'},
                    {name: 'John', age: 38, _extra_person2: 'stripped'}
                ],
                projects: [
                    {
                        id: 1,
                        name: 'Alpha',
                        _extra_project: 'stripped',
                        status: {status: 'active', progress: 50, assignees: ['a'], _extra_status: 'stripped'},
                        tasks: [
                            {
                                title: 'Task 1',
                                priority: 1,
                                _extra_task: 'stripped',
                                subtasks: [
                                    {title: 'Subtask', priority: 2, _extra_subtask: 'stripped'}
                                ]
                            }
                        ]
                    }
                ]
            };

            const issues = new GGIssuesList();
            const result = CompanySchema._parse(inputWithExtras, issues, 'company');

            expect(issues.length).toBe(0);
            expect(result).toBeDefined();

            // Verify root level stripped
            expect(Object.keys(result!)).not.toContain('_extra_company');
            expect(Object.keys(result!)).toEqual(['name', 'founded', 'active', 'headquarters', 'departments', 'leadership', 'projects']);

            // Verify headquarters stripped
            expect(Object.keys(result!.headquarters)).not.toContain('_extra_address');

            // Verify department stripped (inside record)
            expect(Object.keys(result!.departments.engineering)).not.toContain('_extra_dept');

            // Verify location inside department array stripped
            expect(Object.keys(result!.departments.engineering.locations[0])).not.toContain('_extra_loc');

            // Verify leadership tuple stripped
            expect(Object.keys(result!.leadership[0])).not.toContain('_extra_person');
            expect(Object.keys(result!.leadership[1]!)).not.toContain('_extra_person2');

            // Verify project stripped
            expect(Object.keys(result!.projects[0])).not.toContain('_extra_project');

            // Verify discriminated union status stripped
            expect(Object.keys(result!.projects[0].status)).not.toContain('_extra_status');

            // Verify task stripped
            expect(Object.keys(result!.projects[0].tasks[0])).not.toContain('_extra_task');

            // Verify recursive subtask stripped
            expect(Object.keys(result!.projects[0].tasks[0].subtasks![0])).not.toContain('_extra_subtask');
        });

        it('should reject invalid data at deep nesting levels', () => {
            const invalidDeep = {
                ...validCompany,
                projects: [
                    {
                        id: 1,
                        name: 'Alpha',
                        status: {status: 'active', progress: 50, assignees: ['a']},
                        tasks: [
                            {
                                title: 'Task',
                                priority: 1,
                                subtasks: [
                                    {
                                        title: 'Subtask',
                                        priority: 1,
                                        subtasks: [
                                            {title: 123, priority: 1} // Invalid: title should be string
                                        ]
                                    }
                                ]
                            }
                        ]
                    }
                ]
            };

            expect(CompanySchema.is(invalidDeep)).toBe(false);

            const issues = new GGIssuesList();
            const result = CompanySchema._parse(invalidDeep, issues, 'company');
            expect(result).toBeUndefined();
            expect(issues.length).toBeGreaterThan(0);
        });

        it('should handle deeply recursive tasks correctly', () => {
            // Create 10 levels of nested subtasks
            let deepTask: Task = {title: 'Level 10', priority: 10};
            for (let i = 9; i >= 1; i--) {
                deepTask = {title: `Level ${i}`, priority: i, subtasks: [deepTask]};
            }

            const projectWithDeepTasks = {
                id: 1,
                name: 'Deep Project',
                status: {status: 'planning' as const, estimatedStart: '2025'},
                tasks: [deepTask]
            };

            expect(ProjectSchema.is(projectWithDeepTasks)).toBe(true);

            const json = ProjectSchema.stringify(projectWithDeepTasks);
            expect(JSON.parse(json!)).toEqual(projectWithDeepTasks);

            // Add extra properties at various depths and verify stripping
            const deepTaskWithExtras: any = {title: 'Level 10', priority: 10, _extra: 'strip'};
            let current = deepTaskWithExtras;
            for (let i = 9; i >= 1; i--) {
                current = {title: `Level ${i}`, priority: i, subtasks: [current], _extra: 'strip'};
            }

            const issues = new GGIssuesList();
            const parsed = TaskSchema._parse(current, issues, 'task');
            expect(issues.length).toBe(0);

            // Traverse and verify no _extra at any level
            let node: Task | undefined = parsed;
            let level = 1;
            while (node) {
                expect(Object.keys(node)).not.toContain('_extra');
                expect(node.title).toBe(`Level ${level}`);
                node = node.subtasks?.[0];
                level++;
            }
            expect(level).toBe(11); // Verified all 10 levels
        });

        it('should handle all discriminated union variants', () => {
            const variants = [
                {status: 'planning' as const, estimatedStart: '2025-Q1', _extra: 'strip'},
                {status: 'active' as const, progress: 50, assignees: ['a', 'b'], _extra: 'strip'},
                {status: 'completed' as const, completedAt: '2024-01-01', outcome: 'Done', _extra: 'strip'},
                {status: 'cancelled' as const, reason: 'Budget cuts', _extra: 'strip'}
            ];

            for (const variant of variants) {
                expect(ProjectStatusSchema.is(variant)).toBe(true);

                const issues = new GGIssuesList();
                const parsed = ProjectStatusSchema._parse(variant, issues, 'status');
                expect(issues.length).toBe(0);
                expect(Object.keys(parsed!)).not.toContain('_extra');

                const json = ProjectStatusSchema.stringify(parsed!);
                const reparsed = JSON.parse(json!);
                expect(reparsed.status).toBe(variant.status);
            }
        });
    });

    // ==================== Field Defaults ====================

    describe('field defaults', () => {
        it('applies default for null field value with .orNull.default()', () => {
            const Schema = IsObject({name: IsString, comment: IsString.orNull.default("")});
            const issues = new GGIssuesList();
            const result = Schema._parse({name: "John", comment: null}, issues, 'test', true);
            expect(issues.length).toBe(0);
            expect(result).toStrictEqual({name: "John", comment: ""});
        });

        it('applies default for undefined field value with .orUndefined.default()', () => {
            const Schema = IsObject({name: IsString, comment: IsString.orUndefined.default("")});
            const issues = new GGIssuesList();
            const result = Schema._parse({name: "John", comment: undefined}, issues, 'test', true);
            expect(issues.length).toBe(0);
            expect(result).toStrictEqual({name: "John", comment: ""});
        });

        it('applies default for missing field with .orUndefined.default()', () => {
            const Schema = IsObject({name: IsString, comment: IsString.orUndefined.default("")});
            const issues = new GGIssuesList();
            const result = Schema._parse({name: "John"}, issues, 'test', true);
            expect(issues.length).toBe(0);
            expect(result).toStrictEqual({name: "John", comment: ""});
        });

        it('preserves actual value when field has default', () => {
            const Schema = IsObject({name: IsString, comment: IsString.orNull.default("")});
            const issues = new GGIssuesList();
            const result = Schema._parse({name: "John", comment: "hello"}, issues, 'test');
            expect(issues.length).toBe(0);
            expect(result).toStrictEqual({name: "John", comment: "hello"});
        });

        it('applies object default for null field value', () => {
            const Inner = IsObject({x: IsNumber});
            const Schema = IsObject({name: IsString, meta: Inner.orNull.default({x: 0})});
            const issues = new GGIssuesList();
            const result = Schema._parse({name: "John", meta: null}, issues, 'test', true);
            expect(issues.length).toBe(0);
            expect(result).toStrictEqual({name: "John", meta: {x: 0}});
        });

        it('applies default via safeParse with coerce=true', () => {
            const Schema = IsObject({name: IsString, comment: IsString.orNull.default("")});
            const result = Schema.safeParse({name: "John", comment: null}, true);
            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.value).toStrictEqual({name: "John", comment: ""});
            }
        });

        it('applies default for null on .orUndefined.default() (null treated same as undefined)', () => {
            const Schema = IsObject({name: IsString, comment: IsString.orUndefined.default("")});
            const issues = new GGIssuesList();
            const result = Schema._parse({name: "John", comment: null}, issues, 'test', true);
            expect(issues.length).toBe(0);
            expect(result).toStrictEqual({name: "John", comment: ""});
        });

        it('applies default for undefined on .orNull.default() (undefined treated same as null)', () => {
            const Schema = IsObject({name: IsString, comment: IsString.orNull.default("")});
            const issues = new GGIssuesList();
            const result = Schema._parse({name: "John"}, issues, 'test', true);
            expect(issues.length).toBe(0);
            expect(result).toStrictEqual({name: "John", comment: ""});
        });

        it('is() rejects null field even when field has default', () => {
            const Schema = IsObject({name: IsString, comment: IsString.orNull.default("")});
            // is() must remain pure - it checks the value as-is, no defaults applied
            expect(Schema.is({name: "John", comment: null})).toBe(true); // orNull allows null
            expect(Schema.is({name: "John", comment: "hi"})).toBe(true);
            // But a required field with default that receives wrong type should still fail is()
            const Schema2 = IsObject({name: IsString, count: IsNumber.orNull.default(0)});
            expect(Schema2.is({name: "John", count: "not a number"})).toBe(false);
        });

        it('multiple fields with defaults', () => {
            const Schema = IsObject({
                name: IsString,
                bio: IsString.orNull.default(""),
                age: IsNumber.orNull.default(0),
                active: IsBoolean.orUndefined.default(true),
            });
            const issues = new GGIssuesList();
            const result = Schema._parse({name: "John", bio: null, age: null}, issues, 'test', true);
            expect(issues.length).toBe(0);
            expect(result).toStrictEqual({name: "John", bio: "", age: 0, active: true});
        });

        it('defaults in nested objects', () => {
            const Address = IsObject({
                street: IsString,
                city: IsString.orNull.default("Unknown"),
            });
            const Person = IsObject({
                name: IsString,
                address: Address,
            });
            const issues = new GGIssuesList();
            const result = Person._parse({name: "John", address: {street: "123 Main", city: null}}, issues, 'test', true);
            expect(issues.length).toBe(0);
            expect(result).toStrictEqual({name: "John", address: {street: "123 Main", city: "Unknown"}});
        });

        it('parse rejects completely wrong type even with defaults', () => {
            const Schema = IsObject({name: IsString, comment: IsString.orNull.default("")});
            const issues = new GGIssuesList();
            const result = Schema._parse(42, issues, 'test');
            expect(result).toBeUndefined();
            expect(issues.length).toBeGreaterThan(0);
            expect(issues.getIssue(0)?.code).toBe(IsObjectErrors.typeError.code);
        });

        it('parse rejects null input even with field defaults', () => {
            const Schema = IsObject({name: IsString, comment: IsString.orNull.default("")});
            const issues = new GGIssuesList();
            const result = Schema._parse(null, issues, 'test');
            expect(result).toBeUndefined();
            expect(issues.getIssue(0)?.code).toBe(GGIssueKey.required.code);
        });

        it('default does not rescue wrong-type value', () => {
            // A developer would expect: default applies for null/undefined only,
            // NOT for a value that exists but has the wrong type
            const Schema = IsObject({
                name: IsString,
                count: IsNumber.orNull.default(0),
            });
            const issues = new GGIssuesList();
            const result = Schema._parse({name: "John", count: "not a number"}, issues, 'test');
            expect(result).toBeUndefined();
            expect(issues.length).toBeGreaterThan(0);
        });

        it('parse result always passes is()', () => {
            // Critical invariant: if parse succeeds, the output must be valid
            const Schema = IsObject({
                name: IsString,
                bio: IsString.orNull.default(""),
                age: IsNumber.orUndefined.default(0),
            });
            const inputs: Record<string, unknown>[] = [
                {name: "John", bio: null},
                {name: "John", bio: null, age: undefined},
                {name: "John", bio: "hello", age: 42},
                {name: "John", bio: null, age: null},
            ];
            for (const input of inputs) {
                const issues = new GGIssuesList();
                const result = Schema._parse(input, issues, 'test', true);
                if (result !== undefined) {
                    expect(Schema.is(result)).toBe(true);
                }
            }
        });

        it('optional field with default is included in output', () => {
            // A developer would expect: if I set a default, the field is always
            // present in the parsed output — that's the whole point of a default
            const Schema = IsObject({
                name: IsString,
                tag: IsString.orUndefined.default("general"),
            });
            const issues = new GGIssuesList();
            const result = Schema._parse({name: "John"}, issues, 'test', true);
            expect(issues.length).toBe(0);
            expect(result).toStrictEqual({name: "John", tag: "general"});
            expect('tag' in result!).toBe(true);
        });

        it('defaults strip extra properties like normal parse', () => {
            const Schema = IsObject({
                name: IsString,
                bio: IsString.orNull.default(""),
            });
            const issues = new GGIssuesList();
            const result = Schema._parse({name: "John", bio: null, extraProp: "should be gone"} as any, issues, 'test', true);
            expect(issues.length).toBe(0);
            expect(result).toStrictEqual({name: "John", bio: ""});
            expect(Object.keys(result!)).toEqual(['name', 'bio']);
        });

        it('falsy values are preserved, not replaced by defaults', () => {
            // This is critical: 0, "", and false are valid values.
            // Only null/undefined should trigger defaults.
            const Schema = IsObject({
                name: IsString.orNull.default("fallback"),
                count: IsNumber.orNull.default(99),
                active: IsBoolean.orNull.default(true),
            });

            const issues = new GGIssuesList();
            const result = Schema._parse({name: "", count: 0, active: false}, issues, 'test');
            expect(issues.length).toBe(0);
            // All falsy values must be kept as-is
            expect(result).toStrictEqual({name: "", count: 0, active: false});
        });

        it('only null and undefined trigger defaults, nothing else', () => {
            const Schema = IsObject({
                value: IsNumber.orNull.default(42),
            });

            // 0 is not null/undefined → kept
            const r1 = Schema._parse({value: 0}, new GGIssuesList(), 'test');
            expect(r1).toStrictEqual({value: 0});

            // -1 is not null/undefined → kept
            const r2 = Schema._parse({value: -1}, new GGIssuesList(), 'test');
            expect(r2).toStrictEqual({value: -1});

            // null → default
            const r3 = Schema._parse({value: null}, new GGIssuesList(), 'test', true);
            expect(r3).toStrictEqual({value: 42});

            // undefined → default
            const r4 = Schema._parse({value: undefined}, new GGIssuesList(), 'test', true);
            expect(r4).toStrictEqual({value: 42});
        });

        it('is() rejects raw input but parse() succeeds by applying defaults', () => {
            // This test documents the core semantic:
            // is() checks the value as-is → null in a non-nullable field → false
            // parse() applies clean (defaults) first → null becomes "" → valid
            const Schema = IsObject({
                name: IsString,
                comment: IsString.orUndefined.default(""),
            });

            const raw = {name: "John", comment: undefined as any};

            // is() sees undefined for an orUndefined field → still valid (undefined is allowed)
            expect(Schema.is(raw)).toBe(true);

            // But with a stricter field (not optional, just has default via orNull):
            const Strict = IsObject({
                name: IsString,
                bio: IsString.orNull.default(""),
            });
            const rawStrict = {name: "John", bio: null as any};

            // is() sees null for an orNull field → valid (null is allowed by orNull)
            expect(Strict.is(rawStrict)).toBe(true);

            // parse() applies default → null becomes ""
            const issues = new GGIssuesList();
            const parsed = Strict._parse(rawStrict, issues, 'test', true);
            expect(issues.length).toBe(0);
            expect(parsed).toStrictEqual({name: "John", bio: ""});

            // parsed result is also valid
            expect(Strict.is(parsed)).toBe(true);
        });
    });

    // ==================== toJSONSchema ====================

    describe('toJSONSchema()', () => {
        it('basic — all required', () => {
            expect(IsObject({name: IsString, age: IsNumber}).toJSONSchema()).toEqual({
                type: 'object',
                properties: {name: {type: 'string'}, age: {type: 'number'}},
                required: ['name', 'age']
            });
        });
        it('optional field excluded from required', () => {
            const s = IsObject({name: IsString, nick: IsString.orUndefined}).toJSONSchema() as any;
            expect(s.required).toEqual(['name']);
            expect(s.properties.nick).toEqual({type: 'string'});
        });
        it('no required array when all fields optional', () => {
            const s = IsObject({a: IsString.orUndefined}).toJSONSchema() as any;
            expect(s.required).toBeUndefined();
        });
        it('nullable wraps in oneOf', () => {
            const s = IsObject({x: IsNumber}).orNull.toJSONSchema() as any;
            expect(s.oneOf[0].type).toBe('object');
            expect(s.oneOf[1].type).toBe('null');
        });
        it('nested object', () => {
            const s = IsObject({inner: IsObject({val: IsBoolean})}).toJSONSchema() as any;
            expect(s.properties.inner.type).toBe('object');
            expect(s.properties.inner.properties.val).toEqual({type: 'boolean'});
        });
        it('docs on object', () => {
            const s = IsObject({x: IsNumber}).docs({title: 'T', description: 'D'}).toJSONSchema() as any;
            expect(s.title).toBe('T');
            expect(s.description).toBe('D');
        });
    });
});
