import { writeFile, mkdir, readFile } from "fs/promises"
import { dirname } from "path"

/** Generated file message - same for all file types */
const GENERATED_MESSAGE = "THIS FILE IS GENERATED - DO NOT EDIT"

/**
 * Represents a file to be written by the packager.
 * Encapsulates path and content, with a write() method for deferred writing.
 */
export class PackagerFile {
    constructor(
        public readonly path: string,
        public readonly content: string
    ) {}

    /**
     * Write the file if content has changed.
     * @returns true if file was written, false if skipped (content unchanged)
     */
    async write(): Promise<boolean> {
        // Check if file exists and content is the same
        try {
            const existing = await readFile(this.path, "utf-8")
            if (existing === this.content) {
                return false // Skip - content unchanged
            }
        } catch {
            // File doesn't exist, will create it
        }

        await mkdir(dirname(this.path), { recursive: true })
        await writeFile(this.path, this.content, "utf-8")
        return true
    }

    /**
     * Helper to create a JSON file with generated marker field
     */
    static json(path: string, data: unknown): PackagerFile {
        const withMarker = { "//": GENERATED_MESSAGE, ...(data as object) }
        return new PackagerFile(path, JSON.stringify(withMarker, null, 2) + "\n")
    }

    /**
     * Helper to create a text file with generated header comment
     */
    static text(path: string, content: string): PackagerFile {
        const header = `// ---------------------------------------------
// ${GENERATED_MESSAGE}
// ---------------------------------------------

`
        return new PackagerFile(path, header + content)
    }

    /**
     * Helper to create a markdown file with generated notice
     */
    static markdown(path: string, content: string): PackagerFile {
        const notice = `<!-- ${GENERATED_MESSAGE} -->\n\n`
        return new PackagerFile(path, notice + content)
    }

    /**
     * Helper to create a file copied as-is (no generated marker)
     */
    static copy(path: string, content: string): PackagerFile {
        return new PackagerFile(path, content)
    }
}
