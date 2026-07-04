// The action's bundler. Produces a single committed CommonJS file plus an
// aggregated third-party license notice.
//
// We use esbuild rather than ncc. ncc's `import.meta.url` handling mis-rewrites
// @azure/storage-common's crc64 module (a transitive of @actions/artifact) and
// throws on load. esbuild inlines and transpiles every dependency into one
// self-contained file, so although the @actions/* packages are ESM-only, the
// bundle never require()s them at runtime; they are baked in.
//
// The output is CommonJS by deliberate choice for this dependency graph. An ESM
// bundle breaks two ways here: @azure/storage-common's crc64 shim declares
// top-level `require`/`__filename`/`__dirname`, which collide with any ambient
// the bundle must add; and `tunnel` (via @actions/http-client) does a dynamic
// `require('net')` that an ESM bundle cannot resolve. esbuild's CommonJS output
// function-wraps each module and has native CJS ambients, so both dependencies
// work unmodified. The one shim needed is `import.meta.url` for the crc64
// module, provided by the banner below.

import { build } from 'esbuild';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The nearest ancestor directory of `filePath` that contains a package.json. */
function packageRootOf(filePath) {
  let dir = dirname(filePath);
  while (dir !== dirname(dir)) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    dir = dirname(dir);
  }
  return null;
}

/** Collect the unique third-party packages bundled into the output. */
function collectPackages(metafile) {
  const roots = new Set();
  for (const input of Object.keys(metafile.inputs)) {
    if (!input.includes('node_modules/')) continue;
    const root = packageRootOf(join(PACKAGE_ROOT, input));
    if (root !== null) roots.add(root);
  }
  const packages = [];
  for (const root of roots) {
    let pkg;
    try {
      pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    if (!pkg.name || pkg.name.startsWith('@cardanowall/')) continue;
    const licenseFile = readdirSync(root).find((name) => /^(LICEN[SC]E|COPYING)/i.test(name));
    const licenseText = licenseFile ? readFileSync(join(root, licenseFile), 'utf8').trim() : null;
    packages.push({
      name: pkg.name,
      version: pkg.version ?? '',
      license: typeof pkg.license === 'string' ? pkg.license : 'see below',
      licenseText,
    });
  }
  packages.sort((a, b) => a.name.localeCompare(b.name));
  return packages;
}

function renderLicenses(packages) {
  const header = [
    'Third-party licenses bundled into dist/index.js',
    '',
    'This file aggregates the license notices of the npm packages inlined by the',
    'build. Each section names a package and reproduces its license text.',
    '',
    '='.repeat(72),
    '',
  ];
  const sections = packages.map((pkg) => {
    const title = `${pkg.name}@${pkg.version}, ${pkg.license}`;
    const body = pkg.licenseText ?? '(no license file was shipped with this package)';
    return `${title}\n\n${body}\n\n${'='.repeat(72)}\n`;
  });
  return `${header.join('\n')}${sections.join('\n')}`;
}

/** Build the bundle and licenses file into `outDir`. */
export async function runBuild(outDir) {
  const result = await build({
    absWorkingDir: PACKAGE_ROOT,
    entryPoints: ['src/main.ts'],
    outfile: join(outDir, 'index.js'),
    bundle: true,
    platform: 'node',
    target: 'node24',
    format: 'cjs',
    metafile: true,
    legalComments: 'none',
    // Give the CJS output a real `import.meta.url` so dependencies that call
    // createRequire(import.meta.url) / fileURLToPath(import.meta.url) (the crc64
    // shim) resolve against the bundle file.
    banner: { js: "const import_meta_url = require('url').pathToFileURL(__filename).href;" },
    define: { 'import.meta.url': 'import_meta_url' },
  });
  writeFileSync(join(outDir, 'licenses.txt'), renderLicenses(collectPackages(result.metafile)));
}
