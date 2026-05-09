<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# @grest-ts/struct

Binary struct definitions with code generation. Define memory-efficient, strongly-typed data structures using a fluent TypeScript API, then generate optimized classes backed by typed arrays (`Int16Array`, `Uint32Array`, etc.).

Ideal for game engines, real-time simulations, and any scenario where you need to manage large pools of objects with minimal memory overhead, fast iteration, and efficient network/worker serialization.

The generated getters and setters are simple one-liner typed array accesses. V8 and other JS engines inline and optimize these away at JIT time, so you get effectively raw typed array access speed — as fast as JavaScript can go. There is no faster way to do it in JS.

The generated code has zero runtime dependencies and can be used as a standalone package — `@grest-ts/struct` is only needed at code generation time.

## Install

```bash
npm install @grest-ts/struct
```

## How it works

1. You define a struct schema in a `*.struct.ts` file using the fluent `Struct` builder.
2. You run the code generator, which parses the schema and writes a corresponding `*.ts` file with fully typed classes.
3. You import and use the generated classes in your application.

## Defining a struct

Create a file with the `.struct.ts` suffix. The filename becomes the generated class name.

```typescript
// MyEntity.struct.ts
import {ADD_MATH, MUST_EXIST, Struct, typed} from "@grest-ts/struct";

type tEntityRef = number & { tEntityRef: never };
type tSpriteId = number & { tSpriteId: never };

new Struct({useNew: true, useExport: true, useDirty: true})
    .ref<tEntityRef>()
    .buffer()
    .int16("x", ADD_MATH)
    .int16("y", ADD_MATH)
    .buffer()
    .uint32("spriteId", MUST_EXIST, typed<tSpriteId>())
    .bool("isHighlighted")
    .bit("isAnimated")
```

This generates a `MyEntity.ts` file with `MyEntity`, `MyEntityReader`, `MyEntityConfig`, and `MyEntityExport` types.

## Running the code generator

The generator scans a directory for all `*.struct.ts` files and writes the corresponding `*.ts` output files next to them.

### Programmatic usage

```typescript
import {StructParser} from "@grest-ts/struct";

StructParser.build("./src/structs/");
```

### CLI usage

```bash
npx tsx node_modules/@grest-ts/struct/src/generate.ts ./src/structs/
```

The generator only rewrites files whose content has actually changed, so it is safe to run on every build.

## Configuration options

Pass a config object to `new Struct(config)`:

| Option | Default | Description |
|---|---|---|
| `useNew` | `false` | Enables `new()` and `free()` methods for dynamic object allocation and deallocation. When `false`, the pool is fixed-size (all slots are always valid). |
| `useExport` | `false` | Generates `export()` / `import()` methods and a Reader class for transferring data across workers or network. |
| `useDirty` | `false` | Tracks which objects changed so only deltas are exported. Requires `useExport`. |

The combination of these flags determines which template is used for generation:

| `useNew` | `useExport` | `useDirty` | Use case |
|---|---|---|---|
| - | - | - | Fixed-size pool (e.g. map terrain tiles) |
| yes | - | - | Dynamic pool without serialization |
| - | yes | - | Read-only data transfer |
| - | yes | yes | Change-tracked data transfer |
| yes | yes | - | Dynamic pool with full-sync export |
| yes | yes | yes | Full-featured: dynamic pool with dirty tracking |

## Data types

| Method | Bits | TypedArray | TypeScript type |
|---|---|---|---|
| `int8` | 8 | `Int8Array` | `number` |
| `uint8` | 8 | `Uint8Array` | `number` |
| `int16` | 16 | `Int16Array` | `number` |
| `uint16` | 16 | `Uint16Array` | `number` |
| `int32` | 32 | `Int32Array` | `number` |
| `uint32` | 32 | `Uint32Array` | `number` |
| `float32` | 32 | `Float32Array` | `number` |
| `float64` | 64 | `Float64Array` | `number` |
| `bool` | 1 | `Uint8Array` (bitmask) | `boolean` |
| `bit` | 1 | `Uint8Array` (bitmask) | `number` |

Multiple `bool` and `bit` fields are automatically packed into shared bytes.

## Field modifiers

Each field method accepts optional modifiers after the name:

- **`ADD_MATH`** - Generates an `addFieldName(ref, value)` method in addition to the setter, allowing `+=` style updates.
- **`MUST_EXIST`** - Marks the field as an existence indicator. Used with `existenceCheck()` so `forEach` / `exists` can skip empty slots by checking this field is non-zero.
- **`typed<T>()`** - Attaches a branded TypeScript type to the field. The getter returns `T` and the setter requires `T`. Works with type aliases, enums, and imported types.

```typescript
.int16("x", ADD_MATH)                          // generates setX + addX
.uint32("spriteId", MUST_EXIST, typed<tSpriteId>())  // branded type + existence check
.int8("kind", typed<MyEnum>())                  // enum-typed field
```

## Memory layout — AoS, SoA, and AoSoA

The `.buffer()` call controls how fields are laid out in memory. By choosing how you group fields into buffers, you get all three classic data layouts:

**AoS (Array of Structures)** — One buffer, all fields interleaved. Good when you always access all fields together.

