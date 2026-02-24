import {Raw} from "@grest-ts/schema";
import {updateErrorStack} from "./captureStack";

interface Expectation<Data> {
    err: Error;
    execute: (input: Data) => void;
}

/**
 * Collection of expectations to validate data.
 * Pure validation utility - does not know about HTTP response structure.
 */
export class GGExpectations<Data> {

    private readonly expectations: Expectation<Data>[] = []

    public check(data: Data) {
        this.expectations.forEach(expectation => {
            try {
                expectation.execute(data)
            } catch (e: any) {
                throw updateErrorStack(e, expectation.err)
            }
        })
    }

    public flush() {
        this.expectations.length = 0;
    }

    private add(execute: (input: Data) => void): void {
        this.expectations.push({
            err: new Error(),
            execute: execute
        })
    }

    public toEqual(expectedData: Data): void {
        return this.add((input) => expect(input).toEqual(expectedData))
    }

    public toMatchObject(expectedData: Data): void {
        return this.add((input) => expect(input).toMatchObject(expectedData as any))
    }

    public toBeUndefined(): void {
        return this.add((input) => expect(input).toBeUndefined())
    }

    public toHaveLength(length: number) {
        return this.add((input: any) => {
            if (input?.length === undefined) {
                throw new Error("expect.length is not defined on: " + JSON.stringify(input, null, 2));
            }
            expect(input.length).toEqual(length)
        })
    }

    public arrayToContain<Item extends Data extends Array<infer R> ? R : never>(...items: Partial<Raw<Item>>[]) {
        return this.add((input: any) => {
            expect(Array.isArray(input)).toBe(true)
            expect(input).toEqual(
                expect.arrayContaining(
                    items.map(item => expect.objectContaining(item as any))
                )
            );
        })
    }

    public arrayToContainEqual<Item extends Data extends Array<infer R> ? R : never>(...items: Partial<Raw<Item>>[]) {
        return this.add((input: any) => {
            expect(Array.isArray(input)).toBe(true)
            for (const item of items) {
                expect(input).toContainEqual(item);
            }
        })
    }
}
