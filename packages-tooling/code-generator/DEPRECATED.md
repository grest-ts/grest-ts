# Deprecated Package

This package is currently **not in use** by the Grest Framework.

## Why Keep It?

The code-generator provides sophisticated AST-based code generation infrastructure that may become valuable in the future:

- TypeScript Compiler API integration for parsing `.api.ts` files
- Full type extraction including interfaces, enums, unions, and branded types
- Extensible builder system for generating clients, servers, and validators
- Project/File/FileChunk abstractions for managing generated code

## Current Status

The Grest Framework runs fully without any code generation. Validators use runtime JIT compilation via `new Function()` instead of build-time AOT generation.

## Future Potential

If AOT compilation of validators or other code generation needs arise, this package provides the foundation:

- Pre-compile validators at build time for faster cold starts
- Generate type-safe API clients from definitions
- Create documentation from type definitions
- Support environments where `new Function()` is restricted (CSP)

## If Reactivating

1. Review and update the README.md and README-extending.md documentation
2. Update dependencies and ensure compatibility with current TypeScript version
3. Add integration tests with the current validator system
4. Remove this DEPRECATED.md file