```typescript
new Struct()
    .buffer()
    .int16("x")
    .int16("y")
    .uint32("spriteId")
    .uint8("opacity")
// Memory: [x0,y0,spriteId0,opacity0, x1,y1,spriteId1,opacity1, ...]
```

**SoA (Structure of Arrays)** — Separate buffer per field. Best for iterating over a single field across all objects (cache-friendly).

```typescript
new Struct()
    .buffer().int16("x")
    .buffer().int16("y")
    .buffer().uint32("spriteId")
    .buffer().uint8("opacity")
// Memory: [x0,x1,x2,...] [y0,y1,y2,...] [spriteId0,spriteId1,...] [opacity0,opacity1,...]
```

**AoSoA (Array of Structures of Arrays)** — Multiple buffers, each grouping related fields. A hybrid that keeps related data together while separating unrelated groups.

```typescript
new Struct()
    .buffer()
    .int16("x")        // position chunk - accessed together during movement
    .int16("y")
    .buffer()
    .uint32("spriteId")  // rendering chunk - accessed together during draw
    .uint8("opacity")
// Memory: [x0,y0, x1,y1, ...] [spriteId0,opacity0, spriteId1,opacity1, ...]
```

Each `.buffer()` call starts a new chunk backed by its own `ArrayBuffer`. Within a chunk, fields for each object are interleaved. Choose the layout that matches your access patterns.

## Branded reference types

Use `.ref<T>()` to give the pool a branded reference type. This prevents accidentally mixing references from different pools.

```typescript
type tEntityRef = number & { tEntityRef: never };

new Struct()
    .ref<tEntityRef>()
    .buffer()
    .int16("x")
```

The generated getters and setters will require `tEntityRef` instead of plain `number`.

## Using generated code

### Basic (fixed-size pool)

```typescript
import {BasicStruct, tRef} from "./BasicStruct";

const pool = new BasicStruct({initialNumberOfObjects: 1000});

const ref = 0 as tRef;
pool.setX(ref, 100).setY(ref, 200);

console.log(pool.getX(ref)); // 100

pool.forEach(ref => {
    // iterates over all slots (0..999)
});
```

### Addable (dynamic allocation)

When `useNew: true`, objects are allocated and freed dynamically:

```typescript
const pool = new MyStruct({initialNumberOfObjects: 100});

const ref = pool.new();       // allocate
pool.setX(ref, 42);
pool.free(ref);               // deallocate (slot is reused)
```

The pool automatically doubles its backing buffer when capacity is exceeded.

### Exportable (data transfer)

When `useExport: true`, the generated code includes `export()` / `import()` and a Reader class:

```typescript
// Writer side (e.g. main thread / server)
const writer = new MyStruct({initialNumberOfObjects: 100});
const ref = writer.new();
writer.setX(ref, 10);

const message = writer.export();
// send `message` to worker or over network

// Reader side (e.g. worker / client)
const reader = new MyStructReader();
reader.import(message);

reader.forEach(ref => {
    console.log(reader.getX(ref));
});
```

### Dirty tracking

When `useDirty: true`, only modified objects are included in delta exports:

```typescript
const pool = new MyStruct({initialNumberOfObjects: 100, fullSyncRatio: 0.7});

const ref = pool.new();
pool.setX(ref, 10);
pool.dirty(ref);        // mark as changed

const msg = pool.export();  // only includes dirty objects (delta sync)
```

Call `dirty(ref)` after modifying an object to include it in the next export. If the number of dirty objects exceeds `fullSyncRatio * maxObjects`, the export automatically falls back to a full sync.

The `import()` method on the reader accepts optional callbacks:

```typescript
reader.import(message,
    (ref) => { /* called for each changed object */ },
    () => { /* called on full sync instead of per-object */ }
);
```

## Complete example

```typescript
// GameEntity.struct.ts
import {ADD_MATH, MUST_EXIST, Struct, typed} from "@grest-ts/struct";

type tEntityRef = number & { tEntityRef: never };
type tSpriteId = number & { tSpriteId: never };

export enum Direction { Up = 0, Down = 1, Left = 2, Right = 3 }

new Struct({useNew: true, useExport: true, useDirty: true})
    .ref<tEntityRef>()
    .buffer()
    .int16("x", ADD_MATH)
    .int16("y", ADD_MATH)
    .uint16("width")
    .uint16("height")
    .buffer()
    .uint32("spriteId", MUST_EXIST, typed<tSpriteId>())
    .uint8("opacity")
    .bool("isHighlighted")
    .bit("isAnimated")
    .int8("direction", typed<Direction>())
```

```bash
# Generate
npx tsx node_modules/@grest-ts/struct/src/generate.ts ./src/
```

```typescript
// app.ts
import {GameEntity, GameEntityReader} from "./GameEntity";

const entities = new GameEntity({initialNumberOfObjects: 10000, fullSyncRatio: 0.5});

const e = entities.new();
entities.setSpriteId(e, 1 as tSpriteId);
entities.setX(e, 100);
entities.addY(e, 50);  // += 50
entities.dirty(e);

// Transfer to render worker
const snapshot = entities.export();
postMessage(snapshot);

// In the render worker
const view = new GameEntityReader();
onmessage = (msg) => {
    view.import(msg.data, (ref) => {
        updateSprite(ref, view.getX(ref), view.getY(ref), view.getSpriteId(ref));
    });
};
```

