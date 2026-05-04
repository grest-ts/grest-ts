import "./_dedupCheck";
export * from './core/Project'
export * from './core/File'
export * from './core/FileChunk'
export * from './core/FileImports'
export * from './core/TypeResolver'
export * from './core/TypeExtractor'
export * from './core/TypeConverter'
export * from './core/CodeGeneratorError'
export * from './core/GeneratorOptions'
export * from './core/ParsedType'

export * from './testing/compareGeneratedCode'

export * from './func/getTypeName'
export * from './utils/Logger'
export * from './func/extractImportsFromParsedType'
export * from "./utils/ParserError"
export * from "./core/BaseApiParser"
export * from "./core/TypeValidator"

// Codegen exports (merged from @grest-ts/codegen)
export * from './codegen/CodeGenerator'
export * from './codegen/CodegenBuilder'
export * from './codegen/defineConfig'
export * from "./codegen/CodegenRegistry";
