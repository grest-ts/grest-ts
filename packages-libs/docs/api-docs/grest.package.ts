import {definePackage} from "#scripts/packager/definePackage";

definePackage({
    name: "@grest-ts/api-docs",
    description: "Native React-based documentation UI for grest-ts services — renders contracts directly, no OpenAPI/AsyncAPI conversion in the rendering path",
    keywords: ["api-docs", "documentation", "react", "typescript", "contracts"],
    targets: {node: true},
    hasTests: true,
    publishToNpm: true,
    /** Standalone — no dependency on @grest-ts/openapi or @grest-ts/asyncapi.
     *  Those are separate peer packages users install if they specifically need
     *  industry-standard spec exports. */
    dependencies: {},
    /** Ship the Vite-built React UI alongside the source so installs don't
     *  need to rebuild the bundle. */
    extraFiles: ["dist-ui"]
})
