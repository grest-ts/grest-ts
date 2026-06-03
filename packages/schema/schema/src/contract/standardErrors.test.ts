import {describe, it, expect} from 'vitest';
import {
    VALIDATION_ERROR,
    NOT_AUTHORIZED,
    FORBIDDEN,
    NOT_FOUND,
    EXISTS,
    ROUTE_NOT_FOUND
} from './standardErrors';
import {SERVER_ERROR} from "./ERROR";

/**
 * Snapshot tests for standard errors.
 * These tests ensure that error properties don't accidentally change,
 * which would break API contracts and client-server communication.
 */
describe('standardErrors', () => {

    describe('SERVER_ERROR', () => {
        it('should have correct TYPE', () => {
            expect(SERVER_ERROR.TYPE).toBe('SERVER_ERROR');
        });

        it('should have correct STATUS_CODE', () => {
            expect(SERVER_ERROR.STATUS_CODE).toBe(500);
        });

        it('should have no schema (no data)', () => {
            expect(SERVER_ERROR.schema).toBeUndefined();
        });

        it('should create instance without data', () => {
            const error = new SERVER_ERROR();
            expect(error.type).toBe('SERVER_ERROR');
            expect(error.statusCode).toBe(500);
            expect(error.data).toBeUndefined();
            expect(error.success).toBe(false);
        });

        it('should create instance with context', () => {
            const error = new SERVER_ERROR({displayMessage: 'Something went wrong'});
            expect(error.context?.displayMessage).toBe('Something went wrong');
        });

        it('should identify instances correctly', () => {
            const error = new SERVER_ERROR();
            expect(SERVER_ERROR.is(error)).toBe(true);
            expect(SERVER_ERROR.is(new NOT_FOUND())).toBe(false);
            expect(SERVER_ERROR.is({})).toBe(false);
            expect(SERVER_ERROR.is(null)).toBe(false);
        });
    });

    describe('VALIDATION_ERROR', () => {
        it('should have correct TYPE', () => {
            expect(VALIDATION_ERROR.TYPE).toBe('VALIDATION_ERROR');
        });

        it('should have correct STATUS_CODE', () => {
            expect(VALIDATION_ERROR.STATUS_CODE).toBe(422);
        });

        it('should have schema for validation issues array', () => {
            expect(VALIDATION_ERROR.schema).toBeDefined();
        });

        it('should create instance with validation issues', () => {
            const issues = [
                {path: 'email', code: 'invalid_email', message: 'Invalid email format'}
            ];
            const error = new VALIDATION_ERROR(issues);
            expect(error.type).toBe('VALIDATION_ERROR');
            expect(error.statusCode).toBe(422);
            expect(error.data).toEqual(issues);
            expect(error.success).toBe(false);
        });

        it('should validate schema structure', () => {
            // Schema expects array of objects with path, code, message, params (optional)
            const validIssues = [
                {path: 'field1', code: 'required', message: 'Field is required'},
                {path: 'field2', code: 'too_short', message: 'Too short', params: {min: 3}}
            ];
            expect(VALIDATION_ERROR.schema!.is(validIssues)).toBe(true);
        });

        it('should identify instances correctly', () => {
            const error = new VALIDATION_ERROR([{path: 'test', code: 'error', message: 'Test'}]);
            expect(VALIDATION_ERROR.is(error)).toBe(true);
            expect(VALIDATION_ERROR.is(new SERVER_ERROR())).toBe(false);
        });
    });

    describe('NOT_AUTHORIZED', () => {
        it('should have correct TYPE', () => {
            expect(NOT_AUTHORIZED.TYPE).toBe('NOT_AUTHORIZED');
        });

        it('should have correct STATUS_CODE', () => {
            expect(NOT_AUTHORIZED.STATUS_CODE).toBe(401);
        });

        it('should have no schema (no data)', () => {
            expect(NOT_AUTHORIZED.schema).toBeUndefined();
        });

        it('should create instance without data', () => {
            const error = new NOT_AUTHORIZED();
            expect(error.type).toBe('NOT_AUTHORIZED');
            expect(error.statusCode).toBe(401);
            expect(error.data).toBeUndefined();
        });

        it('should identify instances correctly', () => {
            const error = new NOT_AUTHORIZED();
            expect(NOT_AUTHORIZED.is(error)).toBe(true);
            expect(NOT_AUTHORIZED.is(new FORBIDDEN())).toBe(false);
        });
    });

    describe('FORBIDDEN', () => {
        it('should have correct TYPE', () => {
            expect(FORBIDDEN.TYPE).toBe('FORBIDDEN');
        });

        it('should have correct STATUS_CODE', () => {
            expect(FORBIDDEN.STATUS_CODE).toBe(403);
        });

        it('should have no schema (no data)', () => {
            expect(FORBIDDEN.schema).toBeUndefined();
        });

        it('should create instance without data', () => {
            const error = new FORBIDDEN();
            expect(error.type).toBe('FORBIDDEN');
            expect(error.statusCode).toBe(403);
            expect(error.data).toBeUndefined();
        });

        it('should identify instances correctly', () => {
            const error = new FORBIDDEN();
            expect(FORBIDDEN.is(error)).toBe(true);
            expect(FORBIDDEN.is(new NOT_AUTHORIZED())).toBe(false);
        });
    });

    describe('NOT_FOUND', () => {
        it('should have correct TYPE', () => {
            expect(NOT_FOUND.TYPE).toBe('NOT_FOUND');
        });

        it('should have correct STATUS_CODE', () => {
            expect(NOT_FOUND.STATUS_CODE).toBe(404);
        });

        it('should have no schema (no data)', () => {
            expect(NOT_FOUND.schema).toBeUndefined();
        });

        it('should create instance without data', () => {
            const error = new NOT_FOUND();
            expect(error.type).toBe('NOT_FOUND');
            expect(error.statusCode).toBe(404);
            expect(error.data).toBeUndefined();
        });

        it('should identify instances correctly', () => {
            const error = new NOT_FOUND();
            expect(NOT_FOUND.is(error)).toBe(true);
            expect(NOT_FOUND.is(new EXISTS())).toBe(false);
        });
    });

    describe('EXISTS', () => {
        it('should have correct TYPE', () => {
            expect(EXISTS.TYPE).toBe('EXISTS');
        });

        it('should have correct STATUS_CODE', () => {
            expect(EXISTS.STATUS_CODE).toBe(409);
        });

        it('should have no schema (no data)', () => {
            expect(EXISTS.schema).toBeUndefined();
        });

        it('should create instance without data', () => {
            const error = new EXISTS();
            expect(error.type).toBe('EXISTS');
            expect(error.statusCode).toBe(409);
            expect(error.data).toBeUndefined();
        });

        it('should identify instances correctly', () => {
            const error = new EXISTS();
            expect(EXISTS.is(error)).toBe(true);
            expect(EXISTS.is(new NOT_FOUND())).toBe(false);
        });
    });

    describe('ROUTE_NOT_FOUND', () => {
        it('should have correct TYPE', () => {
            expect(ROUTE_NOT_FOUND.TYPE).toBe('ROUTE_NOT_FOUND');
        });

        it('should have correct STATUS_CODE', () => {
            expect(ROUTE_NOT_FOUND.STATUS_CODE).toBe(404);
        });

        it('should have no schema (no data)', () => {
            expect(ROUTE_NOT_FOUND.schema).toBeUndefined();
        });

        it('should create instance without data', () => {
            const error = new ROUTE_NOT_FOUND();
            expect(error.type).toBe('ROUTE_NOT_FOUND');
            expect(error.statusCode).toBe(404);
            expect(error.data).toBeUndefined();
        });

        it('should identify instances correctly', () => {
            const error = new ROUTE_NOT_FOUND();
            expect(ROUTE_NOT_FOUND.is(error)).toBe(true);
            expect(ROUTE_NOT_FOUND.is(new NOT_FOUND())).toBe(false);
        });
    });

    describe('snapshot: all standard error properties', () => {
        it('should match expected error type and status code mapping', () => {
            const errorMap = {
                SERVER_ERROR: {TYPE: SERVER_ERROR.TYPE, STATUS_CODE: SERVER_ERROR.STATUS_CODE},
                VALIDATION_ERROR: {TYPE: VALIDATION_ERROR.TYPE, STATUS_CODE: VALIDATION_ERROR.STATUS_CODE},
                NOT_AUTHORIZED: {TYPE: NOT_AUTHORIZED.TYPE, STATUS_CODE: NOT_AUTHORIZED.STATUS_CODE},
                FORBIDDEN: {TYPE: FORBIDDEN.TYPE, STATUS_CODE: FORBIDDEN.STATUS_CODE},
                NOT_FOUND: {TYPE: NOT_FOUND.TYPE, STATUS_CODE: NOT_FOUND.STATUS_CODE},
                EXISTS: {TYPE: EXISTS.TYPE, STATUS_CODE: EXISTS.STATUS_CODE},
                ROUTE_NOT_FOUND: {TYPE: ROUTE_NOT_FOUND.TYPE, STATUS_CODE: ROUTE_NOT_FOUND.STATUS_CODE},
            };

            // This acts as a "snapshot" - if any of these change, the test will fail
            expect(errorMap).toEqual({
                SERVER_ERROR: {TYPE: 'SERVER_ERROR', STATUS_CODE: 500},
                VALIDATION_ERROR: {TYPE: 'VALIDATION_ERROR', STATUS_CODE: 422},
                NOT_AUTHORIZED: {TYPE: 'NOT_AUTHORIZED', STATUS_CODE: 401},
                FORBIDDEN: {TYPE: 'FORBIDDEN', STATUS_CODE: 403},
                NOT_FOUND: {TYPE: 'NOT_FOUND', STATUS_CODE: 404},
                EXISTS: {TYPE: 'EXISTS', STATUS_CODE: 409},
                ROUTE_NOT_FOUND: {TYPE: 'ROUTE_NOT_FOUND', STATUS_CODE: 404},
            });
        });
    });
});
