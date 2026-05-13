# Contract

Type-safe functions & classes as contracts with validated input, output and fixed error types.

## Overview

Contracts define type-safe API endpoints with:

- Input/output schema validation
- Typed error responses (not just generic errors)
- Async execution with GGPromise wrapper
- Automatic error handling and serialization

### Transport Agnostic

Contracts define **validated async functions** - nothing more. They have no opinion about HTTP, WebSocket, gRPC, or any transport layer. A contract is simply:

```
Input Schema -> Handler -> Success Schema | Error Types
```

This makes contracts useful in multiple contexts:

- **Network boundaries** - Validate data crossing client/server boundary
- **Internal services** - Type-safe function calls between modules
- **Testing** - Same contract, mock implementation
- **Any transport** - Wrap with HTTP, WebSocket, IPC, or direct calls

The transport layer is a separate concern that wraps contracts, not something contracts know about.

## GGContractFunction

Define a single API endpoint:

```typescript
import {GGContractFunction} from "@grest-ts/schema"
import {IsObject, IsString, IsInt} from "@grest-ts/schema"
import {NOT_FOUND, NOT_AUTHORIZED} from "@grest-ts/schema"

const GetUserContract = new GGContractFunction({
    input: IsObject({
        userId: IsInt
    }),
    success: IsObject({
        id: IsInt,
        name: IsString,
        email: IsString
    }),
    errors: [NOT_FOUND, NOT_AUTHORIZED]
});
```

### Implementing a Contract

```typescript
const getUser = GetUserContract.implement(async (data) => {
    const user = await db.users.find(data.userId);
    if (!user) {
        throw new NOT_FOUND();
    }
    return user;
});

// Call the implemented function
const user = await getUser({userId: 123});
```

## GGContractClass

Bundle multiple related endpoints:

```typescript
import {GGContractClass} from "@grest-ts/schema"

const UserContract = new GGContractClass("User", {
    get: {
        input: IsObject({userId: IsInt}),
        success: UserSchema,
        errors: [NOT_FOUND]
    },
    create: {
        input: CreateUserSchema,
        success: UserSchema,
        errors: [EXISTS, VALIDATION_ERROR]
    },
    delete: {
        input: IsObject({userId: IsInt}),
        success: IsObject({deleted: IsInt}),
        errors: [NOT_FOUND, FORBIDDEN]
    }
});
```

### Implementing a Contract Class

```typescript
const UserService = UserContract.implement((deps) => ({
    async get(data) {
        const user = await deps.db.users.find(data.userId);
        if (!user) throw new NOT_FOUND();
        return user;
    },
    async create(data) {
        const existing = await deps.db.users.findByEmail(data.email);
        if (existing) throw new EXISTS();
        return deps.db.users.create(data);
    },
    async delete(data) {
        const deleted = await deps.db.users.delete(data.userId);
        if (!deleted) throw new NOT_FOUND();
        return {deleted: 1};
    }
}));

// Create instance with dependencies
const userService = new UserService({db: database});

// Call methods
const user = await userService.get({userId: 123});
```

## Error Handling

### Standard Errors

Built-in error types for common scenarios:

```typescript
import {
    NOT_FOUND,        // 404 - Resource not found
    NOT_AUTHORIZED,   // 401 - Authentication required
    FORBIDDEN,        // 403 - Permission denied
    EXISTS,           // 409 - Resource already exists
    VALIDATION_ERROR, // 422 - Input validation failed
    SERVER_ERROR      // 500 - Internal server error
} from "@grest-ts/schema"
```

### Custom Errors

Define application-specific errors:

```typescript
import {ERROR} from "@grest-ts/schema"

// Error without data (400 Bad Request)
const INVALID_COUPON = ERROR.badRequest('INVALID_COUPON');

// Error with typed data (400 Bad Request)
const INSUFFICIENT_FUNDS = ERROR.badRequest('INSUFFICIENT_FUNDS', IsObject({
    required: IsNumber,
    available: IsNumber
}));

// Usage
throw new INVALID_COUPON({displayMessage: "Coupon code is invalid or expired"});
throw new INSUFFICIENT_FUNDS({required: 100, available: 50});

// For non-400 status codes, use ERROR.define
const RATE_LIMITED = ERROR.define('RATE_LIMITED', 429);
```

### Error Context

Errors support rich context for debugging:

