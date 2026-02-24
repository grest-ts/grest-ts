# @grest-ts/common

Common utility functions and types shared across all GG packages.

## Purpose

This package contains utility functions and types that are used across multiple packages in the Grest framework. By consolidating them here, we:
- Eliminate code duplication
- Ensure consistency across packages
- Make maintenance easier
- Reduce package dependencies

## Utilities

### `deepFreeze<T>(obj: T): T`

Recursively freezes an object and all its nested properties, making it immutable.

```typescript
import { deepFreeze } from '@grest-ts/common';

const config = deepFreeze({
  name: 'app',
  settings: {
    debug: true
  }
});

// This will throw an error in strict mode
config.settings.debug = false;
```

### `withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T>`

Wraps a promise with a timeout. If the promise doesn't resolve/reject within the specified timeout, the returned promise will reject with an error.

```typescript
import { withTimeout } from '@grest-ts/common';

const result = await withTimeout(
  fetch('https://api.example.com'),
  5000,
  'API request timed out'
);
```

## Types

### `DeepPartial<T>`

Recursively makes all properties of an object optional. Useful for partial matching in tests and validation.

```typescript
import { DeepPartial } from '@grest-ts/common';

interface User {
  id: string;
  profile: {
    name: string;
    email: string;
  };
}

// All properties are optional
const partialUser: DeepPartial<User> = {
  profile: {
    name: 'Alice'
    // email is optional
  }
};
```

## Adding New Utilities

When adding new utilities to this package:

1. Create a new file in `src/` for the utility
2. Export it from `src/index.ts`
3. Add JSDoc comments explaining usage
4. Update this README with examples
5. Ensure the utility is truly reusable across multiple packages
