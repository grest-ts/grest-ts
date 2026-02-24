# Contributing to grest-ts Framework

Thank you for your interest in contributing.

## Legal

By submitting a pull request or otherwise contributing to this project, you agree to the following:

- Your contribution is your original work, or you have the right to submit it under the project's license.
- You grant the project maintainers and Grest Games OÜ a perpetual, irrevocable, worldwide, royalty-free license to use, modify, distribute, and sublicense your contribution under the MIT License (or any other license the project may adopt in the future).
- You waive any claims of ownership or moral rights over the contributed code.
- You are solely responsible for ensuring your contribution does not violate any third-party intellectual property rights, patents, or licenses.
- You understand that your contribution will be publicly available and may be used by others under the project's license.

If you are contributing on behalf of your employer, you confirm that your employer has authorized the contribution under these terms.

## Getting Started

### Prerequisites

- Node.js 22+
- TypeScript 5.9+

### Setup

```bash
git clone https://github.com/grest-ts/grest-ts.git
cd grest-ts
npm install
```

### Running Tests

```bash
# All tests
npm test

# Watch mode
npm run test:watch

# Specific package
npm test -- packages/http

# Type checking
npm run typecheck
```

### Project Structure

This is an npm workspaces monorepo:

- `packages/` - Core framework packages (`@grest-ts/runtime`, `@grest-ts/http`, `@grest-ts/config`, etc.)
- `packages-libs/` - Standalone libraries (`@grest-ts/sql`, `@grest-ts/struct`, etc.)
- `packages-tooling/` - Developer tooling (`@grest-ts/testkit`, `@grest-ts/code-generator`)
- `examples/` - Example projects demonstrating framework usage
- `x-packager/` - Internal package build tooling

## Submitting Changes

1. Fork the repository.
2. Create a branch from `master`.
3. Make your changes.
4. Run `npm test` and `npm run check` to verify nothing is broken.
5. Submit a pull request with a clear description of what you changed and why.

## Guidelines

- Follow existing code style and patterns.
- Add tests for new functionality.
- Keep changes focused - one concern per pull request.
- Do not introduce new dependencies without discussion.

## Reporting Issues

Open a GitHub issue with:

- A clear description of the problem.
- Steps to reproduce.
- Expected vs actual behavior.
- Node.js and TypeScript versions.
