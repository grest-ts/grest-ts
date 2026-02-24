import {describe, it, expect} from 'vitest';
import {GGContractFunction} from './GGContractFunction';
import {GGPromise} from './GGPromise';
import {ERROR} from './ERROR';
import {IsString} from '../schemas/IsString';
import {IsNumber} from '../schemas/IsNumber';
import {IsObject} from '../schemas/IsObject';

const FN_CUSTOM_ERROR = ERROR.define('FN_CUSTOM_ERROR', 400);

describe('GGContractFunction', () => {

    describe('constructor', () => {

        it('should store the method', () => {
            const method = {
                input: IsString,
                success: IsNumber,
            };
            const fn = new GGContractFunction(method);
            expect(fn.method).toBe(method);
        });

        it('should freeze the instance', () => {
            const fn = new GGContractFunction({
                input: IsString,
                success: IsString,
            });
            expect(Object.isFrozen(fn)).toBe(true);
        });

        it('should freeze the method', () => {
            const method = {
                input: IsString,
                success: IsString,
            };
            const fn = new GGContractFunction(method);
            expect(Object.isFrozen(fn.method)).toBe(true);
        });
    });

    describe('implement()', () => {

        describe('with input and success schemas', () => {
            const method = {
                input: IsObject({name: IsString}),
                success: IsObject({greeting: IsString}),
            };

            it('should return a callable function', () => {
                const fn = new GGContractFunction(method);
                const impl = fn.implement(async (data) => {
                    return {greeting: `Hello, ${data.name}!`};
                });

                expect(typeof impl).toBe('function');
            });

            it('should return GGPromise when called', () => {
                const fn = new GGContractFunction(method);
                const impl = fn.implement(async (data) => {
                    return {greeting: `Hello, ${data.name}!`};
                });

                const result = impl({name: 'World'});
                expect(result).toBeInstanceOf(GGPromise);
            });

            it('should pass input to handler and return success', async () => {
                const fn = new GGContractFunction(method);
                const impl = fn.implement(async (data) => {
                    return {greeting: `Hello, ${data.name}!`};
                });

                const result = await impl({name: 'Alice'});
                expect(result).toEqual({greeting: 'Hello, Alice!'});
            });

            it('should validate input', async () => {
                const fn = new GGContractFunction(method);
                const impl = fn.implement(async (data) => {
                    return {greeting: `Hello, ${data.name}!`};
                });

                // Invalid input - objects can't be coerced to string
                const result = await impl({name: {invalid: 'object'} as any}).asResult();
                expect(result.success).toBe(false);
                expect(result.type).toBe('VALIDATION_ERROR');
            });

            it('should validate success output', async () => {
                const fn = new GGContractFunction(method);
                const impl = fn.implement(async () => {
                    // Return wrong type - objects can't be coerced to string
                    return {greeting: {invalid: 'object'}} as any;
                });

                const result = await impl({name: 'Test'}).asResult();
                expect(result.success).toBe(false);
                expect(result.type).toBe('SERVER_ERROR');
            });
        });

        describe('with no input schema', () => {
            const method = {
                success: IsNumber,
            };

            it('should work without input', async () => {
                const fn = new GGContractFunction(method);
                const impl = fn.implement(async () => {
                    return 42;
                });

                const result = await impl();
                expect(result).toBe(42);
            });
        });

        describe('with errors', () => {
            const method = {
                input: IsNumber,
                success: IsString,
                errors: [FN_CUSTOM_ERROR],
            };

            it('should handle thrown errors', async () => {
                const fn = new GGContractFunction(method);
                const impl = fn.implement(async (num) => {
                    if (num < 0) {
                        throw new FN_CUSTOM_ERROR({displayMessage: 'Number must be positive'});
                    }
                    return String(num);
                });

                const result = await impl(-5).asResult();
                expect(result.success).toBe(false);
                expect(result.type).toBe('FN_CUSTOM_ERROR');
            });

            it('should handle returned errors', async () => {
                const fn = new GGContractFunction(method);
                const impl = fn.implement(async (num): Promise<any> => {
                    if (num < 0) {
                        return new FN_CUSTOM_ERROR({displayMessage: 'Negative'});
                    }
                    return String(num);
                });

                const result = await impl(-1).asResult();
                expect(result.success).toBe(false);
                expect(result.type).toBe('FN_CUSTOM_ERROR');
            });

            it('should wrap unknown errors in SERVER_ERROR', async () => {
                const fn = new GGContractFunction(method);
                const impl = fn.implement(async () => {
                    throw new Error('Unexpected error');
                });

                const result = await impl(1).asResult();
                expect(result.success).toBe(false);
                expect(result.type).toBe('SERVER_ERROR');
            });
        });

        describe('multiple calls', () => {

            it('should handle multiple concurrent calls', async () => {
                const method = {
                    input: IsNumber,
                    success: IsNumber,
                };
                const fn = new GGContractFunction(method);
                const impl = fn.implement(async (n) => {
                    await new Promise(r => setTimeout(r, 10));
                    return n * 2;
                });

                const results = await Promise.all([
                    impl(1),
                    impl(2),
                    impl(3),
                ]);

                expect(results).toEqual([2, 4, 6]);
            });

            it('should isolate state between calls', async () => {
                let callCount = 0;
                const method = {
                    input: IsString,
                    success: IsNumber,
                };
                const fn = new GGContractFunction(method);
                const impl = fn.implement(async () => {
                    callCount++;
                    return callCount;
                });

                const result1 = await impl('a');
                const result2 = await impl('b');
                const result3 = await impl('c');

                expect(result1).toBe(1);
                expect(result2).toBe(2);
                expect(result3).toBe(3);
            });
        });
    });
});
