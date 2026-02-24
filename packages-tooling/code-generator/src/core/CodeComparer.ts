/**
 * CodeComparer - Utilities for comparing generated code with expected output
 *
 * Supports two comparison strategies:
 * - V1: Line-by-line comparison (strips imports)
 * - V2: Block-based comparison (splits by blank lines, order-independent)
 */

/**
 * V1: Original comparison strategy
 * Strips all import statements and compares the rest line-by-line
 */
export function compareCodeV1(expected: string, generated: string): {
    matches: boolean
    strippedExpected: string
    strippedGenerated: string
} {
    // Normalize line endings
    expected = expected.replace(/\r\n/g, '\n')
    generated = generated.replace(/\r\n/g, '\n')

    // Strip imports from both files (import order doesn't matter)
    const stripImports = (content: string): string => {
        // Remove all import statements (including multiline imports)
        return content.replace(/^import\s+(?:type\s+)?.*?from\s+['"].*?['"];?\s*$/gm, '')
    }

    const strippedExpected = stripImports(expected)
    const strippedGenerated = stripImports(generated)

    return {
        matches: strippedExpected === strippedGenerated,
        strippedExpected,
        strippedGenerated
    }
}

/**
 * V2: Block-based comparison strategy
 *
 * Splits files by blank lines (\n\n) into logical blocks, then compares:
 * 1. Import blocks: Order of items within imports doesn't matter
 * 2. Code blocks: All blocks must be present (order doesn't matter)
 *
 * This is more robust for generated code where declaration order may vary
 */
export function compareCodeV2(expected: string, generated: string): {
    matches: boolean
    missingBlocks: string[]
    extraBlocks: string[]
    importDiffs: string[]
    splitImportWarnings: string[]
} {
    // Normalize line endings
    expected = expected.replace(/\r\n/g, '\n')
    generated = generated.replace(/\r\n/g, '\n')

    // Split by double newlines to get blocks
    const expectedBlocks = expected.split('\n\n').map(b => b.trim()).filter(b => b.length > 0)
    const generatedBlocks = generated.split('\n\n').map(b => b.trim()).filter(b => b.length > 0)

    // Separate import blocks from code blocks
    const isImportBlock = (block: string) => block.startsWith('import ')

    const expectedImports = expectedBlocks.filter(isImportBlock)
    const generatedImports = generatedBlocks.filter(isImportBlock)

    const expectedCode = expectedBlocks.filter(b => !isImportBlock(b))
    const generatedCode = generatedBlocks.filter(b => !isImportBlock(b))

    // Check for split imports (multiple imports from same source)
    const splitImportWarnings: string[] = []
    const expectedSplitImports = detectSplitImports(expectedImports)
    const generatedSplitImports = detectSplitImports(generatedImports)

    if (expectedSplitImports.length > 0) {
        splitImportWarnings.push('Expected file has split imports from same source:')
        expectedSplitImports.forEach(msg => splitImportWarnings.push(`  - ${msg}`))
    }

    if (generatedSplitImports.length > 0) {
        splitImportWarnings.push('Generated file has split imports from same source:')
        generatedSplitImports.forEach(msg => splitImportWarnings.push(`  - ${msg}`))
    }

    // Compare imports (normalize them first)
    const importDiffs: string[] = []
    const normalizedExpectedImports = normalizeImports(expectedImports)
    const normalizedGeneratedImports = normalizeImports(generatedImports)

    if (normalizedExpectedImports !== normalizedGeneratedImports) {
        importDiffs.push('Import statements differ')
        importDiffs.push('Expected imports:')
        importDiffs.push(normalizedExpectedImports)
        importDiffs.push('Generated imports:')
        importDiffs.push(normalizedGeneratedImports)
    }

    // Compare code blocks (order-independent)
    const normalizedExpectedCode = new Set(expectedCode.map(normalizeBlock))
    const normalizedGeneratedCode = new Set(generatedCode.map(normalizeBlock))

    const missingBlocks: string[] = []
    const extraBlocks: string[] = []

    // Find blocks in expected but not in generated
    for (const block of normalizedExpectedCode) {
        if (!normalizedGeneratedCode.has(block)) {
            missingBlocks.push(denormalizeBlock(block))
        }
    }

    // Find blocks in generated but not in expected
    for (const block of normalizedGeneratedCode) {
        if (!normalizedExpectedCode.has(block)) {
            extraBlocks.push(denormalizeBlock(block))
        }
    }

    const matches = importDiffs.length === 0 && missingBlocks.length === 0 && extraBlocks.length === 0 && splitImportWarnings.length === 0

    return {
        matches,
        missingBlocks,
        extraBlocks,
        importDiffs,
        splitImportWarnings
    }
}

/**
 * Detect split imports (multiple import statements from same source)
 * Returns array of warning messages for each source that has split imports
 */
function detectSplitImports(imports: string[]): string[] {
    const sourceCount = new Map<string, { count: number; isType: boolean }[]>()

    for (const importBlock of imports) {
        const lines = importBlock.split('\n')

        for (const line of lines) {
            const match = line.match(/^import\s+(type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/)
            if (match) {
                const [, isType, , module] = match
                const isTypeImport = !!isType

                if (!sourceCount.has(module)) {
                    sourceCount.set(module, [])
                }

                sourceCount.get(module)!.push({ count: 1, isType: isTypeImport })
            }
        }
    }

    const warnings: string[] = []

    for (const [module, entries] of sourceCount.entries()) {
        // Check for multiple value imports from same source
        const valueImports = entries.filter(e => !e.isType)
        if (valueImports.length > 1) {
            warnings.push(`Multiple value imports from '${module}' (${valueImports.length} import statements)`)
        }

        // Check for multiple type imports from same source
        const typeImports = entries.filter(e => e.isType)
        if (typeImports.length > 1) {
            warnings.push(`Multiple type imports from '${module}' (${typeImports.length} import statements)`)
        }
    }

    return warnings
}

/**
 * Normalize import statements for comparison
 * Merges imports from same module and sorts items
 */
function normalizeImports(imports: string[]): string {
    const importMap = new Map<string, Set<string>>()
    const typeImportMap = new Map<string, Set<string>>()

    for (const importBlock of imports) {
        const lines = importBlock.split('\n')

        for (const line of lines) {
            const match = line.match(/^import\s+(type\s+)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/)
            if (match) {
                const [, isType, items, module] = match
                const targetMap = isType ? typeImportMap : importMap

                if (!targetMap.has(module)) {
                    targetMap.set(module, new Set())
                }

                items.split(',').forEach(item => {
                    targetMap.get(module)!.add(item.trim())
                })
            }
        }
    }

    // Reconstruct normalized imports
    const result: string[] = []

    // Value imports
    for (const [module, items] of Array.from(importMap.entries()).sort()) {
        const sortedItems = Array.from(items).sort()
        result.push(`import {${sortedItems.join(', ')}} from '${module}'`)
    }

    // Type imports
    for (const [module, items] of Array.from(typeImportMap.entries()).sort()) {
        const sortedItems = Array.from(items).sort()
        result.push(`import type {${sortedItems.join(', ')}} from '${module}'`)
    }

    return result.join('\n')
}

/**
 * Normalize a code block for comparison
 * - Removes extra whitespace
 * - Normalizes semicolons
 * - Normalizes quotes
 */
function normalizeBlock(block: string): string {
    return block
        .replace(/\r\n/g, '\n') // Normalize line endings
        .replace(/;+$/gm, '') // Remove trailing semicolons
        .replace(/"/g, "'") // Normalize quotes
        .trim()
}

/**
 * Denormalize a block for display (add back formatting)
 */
function denormalizeBlock(block: string): string {
    return block
}

/**
 * Format comparison results for display
 */
export function formatComparisonV2Result(result: ReturnType<typeof compareCodeV2>): string {
    if (result.matches) {
        return 'Files match!'
    }

    let output = '\nComparison failed:\n'
    output += '─'.repeat(80) + '\n'

    if (result.splitImportWarnings.length > 0) {
        output += '\n[Split Import Issues]:\n'
        output += 'Multiple import statements from the same source should be merged into one.\n'
        result.splitImportWarnings.forEach(warning => {
            output += `${warning}\n`
        })
    }

    if (result.importDiffs.length > 0) {
        output += '\n[Import Differences]:\n'
        result.importDiffs.forEach(diff => {
            output += `  ${diff}\n`
        })
    }

    if (result.missingBlocks.length > 0) {
        output += `\n[Missing blocks] (${result.missingBlocks.length} in expected but not in generated):\n`
        result.missingBlocks.forEach((block, i) => {
            output += `\n[Block ${i + 1}]\n${block}\n`
        })
    }

    if (result.extraBlocks.length > 0) {
        output += `\n[Extra blocks] (${result.extraBlocks.length} in generated but not in expected):\n`
        result.extraBlocks.forEach((block, i) => {
            output += `\n[Block ${i + 1}]\n${block}\n`
        })
    }

    output += '─'.repeat(80) + '\n'

    return output
}
