# @grest-ts/code-generator

> **DEPRECATED**: This package is currently not in use. The Grest Framework runs without code generation - validators use runtime JIT compilation instead. This package is preserved for potential future use. See [DEPRECATED.md](./DEPRECATED.md) for details.

This package is not for humans... You are a brave human if you come here and try to understand the details!

But in overall, it provides the foundation for code generation in the Grest framework. AI assistants use these utilities to generate type-safe clients, servers, and validators from API definitions.

## What's Inside

### Core Generation Infrastructure

- **`Project`** - Central manager for a code generation session. Tracks files, maintains a catalogue of exports for automatic import resolution, and handles writing everything to disk.

- **`File`** - Represents a single generated file. Collects content via chunks, manages imports, and handles smart writing (only writes if content changed).

- **`FileChunk`** - Content blocks within a file. Supports ordering (imports → types → errors → validators → main code) and automatic section headers.

- **`FileImports`** - Manages imports for a file. Handles deduplication, catalogue-based resolution, and SDK shared types mode.

### Type Extraction & Resolution

- **`TypeExtractor`** - The workhorse. Uses TypeScript Compiler API to parse `.api.ts` files and extract full type information including interfaces, enums, unions, branded types, and their validators.

- **`ParsedType`** - Intermediate representation of types. Captures everything needed for validation: kind, properties, enum values, union members, branded type validators, etc.

- **`TypeResolver`** / **`TypeConverter`** / **`TypeValidator`** - Additional type processing utilities.

### Codegen Builder System

- **`CodeGenerator`** - Main orchestrator. Discovers codegen modules via `@grest-ts/common` extension system, scans for `.api.ts` files, dispatches to registered builders, and writes output.

- **`CodegenBuilder`** - Abstract base class for builders. Each package (`@grest-ts/http`, `@grest-ts/events`, etc.) extends this to handle its specific API definition format.

- **`CodegenRegistry`** - Registry where builders register themselves to be discovered.

### Testing Utilities

- **`compareGeneratedCode()`** - One-liner test runner for code generation. Runs generation, compares `*.gen.ts` with `*.expected.ts`, and verifies TypeScript compilation.

- **`runGG()`** - Executes the code generator in a subprocess.

- **`CodeComparer`** - Block-based comparison for generated code with helpful diff output.

## How It Works

1. API definitions are written in `.api.ts` files using fluent builder patterns
2. `CodeGenerator` discovers all registered builders and scans for API files
3. Each builder checks if it can handle a file via `canHandle()`
4. Builders create `File` objects and add `FileChunk`s with generated code
5. `TypeExtractor` provides full type resolution including branded types and validators
6. `Project.write()` resolves all imports via the catalogue and writes files

## For AI Assistants

When generating code:

- Create a `Project` with the target directory
- Create `File` objects for each output file
- Add `FileChunk`s with your generated code (they auto-sort by order)
- Use `TypeExtractor` to resolve types from source files
- Let `FileImports` handle import resolution automatically
- Call `project.write()` when done

The testing utilities make it easy to verify your generators produce correct output.

## Further Reading

[Extending](./README-extending.md) - Extending the code generator with your own builders.