import {describe, expect, it} from 'vitest';
import {GGPromise} from './GGPromise';
import {ERROR} from './ERROR';
import {OK} from './OK';

const PROMISE_TEST_ERROR = ERROR.define('PROMISE_TEST_ERROR', 400);
const PROMISE_OTHER_ERROR = ERROR.define('PROMISE_OTHER_ERROR', 500);

function createSuccessPromise<T>(data: T): GGPromise<T, never> {
    const ok: OK<T> = {success: true, type: 'OK', data};
    return new GGPromise<T, never>(Promise.resolve(ok));
}

function createErrorPromise<T, E extends ERROR<any, any>>(error: E): GGPromise<T, E> {
    return new GGPromise<T, E>(Promise.resolve(error as any));
}

describe('GGPromise', () => {

    describe('then() / await', () => {

        it('should return success data when awaited', async () => {
            const promise = createSuccessPromise({name: 'Alice', age: 30});
            const result = await promise;
            expect(result).toEqual({name: 'Alice', age: 30});
        });

        it('should throw error when awaited on error result', async () => {
            const error = new PROMISE_TEST_ERROR({displayMessage: 'Test failed'});
            const promise = createErrorPromise(error);

            await expect(promise).rejects.toBe(error);
        });

        it('should work with then callback', async () => {
            const promise = createSuccessPromise(42);
            let capturedValue: number | undefined;

            await promise.then(value => {
                capturedValue = value;
            });

            expect(capturedValue).toBe(42);
        });

        it('should call onrejected on error', async () => {
            const error = new PROMISE_TEST_ERROR();
            const promise = createErrorPromise(error);
            let capturedError: any;

            await promise.then(
                () => {
                },
                (err): undefined => {
                    capturedError = err;
                    return undefined;
                }
            );

            expect(capturedError).toBe(error);
        });

        it('should chain then calls', async () => {
            const promise = createSuccessPromise(10);
            const result = await promise
                .then(x => x * 2)
                .then(x => x + 5);

            expect(result).toBe(25);
        });
    });

    describe('asResult()', () => {

        it('should return full OK result on success', async () => {
            const promise = createSuccessPromise({id: 1});
            const result = await promise.asResult();

            expect(result.success).toBe(true);
            expect(result.type).toBe('OK');
            if (result.success) {
                expect(result.data).toEqual({id: 1});
            }
        });

        it('should return full error result on failure', async () => {
            const error = new PROMISE_TEST_ERROR({displayMessage: 'Failed'});
            const promise = createErrorPromise(error);
            const result = await promise.asResult();

            expect(result.success).toBe(false);
            expect(result.type).toBe('PROMISE_TEST_ERROR');
            expect(result).toBe(error);
        });

        it('should allow discriminated union handling', async () => {
            const promise = createSuccessPromise('test data');
            const result = await promise.asResult();

            if (result.success) {
                expect(result.data).toBe('test data');
            } else {
                expect.fail('Should be success');
            }
        });
    });

    describe('orDefault()', () => {

        it('should return success data on success', async () => {
            const promise = createSuccessPromise({value: 'real'});
            const result = await promise.orDefault(() => ({value: 'default'}));

            expect(result).toEqual({value: 'real'});
        });

        it('should return default value on error', async () => {
            const promise = createErrorPromise<{ value: string }, typeof PROMISE_TEST_ERROR.prototype>(new PROMISE_TEST_ERROR());
            const result = await promise.orDefault(() => ({value: 'fallback'}));

            expect(result).toEqual({value: 'fallback'});
        });

        it('should call default factory only on error', async () => {
            let factoryCalled = false;
            const promise = createSuccessPromise('success');

            await promise.orDefault(() => {
                factoryCalled = true;
                return 'default';
            });

            expect(factoryCalled).toBe(false);
        });

        it('should call default factory on error', async () => {
            let factoryCalled = false;
            const promise = createErrorPromise<string, typeof PROMISE_TEST_ERROR.prototype>(new PROMISE_TEST_ERROR());

            await promise.orDefault(() => {
                factoryCalled = true;
                return 'default';
            });

            expect(factoryCalled).toBe(true);
        });
    });

    describe('or()', () => {

        it('should return success data on success', async () => {
            const promise = createSuccessPromise(100);
            const result = await promise.or(() => 0);

            expect(result).toBe(100);
        });

        it('should call handler on error', async () => {
            const promise = createErrorPromise<number, typeof PROMISE_TEST_ERROR.prototype>(new PROMISE_TEST_ERROR());
            const result = await promise.or(() => -1);

            expect(result).toBe(-1);
        });

        it('should pass error to handler', async () => {
            const error = new PROMISE_TEST_ERROR({displayMessage: 'Custom message'});
            const promise = createErrorPromise<number, typeof PROMISE_TEST_ERROR.prototype>(error);
            let capturedError: any;

            await promise.or(err => {
                capturedError = err;
                return 0;
            });

            expect(capturedError).toBe(error);
        });

        it('should allow re-throwing from handler', async () => {
            const originalError = new PROMISE_TEST_ERROR();
            const newError = new PROMISE_OTHER_ERROR();
            const promise = createErrorPromise(originalError);

            await expect(
                promise.or((_err) => {
                    throw newError;
                })
            ).rejects.toBe(newError);
        });

        it('should support async handler', async () => {
            const promise = createErrorPromise<string, typeof PROMISE_TEST_ERROR.prototype>(new PROMISE_TEST_ERROR());
            const result = await promise.or(async () => {
                await new Promise(r => setTimeout(r, 10));
                return 'async-fallback';
            });

            expect(result).toBe('async-fallback');
        });
    });

    describe('catch()', () => {

        it('should return success data on success', async () => {
            const promise = createSuccessPromise('original');
            const result = await promise.catch((): null => null);

            expect(result).toBe('original');
        });

        it('should return handler result on error', async () => {
            const promise = createErrorPromise<string, typeof PROMISE_TEST_ERROR.prototype>(new PROMISE_TEST_ERROR());
            const result = await promise.catch((): null => null);

            expect(result).toBeNull();
        });

        it('should allow returning different type', async () => {
            const promise = createErrorPromise<string, typeof PROMISE_TEST_ERROR.prototype>(new PROMISE_TEST_ERROR());
            const result: string | { error: boolean } = await promise.catch(() => ({error: true}));

            expect(result).toEqual({error: true});
        });

        it('should pass error to handler', async () => {
            const error = new PROMISE_TEST_ERROR({displayMessage: 'Catch test'});
            const promise = createErrorPromise<string, typeof PROMISE_TEST_ERROR.prototype>(error);
            let capturedError: any;

            await promise.catch((err): null => {
                capturedError = err;
                return null;
            });

            expect(capturedError).toBe(error);
        });

        it('should support async handler', async () => {
            const promise = createErrorPromise<string, typeof PROMISE_TEST_ERROR.prototype>(new PROMISE_TEST_ERROR());
            const result = await promise.catch(async () => {
                await new Promise(r => setTimeout(r, 10));
                return 'caught';
            });

            expect(result).toBe('caught');
        });
    });

    describe('map()', () => {

        it('should transform success data', async () => {
            const promise = createSuccessPromise({x: 10, y: 20});
            const mapped = promise.map(data => data.x + data.y);
            const result = await mapped;

            expect(result).toBe(30);
        });

        it('should pass through error without calling mapper', async () => {
            const error = new PROMISE_TEST_ERROR();
            const promise = createErrorPromise(error);
            let mapperCalled = false;

            const mapped = promise.map(() => {
                mapperCalled = true;
                return 'mapped';
            });

            await expect(mapped).rejects.toBe(error);
            expect(mapperCalled).toBe(false);
        });

        it('should return new GGPromise instance', () => {
            const promise = createSuccessPromise(1);
            const mapped = promise.map(x => x * 2);

            expect(mapped).toBeInstanceOf(GGPromise);
            expect(mapped).not.toBe(promise);
        });

        it('should support async mapper', async () => {
            const promise = createSuccessPromise('input');
            const mapped = promise.map(async data => {
                await new Promise(r => setTimeout(r, 10));
                return data.toUpperCase();
            });

            const result = await mapped;
            expect(result).toBe('INPUT');
        });

        it('should chain map calls', async () => {
            const promise = createSuccessPromise(5);
            const result = await promise
                .map(x => x * 2)
                .map(x => x + 1)
                .map(x => String(x));

            expect(result).toBe('11');
        });

        it('should work with asResult after map', async () => {
            const promise = createSuccessPromise(100);
            const result = await promise
                .map(x => ({doubled: x * 2}))
                .asResult();

            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data).toEqual({doubled: 200});
            }
        });

        it('should preserve error type in map chain', async () => {
            const error = new PROMISE_TEST_ERROR({displayMessage: 'Original'});
            const promise = createErrorPromise(error);

            const result = await promise
                .map(x => x)
                .map(x => x)
                .asResult();

            expect(result.success).toBe(false);
            if (!result.success) {
                expect(result.type).toBe('PROMISE_TEST_ERROR');
            }
        });
    });

    describe('method chaining combinations', () => {

        it('should work: map then orDefault', async () => {
            const promise = createSuccessPromise(10);
            const result = await promise
                .map(x => x * 3)
                .orDefault(() => 0);

            expect(result).toBe(30);
        });

        it('should work: map then catch', async () => {
            const promise = createErrorPromise<number, typeof PROMISE_TEST_ERROR.prototype>(new PROMISE_TEST_ERROR());
            const result = await promise
                .map(x => x * 3)
                .catch(() => 'caught');

            expect(result).toBe('caught');
        });

        it('should work: map then or', async () => {
            const promise = createSuccessPromise(5);
            const result = await promise
                .map(x => x + 10)
                .or(() => 0);

            expect(result).toBe(15);
        });
    });
});
