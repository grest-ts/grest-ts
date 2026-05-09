<!-- GREST-TS-BANNER-START -->
> Part of the [grest-ts](https://github.com/grest-ts/grest-ts) framework.
> [Documentation](https://github.com/grest-ts/grest-ts#readme) | [All packages](https://github.com/grest-ts/grest-ts#package-reference)
<!-- GREST-TS-BANNER-END -->

# @grest-ts/cli

CLI for keeping every `@grest-ts/*` package in your project on the same version. Full guide: [Guide → CLI](@guide/cli).

## Usage

```bash
npx @grest-ts/cli update             # bump to "latest"
npx @grest-ts/cli update 0.0.30      # bump to a specific version
npx @grest-ts/cli update next        # bump to a dist-tag
npx @grest-ts/cli update --dry-run   # preview only
```

## Install (optional)

`npx` works without installing anything. To pin a CLI version per-project:

```bash
npm install -D @grest-ts/cli
```