```typescript
throw new NOT_FOUND({
    displayMessage: "User not found",      // Safe to show to user
    debugMessage: "Query returned 0 rows", // For logs only
    debugData: {query: "SELECT..."},       // Debug payload
    ref: "ERR_123"                         // Correlation ID
});
```

## GGPromise

Contract calls return GGPromise, a wrapper with flexible error handling:

### Default: Throw on Error

```typescript
// Errors throw automatically
const user = await userService.get({userId: 123});
// user is User type, errors throw
```

### Explicit: Discriminated Union

```typescript
const result = await userService.get({userId: 123}).asResult();

if (result.success) {
    console.log(result.data);  // User
} else {
    console.log(result.type);  // "NOT_FOUND", "NOT_AUTHORIZED", etc.
}
```

### Fallback Values

```typescript
// Default value on any error
const user = await userService.get({userId: 123})
    .orDefault(() => guestUser);

// Handle specific errors
const user = await userService.get({userId: 123})
    .or((error) => {
        if (error.type === "NOT_FOUND") {
            return createDefaultUser();
        }
        throw error;  // Re-throw others
    });
```

### Transform Results

```typescript
// Map success value
const userName = await userService.get({userId: 123})
    .map(user => user.name);

// Catch and transform errors
const result = await userService.get({userId: 123})
    .catch(error => null);  // Returns User | null
```

## Validation Flow

Contract executor performs validation at multiple stages:

1. **Input validation** - Validates request data, returns VALIDATION_ERROR if invalid
2. **Handler execution** - Runs your implementation
3. **Output validation** - Validates response against success schema
4. **Error validation** - Validates error data against error schema

```typescript
// Input validation - returns VALIDATION_ERROR to client
const result = await userService.get({userId: "not-a-number"});
// result.type === "VALIDATION_ERROR"
// result.data contains validation issues

// Output validation - throws SERVER_ERROR (bug in handler)
// If your handler returns data that doesn't match success schema
```

## Type Safety

Contracts provide end-to-end type safety:

```typescript
const contract = new GGContractFunction({
    input: IsObject({userId: IsInt}),
    success: IsObject({name: IsString}),
    errors: [NOT_FOUND, FORBIDDEN]
});

const fn = contract.implement(async (data) => {
    // data is typed as {userId: number}
    return {name: "Test"};
    // Return type must match success schema
});

// Call site
const result = await fn({userId: 123}).asResult();
if (result.success) {
    result.data.name;  // string
} else {
    result.type;  // "NOT_FOUND" | "FORBIDDEN" | "VALIDATION_ERROR" | "SERVER_ERROR"
}
```

## Best Practices

### Define All Possible Errors

```typescript
// Good - explicit error types
const GetUser = new GGContractFunction({
    input: UserIdSchema,
    success: UserSchema,
    errors: [NOT_FOUND, NOT_AUTHORIZED, FORBIDDEN] // SERVER_ERROR is implicit, VALIDATION_ERROR is implicit in case input is used.
});

// Avoid - missing error types
const GetUser = new GGContractFunction({
    input: UserIdSchema,
    success: UserSchema,
    errors: []  // Unlisted errors become SERVER_ERROR
});
```

### Use displayMessage for User-Facing Errors

```typescript
// Good - safe message for UI
throw new NOT_FOUND({
    displayMessage: "User not found",
    debugMessage: `User ID ${id} not in database`,  // Logs only
    debugData: {id, table: "users"}  // Logs only
});

// Avoid - leaking internal details
throw new NOT_FOUND({
    displayMessage: `SELECT * FROM users WHERE id=${id} returned 0 rows`
});
```

### Handle Errors at the Right Level

```typescript
// Good - handle expected errors, let unexpected bubble up
const user = await userService.get({userId}).or((error) => {
    if (error.type === "NOT_FOUND") {
        return null;  // Expected case
    }
    throw error;  // Unexpected - let it propagate
});

// Avoid - swallowing all errors
const user = await userService.get({userId}).orDefault(() => null);
// Hides NOT_AUTHORIZED, SERVER_ERROR, etc.
```

### Use asResult() for Complex Error Handling

```typescript
// Good - explicit handling of each error type
const result = await userService.get({userId}).asResult();
switch (result.type) {
    case "NOT_FOUND":
        return redirect("/register");
    case "NOT_AUTHORIZED":
        return redirect("/login");
    case "FORBIDDEN":
        return showError("Permission denied");
    default:
        return showError("Something went wrong");
}

// Use result.data...
```
