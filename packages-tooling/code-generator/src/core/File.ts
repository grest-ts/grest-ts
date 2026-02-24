import * as path from 'path'
import * as fs from 'fs'
import type { Project } from './Project'
import { FileImports } from './FileImports'
import { FileChunk, FileChunkOrder } from './FileChunk'
import { validateAndNormalizePath } from '../func/validateAndNormalizePath'

/**
 * Represents a single generated file
 */
export class File {
    public readonly project: Project
    public readonly absolutePath: string
    public readonly name: string
    public readonly imports: FileImports
    private readonly chunks: FileChunk[] = []

    constructor(project: Project, absolutePath: string, name: string) {
        // Validate and normalize the path
        const normalizedPath = validateAndNormalizePath(absolutePath, 'File absolutePath')

        this.project = project
        this.absolutePath = normalizedPath
        this.name = name
        this.imports = new FileImports(this)
        this.project._addFile(this)
    }

    /**
     * Internal: Add chunk to file
     * Called by FileChunk constructor
     */
    _addChunk(chunk: FileChunk): void {
        this.chunks.push(chunk)
    }

    /**
     * Generate final code for this file
     * Automatically adds section headers before groups of chunks with specific orders
     */
    getCode(): string {
        const code: string[] = []

        // Standard header comment for all generated files (skip for JSON files)
        if (!this.absolutePath.endsWith('.json')) {
            code.push('/**\n * DO NOT EDIT MANUALLY - This file is auto-generated\n */\n\n')
        }

        // Imports chunk (always first)
        new FileChunk(this, { order: FileChunkOrder.IMPORTS })
            .addCode(this.imports.getCode())

        // Sort chunks by order
        this.chunks.sort((a, b) => a.options.order - b.options.order)

        // Section headers mapping
        // Rule: Never prefix linebreaks, always 2 linebreaks after things
        // Headers end with \n\n (2 newlines = 1 blank line after)
        const sectionHeaders: Partial<Record<FileChunkOrder, string>> = {
            [FileChunkOrder.TYPE_ALIASES]: '// ---------------------------------------------------------\n// Types\n// ---------------------------------------------------------\n\n',
            [FileChunkOrder.ERROR_CLASSES]: '// ---------------------------------------------------------\n// Errors\n// ---------------------------------------------------------\n\n',
            [FileChunkOrder.INTERFACES_AFTER_ERRORS]: '// ---------------------------------------------------------\n// Interfaces\n// ---------------------------------------------------------\n\n',
            [FileChunkOrder.VALIDATOR_CLASSES]: '// ---------------------------------------------------------\n// Object validators\n// ---------------------------------------------------------\n\n'
        }

        // Track last order to detect when we enter a new section
        let lastOrder: FileChunkOrder | null = null
        let headerAddedForOrder = new Set<FileChunkOrder>()

        this.chunks.forEach(chunk => {
            const chunkOrder = chunk.options.order

            // If this is a new order and it has a section header, add it (once per order)
            if (chunkOrder !== lastOrder && sectionHeaders[chunkOrder] && !headerAddedForOrder.has(chunkOrder)) {
                code.push(sectionHeaders[chunkOrder]!)
                headerAddedForOrder.add(chunkOrder)
            }

            code.push(chunk.getCode())
            lastOrder = chunkOrder
        })

        const result = code.join('')
        // Ensure file ends with exactly one newline
        return result.trimEnd() + '\n'
    }

    /**
     * Write file to disk
     * Only writes if the content has changed to avoid triggering file watchers unnecessarily
     * Skips writing if file has no content beyond the header comment
     */
    async write(): Promise<void> {
        const code = this.getCode()

        // Skip writing if file has no content beyond the header comment
        // The header is always added for non-JSON files (see getCode())
        const hasOnlyHeader = !this.absolutePath.endsWith('.json') &&
                             code.trim() === '/**\n * DO NOT EDIT MANUALLY - This file is auto-generated\n */'

        if (hasOnlyHeader) {
            // File is empty (only header), don't write it
            // If the file already exists, delete it
            try {
                await fs.promises.unlink(this.absolutePath)
            } catch (error) {
                // File doesn't exist, that's fine
            }
            return
        }

        const dir = path.dirname(this.absolutePath)

        // Ensure directory exists
        await fs.promises.mkdir(dir, { recursive: true })

        // Check if file exists and has the same content
        let shouldWrite = true
        try {
            const existingContent = await fs.promises.readFile(this.absolutePath, 'utf-8')
            // Normalize line endings for comparison (handle Windows \r\n vs Unix \n)
            const normalizedExisting = existingContent.replace(/\r\n/g, '\n')
            const normalizedNew = code.replace(/\r\n/g, '\n')
            if (normalizedExisting === normalizedNew) {
                // Content unchanged, skip writing to avoid triggering file watchers
                shouldWrite = false
            }
        } catch (error) {
            // File doesn't exist or can't be read, proceed with write
            shouldWrite = true
        }

        if (shouldWrite) {
            await fs.promises.writeFile(this.absolutePath, code, 'utf-8')
        }
    }
}
