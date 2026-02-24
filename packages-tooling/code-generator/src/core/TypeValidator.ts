import * as ts from "typescript";
import {ParserError} from "../utils/ParserError";

/**
 * Type validator for API definitions
 * Ensures only supported types are used in API contracts
 */
export class TypeValidator {
    private static readonly UNSUPPORTED_TYPES = new Map<string, string>([
        ['Map', 'Maps cannot be serialized over HTTP/WebSocket. Use an object with string keys instead: { [key: string]: ValueType }'],
        ['Set', 'Sets cannot be serialized over HTTP/WebSocket. Use an array instead: ValueType[]'],
        ['WeakMap', 'WeakMap cannot be serialized. Use an object with string keys instead: { [key: string]: ValueType }'],
        ['WeakSet', 'WeakSet cannot be serialized. Use an array instead: ValueType[]'],
        ['Symbol', 'Symbols cannot be serialized over HTTP/WebSocket'],
        ['Function', 'Function types are not allowed in API contracts (except in the API definition itself)'],
        ['BigInt', 'BigInt is not supported. Use number or string instead'],
        ['Date', 'Date objects cannot be reliably serialized. Use number (timestamp) or string (ISO 8601) instead'],
        ['RegExp', 'RegExp cannot be serialized. Use string patterns instead'],
        ['Promise', 'Promise types should not appear in API contracts. Use async/await patterns instead'],
        ['Buffer', 'Buffer is Node.js specific. Use Uint8Array or base64 string instead'],
    ])

    /**
     * Validate a type node and throw detailed error if unsupported
     */
    static validateType(
        typeNode: ts.TypeNode,
        filePath: string,
        sourceFile: ts.SourceFile,
        context: string = 'API contract'
    ): void {
        this.validateTypeRecursive(typeNode, filePath, sourceFile, context, new Set())
    }

    private static validateTypeRecursive(
        typeNode: ts.TypeNode,
        filePath: string,
        sourceFile: ts.SourceFile,
        context: string,
        visitedNodes: Set<ts.TypeNode>
    ): void {
        // Prevent infinite recursion
        if (visitedNodes.has(typeNode)) return
        visitedNodes.add(typeNode)

        // Check for unsupported type references
        if (ts.isTypeReferenceNode(typeNode)) {
            const typeName = typeNode.typeName.getText(sourceFile)

            // Check if it's an unsupported built-in type
            const suggestion = this.UNSUPPORTED_TYPES.get(typeName)
            if (suggestion) {
                throw new ParserError(
                    `Unsupported type '${typeName}' used in ${context}.\n  ${suggestion}`,
                    filePath,
                    typeNode,
                    sourceFile
                )
            }

            // Validate type arguments for generics
            if (typeNode.typeArguments) {
                for (const arg of typeNode.typeArguments) {
                    this.validateTypeRecursive(arg, filePath, sourceFile, `${context} (generic type argument)`, visitedNodes)
                }
            }
        }

        // Validate array element types
        if (ts.isArrayTypeNode(typeNode)) {
            this.validateTypeRecursive(typeNode.elementType, filePath, sourceFile, `${context} (array element)`, visitedNodes)
        }

        // Validate union members
        if (ts.isUnionTypeNode(typeNode)) {
            for (const member of typeNode.types) {
                this.validateTypeRecursive(member, filePath, sourceFile, `${context} (union member)`, visitedNodes)
            }
        }

        // Validate intersection members
        if (ts.isIntersectionTypeNode(typeNode)) {
            for (const member of typeNode.types) {
                this.validateTypeRecursive(member, filePath, sourceFile, `${context} (intersection member)`, visitedNodes)
            }
        }

        // Validate tuple elements
        if (ts.isTupleTypeNode(typeNode)) {
            for (const element of typeNode.elements) {
                this.validateTypeRecursive(element, filePath, sourceFile, `${context} (tuple element)`, visitedNodes)
            }
        }

        // Check for function types (not allowed except in specific contexts)
        if (ts.isFunctionTypeNode(typeNode)) {
            throw new ParserError(
                `Function types are not allowed in ${context}. API contracts must use serializable data types only.`,
                filePath,
                typeNode,
                sourceFile
            )
        }
    }
}