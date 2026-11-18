<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# @grest-ts/plugins

Plugins for an app that runs in several places: a server, a cron worker, a browser UI, an agent on a machine. A plugin is one package with a **facet per layer** (one subpath export per runtime). Each runtime runs its layer's facets through a **host**. Plugins extend each other through typed **points**. A generator writes the per-layer registries, so adding a plugin means creating its folder and running the generator.

| Concept | What it is |
|---|---|
| Manifest | `src/manifest.ts` in the plugin package: `export const manifest = {name, ...}`, plain data, no imports. The app chooses the other fields (dependencies, flags, cards). |
| Facet | What a plugin gives one layer. The app defines the facet type; the facet doesn't repeat the plugin's name. |
| `GGPluginHost` | Runs one layer in one process: dependency order, enablement, lifecycle phases, config, point contributions. |
| `GGPoint` | A typed extension point, `one` or `many`. |
| `GGPluginGen` | Writes `{[pluginName]: facet}` per layer, the manifests, and the collecting package's dependencies. |

## Points

```typescript
import {GGPoint} from "@grest-ts/plugins"

// Defined where the host of the point lives: the app, or the plugin that owns it.
export const RepoAccessPoint = GGPoint.one<RepoAccess>("repoAccess")
export const SettingsSlot = GGPoint.many<SettingsSection>("settings")
// Owned by a plugin: nothing reaches it while "approvals" is off.
export const GrantTypeSlot = GGPoint.many<GrantType>("grantTypes", {owner: "approvals"})
```

A plugin provides items as entries, statically in its facet's `provides`, or returned from a phase when they need the runtime's context:

```typescript
export const vaultClientPlugin: ClientPlugin = {
    provides: [SettingsSlot.provide({section: "vault", render: () => <Vault/>})],
}

export const gitHubPlugin = defineHubPlugin({
    compose: ctx => {
        const git = new GitHub(ctx.dynamo)
        return [RepoAccessPoint.provide(git.access)]
    },
})
```

Points are matched by `id`. A `one` point refuses a second provider. Items with a numeric `order` field are sorted by it.

## Host

```typescript
import {GGPluginHost} from "@grest-ts/plugins"
import {MANIFESTS} from "./manifests.gen"
import {HUB} from "./hub.gen"

export const hubPlugins = new GGPluginHost<HubFacet>({
    plugins: HUB,
    dependsOn: name => MANIFESTS[name].hub?.dependsOn,
    isOn: name => !DISABLED.includes(name),
})
if (hubPlugins.dropped.length) throw new Error(`Off dependency: ${JSON.stringify(hubPlugins.dropped)}`)

// In the runtime's GGConfig.define: plugins: hubPlugins.configTree()
await hubPlugins.run("compose", ctx)   // facet.compose(ctx, itsConfig) in order; returned entries are provided
hubPlugins.one(RepoAccessPoint)
hubPlugins.many(OrgTopicPoint)         // [{plugin, item}]
```

- **Order:** dependencies first, then by name. An unknown dependency or a cycle throws.
- **Enablement:** `isOn` decides which plugins run. A plugin whose dependency is off is not run, and is listed in `dropped` with the missing dependency. A host that must not run without one throws on `dropped`; a host for user-chosen plugins lets them go.
- **Phases:** `run(phase, ctx)` calls that method on every active facet, so `run("compose")` then `run("wire")` gives two-phase wiring where order doesn't matter.
- **Per-scope reads:** `many(point, isOn)` and `one(point, isOn)` take a narrower predicate (e.g. the plugins on in one workspace). An owned point is empty while its owner is off.
- **Config:** a facet's `config(prefix)` is called once by `configTree()`, under `plugins/<name>/` unless the host is given `configPrefix`. `localConfig()` feeds `localConfigTree()`, and `configOf(facet)` returns the handles to another layer of the same plugin.

## React

```tsx
import {GGPluginsProvider, useSlot, useSlotOne, useSlotHooks} from "@grest-ts/plugins/react"

<GGPluginsProvider host={uiPlugins} useIsOn={workspaceId => usePluginsOn(workspaceId)}>
    <App/>
</GGPluginsProvider>

const sections = useSlot(SettingsSlot, workspaceId)    // items of plugins on in this workspace
const Panel = useSlotOne(PanelSlot)                    // undefined while none is on
const counts = useSlotHooks(BadgeSlot, (item, on) => item.useCount(on), workspaceId)
```

`useIsOn` is a hook. `useSlotHooks` calls every item's hook, including items that are off (`on: false`), so switching a plugin never changes the hook order.

## Generator

```javascript
// scripts/gen-plugins.mjs: `node scripts/gen-plugins.mjs [--check]`
import {GGPluginGen} from "@grest-ts/plugins/gen"

export const pluginGen = new GGPluginGen({
    root: new URL("..", import.meta.url).pathname,
    generatedBy: "scripts/gen-plugins.mjs",
    manifest: "src/manifest.ts",
    manifests: {name: "MANIFESTS", out: "src/collection/manifests.gen.ts"},
    layers: [
        {name: "HUB", from: ["./hub"], export: "HubPlugin", out: "src/collection/hub.gen.ts"},
        {name: "UI", from: ["./vm-ui", "./hub-ui"], export: "ClientPlugin", out: "src/collection/ui.gen.ts"},
    ],
    dependencies: {packageJson: "src/collection/package.json", version: "*"},
})
await pluginGen.cli(import.meta.url)
```

- **Finding plugins:** every workspace package (root `package.json` `workspaces`) with a manifest is a plugin.
- **Joining a layer:** a plugin joins by exporting `<camelName><export>` (`userKeysHubPlugin`) from one of the layer's subpaths.
- **Output:** layers that share an `out` file are written together. Keep a layer that browser code imports in its own file, so the bundle doesn't pull in server facets.
- **Dependencies:** the `dependencies` package.json is kept listing exactly the plugin packages the generated files import; other dependencies are left alone.
- **`--check`:** exits 1 when a file is stale; `pluginGen.generate()` returns the content for a test to compare.

The generator runs under plain `node`. It loads each manifest with `import()`, so manifests stay plain data.
