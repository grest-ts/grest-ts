import {IsTuple, TupleSchema} from './IsTuple';
import {IsString} from './IsString';
import {IsNumber} from './IsNumber';
import {IsBoolean} from './IsBoolean';
import {IsObject} from './IsObject';
import {GGIssueKey} from "../issue/GGIssueKey";
import {GGIssuesList} from "../issue/GGIssuesList";
import {testObjectValidation, testStringify, testUtils} from "../utils/testUtils";
import {IsNumberErrors, IsStringErrors, IsTupleErrors} from "../Errors";

// Define test issues outside utilsSpec to avoid double registration
const nonEmptyFirstError = new GGIssueKey('tuple_non_empty_first', 'First element must be non-empty');

testUtils('IsTuple', () => {

    describe('factory function', () => {
        it('should throw if no elements provided (direct)', () => {
            expect(() => IsTuple().is([])).toThrow('IsTuple requires at least one element schema');
        });

        it('should throw if no elements provided (factory)', () => {
            expect(() => IsTuple(() => [] as const).is([])).toThrow('IsTuple requires at least one element schema');
        });
    });

    const StringNumberTuple = IsTuple(IsString, IsNumber);

    testObjectValidation('validation [string, number]', StringNumberTuple, [
        {value: ['hello', 42], valid: true},
        {value: ['', 0], valid: true},
        {value: ['hello'], valid: false, issue: IsTupleErrors.lengthError},
        {value: ['hello', 42, true], valid: false, issue: IsTupleErrors.lengthError},
        {value: [], valid: false, issue: IsTupleErrors.lengthError},
        {value: [42, 'hello'], valid: false, issue: IsStringErrors.typeError, path: 'root.0'},
        {value: [42, 42], valid: false, issue: IsStringErrors.typeError, path: 'root.0'},
        {value: ['hello', 'world'], valid: false, issue: IsNumberErrors.typeError, path: 'root.1'},
        {value: null, valid: false, issue: GGIssueKey.required},
        {value: undefined, valid: false, issue: GGIssueKey.required},
        {value: 'string', valid: false, issue: IsTupleErrors.typeError},
        {value: {}, valid: false, issue: IsTupleErrors.typeError},
        {value: 123, valid: false, issue: IsTupleErrors.typeError},
    ]);

    testObjectValidation('orUndefined', StringNumberTuple.orUndefined, [
        {value: undefined, valid: true},
        {value: ['hello', 42], valid: true},
        {value: null, valid: false, issue: GGIssueKey.required},
        {value: ['wrong'], valid: false, issue: IsTupleErrors.lengthError},
    ]);

    testObjectValidation('orNull', StringNumberTuple.orNull, [
        {value: null, valid: true},
        {value: ['hello', 42], valid: true},
        {value: undefined, valid: false, issue: GGIssueKey.required},
        {value: [42, 'wrong'], valid: false, issue: IsStringErrors.typeError, path: 'root.0'},
    ]);

    describe('coercion', () => {
        it('should coerce elements when coerce flag is true', () => {
            const issues = new GGIssuesList();
            const result = StringNumberTuple._parse([123, '42'], issues, 'test', true);
            expect(result).toEqual(['123', 42]);
            expect(issues.length).toBe(0);
        });
    });

    describe('single element tuple', () => {
        const SingleTuple = IsTuple(IsString);

        testObjectValidation('validation', SingleTuple, [
            {value: ['hello'], valid: true},
            {value: [], valid: false, issue: IsTupleErrors.lengthError},
            {value: ['hello', 'world'], valid: false, issue: IsTupleErrors.lengthError},
        ]);
    });

    describe('triple element tuple', () => {
        const TripleTuple = IsTuple(IsString, IsNumber, IsBoolean);

        testObjectValidation('validation', TripleTuple, [
            {value: ['hello', 42, true], valid: true},
            {value: ['', 0, false], valid: true},
            {value: [true, 'hello', 42], valid: false, issue: IsStringErrors.typeError, path: 'root.0'},
        ]);
    });

    describe('nested tuples', () => {
        const NestedTuple = IsTuple(IsString, IsTuple(IsNumber, IsBoolean));

        testObjectValidation('validation', NestedTuple, [
            {value: ['hello', [42, true]], valid: true},
            {value: ['', [0, false]], valid: true},
            {value: ['hello', [42]], valid: false, issue: IsTupleErrors.lengthError, path: 'root.1'},
            {value: ['hello', ['wrong', true]], valid: false, issue: IsNumberErrors.typeError, path: 'root.1.0'},
            {value: ['hello', 42], valid: false, issue: IsTupleErrors.typeError, path: 'root.1'},
        ]);
    });

    describe('tuple with optional elements', () => {
        const OptionalTuple = IsTuple(IsString, IsNumber.orUndefined);

        testObjectValidation('validation', OptionalTuple, [
            {value: ['hello', 42], valid: true},
            {value: ['hello', undefined], valid: true},
            {value: ['hello'], valid: false, issue: IsTupleErrors.lengthError},
        ]);
    });

    describe('length error params', () => {
        it('should include expected and actual in error params', () => {
            const issues = new GGIssuesList();
            StringNumberTuple._parse(['a', 'b', 'c'], issues, 'test');
            const params = issues.getParams(0) as { expected: number, actual: number };
            expect(params.expected).toBe(2);
            expect(params.actual).toBe(3);
        });
    });

    describe('docs()', () => {
        it('should add documentation', () => {
            const schema = StringNumberTuple.docs({
                title: 'NameAge',
                description: 'A tuple of name and age'
            });
            expect(schema.def.docs?.title).toBe('NameAge');
            expect(schema.def.docs?.description).toBe('A tuple of name and age');
        });
    });

    // ==================== Refinement ====================

    describe('refine()', () => {
        const NonEmptyFirstTuple = IsTuple(IsString, IsNumber).refine(
            ([str]) => str.length > 0,
            nonEmptyFirstError
        );

        it('accepts values passing refinement', () => {
            expect(NonEmptyFirstTuple.is(['hello', 42])).toBe(true);
            expect(NonEmptyFirstTuple.is(['x', 0])).toBe(true);
        });

        it('rejects values failing refinement', () => {
            expect(NonEmptyFirstTuple.is(['', 42])).toBe(false);
        });

        it('adds correct error for failing refinement', () => {
            const issues = new GGIssuesList();
            expect(NonEmptyFirstTuple._parse(['', 42], issues, 'test')).toBeUndefined();
            expect(issues.getIssue(0)).toBe(nonEmptyFirstError);
        });
    });

    // ==================== Stringify ====================

    testStringify('stringify', StringNumberTuple, [
        {value: ['hello', 42], expected: ['hello', 42]},
        {value: ['', 0], expected: ['', 0]},
    ]);

    testStringify('stringify triple tuple', IsTuple(IsString, IsNumber, IsBoolean), [
        {value: ['hello', 42, true], expected: ['hello', 42, true]},
        {value: ['', 0, false], expected: ['', 0, false]},
    ]);

    testStringify('stringify nested tuple', IsTuple(IsString, IsTuple(IsNumber, IsBoolean)), [
        {value: ['hello', [42, true]], expected: ['hello', [42, true]]},
    ]);

    testStringify('stringify orNull', StringNumberTuple.orNull, [
        {value: ['hello', 42], expected: ['hello', 42]},
        {value: null, expected: null},
    ]);

    // ==================== Property Stripping ====================

    describe('strips extra properties from object elements', () => {
        const UserSchema = IsObject({name: IsString, age: IsNumber});
        const UserStringTuple = IsTuple(UserSchema, IsString);

        it('should strip extra properties from object in tuple', () => {
            const issues = new GGIssuesList();
            const input = [{name: 'John', age: 30, extra: 'ignored', password: 'secret'}, 'active'];
            const result = UserStringTuple._parse(input, issues, 'user');

            expect(issues.length).toBe(0);
            expect(result).toBeDefined();
            expect(result![0]).toEqual({name: 'John', age: 30});
            expect(result![1]).toBe('active');
            expect(Object.keys(result![0])).toEqual(['name', 'age']);
        });

        it('should strip extra properties from multiple objects in tuple', () => {
            const TwoUsers = IsTuple(UserSchema, UserSchema);
            const issues = new GGIssuesList();
            const input = [
                {name: 'John', age: 30, secret: 'hidden'},
                {name: 'Jane', age: 25, password: '123'}
            ];
            const result = TwoUsers._parse(input, issues, 'users');

            expect(issues.length).toBe(0);
            expect(result).toBeDefined();
            expect(result![0]).toEqual({name: 'John', age: 30});
            expect(result![1]).toEqual({name: 'Jane', age: 25});
        });
    });

    // ==================== Recursive Tuple (via factory) ====================

    describe('recursive tuple schema', () => {
        // Linked list node: [value, next] where next is either null or another node
        type LinkedListNode = [number, LinkedListNode | null];

        const LinkedListSchema: TupleSchema<LinkedListNode> = IsTuple(() => [
            IsNumber,
            LinkedListSchema.orNull
        ] as const);

        it('validates single node (null tail)', () => {
            expect(LinkedListSchema.is([42, null])).toBe(true);
        });

        it('validates chain of two nodes', () => {
            const list: LinkedListNode = [1, [2, null]];
            expect(LinkedListSchema.is(list)).toBe(true);
        });

        it('validates longer chain', () => {
            const list: LinkedListNode = [1, [2, [3, [4, null]]]];
            expect(LinkedListSchema.is(list)).toBe(true);
        });

        it('rejects invalid value type', () => {
            expect(LinkedListSchema.is(['not a number', null])).toBe(false);
        });

        it('rejects invalid tail type', () => {
            expect(LinkedListSchema.is([1, 'not a list'])).toBe(false);
        });

        it('rejects invalid nested node', () => {
            expect(LinkedListSchema.is([1, ['invalid', null]])).toBe(false);
        });

        it('parses recursive structure', () => {
            const issues = new GGIssuesList();
            const input = [1, [2, [3, null]]];
            const result = LinkedListSchema._parse(input, issues, '');
            expect(issues.length).toBe(0);
            expect(result).toEqual([1, [2, [3, null]]]);
        });

        it('stringifies recursive structure', () => {
            const list: LinkedListNode = [1, [2, [3, null]]];
            const result = LinkedListSchema.stringify(list);
            expect(JSON.parse(result!)).toEqual([1, [2, [3, null]]]);
        });
    });

    describe('recursive tuple with object elements', () => {
        // Binary tree as tuple: [value, left, right]
        interface TreeValue {
            label: string
        }

        type BinaryTreeTuple = [TreeValue, BinaryTreeTuple | null, BinaryTreeTuple | null];

        const TreeValueSchema = IsObject({label: IsString});
        const BinaryTreeSchema: TupleSchema<BinaryTreeTuple> = IsTuple(() => [
            TreeValueSchema,
            BinaryTreeSchema.orNull,
            BinaryTreeSchema.orNull
        ] as const);

        it('validates leaf node', () => {
            expect(BinaryTreeSchema.is([{label: 'root'}, null, null])).toBe(true);
        });

        it('validates tree with children', () => {
            const tree: BinaryTreeTuple = [
                {label: 'root'},
                [{label: 'left'}, null, null],
                [{label: 'right'}, null, null]
            ];
            expect(BinaryTreeSchema.is(tree)).toBe(true);
        });

        it('validates deeply nested tree', () => {
            const tree: BinaryTreeTuple = [
                {label: 'root'},
                [
                    {label: 'left'},
                    [{label: 'left-left'}, null, null],
                    [{label: 'left-right'}, null, null]
                ],
                null
            ];
            expect(BinaryTreeSchema.is(tree)).toBe(true);
        });

        it('parses and strips extra properties', () => {
            const issues = new GGIssuesList();
            const input = [
                {label: 'root', EXTRA: 'stripped'},
                [{label: 'left', NESTED_EXTRA: 'also stripped'}, null, null],
                null
            ];
            const result = BinaryTreeSchema._parse(input, issues, '');
            expect(issues.length).toBe(0);
            expect(result).toEqual([
                {label: 'root'},
                [{label: 'left'}, null, null],
                null
            ]);
        });

        it('stringifies tree structure', () => {
            const tree: BinaryTreeTuple = [
                {label: 'root'},
                [{label: 'left'}, null, null],
                null
            ];
            const result = BinaryTreeSchema.stringify(tree);
            expect(JSON.parse(result!)).toEqual(tree);
        });
    });

    // ==================== Nullable Object Elements ====================

    describe('nullable object elements', () => {
        const UserSchema = IsObject({name: IsString, age: IsNumber});

        it('validates tuple with nullable object element', () => {
            const Schema = IsTuple(IsString, UserSchema.orNull);
            expect(Schema.is(['active', {name: 'John', age: 30}])).toBe(true);
            expect(Schema.is(['inactive', null])).toBe(true);
            expect(Schema.is(['inactive', undefined])).toBe(false);
        });

        it('parse preserves null for nullable object element', () => {
            const Schema = IsTuple(IsString, UserSchema.orNull);
            const issues = new GGIssuesList();
            const result = Schema._parse(['inactive', null], issues, 'test');
            expect(issues.length).toBe(0);
            expect(result).toEqual(['inactive', null]);
            expect(result![1]).toBe(null);
        });

        it('parse strips extra props from non-null object, preserves null', () => {
            const Schema = IsTuple(UserSchema.orNull, IsString, UserSchema.orNull);
            const issues = new GGIssuesList();
            const input = [{name: 'John', age: 30, extra: 'ignored'}, 'middle', null];
            const result = Schema._parse(input, issues, 'test');
            expect(issues.length).toBe(0);
            expect(result).toEqual([{name: 'John', age: 30}, 'middle', null]);
            expect(Object.keys(result![0]!)).toEqual(['name', 'age']);
            expect(result![2]).toBe(null);
        });

        it('validates tuple with optional object element', () => {
            const Schema = IsTuple(IsString, UserSchema.orUndefined);
            expect(Schema.is(['active', {name: 'John', age: 30}])).toBe(true);
            expect(Schema.is(['inactive', undefined])).toBe(true);
            expect(Schema.is(['inactive', null])).toBe(false);
        });

        it('parse preserves undefined for optional object element', () => {
            const Schema = IsTuple(IsString, UserSchema.orUndefined);
            const issues = new GGIssuesList();
            const result = Schema._parse(['inactive', undefined], issues, 'test');
            expect(issues.length).toBe(0);
            expect(result).toEqual(['inactive', undefined]);
            expect(result![1]).toBe(undefined);
        });
    });

    // ==================== Null vs Undefined Preservation ====================

    describe('null vs undefined preservation in parse', () => {
        const UserSchema = IsObject({name: IsString});

        it('orNull tuple preserves null (not converts to undefined)', () => {
            const MaybeUserTuple = IsTuple(UserSchema).orNull;

            const issues = new GGIssuesList();
            const result = MaybeUserTuple._parse(null, issues, '');

            expect(issues.length).toBe(0);
            expect(result).toBeNull();
            expect(result).not.toBeUndefined();
        });

        it('orUndefined tuple preserves undefined (not converts to null)', () => {
            const MaybeUserTuple = IsTuple(UserSchema).orUndefined;

            const issues = new GGIssuesList();
            const result = MaybeUserTuple._parse(undefined, issues, '');

            expect(issues.length).toBe(0);
            expect(result).toBeUndefined();
            expect(result).not.toBeNull();
        });

        it('recursive orNull preserves null at nested level', () => {
            type Node = [string, Node | null];
            const NodeSchema: TupleSchema<Node> = IsTuple(() => [
                IsString,
                NodeSchema.orNull
            ] as const);

            const issues = new GGIssuesList();
            const input = ['root', ['child', null]];
            const result = NodeSchema._parse(input, issues, '');

            expect(issues.length).toBe(0);
            expect(result).toEqual(['root', ['child', null]]);
            expect(result![1]![1]).toBeNull();
            expect(result![1]![1]).not.toBeUndefined();
        });

        it('recursive orUndefined preserves undefined at nested level', () => {
            type Node = [string, Node | undefined];
            const NodeSchema: TupleSchema<Node> = IsTuple(() => [
                IsString,
                NodeSchema.orUndefined
            ] as const);

            const issues = new GGIssuesList();
            const input = ['root', ['child', undefined]];
            const result = NodeSchema._parse(input, issues, '');

            expect(issues.length).toBe(0);
            expect(result).toEqual(['root', ['child', undefined]]);
            expect(result![1]![1]).toBeUndefined();
            expect(result![1]![1]).not.toBeNull();
        });
    });

    // ==================== Defaults in Tuple Elements ====================

    describe('defaults in tuple elements', () => {
        const Entry = IsObject({
            label: IsString,
            value: IsNumber.orNull.default(0),
        });
        const Pair = IsTuple(IsString, Entry);

        it('applies defaults to object element in tuple', () => {
            const issues = new GGIssuesList();
            const result = Pair._parse(["key", {label: "count", value: null}], issues, 'test', true);
            expect(issues.length).toBe(0);
            expect(result).toStrictEqual(["key", {label: "count", value: 0}]);
        });

        it('parse result always passes is()', () => {
            const issues = new GGIssuesList();
            const result = Pair._parse(["key", {label: "count", value: null}], issues, 'test', true);
            expect(issues.length).toBe(0);
            expect(Pair.is(result)).toBe(true);
        });

        it('preserves actual value over default in tuple element', () => {
            const issues = new GGIssuesList();
            const result = Pair._parse(["key", {label: "count", value: 42}], issues, 'test');
            expect(issues.length).toBe(0);
            expect(result).toStrictEqual(["key", {label: "count", value: 42}]);
        });
    });

    // ==================== toSchemaDescription ====================

    describe('toSchemaDescription()', () => {
        it('basic two-element tuple', () => {
            const desc = IsTuple(IsString, IsNumber).toSchemaDescription();
            expect(desc.node.kind).toBe('tuple');
            const elements = (desc.node as any).elements as any[];
            expect(elements).toHaveLength(2);
            expect(elements[0].node).toEqual({kind: 'string'});
            expect(elements[1].node).toEqual({kind: 'number', integer: false});
            expect(desc.nullable).toBe(false);
        });
        it('single-element tuple', () => {
            const desc = IsTuple(IsBoolean).toSchemaDescription();
            expect(desc.node.kind).toBe('tuple');
            const elements = (desc.node as any).elements as any[];
            expect(elements).toHaveLength(1);
            expect(elements[0].node).toEqual({kind: 'boolean'});
        });
        it('nullable sets nullable:true, node stays tuple', () => {
            const desc = IsTuple(IsString, IsNumber).orNull.toSchemaDescription();
            expect(desc.node.kind).toBe('tuple');
            expect(desc.nullable).toBe(true);
            const elements = (desc.node as any).elements as any[];
            expect(elements).toHaveLength(2);
        });
    });
});
