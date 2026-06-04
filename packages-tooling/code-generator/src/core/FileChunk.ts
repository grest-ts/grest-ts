import type {File} from './File'
import type {FileImportInput} from './FileImports'
import {enumOf, type Values} from "@grest-ts/common"

/**
 * Order for chunks within a file
 */
export const FileChunkOrder = enumOf({
    IMPORTS: 0,
    INTERFACES: 5,           // DEPRECATED: Old interfaces order (kept for backwards compat)
    CLASSES: 10,
    TYPE_ALIASES: 15,        // Type aliases (type X = ...)
    ERROR_CLASSES: 18,       // Error classes
    TYPES: 20,               // DEPRECATED: Keep for backwards compat
    INTERFACES_AFTER_ERRORS: 21,  // Interfaces (in sectioned files)
    VALIDATOR_CLASSES: 45,   // Validator classes
    VALIDATORS: 50,
    HELPERS: 60,
})
export type FileChunkOrder = Values<typeof FileChunkOrder>


/**
 * Options for a file chunk
 */
export interface FileChunkOptions {
    /** Optional name (used for catalogue registration) */
    name?: string
    /** Order within the file */
    order: FileChunkOrder
}

/**
 * A chunk of code within a file
 */
export class FileChunk {
    public readonly project: any // Will be Project after circular imports resolved
    public readonly file: File
    public readonly options: FileChunkOptions
    private readonly code: string[] = []

    constructor(file: File, options: FileChunkOptions) {
        this.file = file
        this.project = file.project
        this.options = Object.freeze(options)

        // Register in catalogue if named
        if (options.name) {
            this.project.addToCatalogue(this.file, options.name)
        }

        this.file._addChunk(this)
    }

    /**
     * Add code to this chunk
     */
    addCode(code: string): this {
        this.code.push(code)
        return this
    }

    /**
     * Get generated code
     */
    getCode(): string {
        return this.code.join('')
    }

    /**
     * Add an import (convenience method)
     */
    addImport(input: FileImportInput): this {
        this.file.imports.addImport(input)
        return this
    }
}
