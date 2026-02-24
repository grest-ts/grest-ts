import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
const runtimeDeps = Object.keys(pkg.dependencies || {});

// Generate a production package.json with only runtime dependencies
mkdirSync('dist', { recursive: true });
writeFileSync('dist/package.json', JSON.stringify({
  name: pkg.name,
  version: pkg.version,
  type: pkg.type,
  scripts: { start: "node ./server.js" },
  dependencies: pkg.dependencies,
}, null, 2));

esbuild.build({
  entryPoints: ['src/AppRuntime.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: 'dist/server.js',
  sourcemap: true,
  tsconfig: 'tsconfig.json',
  banner: {
    js: "import { createRequire } from 'module';\nconst require = createRequire(import.meta.url);",
  },
  plugins: [{
    name: 'externalize-deps',
    setup(build) {
      // Only externalize packages listed in dependencies (runtime deps).
      // Everything else (@grest-ts/*, @newproject/*) gets bundled.
      build.onResolve({ filter: /^[^./]/ }, (args) => {
        const pkg = args.path.startsWith('@')
          ? args.path.split('/').slice(0, 2).join('/')
          : args.path.split('/')[0];
        if (runtimeDeps.includes(pkg)) {
          return { path: args.path, external: true };
        }
        return undefined;
      });
    },
  }],
});
