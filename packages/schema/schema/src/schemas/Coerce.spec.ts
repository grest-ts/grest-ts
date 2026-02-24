import {describe, expect, it} from 'vitest';
import {IsString} from './IsString';
import {IsNumber} from './IsNumber';
import {IsBoolean} from './IsBoolean';
import {IsBit} from './IsBit';
import {IsArray} from './IsArray';
import {IsObject} from './IsObject';
import {IsTuple} from './IsTuple';
import {IsRecord} from './IsRecord';
import {IsUnion} from './IsUnion';
import {IsDiscriminated} from './IsDiscriminated';
import {IsLiteral} from './IsLiteral';
import {GGIssuesList} from '../issue/GGIssuesList';
import {testUtils} from '../utils/testUtils';
import {IsStringErrors} from '../Errors';

// Language coercion - the use case from the issue
const IsLanguage = IsString
    .coerce((lang: string) => {
        return lang && lang !== '*' && lang.trim() !== '' ? lang.split(',')[0].split('-')[0]?.toLowerCase() : lang;
    })
    .regex(/^[a-z]{2}$/, IsStringErrors.patternError)
    .brand('language')
    .docs({
        title: 'Language code',
        description: 'ISO 639-1',
        example: 'en'
    });

testUtils('Coerce', () => {

    describe('IsString.coerce', () => {
        const UpperToLower = IsString.coerce(v => v.toLowerCase());

        it('should transform valid values with coerce=true', () => {
            const issues = new GGIssuesList();
            const result = UpperToLower._parse('HELLO', issues, 'test', true);
            expect(result).toBe('hello');
            expect(issues.length).toBe(0);
        });

        it('should not transform with coerce=false', () => {
            const issues = new GGIssuesList();
            const result = UpperToLower._parse('hello', issues, 'test', false);
            expect(result).toBe('hello');
            expect(issues.length).toBe(0);
        });

        it('should coerce number to string with coerce=true', () => {
            const issues = new GGIssuesList();
            // Built-in coercion converts 123 to '123', then user coercion lowercases it
            const result = UpperToLower._parse(123, issues, 'test', true);
            expect(result).toBe('123');
            expect(issues.length).toBe(0);
        });

        it('should reject objects even with coerce=true', () => {
            const issues = new GGIssuesList();
            const result = UpperToLower._parse({}, issues, 'test', true);
            expect(result).toBeUndefined();
            expect(issues.length).toBeGreaterThan(0);
        });
    });

    describe('IsLanguage (real use case)', () => {
        it('should coerce "en-US" to "en"', () => {
            const issues = new GGIssuesList();
            const result = IsLanguage._parse('en-US', issues, 'test', true);
            expect(result).toBe('en');
            expect(issues.length).toBe(0);
        });

        it('should coerce "en,de" to "en"', () => {
            const issues = new GGIssuesList();
            const result = IsLanguage._parse('en,de', issues, 'test', true);
            expect(result).toBe('en');
            expect(issues.length).toBe(0);
        });

        it('should coerce "EN-US" to "en" (lowercase)', () => {
            const issues = new GGIssuesList();
            const result = IsLanguage._parse('EN-US', issues, 'test', true);
            expect(result).toBe('en');
            expect(issues.length).toBe(0);
        });

        it('should pass through valid values', () => {
            const issues = new GGIssuesList();
            const result = IsLanguage._parse('en', issues, 'test', true);
            expect(result).toBe('en');
            expect(issues.length).toBe(0);
        });

        it('should reject invalid values', () => {
            const issues = new GGIssuesList();
            const result = IsLanguage._parse('eng', issues, 'test', true); // 3 chars, not 2
            expect(result).toBeUndefined();
            expect(issues.length).toBeGreaterThan(0);
        });

        it('should handle * character', () => {
            const issues = new GGIssuesList();
            const result = IsLanguage._parse('*', issues, 'test', true);
            // * stays as * and fails regex
            expect(result).toBeUndefined();
            expect(issues.length).toBeGreaterThan(0);
        });
    });

    describe('chained coercions', () => {
        const TrimAndLower = IsString
            .coerce(v => v.trim())
            .coerce(v => v.toLowerCase());

        it('should apply multiple coercions in order', () => {
            const issues = new GGIssuesList();
            const result = TrimAndLower._parse('  HELLO  ', issues, 'test', true);
            expect(result).toBe('hello');
            expect(issues.length).toBe(0);
        });
    });

    describe('IsNumber.coerce', () => {
        const RoundNumber = IsNumber.coerce(v => Math.round(v));

        it('should transform numbers', () => {
            const issues = new GGIssuesList();
            const result = RoundNumber._parse(3.7, issues, 'test', true);
            expect(result).toBe(4);
            expect(issues.length).toBe(0);
        });

        it('should coerce string to number first, then apply coercion', () => {
            const issues = new GGIssuesList();
            const result = RoundNumber._parse('3.7', issues, 'test', true);
            expect(result).toBe(4);
            expect(issues.length).toBe(0);
        });
    });

    describe('IsArray with coerce', () => {
        const ArrayOfLower = IsArray(IsString.coerce(v => v.toLowerCase()));

        it('should coerce each element', () => {
            const issues = new GGIssuesList();
            const result = ArrayOfLower._parse(['HELLO', 'WORLD'], issues, 'test', true);
            expect(result).toEqual(['hello', 'world']);
            expect(issues.length).toBe(0);
        });

        it('should handle empty array', () => {
            const issues = new GGIssuesList();
            const result = ArrayOfLower._parse([], issues, 'test', true);
            expect(result).toEqual([]);
            expect(issues.length).toBe(0);
        });
    });

    describe('IsObject with coerce', () => {
        const PersonSchema = IsObject({
            name: IsString.coerce(v => v.trim()),
            age: IsNumber
        });

        it('should coerce object fields', () => {
            const issues = new GGIssuesList();
            const result = PersonSchema._parse({name: '  John  ', age: 30}, issues, 'test', true);
            expect(result).toEqual({name: 'John', age: 30});
            expect(issues.length).toBe(0);
        });

        it('should coerce string to number for age', () => {
            const issues = new GGIssuesList();
            const result = PersonSchema._parse({name: 'John', age: '30'}, issues, 'test', true);
            expect(result).toEqual({name: 'John', age: 30});
            expect(issues.length).toBe(0);
        });
    });

    describe('IsTuple with coerce', () => {
        const NameAgeTuple = IsTuple(
            IsString.coerce(v => v.toLowerCase()),
            IsNumber
        );

        it('should coerce tuple elements', () => {
            const issues = new GGIssuesList();
            const result = NameAgeTuple._parse(['JOHN', 30], issues, 'test', true);
            expect(result).toEqual(['john', 30]);
            expect(issues.length).toBe(0);
        });

        it('should coerce string to number', () => {
            const issues = new GGIssuesList();
            const result = NameAgeTuple._parse(['john', '30'], issues, 'test', true);
            expect(result).toEqual(['john', 30]);
            expect(issues.length).toBe(0);
        });
    });

    describe('IsRecord with coerce', () => {
        const StringRecord = IsRecord(IsString, IsString.coerce(v => v.toUpperCase()));

        it('should coerce record values', () => {
            const issues = new GGIssuesList();
            const result = StringRecord._parse({a: 'hello', b: 'world'}, issues, 'test', true);
            expect(result).toEqual({a: 'HELLO', b: 'WORLD'});
            expect(issues.length).toBe(0);
        });
    });

    describe('IsUnion with coerce', () => {
        const StringOrNumber = IsUnion(IsString, IsNumber);

        it('should coerce to first matching variant (string)', () => {
            const issues = new GGIssuesList();
            // Boolean coerces to string 'true' via first matching variant
            const result = StringOrNumber._parse(true, issues, 'test', true);
            expect(result).toBe('true');
            expect(issues.length).toBe(0);
        });

        it('should use second variant when value matches it as-is', () => {
            const NumberFirst = IsUnion(IsNumber.min(0), IsString);
            const issues = new GGIssuesList();
            // '42' is already a valid string (second variant), so no coercion needed
            const result = NumberFirst._parse('42', issues, 'test', true);
            expect(result).toBe('42');
            expect(issues.length).toBe(0);
        });

        it('should coerce invalid value to first matching variant', () => {
            const StringOrNumber = IsUnion(IsString, IsNumber);
            const issues = new GGIssuesList();
            // true is not a string or number, but can be coerced to 'true' (string)
            const result = StringOrNumber._parse(true, issues, 'test', true);
            expect(result).toBe('true');
            expect(issues.length).toBe(0);
        });
    });

    describe('IsDiscriminated with coerce', () => {
        const MessageType = IsDiscriminated('type', {
            text: IsObject({type: IsLiteral('text'), content: IsString.coerce(v => v.trim())}),
            number: IsObject({type: IsLiteral('number'), value: IsNumber})
        });

        it('should coerce discriminated variant fields', () => {
            const issues = new GGIssuesList();
            const result = MessageType._parse({type: 'text', content: '  hello  '}, issues, 'test', true);
            expect(result).toEqual({type: 'text', content: 'hello'});
            expect(issues.length).toBe(0);
        });

        it('should coerce string to number in number variant', () => {
            const issues = new GGIssuesList();
            const result = MessageType._parse({type: 'number', value: '42'}, issues, 'test', true);
            expect(result).toEqual({type: 'number', value: 42});
            expect(issues.length).toBe(0);
        });
    });

    describe('IsBit with coerce', () => {
        it('should coerce true to 1', () => {
            const issues = new GGIssuesList();
            const result = IsBit._parse(true, issues, 'test', true);
            expect(result).toBe(1);
            expect(issues.length).toBe(0);
        });

        it('should coerce false to 0', () => {
            const issues = new GGIssuesList();
            const result = IsBit._parse(false, issues, 'test', true);
            expect(result).toBe(0);
            expect(issues.length).toBe(0);
        });

        it('should coerce "1" to 1', () => {
            const issues = new GGIssuesList();
            const result = IsBit._parse('1', issues, 'test', true);
            expect(result).toBe(1);
            expect(issues.length).toBe(0);
        });

        it('should coerce "0" to 0', () => {
            const issues = new GGIssuesList();
            const result = IsBit._parse('0', issues, 'test', true);
            expect(result).toBe(0);
            expect(issues.length).toBe(0);
        });
    });

    describe('IsBoolean with coerce', () => {
        it('should coerce "true" to true', () => {
            const issues = new GGIssuesList();
            const result = IsBoolean._parse('true', issues, 'test', true);
            expect(result).toBe(true);
            expect(issues.length).toBe(0);
        });

        it('should coerce "false" to false', () => {
            const issues = new GGIssuesList();
            const result = IsBoolean._parse('false', issues, 'test', true);
            expect(result).toBe(false);
            expect(issues.length).toBe(0);
        });

        it('should coerce 1 to true', () => {
            const issues = new GGIssuesList();
            const result = IsBoolean._parse(1, issues, 'test', true);
            expect(result).toBe(true);
            expect(issues.length).toBe(0);
        });

        it('should coerce 0 to false', () => {
            const issues = new GGIssuesList();
            const result = IsBoolean._parse(0, issues, 'test', true);
            expect(result).toBe(false);
            expect(issues.length).toBe(0);
        });
    });

    describe('coerce with optional/nullable', () => {
        const OptionalLower = IsString.coerce(v => v.toLowerCase()).orUndefined;

        it('should pass through undefined', () => {
            const issues = new GGIssuesList();
            const result = OptionalLower._parse(undefined, issues, 'test', true);
            expect(result).toBeUndefined();
            expect(issues.length).toBe(0);
        });

        it('should coerce non-undefined values', () => {
            const issues = new GGIssuesList();
            const result = OptionalLower._parse('HELLO', issues, 'test', true);
            expect(result).toBe('hello');
            expect(issues.length).toBe(0);
        });

        const NullableLower = IsString.coerce(v => v.toLowerCase()).orNull;

        it('should pass through null', () => {
            const issues = new GGIssuesList();
            const result = NullableLower._parse(null, issues, 'test', true);
            expect(result).toBeNull();
            expect(issues.length).toBe(0);
        });
    });

    describe('coerce with default', () => {
        const DefaultString = IsString.coerce(v => v.toLowerCase()).default('default');

        it('should use default for undefined', () => {
            const issues = new GGIssuesList();
            const result = DefaultString._parse(undefined, issues, 'test', true);
            expect(result).toBe('default');
            expect(issues.length).toBe(0);
        });

        it('should coerce provided values', () => {
            const issues = new GGIssuesList();
            const result = DefaultString._parse('HELLO', issues, 'test', true);
            expect(result).toBe('hello');
            expect(issues.length).toBe(0);
        });
    });

    describe('nested coercion (deeply nested)', () => {
        const DeepSchema = IsObject({
            outer: IsObject({
                inner: IsArray(IsString.coerce(v => v.toUpperCase()))
            })
        });

        it('should coerce deeply nested values', () => {
            const issues = new GGIssuesList();
            const result = DeepSchema._parse({
                outer: {
                    inner: ['hello', 'world']
                }
            }, issues, 'test', true);
            expect(result).toEqual({
                outer: {
                    inner: ['HELLO', 'WORLD']
                }
            });
            expect(issues.length).toBe(0);
        });
    });

    // ──────────────────────────────────────────────────────────────────────────
    // Complex nested type tests for thorough AOT/CODE coverage
    // ──────────────────────────────────────────────────────────────────────────

    describe('Array of objects with coercion', () => {
        const UsersSchema = IsArray(IsObject({
            name: IsString.coerce(v => v.trim()),
            email: IsString.coerce(v => v.toLowerCase()),
            age: IsNumber
        }));

        it('should coerce fields in each array element', () => {
            const issues = new GGIssuesList();
            const result = UsersSchema._parse([
                {name: '  John  ', email: 'JOHN@EXAMPLE.COM', age: 30},
                {name: '  Jane  ', email: 'JANE@EXAMPLE.COM', age: 25}
            ], issues, 'test', true);
            expect(result).toEqual([
                {name: 'John', email: 'john@example.com', age: 30},
                {name: 'Jane', email: 'jane@example.com', age: 25}
            ]);
            expect(issues.length).toBe(0);
        });

        it('should coerce string to number in object fields', () => {
            const issues = new GGIssuesList();
            const result = UsersSchema._parse([
                {name: 'John', email: 'john@example.com', age: '30'}
            ], issues, 'test', true);
            expect(result).toEqual([
                {name: 'John', email: 'john@example.com', age: 30}
            ]);
            expect(issues.length).toBe(0);
        });
    });

    describe('Nested arrays with coercion', () => {
        const MatrixSchema = IsArray(IsArray(IsNumber));

        it('should coerce strings to numbers in nested arrays', () => {
            const issues = new GGIssuesList();
            const result = MatrixSchema._parse([
                ['1', '2', '3'],
                ['4', '5', '6']
            ], issues, 'test', true);
            expect(result).toEqual([
                [1, 2, 3],
                [4, 5, 6]
            ]);
            expect(issues.length).toBe(0);
        });

        it('should handle mixed coercion in nested arrays', () => {
            const issues = new GGIssuesList();
            const result = MatrixSchema._parse([
                [1, '2', 3],
                ['4', 5, '6']
            ], issues, 'test', true);
            expect(result).toEqual([
                [1, 2, 3],
                [4, 5, 6]
            ]);
            expect(issues.length).toBe(0);
        });
    });

    describe('Object with optional fields with coercion', () => {
        const ConfigSchema = IsObject({
            host: IsString.coerce(v => v.toLowerCase()),
            port: IsNumber,
            debug: IsBoolean.orUndefined,
            tags: IsArray(IsString.coerce(v => v.trim())).orUndefined
        });

        it('should coerce present optional fields', () => {
            const issues = new GGIssuesList();
            const result = ConfigSchema._parse({
                host: 'LOCALHOST',
                port: '8080',
                debug: 'true',
                tags: ['  dev  ', '  test  ']
            }, issues, 'test', true);
            expect(result).toEqual({
                host: 'localhost',
                port: 8080,
                debug: true,
                tags: ['dev', 'test']
            });
            expect(issues.length).toBe(0);
        });

        it('should handle missing optional fields', () => {
            const issues = new GGIssuesList();
            const result = ConfigSchema._parse({
                host: 'LOCALHOST',
                port: 8080
            }, issues, 'test', true);
            expect(result).toEqual({
                host: 'localhost',
                port: 8080
            });
            expect(issues.length).toBe(0);
        });
    });

    describe('Tuple containing objects and arrays', () => {
        const MixedTuple = IsTuple(
            IsObject({name: IsString.coerce(v => v.toUpperCase())}),
            IsArray(IsNumber),
            IsString.coerce(v => v.trim())
        );

        it('should coerce all tuple elements', () => {
            const issues = new GGIssuesList();
            const result = MixedTuple._parse([
                {name: 'john'},
                ['1', '2', '3'],
                '  hello  '
            ], issues, 'test', true);
            expect(result).toEqual([
                {name: 'JOHN'},
                [1, 2, 3],
                'hello'
            ]);
            expect(issues.length).toBe(0);
        });
    });

    describe('Tuple with nested tuples', () => {
        const NestedTuple = IsTuple(
            IsTuple(IsString.coerce(v => v.toLowerCase()), IsNumber),
            IsTuple(IsBoolean, IsString.coerce(v => v.toUpperCase()))
        );

        it('should coerce nested tuple elements', () => {
            const issues = new GGIssuesList();
            const result = NestedTuple._parse([
                ['HELLO', '42'],
                ['true', 'world']
            ], issues, 'test', true);
            expect(result).toEqual([
                ['hello', 42],
                [true, 'WORLD']
            ]);
            expect(issues.length).toBe(0);
        });
    });

    describe('Record with complex value types', () => {
        const RecordOfArrays = IsRecord(
            IsString,
            IsArray(IsString.coerce(v => v.toUpperCase()))
        );

        it('should coerce array values in record', () => {
            const issues = new GGIssuesList();
            const result = RecordOfArrays._parse({
                fruits: ['apple', 'banana'],
                colors: ['red', 'blue', 'green']
            }, issues, 'test', true);
            expect(result).toEqual({
                fruits: ['APPLE', 'BANANA'],
                colors: ['RED', 'BLUE', 'GREEN']
            });
            expect(issues.length).toBe(0);
        });
    });

    describe('Record with object values', () => {
        const RecordOfObjects = IsRecord(
            IsString,
            IsObject({
                value: IsNumber,
                label: IsString.coerce(v => v.trim())
            })
        );

        it('should coerce object fields in record values', () => {
            const issues = new GGIssuesList();
            const result = RecordOfObjects._parse({
                item1: {value: '10', label: '  First  '},
                item2: {value: '20', label: '  Second  '}
            }, issues, 'test', true);
            expect(result).toEqual({
                item1: {value: 10, label: 'First'},
                item2: {value: 20, label: 'Second'}
            });
            expect(issues.length).toBe(0);
        });
    });

    describe('Discriminated with array fields', () => {
        const EventSchema = IsDiscriminated('type', {
            click: IsObject({
                type: IsLiteral('click'),
                coordinates: IsTuple(IsNumber, IsNumber),
                modifiers: IsArray(IsString.coerce(v => v.toLowerCase()))
            }),
            keyboard: IsObject({
                type: IsLiteral('keyboard'),
                keys: IsArray(IsString.coerce(v => v.toUpperCase())),
                repeat: IsNumber
            })
        });

        it('should coerce array fields in click variant', () => {
            const issues = new GGIssuesList();
            const result = EventSchema._parse({
                type: 'click',
                coordinates: ['100', '200'],
                modifiers: ['CTRL', 'SHIFT']
            }, issues, 'test', true);
            expect(result).toEqual({
                type: 'click',
                coordinates: [100, 200],
                modifiers: ['ctrl', 'shift']
            });
            expect(issues.length).toBe(0);
        });

        it('should coerce array fields in keyboard variant', () => {
            const issues = new GGIssuesList();
            const result = EventSchema._parse({
                type: 'keyboard',
                keys: ['enter', 'space'],
                repeat: '5'
            }, issues, 'test', true);
            expect(result).toEqual({
                type: 'keyboard',
                keys: ['ENTER', 'SPACE'],
                repeat: 5
            });
            expect(issues.length).toBe(0);
        });
    });

    describe('Discriminated with nested objects', () => {
        const ResponseSchema = IsDiscriminated('status', {
            success: IsObject({
                status: IsLiteral('success'),
                data: IsObject({
                    id: IsNumber,
                    name: IsString.coerce(v => v.trim()),
                    tags: IsArray(IsString.coerce(v => v.toLowerCase()))
                })
            }),
            error: IsObject({
                status: IsLiteral('error'),
                message: IsString.coerce(v => v.toUpperCase()),
                code: IsNumber
            })
        });

        it('should coerce nested object in success variant', () => {
            const issues = new GGIssuesList();
            const result = ResponseSchema._parse({
                status: 'success',
                data: {
                    id: '123',
                    name: '  Test Item  ',
                    tags: ['TAG1', 'TAG2']
                }
            }, issues, 'test', true);
            expect(result).toEqual({
                status: 'success',
                data: {
                    id: 123,
                    name: 'Test Item',
                    tags: ['tag1', 'tag2']
                }
            });
            expect(issues.length).toBe(0);
        });

        it('should coerce fields in error variant', () => {
            const issues = new GGIssuesList();
            const result = ResponseSchema._parse({
                status: 'error',
                message: 'something went wrong',
                code: '500'
            }, issues, 'test', true);
            expect(result).toEqual({
                status: 'error',
                message: 'SOMETHING WENT WRONG',
                code: 500
            });
            expect(issues.length).toBe(0);
        });
    });

    describe('Complex mixed nesting', () => {
        const ComplexSchema = IsObject({
            users: IsArray(IsObject({
                profile: IsObject({
                    name: IsString.coerce(v => v.trim()),
                    email: IsString.coerce(v => v.toLowerCase())
                }),
                scores: IsTuple(IsNumber, IsNumber, IsNumber),
                metadata: IsRecord(IsString, IsString.coerce(v => v.toUpperCase()))
            }))
        });

        it('should coerce all nested levels', () => {
            const issues = new GGIssuesList();
            const result = ComplexSchema._parse({
                users: [{
                    profile: {
                        name: '  John Doe  ',
                        email: 'JOHN@EXAMPLE.COM'
                    },
                    scores: ['85', '90', '95'],
                    metadata: {
                        role: 'admin',
                        status: 'active'
                    }
                }]
            }, issues, 'test', true);
            expect(result).toEqual({
                users: [{
                    profile: {
                        name: 'John Doe',
                        email: 'john@example.com'
                    },
                    scores: [85, 90, 95],
                    metadata: {
                        role: 'ADMIN',
                        status: 'ACTIVE'
                    }
                }]
            });
            expect(issues.length).toBe(0);
        });
    });

    describe('Union with complex variants', () => {
        const DataSchema = IsUnion(
            IsArray(IsString.coerce(v => v.toLowerCase())),
            IsObject({value: IsNumber, label: IsString.coerce(v => v.trim())})
        );

        it('should coerce array variant', () => {
            const issues = new GGIssuesList();
            const result = DataSchema._parse(['HELLO', 'WORLD'], issues, 'test', true);
            expect(result).toEqual(['hello', 'world']);
            expect(issues.length).toBe(0);
        });

        it('should coerce object variant', () => {
            const issues = new GGIssuesList();
            const result = DataSchema._parse({value: '42', label: '  test  '}, issues, 'test', true);
            expect(result).toEqual({value: 42, label: 'test'});
            expect(issues.length).toBe(0);
        });
    });

    describe('Array of discriminated unions', () => {
        const ItemSchema = IsDiscriminated('kind', {
            text: IsObject({kind: IsLiteral('text'), content: IsString.coerce(v => v.trim())}),
            number: IsObject({kind: IsLiteral('number'), value: IsNumber})
        });
        const ItemsArray = IsArray(ItemSchema);

        it('should coerce each discriminated item in array', () => {
            const issues = new GGIssuesList();
            const result = ItemsArray._parse([
                {kind: 'text', content: '  hello  '},
                {kind: 'number', value: '42'},
                {kind: 'text', content: '  world  '}
            ], issues, 'test', true);
            expect(result).toEqual([
                {kind: 'text', content: 'hello'},
                {kind: 'number', value: 42},
                {kind: 'text', content: 'world'}
            ]);
            expect(issues.length).toBe(0);
        });
    });

    describe('Record of tuples', () => {
        const PointsRecord = IsRecord(
            IsString,
            IsTuple(IsNumber, IsNumber, IsString.coerce(v => v.toUpperCase()))
        );

        it('should coerce tuple values in record', () => {
            const issues = new GGIssuesList();
            const result = PointsRecord._parse({
                start: ['0', '0', 'origin'],
                end: ['100', '200', 'destination']
            }, issues, 'test', true);
            expect(result).toEqual({
                start: [0, 0, 'ORIGIN'],
                end: [100, 200, 'DESTINATION']
            });
            expect(issues.length).toBe(0);
        });
    });
});
