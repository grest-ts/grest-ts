import {GGSchema} from "../../../GGSchema";

/**
 * Shared compilation state for closure-based compilers.
 * Handles captures, recursion detection, and code generation helpers.
 */
export class CompilerState {
    /** Captured values that will be passed to the generated function */
    readonly captures = new Map<string, unknown>();

    /** Counter for generating unique variable names */
    private captureId = 0;

    /** Schemas currently being compiled (for recursion detection) */
    private readonly compiling = new Map<GGSchema<any>, string>();

    /** Function names that were found to be recursive */
    private readonly recursiveFuncs = new Set<string>();

    /**
     * Reset state for a new compilation
     */
    reset(): void {
        this.captures.clear();
        this.captureId = 0;
        this.compiling.clear();
        this.recursiveFuncs.clear();
    }

    /**
     * Capture a value to be passed to the generated function.
     * Returns the variable name to use in generated code.
     */
    capture(value: unknown, prefix = '_c'): string {
        const name = `${prefix}${this.captureId++}`;
        this.captures.set(name, value);
        return name;
    }

    /**
     * Generate a fresh variable name (doesn't capture a value)
     */
    freshVar(prefix = '_v'): string {
        return `${prefix}${this.captureId++}`;
    }

    /**
     * Check if a schema is currently being compiled (recursion detection).
     * If found, marks the function as recursive and returns the function name.
     */
    getRecursiveFunc(schema: GGSchema<any>): string | undefined {
        const existingFunc = this.compiling.get(schema);
        if (existingFunc) {
            this.recursiveFuncs.add(existingFunc);
        }
        return existingFunc;
    }

    /**
     * Register a schema as being compiled with the given function name.
     */
    registerCompiling(schema: GGSchema<any>, funcName: string): void {
        this.compiling.set(schema, funcName);
    }

    /**
     * Unregister a schema after compilation is complete.
     */
    unregisterCompiling(schema: GGSchema<any>): void {
        this.compiling.delete(schema);
    }

    /**
     * Check if any recursive functions were detected.
     */
    hasRecursion(): boolean {
        return this.recursiveFuncs.size > 0;
    }

    /**
     * Check if a specific function name is recursive.
     */
    isRecursive(funcName: string): boolean {
        return this.recursiveFuncs.has(funcName);
    }

    /**
     * Get forward declarations for recursive functions.
     */
    getForwardDeclarations(): string {
        return [...this.recursiveFuncs].map(n => `let ${n};`).join('');
    }

    /**
     * If recursion occurred for the given function, wrap body in a self-assigning function.
     * Otherwise, replace innerVar with actual expression v.
     */
    wrapIfRecursive(body: string, funcName: string, innerVar: string, v: string): string {
        if (this.recursiveFuncs.has(funcName)) {
            // Recursive: wrap in forward-declared function
            return `(${funcName}=((${innerVar})=>${body}))(${v})`;
        }
        // Non-recursive: simple string replacement
        return body.split(innerVar).join(v);
    }

    /**
     * For validation with path tracking - wraps recursive function with both value and path params.
     */
    wrapIfRecursiveValidate(body: string, funcName: string, innerVar: string, innerPath: string, v: string, path: string): string {
        if (this.recursiveFuncs.has(funcName)) {
            // Recursive: wrap in forward-declared function with value and path params
            return `(${funcName}=((${innerVar},i,${innerPath})=>${body}))(${v},i,${path})`;
        }
        // Non-recursive: simple string replacement for both var and path
        return body.split(innerVar).join(v).split(innerPath).join(path);
    }

    static DEBUG = false;

    /**
     * Build the function body code string (for new Function()).
     */
    private buildCode(body: string, params: string[]): string {
        const paramList = params.length > 0 ? params.join(',') : 'v';
        const forwardDecls = this.hasRecursion() ? this.getForwardDeclarations() : '';
        return `${forwardDecls}return (${paramList})=>${body}`;
    }

    /**
     * Build and execute the function from generated body code.
     */
    buildFunction<T>(body: string, ...params: string[]): T {
        const code = this.buildCode(body, params);

        if (CompilerState.DEBUG) {
            console.log('=== Generated code ===');
            console.log(code);
            console.log('======================');
        }

        const varNames = [...this.captures.keys()];
        const varValues = [...this.captures.values()];
        const factory = new Function(...varNames, code);
        return factory(...varValues) as T;
    }

    /**
     * Get the generated code as a string (for analysis/export).
     * Returns the arrow function expression.
     */
    getCode(body: string, ...params: string[]): string {
        const paramList = params.length > 0 ? params.join(',') : 'v';
        const forwardDecls = this.hasRecursion() ? this.getForwardDeclarations() : '';

        if (forwardDecls) {
            // Recursive: wrap in IIFE to declare forward refs
            return `(()=>{${forwardDecls}return (${paramList})=>${body}})()`;
        }
        return `(${paramList})=>${body}`;
    }
}
