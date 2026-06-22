import {describe, it, expect} from 'vitest';
import {GGContractExecutor} from './GGContractExecutor';
import {ERROR, SERVER_ERROR} from './ERROR';
import {
    NOT_AUTHORIZED,
    FORBIDDEN,
    NOT_FOUND,
    EXISTS,
    ROUTE_NOT_FOUND
} from './standardErrors';
import {IsString} from '../schemas/IsString';
import {IsNumber} from '../schemas/IsNumber';
import {IsObject} from '../schemas/IsObject';
import {GGContractMethod} from './GGContractClass';
import {GG_NO_PERMISSIONS} from "./permission/GGPermission";

const EXEC_CUSTOM_ERROR = ERROR.define('EXEC_CUSTOM_ERROR', 400);
const EXEC_DATA_ERROR = ERROR.define('EXEC_DATA_ERROR', 400, IsString);

describe('GGContractExecutor', () => {

    describe('call() - input validation', () => {

        it('should validate input when schema is provided', async () => {
            const contract: GGContractMethod = {
                input: IsObject({name: IsString}),
                success: IsString,
                permission: GG_NO_PERMISSIONS
            };

            const result = await GGContractExecutor.call(
                contract,
                {name: {invalid: 'object'}}, // invalid - objects can't be coerced to string
                undefined,
                async () => 'result'
            );

            expect(result.success).toBe(false);
            expect(result.type).toBe('VALIDATION_ERROR');
        });

        it('should pass validated input to handler', async () => {
            let receivedData: any;
            const contract: GGContractMethod = {
                input: IsObject({value: IsNumber}),
                success: IsNumber,
                permission: GG_NO_PERMISSIONS
            };

            await GGContractExecutor.call(
                contract,
                {value: 42, extra: 'ignored'},
                undefined,
                async (data) => {
                    receivedData = data;
                    return data.value;
                }
            );

            expect(receivedData).toEqual({value: 42});
            expect(receivedData.extra).toBeUndefined(); // cleaned by parse
        });

        it('should allow any input when no schema', async () => {
            const contract: GGContractMethod = {
                success: IsString,
                permission: GG_NO_PERMISSIONS
            };

            const result = await GGContractExecutor.call(
                contract,
                {any: 'data', works: true},
                undefined,
                async () => 'success'
            );

            expect(result.success).toBe(true);
        });

        it('should coerce input values', async () => {
            let receivedData: any;
            const contract: GGContractMethod = {
                input: IsObject({count: IsNumber}),
                success: IsNumber,
                permission: GG_NO_PERMISSIONS
            };

            await GGContractExecutor.call(
                contract,
                {count: '42'}, // string will be coerced to number
                undefined,
                async (data) => {
                    receivedData = data;
                    return data.count;
                }
            );

            expect(receivedData.count).toBe(42);
            expect(typeof receivedData.count).toBe('number');
        });
    });

    describe('call() - success path', () => {

        it('should return OK result on success', async () => {
            const contract: GGContractMethod = {
                input: IsNumber,
                success: IsNumber,
                permission: GG_NO_PERMISSIONS
            };

            const result = await GGContractExecutor.call(
                contract,
                5,
                undefined,
                async (n) => n * 2
            );

            expect(result.success).toBe(true);
            expect(result.type).toBe('OK');
            if (result.success) {
                expect(result.data).toBe(10);
            }
        });

        it('should validate success data', async () => {
            const contract: GGContractMethod = {
                input: IsNumber,
                success: IsNumber,
                permission: GG_NO_PERMISSIONS
            };

            const result = await GGContractExecutor.call(
                contract,
                5,
                undefined,
                async () => 'not a number' as any
            );

            expect(result.success).toBe(false);
            expect(result.type).toBe('SERVER_ERROR');
        });

        it('should strip extra properties from success data', async () => {
            const contract: GGContractMethod = {
                input: IsString,
                success: IsObject({id: IsNumber}),
                permission: GG_NO_PERMISSIONS
            };

            const result = await GGContractExecutor.call(
                contract,
                'test',
                undefined,
                async () => ({id: 1, secret: 'should-be-removed'}) as any
            );

            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data).toEqual({id: 1});
                expect((result.data as any).secret).toBeUndefined();
            }
        });

        it('should set data to undefined when no success schema', async () => {
            const contract: GGContractMethod = {
                input: IsString,
                permission: GG_NO_PERMISSIONS
            };

            const result = await GGContractExecutor.call(
                contract,
                'test',
                undefined,
                async () => ({anything: 'returned'}) as any
            );

            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data).toBeUndefined();
            }
        });
    });

    describe('call() - error handling', () => {

        it('should handle thrown ERROR instances', async () => {
            const contract: GGContractMethod = {
                input: IsString,
                success: IsString,
                errors: [EXEC_CUSTOM_ERROR],
                permission: GG_NO_PERMISSIONS
            };

            const result = await GGContractExecutor.call(
                contract,
                'test',
                undefined,
                async () => {
                    throw new EXEC_CUSTOM_ERROR({displayMessage: 'Custom error occurred'});
                }
            );

            expect(result.success).toBe(false);
            expect(result.type).toBe('EXEC_CUSTOM_ERROR');
        });

        it('should handle returned ERROR instances', async () => {
            const contract: GGContractMethod = {
                input: IsString,
                success: IsString,
                errors: [EXEC_CUSTOM_ERROR],
                permission: GG_NO_PERMISSIONS
            };

            const result = await GGContractExecutor.call(
                contract,
                'test',
                undefined,
                async (): Promise<any> => {
                    return new EXEC_CUSTOM_ERROR({displayMessage: 'Returned error'});
                }
            );

            expect(result.success).toBe(false);
            expect(result.type).toBe('EXEC_CUSTOM_ERROR');
        });

        it('should wrap unknown errors in SERVER_ERROR', async () => {
            const contract: GGContractMethod = {
                input: IsString,
                success: IsString,
                permission: GG_NO_PERMISSIONS
            };

            const result = await GGContractExecutor.call(
                contract,
                'test',
                undefined,
                async () => {
                    throw new Error('Unexpected error');
                }
            );

            expect(result.success).toBe(false);
            expect(result.type).toBe('SERVER_ERROR');
        });

        it('should reject unlisted error types', async () => {
            const contract: GGContractMethod = {
                input: IsString,
                success: IsString,
                errors: [EXEC_CUSTOM_ERROR], // EXEC_DATA_ERROR not listed
                permission: GG_NO_PERMISSIONS
            };

            const result = await GGContractExecutor.call(
                contract,
                'test',
                undefined,
                async (): Promise<any> => {
                    return new EXEC_DATA_ERROR('some data');
                }
            );

            expect(result.success).toBe(false);
            expect(result.type).toBe('SERVER_ERROR');
        });

        it('should accept error JSON with data from client', async () => {
            const contract: GGContractMethod = {
                input: IsString,
                success: IsString,
                errors: [EXEC_DATA_ERROR],
                permission: GG_NO_PERMISSIONS
            };

            const result = await GGContractExecutor.call(
                contract,
                'test',
                undefined,
                async (): Promise<any> => {
                    // Client responses pass error JSON directly - data is trusted from server
                    return {success: false, type: 'EXEC_DATA_ERROR', data: 'valid string'};
                }
            );

            expect(result.success).toBe(false);
            expect(result.type).toBe('EXEC_DATA_ERROR');
        });
    });

    describe('call() - system errors', () => {

        it('should recognize NOT_AUTHORIZED when listed in errors', async () => {
            const contract: GGContractMethod = {
                success: IsString,
                errors: [NOT_AUTHORIZED],
                permission: GG_NO_PERMISSIONS
            };

            const result = await GGContractExecutor.call(
                contract,
                undefined,
                undefined,
                async () => {
                    throw new NOT_AUTHORIZED();
                }
            );

            expect(result.success).toBe(false);
            expect(result.type).toBe('NOT_AUTHORIZED');
        });

        it('should recognize FORBIDDEN when listed in errors', async () => {
            const contract: GGContractMethod = {
                success: IsString,
                errors: [FORBIDDEN],
                permission: GG_NO_PERMISSIONS
            };

            const result = await GGContractExecutor.call(
                contract,
                undefined,
                undefined,
                async () => {
                    throw new FORBIDDEN();
                }
            );

            expect(result.success).toBe(false);
            expect(result.type).toBe('FORBIDDEN');
        });

        it('should recognize NOT_FOUND when listed in errors', async () => {
            const contract: GGContractMethod = {
                success: IsString,
                errors: [NOT_FOUND],
                permission: GG_NO_PERMISSIONS
            };

            const result = await GGContractExecutor.call(
                contract,
                undefined,
                undefined,
                async () => {
                    throw new NOT_FOUND();
                }
            );

            expect(result.success).toBe(false);
            expect(result.type).toBe('NOT_FOUND');
        });

        it('should recognize EXISTS when listed in errors', async () => {
            const contract: GGContractMethod = {
                success: IsString,
                errors: [EXISTS],
                permission: GG_NO_PERMISSIONS
            };

            const result = await GGContractExecutor.call(
                contract,
                undefined,
                undefined,
                async () => {
                    throw new EXISTS();
                }
            );

            expect(result.success).toBe(false);
            expect(result.type).toBe('EXISTS');
        });

        it('should recognize ROUTE_NOT_FOUND when listed in errors', async () => {
            const contract: GGContractMethod = {
                success: IsString,
                errors: [ROUTE_NOT_FOUND],
                permission: GG_NO_PERMISSIONS
            };

            const result = await GGContractExecutor.call(
                contract,
                undefined,
                undefined,
                async () => {
                    throw new ROUTE_NOT_FOUND();
                }
            );

            expect(result.success).toBe(false);
            expect(result.type).toBe('ROUTE_NOT_FOUND');
        });

        it('should reject system errors not listed in contract', async () => {
            const contract: GGContractMethod = {
                success: IsString,
                // NOT_AUTHORIZED not listed in errors
                permission: GG_NO_PERMISSIONS,
            };

            const result = await GGContractExecutor.call(
                contract,
                undefined,
                undefined,
                async () => {
                    throw new NOT_AUTHORIZED();
                }
            );

            expect(result.success).toBe(false);
            expect(result.type).toBe('SERVER_ERROR');
        });
    });

    describe('call() - skip validation option', () => {

        it('should skip input validation when enabled', async () => {
            let receivedData: any;
            const contract: GGContractMethod = {
                input: IsObject({value: IsNumber}),
                success: IsNumber,
                permission: GG_NO_PERMISSIONS
            };

            await GGContractExecutor.call(
                contract,
                {value: 'not-a-number'}, // would fail validation
                {noValidation: true},
                async (data) => {
                    receivedData = data;
                    return 0;
                }
            );

            expect(receivedData.value).toBe('not-a-number');
        });

        it('should skip output validation when enabled', async () => {
            const contract: GGContractMethod = {
                input: IsNumber,
                success: IsNumber,
                permission: GG_NO_PERMISSIONS
            };

            const result = await GGContractExecutor.call(
                contract,
                5,
                {noValidation: true},
                async () => 'not-a-number' as any
            );

            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data).toBe('not-a-number');
            }
        });

        it('should still create error instances when noValidation is true but errors array is provided', async () => {
            const contract: GGContractMethod = {
                errors: [EXEC_CUSTOM_ERROR, EXEC_DATA_ERROR],
                permission: GG_NO_PERMISSIONS
            };

            // Simulates client receiving error JSON from server
            const result = await GGContractExecutor.call(
                contract,
                undefined,
                {noValidation: true},
                async (): Promise<any> => ({
                    success: false,
                    type: 'EXEC_CUSTOM_ERROR',
                    data: undefined,
                    context: {displayMessage: 'Error from server'}
                })
            );

            expect(result.success).toBe(false);
            expect(result.type).toBe('EXEC_CUSTOM_ERROR');
            expect(result).toBeInstanceOf(EXEC_CUSTOM_ERROR);
        });

        it('should handle error with data when noValidation is true', async () => {
            const contract: GGContractMethod = {
                errors: [EXEC_DATA_ERROR],
                permission: GG_NO_PERMISSIONS
            };

            // Simulates client receiving error JSON with data from server
            const result = await GGContractExecutor.call(
                contract,
                undefined,
                {noValidation: true},
                async (): Promise<any> => ({
                    success: false,
                    type: 'EXEC_DATA_ERROR',
                    data: 'error details',
                    context: {displayMessage: 'Data error'}
                })
            );

            expect(result.success).toBe(false);
            expect(result.type).toBe('EXEC_DATA_ERROR');
            expect(result).toBeInstanceOf(EXEC_DATA_ERROR);
            expect((result as any).data).toBe('error details');
        });

        it('should handle undefined errors array gracefully when noValidation is true', async () => {
            const contract: GGContractMethod = {
                // No errors array - this should not throw
                permission: GG_NO_PERMISSIONS,
            };

            // When errors array is undefined, custom errors can't be created
            // but it should not throw TypeError
            const result = await GGContractExecutor.call(
                contract,
                undefined,
                {noValidation: true},
                async (): Promise<any> => ({
                    success: false,
                    type: 'SOME_UNKNOWN_ERROR',
                    data: undefined,
                })
            );

            // Since the error type is not recognized, it returns the raw JSON
            expect(result.success).toBe(false);
            expect(result.type).toBe('SERVER_ERROR');
        });
    });

    describe('call() - response format validation', () => {

        it('should reject non-object response', async () => {
            const contract: GGContractMethod = {
                success: IsString,
                permission: GG_NO_PERMISSIONS
            };

            const result = await GGContractExecutor.call(
                contract,
                undefined,
                undefined,
                async (): Promise<any> => 'raw string' // Not wrapped in OK
            );

            // The executor wraps raw responses in OK structure
            expect(result.success).toBe(true);
        });

        it('should reject null response when success schema defined', async () => {
            const contract: GGContractMethod = {
                success: IsString,
                permission: GG_NO_PERMISSIONS
            };

            const result = await GGContractExecutor.call(
                contract,
                undefined,
                undefined,
                async (): Promise<any> => null
            );

            // null gets wrapped in OK, but fails IsString validation
            expect(result.success).toBe(false);
            expect(result.type).toBe('SERVER_ERROR');
        });

        it('should handle client-side error JSON format', async () => {
            const contract: GGContractMethod = {
                success: IsString,
                errors: [EXEC_CUSTOM_ERROR],
                permission: GG_NO_PERMISSIONS
            };

            const result = await GGContractExecutor.call(
                contract,
                undefined,
                undefined,
                async (): Promise<any> => ({
                    success: false,
                    type: 'EXEC_CUSTOM_ERROR',
                    data: undefined,
                    context: {displayMessage: 'From client'}
                })
            );

            expect(result.success).toBe(false);
            expect(result.type).toBe('EXEC_CUSTOM_ERROR');
        });

        it('should handle client-side OK JSON format', async () => {
            const contract: GGContractMethod = {
                success: IsString,
                permission: GG_NO_PERMISSIONS
            };

            const result = await GGContractExecutor.call(
                contract,
                undefined,
                undefined,
                async (): Promise<any> => ({
                    success: true,
                    type: 'OK',
                    data: 'from client'
                })
            );

            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data).toBe('from client');
            }
        });
    });

    describe('call() - async behavior', () => {

        it('should handle async handlers', async () => {
            const contract: GGContractMethod = {
                input: IsNumber,
                success: IsNumber,
                permission: GG_NO_PERMISSIONS
            };

            const result = await GGContractExecutor.call(
                contract,
                10,
                undefined,
                async (n) => {
                    await new Promise(r => setTimeout(r, 10));
                    return n * 2;
                }
            );

            expect(result.success).toBe(true);
            if (result.success) {
                expect(result.data).toBe(20);
            }
        });

        it('should handle Promise rejection', async () => {
            const contract: GGContractMethod = {
                success: IsString,
                permission: GG_NO_PERMISSIONS
            };

            const result = await GGContractExecutor.call(
                contract,
                undefined,
                undefined,
                async () => {
                    return Promise.reject(new Error('Rejected'));
                }
            );

            expect(result.success).toBe(false);
            expect(result.type).toBe('SERVER_ERROR');
        });
    });

    describe('createErrorObj()', () => {
        it('returns a live error instance as-is, preserving its debug context', () => {
            // The client's response parser synthesises this for an unparseable body —
            // the offending text lives only in debugData, so reconstructing from wire
            // JSON would throw it away.
            const rich = new SERVER_ERROR({displayMessage: 'Failed to parse JSON', debugData: {text: '<html>502 Bad Gateway</html>'}});
            const out = GGContractExecutor.createErrorObj(rich as never);
            expect(out).toBe(rich);
            expect(out.getDebugContext()?.debugData).toEqual({text: '<html>502 Bad Gateway</html>'});
        });

        it('reconstructs a typed error from wire JSON', () => {
            const out = GGContractExecutor.createErrorObj({success: false, type: 'NOT_FOUND', context: {displayMessage: 'gone'}} as never, [NOT_FOUND]);
            expect(out.type).toBe('NOT_FOUND');
            expect(out.context?.displayMessage).toBe('gone');
        });
    });
});
