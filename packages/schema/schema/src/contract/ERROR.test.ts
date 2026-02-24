import {describe, it, expect} from 'vitest';
import {ERROR, SERVER_ERROR} from './ERROR';
import {IsString} from '../schemas/IsString';
import {IsNumber} from '../schemas/IsNumber';
import {IsObject} from '../schemas/IsObject';

const MY_ERROR = ERROR.define('MY_ERROR', 418);

describe('ERROR', () => {

    describe('define()', () => {

        describe('without schema (no data)', () => {

            it('should set TYPE correctly', () => {
                expect(MY_ERROR.TYPE).toBe('MY_ERROR');
            });

            it('should set STATUS_CODE correctly', () => {
                expect(MY_ERROR.STATUS_CODE).toBe(418);
            });

            it('should have no schema', () => {
                expect(MY_ERROR.schema).toBeUndefined();
            });

            it('should create instance without data', () => {
                const error = new MY_ERROR();
                expect(error.type).toBe('MY_ERROR');
                expect(error.statusCode).toBe(418);
                expect(error.data).toBeUndefined();
                expect(error.success).toBe(false);
            });

            it('should create instance with context', () => {
                const error = new MY_ERROR({displayMessage: 'Test message'});
                expect(error.context?.displayMessage).toBe('Test message');
                expect(error.context?.timestamp).toBeDefined();
                expect(error.context?.ref).toBeDefined();
            });

            it('should generate unique ref for each instance', () => {
                const error1 = new MY_ERROR();
                const error2 = new MY_ERROR();
                expect(error1.context?.ref).not.toBe(error2.context?.ref);
            });

            it('should preserve custom ref', () => {
                const error = new MY_ERROR({ref: 'custom-ref-123'});
                expect(error.context?.ref).toBe('custom-ref-123');
            });

            it('should be frozen', () => {
                const error = new MY_ERROR();
                expect(Object.isFrozen(error)).toBe(true);
                expect(Object.isFrozen(error.context)).toBe(true);
            });

            it('should be an instance of Error', () => {
                const error = new MY_ERROR();
                expect(error).toBeInstanceOf(Error);
                expect(error).toBeInstanceOf(ERROR);
            });

            it('should have error message set to type', () => {
                const error = new MY_ERROR();
                expect(error.message).toBe('MY_ERROR');
            });
        });

        describe('with schema (has data)', () => {
            const DATA_ERROR = ERROR.define('DATA_ERROR', 400, IsObject({
                field: IsString,
                code: IsNumber
            }));

            it('should set TYPE correctly', () => {
                expect(DATA_ERROR.TYPE).toBe('DATA_ERROR');
            });

            it('should set STATUS_CODE correctly', () => {
                expect(DATA_ERROR.STATUS_CODE).toBe(400);
            });

            it('should have schema defined', () => {
                expect(DATA_ERROR.schema).toBeDefined();
            });

            it('should create instance with data', () => {
                const error = new DATA_ERROR({field: 'email', code: 123});
                expect(error.type).toBe('DATA_ERROR');
                expect(error.statusCode).toBe(400);
                expect(error.data).toEqual({field: 'email', code: 123});
                expect(error.success).toBe(false);
            });

            it('should create instance with data and context', () => {
                const error = new DATA_ERROR(
                    {field: 'username', code: 456},
                    {displayMessage: 'Validation failed'}
                );
                expect(error.data).toEqual({field: 'username', code: 456});
                expect(error.context?.displayMessage).toBe('Validation failed');
            });

            it('should validate schema structure', () => {
                expect(DATA_ERROR.schema.is({field: 'test', code: 100})).toBe(true);
                expect(DATA_ERROR.schema.is({field: 'test'})).toBe(false);
                expect(DATA_ERROR.schema.is({field: 123, code: 100})).toBe(false);
            });
        });

        describe('is() static method', () => {
            const ERROR_A = ERROR.define('ERROR_A', 400);
            const ERROR_B = ERROR.define('ERROR_B', 400);

            it('should return true for own instances', () => {
                const error = new ERROR_A();
                expect(ERROR_A.is(error)).toBe(true);
            });

            it('should return false for other error instances', () => {
                const error = new ERROR_A();
                expect(ERROR_B.is(error)).toBe(false);
            });

            it('should return false for non-error values', () => {
                expect(ERROR_A.is(null)).toBe(false);
                expect(ERROR_A.is(undefined)).toBe(false);
                expect(ERROR_A.is({})).toBe(false);
                expect(ERROR_A.is('ERROR_A')).toBe(false);
                expect(ERROR_A.is(new Error('ERROR_A'))).toBe(false);
            });
        });

        describe('class name', () => {
            it('should set class name to type', () => {
                const CUSTOM_ERROR = ERROR.define('CUSTOM_ERROR', 500);
                expect(CUSTOM_ERROR.name).toBe('CUSTOM_ERROR');
            });
        });

        describe('frozen class', () => {
            it('should freeze the error class', () => {
                const FROZEN_ERROR = ERROR.define('FROZEN_ERROR', 500);
                expect(Object.isFrozen(FROZEN_ERROR)).toBe(true);
            });
        });
    });

    describe('badRequest()', () => {

        describe('without schema', () => {
            const BAD_INPUT = ERROR.badRequest('BAD_INPUT');

            it('should create error with 400 status code', () => {
                expect(BAD_INPUT.STATUS_CODE).toBe(400);
            });

            it('should set TYPE correctly', () => {
                expect(BAD_INPUT.TYPE).toBe('BAD_INPUT');
            });

            it('should create instance without data', () => {
                const error = new BAD_INPUT();
                expect(error.statusCode).toBe(400);
                expect(error.data).toBeUndefined();
            });
        });

        describe('with schema', () => {
            const INVALID_FIELD = ERROR.badRequest('INVALID_FIELD', IsString);

            it('should create error with 400 status code', () => {
                expect(INVALID_FIELD.STATUS_CODE).toBe(400);
            });

            it('should have schema defined', () => {
                expect(INVALID_FIELD.schema).toBeDefined();
            });

            it('should create instance with data', () => {
                const error = new INVALID_FIELD('email');
                expect(error.statusCode).toBe(400);
                expect(error.data).toBe('email');
            });
        });
    });

    describe('toJSON()', () => {
        const TEST_ERROR = ERROR.define('TEST_ERROR', 400, IsString);

        it('should serialize error without data', () => {
            const SIMPLE_ERROR = ERROR.define('SIMPLE_ERROR', 500);
            const error = new SIMPLE_ERROR({displayMessage: 'Something failed'});
            const json = error.toJSON();

            expect(json.success).toBe(false);
            expect(json.type).toBe('SIMPLE_ERROR');
            expect(json.data).toBeUndefined();
            expect(json.context?.displayMessage).toBe('Something failed');
            expect(json.context?.timestamp).toBeDefined();
            expect(json.context?.ref).toBeDefined();
        });

        it('should serialize error with data', () => {
            const error = new TEST_ERROR('field_name', {displayMessage: 'Invalid field'});
            const json = error.toJSON();

            expect(json.success).toBe(false);
            expect(json.type).toBe('TEST_ERROR');
            expect(json.data).toBe('field_name');
            expect(json.context?.displayMessage).toBe('Invalid field');
        });

        it('should not include debug context in JSON', () => {
            const error = new TEST_ERROR('test', {
                displayMessage: 'User message',
                debugMessage: 'Debug info',
                debugData: {internal: 'data'}
            });
            const json = error.toJSON();

            expect(json.context?.displayMessage).toBe('User message');
            expect((json as any).debugMessage).toBeUndefined();
            expect((json as any).debugData).toBeUndefined();
        });
    });

    describe('getDebugContext()', () => {
        const DEBUG_ERROR = ERROR.define('DEBUG_ERROR', 500);

        it('should return debug context', () => {
            const originalError = new Error('Original');
            const error = new DEBUG_ERROR({
                debugMessage: 'Internal error details',
                debugData: {stack: 'trace'},
                originalError
            });

            const debug = error.getDebugContext();
            expect(debug?.debugMessage).toBe('Internal error details');
            expect(debug?.debugData).toEqual({stack: 'trace'});
            expect(debug?.originalError).toBe(originalError);
        });

        it('should return undefined values when not provided', () => {
            const error = new DEBUG_ERROR();
            const debug = error.getDebugContext();

            expect(debug?.debugMessage).toBeUndefined();
            expect(debug?.debugData).toBeUndefined();
            expect(debug?.originalError).toBeUndefined();
        });
    });

    describe('fromUnknown()', () => {

        it('should return ERROR instance as-is', () => {
            const original = new SERVER_ERROR({displayMessage: 'Test'});
            const result = ERROR.fromUnknown(original);
            expect(result).toBe(original);
        });

        it('should wrap Error in SERVER_ERROR', () => {
            const jsError = new Error('Something broke');
            const result = ERROR.fromUnknown(jsError);

            expect(result).toBeInstanceOf(ERROR);
            expect(result.type).toBe('SERVER_ERROR');
            expect(result.getDebugContext()?.originalError).toBe(jsError);
        });

        it('should handle error class passed instead of instance', () => {
            const MY_ERR = ERROR.define('MY_ERR', 400);
            const result = ERROR.fromUnknown(MY_ERR);

            expect(result).toBeInstanceOf(ERROR);
            expect(result.type).toBe('SERVER_ERROR');
            expect(result.getDebugContext()?.debugMessage).toContain('throw new MY_ERR');
        });

        it('should wrap unknown values in SERVER_ERROR', () => {
            const unknownValue = {some: 'object'};
            const result = ERROR.fromUnknown(unknownValue);

            expect(result).toBeInstanceOf(ERROR);
            expect(result.type).toBe('SERVER_ERROR');
            expect(result.getDebugContext()?.debugData).toEqual(unknownValue);
        });

        it('should handle string values', () => {
            const result = ERROR.fromUnknown('error string');
            expect(result.type).toBe('SERVER_ERROR');
            expect(result.getDebugContext()?.debugData).toBe('error string');
        });

        it('should handle null', () => {
            const result = ERROR.fromUnknown(null);
            expect(result.type).toBe('SERVER_ERROR');
        });

        it('should handle undefined', () => {
            const result = ERROR.fromUnknown(undefined);
            expect(result.type).toBe('SERVER_ERROR');
        });
    });

    describe('ref inheritance', () => {
        const WRAPPER_ERROR = ERROR.define('WRAPPER_ERROR', 500);
        const ORIGINAL_ERROR = ERROR.define('ORIGINAL_ERROR', 400);

        it('should inherit ref from original error when provided', () => {
            const original = new ORIGINAL_ERROR({ref: 'original-ref-123'});
            const wrapper = new WRAPPER_ERROR({originalError: original});

            expect(wrapper.context?.ref).toBe('original-ref-123');
        });

        it('should use custom ref over inherited ref', () => {
            const original = new ORIGINAL_ERROR({ref: 'original-ref-123'});
            const wrapper = new WRAPPER_ERROR({
                ref: 'custom-ref-456',
                originalError: original
            });

            expect(wrapper.context?.ref).toBe('custom-ref-456');
        });

        it('should generate new ref when original error has none', () => {
            const jsError = new Error('Not an ERROR instance');
            const wrapper = new WRAPPER_ERROR({originalError: jsError});

            expect(wrapper.context?.ref).toBeDefined();
            expect(wrapper.context?.ref).toMatch(/^ERR_REF_/);
        });
    });

    describe('timestamp', () => {
        const TIME_ERROR = ERROR.define('TIME_ERROR', 500);

        it('should auto-generate timestamp', () => {
            const before = Date.now();
            const error = new TIME_ERROR();
            const after = Date.now();

            expect(error.context?.timestamp).toBeGreaterThanOrEqual(before);
            expect(error.context?.timestamp).toBeLessThanOrEqual(after);
        });

        it('should preserve custom timestamp', () => {
            const customTime = 1700000000000;
            const error = new TIME_ERROR({timestamp: customTime});
            expect(error.context?.timestamp).toBe(customTime);
        });
    });
});
