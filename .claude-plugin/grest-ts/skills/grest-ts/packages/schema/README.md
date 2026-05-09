<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# @grest-ts/schema

Type-safe runtime validation library for Grest Framework.

## Features

- World fastest stringify, validation, clean and coerce thanks to AOT.
- Type-safe validators with branded type support
- Primitive validators (IsString, IsNumber, IsBoolean)
- Composite validators (IsObject, IsArray, IsUnion, IsDiscriminated)
- Rich set of branded validators (IsInt, IsEmail, IsUrl, IsDate, etc.)
- Coercion support for API input parsing
- Detailed validation error collection with paths
- Zero runtime overhead branded types
- Internalization / translations are fully supported via @grest-ts/intl

## Quick usage example

```typescript
import {IsString, IsNumber, IsObject, IsInt, IsEmail, GGIssuesList} from "@grest-ts/schema"

// Define a validator for your type
const IsUser = IsObject({
    id: IsInt,
    name: IsString,
    email: IsEmail,
    age: IsInt.orUndefined
});

// ---
// Parse with coercion and error collection
const result = IsUser.safeParse(data, true) // set last argument to false to skip coercion.
if (result.success === false) {
    // Handle validation errors
    console.log(result.issues.toJSON())
}

// ---
// Type guard - returns boolean
if (IsUser.is(user)) {
    // data is typed as User  (but can contain extra properties, not safe for database insert for example. Use parse instead)
}

// ---
// Assert - throws on validation failure
IsUser.assert(data)

// ---
// Branded types for domain modeling
const IsUserId = IsInt.brand<"UserId">();
const userId = IsUserId.parse(rawId, true); // parse with coercion, throws on error
type tUserId = typeof IsUserId.infer;
```

## Contract example

Type-safe classes with validated input, output, and typed errors:

```typescript
import {EXISTS, GGContractClass, IsEmail, IsInt, IsObject, IsString, NOT_FOUND} from "@grest-ts/schema"

// Define a contract class with multiple methods
const UserContract = new GGContractClass("User", {
    get: {
        input: IsObject({userId: IsInt}),
        success: IsObject({id: IsInt, name: IsString}),
        errors: [NOT_FOUND]
    },
    create: {
        input: IsObject({name: IsString, email: IsEmail}),
        success: IsObject({id: IsInt, name: IsString}),
        errors: [EXISTS]
    }
});

// Implement the contract
const UserService = UserContract.implement((db) => ({
    async get(data) {
        const user = await db.users.find(data.userId)
        if (!user) throw new NOT_FOUND()
        return user
    },
    async create(data) {
        return db.users.create(data)
    }
}));

// Create instance and call methods - errors are typed!
const userService = new UserService(database);
const result = await userService.get({userId: 123}).asResult();
if (result.success) {
    console.log(result.data.name);  // typed as string
} else {
    console.log(result.type);  // "NOT_FOUND" | "VALIDATION_ERROR" | "SERVER_ERROR"
}
```

See [Contract documentation](./README-contract.md) for custom errors, GGPromise helpers, and more.

## Documentation

- [Usage](./README-usage.md) - How to define and use validators
- [Contract](./README-contract.md) - Type-safe RPC contracts with typed errors
- [Codec](./README-codec.md) - Bidirectional data transformation with schema documentation
- [Localization](./README-localization.md) - How to localize error messages.
- [Extending](./README-extending.md) - How to create custom validators
