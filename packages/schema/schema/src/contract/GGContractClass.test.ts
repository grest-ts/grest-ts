import {describe, expect, it} from 'vitest';
import {GGContractClass} from './GGContractClass';
import {GGPromise} from './GGPromise';
import {ERROR} from './ERROR';
import {IsString} from '../schemas/IsString';
import {IsNumber} from '../schemas/IsNumber';
import {IsObject} from '../schemas/IsObject';
import {GG_NO_PERMISSIONS} from "./permission/GGPermission";

const USER_NOT_FOUND = ERROR.define('USER_NOT_FOUND', 404);
const INVALID_PASSWORD = ERROR.define('INVALID_PASSWORD', 400);

describe('GGContractClass', () => {

    describe('constructor', () => {

        it('should store name', () => {
            const contract = new GGContractClass('TestContract', {});
            expect(contract.name).toBe('TestContract');
        });

        it('should store methods', () => {
            const methods = {
                getUser: {success: IsString,
                    permission: GG_NO_PERMISSIONS
                },
                setUser: {input: IsString, success: IsString,
                    permission: GG_NO_PERMISSIONS
                },
            };
            const contract = new GGContractClass('UserContract', methods);
            expect(contract.methods).toBe(methods);
        });

        it('should freeze the instance', () => {
            const contract = new GGContractClass('Frozen', {});
            expect(Object.isFrozen(contract)).toBe(true);
        });

        it('should freeze each method', () => {
            const methods = {
                method1: {success: IsString,
                    permission: GG_NO_PERMISSIONS
                },
                method2: {input: IsNumber, success: IsNumber,
                    permission: GG_NO_PERMISSIONS
                },
            };
            const contract = new GGContractClass('Contract', methods);

            expect(Object.isFrozen(contract.methods.method1)).toBe(true);
            expect(Object.isFrozen(contract.methods.method2)).toBe(true);
        });
    });

    describe('implement()', () => {

        describe('basic implementation', () => {
            const UserContract = new GGContractClass('UserContract', {
                greet: {
                    input: IsObject({name: IsString}),
                    success: IsString,
                    permission: GG_NO_PERMISSIONS
                },
                getNumber: {
                    success: IsNumber,
                    permission: GG_NO_PERMISSIONS
                },
            });

            it('should return client object directly', () => {
                const service = UserContract.implement({
                    greet: async (data) => `Hello, ${data.name}!`,
                    getNumber: async () => 42,
                });

                expect(typeof service).toBe('object');
            });

            it('should have client methods', () => {
                const service = UserContract.implement({
                    greet: async (data) => `Hello, ${data.name}!`,
                    getNumber: async () => 42,
                });

                expect(typeof service.greet).toBe('function');
                expect(typeof service.getNumber).toBe('function');
            });

            it('should return GGPromise from methods', () => {
                const service = UserContract.implement({
                    greet: async (data) => `Hello, ${data.name}!`,
                    getNumber: async () => 42,
                });

                const result = service.greet({name: 'Test'});

                expect(result).toBeInstanceOf(GGPromise);
            });

            it('should execute handler and return result', async () => {
                const service = UserContract.implement({
                    greet: async (data) => `Hello, ${data.name}!`,
                    getNumber: async () => 42,
                });

                expect(await service.greet({name: 'World'})).toBe('Hello, World!');
                expect(await service.getNumber()).toBe(42);
            });
        });

        describe('with errors', () => {
            const AuthContract = new GGContractClass('AuthContract', {
                login: {
                    input: IsObject({
                        username: IsString,
                        password: IsString,
                    }),
                    success: IsObject({token: IsString}),
                    errors: [USER_NOT_FOUND, INVALID_PASSWORD],
                    permission: GG_NO_PERMISSIONS
                },
            });

            it('should handle thrown errors', async () => {
                const service = AuthContract.implement({
                    login: async (data) => {
                        if (data.username !== 'admin') {
                            throw new USER_NOT_FOUND();
                        }
                        if (data.password !== 'secret') {
                            throw new INVALID_PASSWORD();
                        }
                        return {token: 'jwt-token'};
                    },
                });

                const result = await service.login({
                    username: 'unknown',
                    password: 'test',
                }).asResult();

                expect(result.success).toBe(false);
                expect(result.type).toBe('USER_NOT_FOUND');
            });

            it('should validate input', async () => {
                const service = AuthContract.implement({
                    login: async () => ({token: 'test'}),
                });

                const result = await service.login({
                    username: {invalid: 'object'} as any, // objects can't be coerced to string
                    password: 'test',
                }).asResult();

                expect(result.success).toBe(false);
                expect(result.type).toBe('VALIDATION_ERROR');
            });

            it('should wrap unknown errors', async () => {
                const service = AuthContract.implement({
                    login: async () => {
                        throw new Error('Database connection failed');
                    },
                });

                const result = await service.login({
                    username: 'admin',
                    password: 'secret',
                }).asResult();

                expect(result.success).toBe(false);
                expect(result.type).toBe('SERVER_ERROR');
            });
        });

        describe('missing handler validation', () => {
            const Contract = new GGContractClass('TestContract', {
                method1: {success: IsString,
                    permission: GG_NO_PERMISSIONS
                },
                method2: {success: IsNumber,
                    permission: GG_NO_PERMISSIONS
                },
            });

            it('should throw if handler is missing', () => {
                expect(() => Contract.implement({
                    method1: async () => 'test',
                    // method2 is missing
                } as any)).toThrow('Handler missing for TestContract.method2');
            });
        });

        describe('concurrent method calls', () => {
            const AsyncContract = new GGContractClass('AsyncContract', {
                slow: {
                    input: IsNumber,
                    success: IsNumber,
                    permission: GG_NO_PERMISSIONS
                },
                fast: {
                    input: IsNumber,
                    success: IsNumber,
                    permission: GG_NO_PERMISSIONS
                },
            });

            it('should handle concurrent calls to same instance', async () => {
                const service = AsyncContract.implement({
                    slow: async (n) => {
                        await new Promise(r => setTimeout(r, 50));
                        return n * 10;
                    },
                    fast: async (n) => {
                        await new Promise(r => setTimeout(r, 10));
                        return n * 2;
                    },
                });

                const [slow1, fast1, slow2, fast2] = await Promise.all([
                    service.slow(1),
                    service.fast(1),
                    service.slow(2),
                    service.fast(2),
                ]);

                expect(slow1).toBe(10);
                expect(fast1).toBe(2);
                expect(slow2).toBe(20);
                expect(fast2).toBe(4);
            });
        });
    });
});
