/**
 * Tests for CodeComparer import comparison logic
 */

import {compareCodeV2} from './CodeComparer'

describe('CodeComparer - Import Comparison', () => {

    it('should match when imports are in different order', () => {
        const expected = `
import {Foo, Bar} from 'module1'
import {Baz} from 'module2'

export class Test {}
`.trim()

        const generated = `
import {Baz} from 'module2'
import {Bar, Foo} from 'module1'

export class Test {}
`.trim()

        const result = compareCodeV2(expected, generated)
        expect(result.matches).toBe(true)
    })

    it('should detect when imports are split across multiple lines in generated file', () => {
        const expected = `
import {Foo, Bar, Baz} from 'module1'

export class Test {}
`.trim()

        const generated = `
import {Foo} from 'module1'
import {Bar} from 'module1'
import {Baz} from 'module1'

export class Test {}
`.trim()

        const result = compareCodeV2(expected, generated)
        expect(result.matches).toBe(false)
        expect(result.splitImportWarnings.length).toBeGreaterThan(0)
        expect(result.splitImportWarnings.some(w => w.includes("Multiple value imports from 'module1'"))).toBe(true)
    })

    it('should detect when imports are split across multiple lines in expected file', () => {
        const expected = `
import {Foo} from 'module1'
import {Bar} from 'module1'

export class Test {}
`.trim()

        const generated = `
import {Foo, Bar} from 'module1'

export class Test {}
`.trim()

        const result = compareCodeV2(expected, generated)
        expect(result.matches).toBe(false)
        expect(result.splitImportWarnings.length).toBeGreaterThan(0)
        expect(result.splitImportWarnings.some(w => w.includes("Expected file has split imports"))).toBe(true)
    })

    it('should detect missing imports', () => {
        const expected = `
import {Foo, Bar} from 'module1'

export class Test {}
`.trim()

        const generated = `
import {Foo} from 'module1'

export class Test {}
`.trim()

        const result = compareCodeV2(expected, generated)
        expect(result.matches).toBe(false)
        expect(result.importDiffs.length).toBeGreaterThan(0)
    })

    it('should detect extra imports', () => {
        const expected = `
import {Foo} from 'module1'

export class Test {}
`.trim()

        const generated = `
import {Foo, Bar} from 'module1'

export class Test {}
`.trim()

        const result = compareCodeV2(expected, generated)
        expect(result.matches).toBe(false)
        expect(result.importDiffs.length).toBeGreaterThan(0)
    })

    it('should distinguish between type and value imports', () => {
        const expected = `
import {Foo} from 'module1'

export class Test {}
`.trim()

        const generated = `
import type {Foo} from 'module1'

export class Test {}
`.trim()

        const result = compareCodeV2(expected, generated)
        expect(result.matches).toBe(false)
        expect(result.importDiffs.length).toBeGreaterThan(0)
    })

    it('should match when type imports are in different order', () => {
        const expected = `
import type {Foo, Bar} from 'module1'
import {Baz} from 'module2'

export class Test {}
`.trim()

        const generated = `
import {Baz} from 'module2'
import type {Bar, Foo} from 'module1'

export class Test {}
`.trim()

        const result = compareCodeV2(expected, generated)
        expect(result.matches).toBe(true)
    })

    it('should detect split type imports', () => {
        const expected = `
import type {Foo, Bar} from 'module1'

export class Test {}
`.trim()

        const generated = `
import type {Foo} from 'module1'
import type {Bar} from 'module1'

export class Test {}
`.trim()

        const result = compareCodeV2(expected, generated)
        expect(result.matches).toBe(false)
        expect(result.splitImportWarnings.length).toBeGreaterThan(0)
        expect(result.splitImportWarnings.some(w => w.includes("Multiple type imports from 'module1'"))).toBe(true)
    })

    it('should detect import from different module', () => {
        const expected = `
import {Foo} from 'module1'

export class Test {}
`.trim()

        const generated = `
import {Foo} from 'module2'

export class Test {}
`.trim()

        const result = compareCodeV2(expected, generated)
        expect(result.matches).toBe(false)
        expect(result.importDiffs.length).toBeGreaterThan(0)
    })

    it('should handle mixed type and value imports from same module', () => {
        const expected = `
import {Foo} from 'module1'
import type {Bar} from 'module1'

export class Test {}
`.trim()

        const generated = `
import type {Bar} from 'module1'
import {Foo} from 'module1'

export class Test {}
`.trim()

        const result = compareCodeV2(expected, generated)
        expect(result.matches).toBe(true)
    })

    it('should detect when type and value are swapped', () => {
        const expected = `
import {Foo} from 'module1'
import type {Bar} from 'module1'

export class Test {}
`.trim()

        const generated = `
import type {Foo} from 'module1'
import {Bar} from 'module1'

export class Test {}
`.trim()

        const result = compareCodeV2(expected, generated)
        expect(result.matches).toBe(false)
        expect(result.importDiffs.length).toBeGreaterThan(0)
    })

    it('should handle imports with no items (should not happen but edge case)', () => {
        const expected = `
import {Foo} from 'module1'

export class Test {}
`.trim()

        const generated = `
export class Test {}
`.trim()

        const result = compareCodeV2(expected, generated)
        expect(result.matches).toBe(false)
        expect(result.importDiffs.length).toBeGreaterThan(0)
    })
})
