import {describe, expect, it} from 'vitest';
import {IsArray} from './IsArray';
import {IsString} from './IsString';
import {IsNumber} from './IsNumber';
import {IsObject, ObjectSchema} from './IsObject';
import {IsAny} from './IsAny';
import {GGIssueKey} from "../issue/GGIssueKey";
import {GGIssuesList} from "../issue/GGIssuesList";
import {GGIssueInvalid} from "../issue/issues/GGIssueInvalid";
import {testObjectValidation, testStringify, testValidation, testUtils} from "../utils/testUtils";
import {IsArrayErrors, IsNumberErrors, IsStringErrors} from "../Errors";

const arrayUniqueError = new GGIssueInvalid("array.unique", "Array must have unique elements");

testUtils('IsArray', () => {

    // Basic validation
    testValidation('validation', IsArray(IsAny.orUndefined.orNull), [
        {value: [], valid: true},
        {value: [1, 2, 3], valid: true},
        {value: ['a', 'b', 'c'], valid: true},
        {value: [{}, {}, {}], valid: true},
        {value: [1, 'a', null, true, false, {}, [], undefined], valid: true},  // mixed types (no null - IsAny rejects null)
        {value: 'array', valid: false, issue: IsArrayErrors.typeError},
        {value: 123, valid: false, issue: IsArrayErrors.typeError},
        {value: {}, valid: false, issue: IsArrayErrors.typeError},
        {value: null, valid: false, issue: GGIssueKey.required},
        {value: undefined, valid: false, issue: GGIssueKey.required},
    ]);

    // minLength constraint
    testValidation('minLength(2)', IsArray(IsAny).minLength(2), [
        {value: [], valid: false, issue: IsArrayErrors.minLengthError},
        {value: [1], valid: false, issue: IsArrayErrors.minLengthError},
        {value: [1, 2], valid: true},
        {value: [1, 2, 3], valid: true},
    ]);

    // maxLength constraint
    testValidation('maxLength(3)', IsArray(IsAny).maxLength(3), [
        {value: [], valid: true},
        {value: [1, 2, 3], valid: true},
        {value: [1, 2, 3, 4], valid: false, issue: IsArrayErrors.maxLengthError},
        {value: [1, 2, 3, 4, 5], valid: false, issue: IsArrayErrors.maxLengthError},
    ]);

    // range constraint
    testValidation('range(1, 3)', IsArray(IsAny).range(1, 3), [
        {value: [], valid: false, issue: IsArrayErrors.rangeError},
        {value: [1], valid: true},
        {value: [1, 2], valid: true},
        {value: [1, 2, 3], valid: true},
        {value: [1, 2, 3, 4], valid: false, issue: IsArrayErrors.rangeError},
    ]);

    // minLength().maxLength() chaining - same as range(), uses rangeError when both set
    testValidation('minLength(1).maxLength(3)', IsArray(IsAny).minLength(1).maxLength(3), [
        {value: [], valid: false, issue: IsArrayErrors.rangeError},
        {value: [1], valid: true},
        {value: [1, 2, 3], valid: true},
        {value: [1, 2, 3, 4], valid: false, issue: IsArrayErrors.rangeError},
    ]);

    // orUndefined
    testValidation('orUndefined', IsArray(IsAny).orUndefined, [
        {value: undefined, valid: true},
        {value: [], valid: true},
        {value: [1, 2, 3], valid: true},
        {value: null, valid: false, issue: GGIssueKey.required},
        {value: 'hello', valid: false, issue: IsArrayErrors.typeError},
    ]);

    // orNull
    testValidation('orNull', IsArray(IsAny).orNull, [
        {value: null, valid: true},
        {value: [], valid: true},
        {value: [1, 2, 3], valid: true},
        {value: undefined, valid: false, issue: GGIssueKey.required},
        {value: 'hello', valid: false, issue: IsArrayErrors.typeError},
    ]);

    // orUndefined/orNull with constraints
    testValidation('minLength(1).orUndefined', IsArray(IsAny).minLength(1).orUndefined, [
        {value: undefined, valid: true},
        {value: [1], valid: true},
        {value: [], valid: false, issue: IsArrayErrors.minLengthError},
        {value: null, valid: false, issue: GGIssueKey.required},
    ]);

    testValidation('maxLength(2).orNull', IsArray(IsAny).maxLength(2).orNull, [
        {value: null, valid: true},
        {value: [], valid: true},
        {value: [1, 2], valid: true},
        {value: [1, 2, 3], valid: false, issue: IsArrayErrors.maxLengthError},
        {value: undefined, valid: false, issue: GGIssueKey.required},
    ]);

    // Typed element validation
    testObjectValidation('IsArray(IsString)', IsArray(IsString), [
        {value: [], valid: true},
        {value: ['a', 'b', 'c'], valid: true},
        {value: [1, 2, 3], valid: false, issue: IsStringErrors.typeError, path: 'root.0'},
        {value: ['a', 1, 'c'], valid: false, issue: IsStringErrors.typeError, path: 'root.1'},
        {value: null, valid: false, issue: GGIssueKey.required},
    ]);

    testObjectValidation('IsArray(IsNumber)', IsArray(IsNumber), [
        {value: [], valid: true},
        {value: [1, 2, 3], valid: true},
        {value: [1.5, -2, 0], valid: true},
        {value: ['a', 'b'], valid: false, issue: IsNumberErrors.typeError, path: 'root.0'},
        {value: [1, 'x', 3], valid: false, issue: IsNumberErrors.typeError, path: 'root.1'},
    ]);

    // Typed elements with constraints
    testObjectValidation('IsArray(IsString.minLength(2))', IsArray(IsString.minLength(2)), [
        {value: [], valid: true},
        {value: ['ab', 'abc'], valid: true},
        {value: ['a'], valid: false, issue: IsStringErrors.minLengthError, path: 'root.0'},
        {value: ['ab', 'x'], valid: false, issue: IsStringErrors.minLengthError, path: 'root.1'},
    ]);

    testObjectValidation('IsArray(IsNumber.min(0))', IsArray(IsNumber.min(0)), [
        {value: [], valid: true},
        {value: [0, 1, 2], valid: true},
        {value: [-1, 0, 1], valid: false, issue: IsNumberErrors.minError, path: 'root.0'},
    ]);

    // Combined array + element constraints
    testObjectValidation('IsArray(IsString).minLength(1).maxLength(3)', IsArray(IsString).minLength(1).maxLength(3), [
        {value: [], valid: false, issue: IsArrayErrors.rangeError},
        {value: ['a'], valid: true},
        {value: ['a', 'b', 'c'], valid: true},
        {value: ['a', 'b', 'c', 'd'], valid: false, issue: IsArrayErrors.rangeError},
        {value: [1], valid: false, issue: IsStringErrors.typeError, path: 'root.0'},
    ]);

    // Element coercion
    describe('of(IsNumber) coercion', () => {
        it('should coerce string elements to numbers', () => {
            const issues = new GGIssuesList();
            expect(IsArray(IsNumber)._parse(['1', '2', '3'], issues, 'test', true)).toEqual([1, 2, 3]);
            expect(issues.length).toBe(0);
        });

        it('should fail on non-coercible elements', () => {
            const issues = new GGIssuesList();
            expect(IsArray(IsNumber)._parse(['1', 'x', '3'], issues, 'test', true)).toBeUndefined();
            expect(issues.getIssue(0)?.code).toBe(IsNumberErrors.typeError.code);
        });
    });

    describe('of(IsString) coercion', () => {
        it('should coerce number elements to strings', () => {
            const issues = new GGIssuesList();
            expect(IsArray(IsString)._parse([1, 2, 3], issues, 'test', true)).toEqual(['1', '2', '3']);
            expect(issues.length).toBe(0);
        });

        it('should coerce boolean elements to strings', () => {
            const issues = new GGIssuesList();
            expect(IsArray(IsString)._parse([true, false], issues, 'test', true)).toEqual(['true', 'false']);
            expect(issues.length).toBe(0);
        });
    });

    // Nested arrays
    testObjectValidation('of(IsArray(IsString))', IsArray(IsArray(IsString)), [
        {value: [], valid: true},
        {value: [[]], valid: true},
        {value: [['a', 'b'], ['c']], valid: true},
        {value: [['a'], 'b'], valid: false, issue: IsArrayErrors.typeError, path: 'root.1'},
        {value: [['a'], [1]], valid: false, issue: IsStringErrors.typeError, path: 'root.1.0'},
    ]);

    testObjectValidation('of(IsArray(IsArray(IsNumber)))', IsArray(IsArray(IsArray(IsNumber))), [
        {value: [[[1, 2], [3]], [[4]]], valid: true},
        {value: [[[1, 2], ['x']]], valid: false, issue: IsNumberErrors.typeError, path: 'root.0.1.0'},
    ]);

    // Stringify tests
    testStringify('stringify untyped', IsArray(IsAny), [
        {value: [], expected: []},
        {value: [1, 2, 3], expected: [1, 2, 3]},
        {value: ['a', 'b'], expected: ['a', 'b']},
    ]);

    testStringify('stringify of(IsString)', IsArray(IsString), [
        {value: [], expected: []},
        {value: ['hello', 'world'], expected: ['hello', 'world']},
    ]);

    testStringify('stringify of(IsNumber)', IsArray(IsNumber), [
        {value: [], expected: []},
        {value: [1, 2, 3], expected: [1, 2, 3]},
        {value: [0.5, -1, 100], expected: [0.5, -1, 100]},
    ]);

    testStringify('stringify of(IsArray(IsNumber))', IsArray(IsArray(IsNumber)), [
        {value: [[1, 2], [3, 4]], expected: [[1, 2], [3, 4]]},
        {value: [[], [1]], expected: [[], [1]]},
    ]);

    describe('stringify orUndefined', () => {
        it('orUndefined.stringify(undefined) returns undefined', () => {
            expect(IsArray(IsAny).orUndefined.stringify(undefined)).toBe(undefined);
        });

        it('orUndefined.stringify(value) returns stringified value', () => {
            expect(IsArray(IsAny).orUndefined.stringify([1, 2, 3])).toBe('[1,2,3]');
        });

        it('of(IsNumber).orUndefined.stringify(undefined) returns undefined', () => {
            expect(IsArray(IsNumber).orUndefined.stringify(undefined)).toBe(undefined);
        });

        it('of(IsString).orUndefined.stringify(value) returns stringified value', () => {
            expect(IsArray(IsString).orUndefined.stringify(['a', 'b'])).toBe('["a","b"]');
        });
    });

    // toJSONSchema() tests
    describe('toJSONSchema()', () => {
        it('should generate basic array schema with element', () => {
            expect(IsArray(IsAny).toJSONSchema()).toEqual({type: 'array', items: {}});
        });

        it('should include element schema as items', () => {
            expect(IsArray(IsString).toJSONSchema()).toEqual({
                type: 'array',
                items: {type: 'string'}
            });
        });

        it('should include constraints', () => {
            expect(IsArray(IsAny).minLength(2).toJSONSchema()).toEqual({type: 'array', items: {}, minItems: 2});
            expect(IsArray(IsAny).maxLength(10).toJSONSchema()).toEqual({type: 'array', items: {}, maxItems: 10});
            expect(IsArray(IsAny).range(1, 5).toJSONSchema()).toEqual({type: 'array', items: {}, minItems: 1, maxItems: 5});
        });

        it('should handle nullable', () => {
            expect(IsArray(IsAny).orNull.toJSONSchema()).toEqual({
                oneOf: [{type: 'array', items: {}}, {type: 'null'}]
            });
        });

        it('should combine element schema with constraints', () => {
            expect(IsArray(IsNumber).minLength(1).maxLength(100).toJSONSchema()).toEqual({
                type: 'array',
                items: {type: 'number'},
                minItems: 1,
                maxItems: 100
            });
        });
    });

    // Caching tests
    describe('caching', () => {
        it('should return cached schema for same element schema', () => {
            const schema1 = IsArray(IsString);
            const schema2 = IsArray(IsString);
            expect(schema1).toBe(schema2);
        });

        it('should not cache when constraints are applied', () => {
            const base = IsArray(IsString);
            const constrained = base.minLength(1);
            expect(base).not.toBe(constrained);
        });
    });

    // Constraint tightening
    describe('constraint tightening', () => {
        it('cannot lower minLength', () => {
            expect(() => IsArray(IsAny).minLength(5).minLength(3)).toThrow('Cannot lower minLength');
        });

        it('cannot raise maxLength', () => {
            expect(() => IsArray(IsAny).maxLength(5).maxLength(10)).toThrow('Cannot raise maxLength');
        });

        it('can tighten minLength', () => {
            const tighter = IsArray(IsAny).minLength(3).minLength(5);
            expect(tighter.is([1, 2, 3, 4])).toBe(false);
            expect(tighter.is([1, 2, 3, 4, 5])).toBe(true);
        });

        it('can tighten maxLength', () => {
            const tighter = IsArray(IsAny).maxLength(10).maxLength(5);
            expect(tighter.is([1, 2, 3, 4, 5, 6])).toBe(false);
            expect(tighter.is([1, 2, 3, 4, 5])).toBe(true);
        });

        it('rejects invalid range', () => {
            expect(() => IsArray(IsAny).range(10, 5)).toThrow('Invalid range');
        });
    });

    // docs() tests
    describe('docs()', () => {
        it('should add documentation to schema', () => {
            const schema = IsArray(IsString).docs({
                description: 'A list of tags',
                example: ['tag1', 'tag2']
            });
            expect(schema.def.docs?.description).toBe('A list of tags');
            expect(schema.def.docs?.example).toEqual(['tag1', 'tag2']);
        });

        it('should preserve constraints when adding docs', () => {
            const schema = IsArray(IsAny).minLength(1).maxLength(10).docs({description: 'Limited array'});
            expect(schema.def.minLength).toBe(1);
            expect(schema.def.maxLength).toBe(10);
            expect(schema.def.docs?.description).toBe('Limited array');
        });
    });

    // Refinements
    describe('refinements', () => {
        const UniqueStrings = IsArray(IsString).refine(
            arr => new Set(arr).size === arr.length,
            arrayUniqueError
        );

        it('refine() - is() accepts valid arrays', () => {
            expect(UniqueStrings.is(['a', 'b', 'c'])).toBe(true);
            expect(UniqueStrings.is([])).toBe(true);
        });

        it('refine() - is() rejects arrays that fail refinement', () => {
            expect(UniqueStrings.is(['a', 'b', 'a'])).toBe(false);
            expect(UniqueStrings.is(['x', 'x'])).toBe(false);
        });

        it('refine() - parse() accepts valid arrays', () => {
            const issues = new GGIssuesList();
            const result = UniqueStrings._parse(['a', 'b', 'c'], issues, 'test');
            expect(result).toEqual(['a', 'b', 'c']);
            expect(issues.length).toBe(0);
        });

        it('refine() - parse() rejects arrays that fail refinement', () => {
            const issues = new GGIssuesList();
            const result = UniqueStrings._parse(['a', 'b', 'a'], issues, 'test');
            expect(result).toBeUndefined();
            expect(issues.length).toBe(1);
            expect(issues.getIssue(0)?.code).toBe('invalid.array.unique');
        });

        it('refine() with minLength constraint', () => {
            const AtLeast2Unique = IsArray(IsString).minLength(2).refine(
                arr => new Set(arr).size === arr.length,
                arrayUniqueError
            );

            expect(AtLeast2Unique.is(['a', 'b'])).toBe(true);
            expect(AtLeast2Unique.is(['a'])).toBe(false); // fails minLength
            expect(AtLeast2Unique.is(['a', 'a'])).toBe(false); // fails refinement
        });
    });

    // Empty path handling
    describe('empty path handling', () => {
        it('should handle empty path in parse', () => {
            const issues = new GGIssuesList();
            IsArray(IsString)._parse(['a', 1], issues, '');
            expect(issues.getPath(0)).toBe('1');
        });

        it('should handle root path for type errors', () => {
            const issues = new GGIssuesList();
            IsArray(IsAny)._parse('not array', issues, '');
            expect(issues.getPath(0)).toBe('');
        });
    });

    // Regex-constrained string elements
    describe('with regex-constrained elements', () => {
        const emailArray = IsArray(IsString.regex(/^[a-z]+@[a-z]+\.[a-z]+$/i));

        it('should validate arrays with regex-constrained strings', () => {
            expect(emailArray.is(['john@example.com', 'jane@test.org'])).toBe(true);
            expect(emailArray.is(['john@example.com', 'invalid'])).toBe(false);
            expect(emailArray.is([])).toBe(true);
        });

        it('should report correct path for invalid regex elements', () => {
            const issues = new GGIssuesList();
            emailArray._parse(['john@example.com', 'not-email', 'jane@test.org'], issues, 'emails');
            expect(issues.getPath(0)).toBe('emails.1');
            expect(issues.getIssue(0)?.code).toBe('invalid.string.pattern');
        });
    });

    // Issue #6: parse should collect ALL element errors, not just first
    describe('collects all element errors', () => {
        it('should report errors for all invalid elements', () => {
            const issues = new GGIssuesList();
            IsArray(IsNumber)._parse(['a', 'b', 'c'], issues, 'arr');
            expect(issues.length).toBe(3);
            expect(issues.getPath(0)).toBe('arr.0');
            expect(issues.getPath(1)).toBe('arr.1');
            expect(issues.getPath(2)).toBe('arr.2');
        });

        it('should report errors for multiple invalid elements at various positions', () => {
            const issues = new GGIssuesList();
            IsArray(IsNumber)._parse([1, 'bad', 3, 'also bad', 5], issues, 'arr');
            expect(issues.length).toBe(2);
            expect(issues.getPath(0)).toBe('arr.1');
            expect(issues.getPath(1)).toBe('arr.3');
        });

        it('should return undefined when any element fails', () => {
            const issues = new GGIssuesList();
            const result = IsArray(IsNumber)._parse([1, 'bad', 3], issues, 'arr');
            expect(result).toBeUndefined();
            expect(issues.length).toBe(1);
        });
    });

    // Nullable object elements - tests toInlineParseConstruct wrapper
    describe('nullable object elements', () => {
        const UserSchema = IsObject({name: IsString, age: IsNumber});
        const NullableUsersArray = IsArray(UserSchema.orNull);

        it('validates array with null elements', () => {
            expect(NullableUsersArray.is([{name: 'John', age: 30}, null, {name: 'Jane', age: 25}])).toBe(true);
            expect(NullableUsersArray.is([null, null])).toBe(true);
            expect(NullableUsersArray.is([])).toBe(true);
        });

        it('rejects array with undefined elements (only null allowed)', () => {
            expect(NullableUsersArray.is([{name: 'John', age: 30}, undefined])).toBe(false);
        });

        it('parse preserves null elements', () => {
            const issues = new GGIssuesList();
            const input = [{name: 'John', age: 30}, null, {name: 'Jane', age: 25}];
            const result = NullableUsersArray._parse(input, issues, 'test');
            expect(issues.length).toBe(0);
            expect(result).toEqual([{name: 'John', age: 30}, null, {name: 'Jane', age: 25}]);
        });

        it('parse strips extra props from non-null objects, preserves null', () => {
            const issues = new GGIssuesList();
            const input = [{name: 'John', age: 30, extra: 'ignored'}, null, {name: 'Jane', age: 25, secret: 'hidden'}];
            const result = NullableUsersArray._parse(input, issues, 'test');
            expect(issues.length).toBe(0);
            expect(result).toEqual([{name: 'John', age: 30}, null, {name: 'Jane', age: 25}]);
            expect(Object.keys(result![0]!)).toEqual(['name', 'age']);
            expect(result![1]).toBe(null);
            expect(Object.keys(result![2]!)).toEqual(['name', 'age']);
        });
    });

    // Property stripping for child objects
    describe('strips extra properties from child objects', () => {
        const UserSchema = IsObject({name: IsString, age: IsNumber});
        const UsersArray = IsArray(UserSchema);

        it('should strip extra properties from objects in array', () => {
            const issues = new GGIssuesList();
            const input = [
                {name: 'John', age: 30, extra: 'ignored', password: 'secret'},
                {name: 'Jane', age: 25, anotherExtra: true}
            ];
            const result = UsersArray._parse(input, issues, 'users');

            expect(issues.length).toBe(0);
            expect(result).toBeDefined();
            expect(result).toHaveLength(2);

            // Verify extra properties are stripped
            expect(result![0]).toEqual({name: 'John', age: 30});
            expect(result![1]).toEqual({name: 'Jane', age: 25});

            // Verify no extra keys
            expect(Object.keys(result![0])).toEqual(['name', 'age']);
            expect(Object.keys(result![1])).toEqual(['name', 'age']);
        });

        it('should strip extra properties in nested object arrays', () => {
            const TeamSchema = IsObject({
                teamName: IsString,
                members: UsersArray
            });
            const issues = new GGIssuesList();
            const input = {
                teamName: 'Alpha',
                members: [
                    {name: 'John', age: 30, secret: 'hidden'},
                    {name: 'Jane', age: 25, password: '123'}
                ],
                extraTeamProp: 'ignored'
            };
            const result = TeamSchema._parse(input, issues, 'team');

            expect(issues.length).toBe(0);
            expect(result).toBeDefined();
            expect(Object.keys(result!)).toEqual(['teamName', 'members']);
            expect(result!.members).toHaveLength(2);
            expect(result!.members[0]).toEqual({name: 'John', age: 30});
            expect(result!.members[1]).toEqual({name: 'Jane', age: 25});
        });
    });

    // ==================== Recursive Array (via factory) ====================

    describe('recursive array schema', () => {
        // Define a recursive tree node: each node has children array of same type
        interface TreeNode {
            name: string;
            children?: TreeNode[];
        }

        const TreeNodeSchema: ObjectSchema<TreeNode> = IsObject(() => ({
            name: IsString,
            children: IsArray(() => TreeNodeSchema).orUndefined
        }));

        it('validates leaf nodes (no children)', () => {
            expect(TreeNodeSchema.is({name: 'leaf'})).toBe(true);
            expect(TreeNodeSchema.is({name: 'leaf', children: undefined})).toBe(true);
        });

        it('validates nodes with empty children array', () => {
            expect(TreeNodeSchema.is({name: 'node', children: []})).toBe(true);
        });

        it('validates nodes with children', () => {
            const tree: TreeNode = {
                name: 'root',
                children: [
                    {name: 'child1'},
                    {name: 'child2', children: []}
                ]
            };
            expect(TreeNodeSchema.is(tree)).toBe(true);
        });

        it('validates deeply nested tree', () => {
            const deepTree = {
                name: 'root',
                children: [
                    {
                        name: 'level1',
                        children: [
                            {
                                name: 'level2',
                                children: [
                                    {name: 'level3', children: [{name: 'level4'}]}
                                ]
                            }
                        ]
                    }
                ]
            };
            expect(TreeNodeSchema.is(deepTree)).toBe(true);
        });

        it('rejects invalid nested nodes', () => {
            const invalidTree = {
                name: 'root',
                children: [
                    {name: 'valid'},
                    {name: 123} // invalid: name should be string
                ]
            };
            expect(TreeNodeSchema.is(invalidTree)).toBe(false);
        });

        it('parses and strips extra properties recursively', () => {
            const issues = new GGIssuesList();
            const input = {
                name: 'root',
                EXTRA: 'should be stripped',
                children: [
                    {name: 'child1', CHILD_EXTRA: 'stripped'},
                    {
                        name: 'child2',
                        NESTED_EXTRA: 'also stripped',
                        children: [{name: 'grandchild', DEEP_EXTRA: 'stripped too'}]
                    }
                ]
            };
            const result = TreeNodeSchema._parse(input, issues, '');
            expect(issues.length).toBe(0);
            expect(result).toEqual({
                name: 'root',
                children: [
                    {name: 'child1'},
                    {name: 'child2', children: [{name: 'grandchild'}]}
                ]
            });
        });

        it('stringifies recursive structure', () => {
            const tree = {
                name: 'root',
                children: [
                    {name: 'child1'},
                    {name: 'child2', children: [{name: 'grandchild'}]}
                ]
            };
            const result = TreeNodeSchema.stringify(tree);
            expect(JSON.parse(result!)).toEqual(tree);
        });

        it('handles mixed leaf and branch nodes', () => {
            const issues = new GGIssuesList();
            const input = {
                name: 'root',
                children: [
                    {name: 'leaf1'}, // no children key
                    {name: 'leaf2', children: undefined}, // explicit undefined
                    {name: 'branch', children: [{name: 'nested'}]} // has children
                ]
            };
            const result = TreeNodeSchema._parse(input, issues, '');
            expect(issues.length).toBe(0);
            expect(result).toBeDefined();
        });
    });

    // ==================== Defaults in Array Elements ====================

    describe('defaults in array elements', () => {
        const Item = IsObject({
            name: IsString,
            note: IsString.orNull.default(""),
        });
        const ItemList = IsArray(Item);

        it('applies defaults to each element', () => {
            const issues = new GGIssuesList();
            const result = ItemList._parse([
                {name: "A", note: null},
                {name: "B", note: "keep this"},
                {name: "C", note: null},
            ], issues, 'test', true);
            expect(issues.length).toBe(0);
            expect(result).toStrictEqual([
                {name: "A", note: ""},
                {name: "B", note: "keep this"},
                {name: "C", note: ""},
            ]);
        });

        it('parse result always passes is()', () => {
            const issues = new GGIssuesList();
            const result = ItemList._parse([
                {name: "X", note: null},
            ], issues, 'test', true);
            expect(issues.length).toBe(0);
            expect(ItemList.is(result)).toBe(true);
        });

        it('rejects element with wrong type even when element has default fields', () => {
            const issues = new GGIssuesList();
            const result = ItemList._parse([
                {name: "A", note: null},
                "not an object",
            ], issues, 'test', true);
            expect(result).toBeUndefined();
            expect(issues.length).toBeGreaterThan(0);
        });

        it('empty array still works with element defaults', () => {
            const issues = new GGIssuesList();
            const result = ItemList._parse([], issues, 'test');
            expect(issues.length).toBe(0);
            expect(result).toStrictEqual([]);
        });
    });
});
