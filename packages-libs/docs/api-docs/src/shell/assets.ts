import {readFileSync} from "fs";
import {dirname, join} from "path";
import {createRequire} from "module";
import {fileURLToPath} from "url";

const _require = createRequire(import.meta.url);

// ── External viewer assets ─────────────────────────────────────────────────

/** Directory of the swagger-ui-dist npm package. */
function swaggerUiDistDir(): string {
    return dirname(_require.resolve("swagger-ui-dist/swagger-ui-bundle.js"));
}

/** Directory of the @asyncapi/react-component browser standalone bundle. */
function asyncApiDistDir(): string {
    // Resolve via the package's known browser standalone entry.
    // The package ships its assets under browser/standalone/ and styles/default.min.css.
    // We resolve a known file and walk up to the package root.
    const indexPath = _require.resolve("@asyncapi/react-component/browser/standalone/index.js");
    return dirname(indexPath); // .../browser/standalone
}

function asyncApiCssPath(): string {
    // Sibling of the standalone dir: package_root/styles/default.min.css
    const standaloneDir = asyncApiDistDir();
    const pkgRoot = dirname(dirname(standaloneDir)); // up two levels: standalone → browser → root
    return join(pkgRoot, "styles", "default.min.css");
}

export interface VendoredAsset {
    /** File name as served at /assets/<filename> in live mode. */
    filename: string;
    contentType: string;
    body: Buffer;
}

/** Read all bundled assets from disk. Cached after first call. */
let _cached: VendoredAsset[] | undefined;
export function loadVendoredAssets(): VendoredAsset[] {
    if (_cached) return _cached;
    const swaggerDir = swaggerUiDistDir();
    const aaDir = asyncApiDistDir();
    const aaCss = asyncApiCssPath();
    const shellDir = join(dirname(fileURLToPath(import.meta.url)), "assets");
    _cached = [
        {filename: "swagger-ui-bundle.js", contentType: "application/javascript", body: readFileSync(join(swaggerDir, "swagger-ui-bundle.js"))},
        {filename: "swagger-ui.css",       contentType: "text/css",              body: readFileSync(join(swaggerDir, "swagger-ui.css"))},
        {filename: "asyncapi-component.js", contentType: "application/javascript", body: readFileSync(join(aaDir, "index.js"))},
        {filename: "asyncapi-component.css", contentType: "text/css",             body: readFileSync(aaCss)},
        {filename: "shell.js",             contentType: "application/javascript", body: readFileSync(join(shellDir, "shell.js"))},
        {filename: "shell.css",            contentType: "text/css",              body: readFileSync(join(shellDir, "shell.css"))},
    ];
    return _cached;
}
