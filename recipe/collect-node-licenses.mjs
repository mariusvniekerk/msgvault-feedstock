import { existsSync, realpathSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const [nodeModulesArg, outputArg] = process.argv.slice(2);
if (!nodeModulesArg || !outputArg) {
  throw new Error('usage: node collect-node-licenses.mjs <node_modules> <output.json>');
}

const packages = new Map();

async function visitPackage(packagePath) {
  const manifestPath = join(packagePath, 'package.json');
  if (!existsSync(manifestPath)) return;

  const resolvedPath = realpathSync(packagePath);
  if (packages.has(resolvedPath)) return;

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const license = typeof manifest.license === 'string' ? manifest.license : undefined;
  if (!manifest.name || !manifest.version || !license) {
    throw new Error(`incomplete license metadata in ${manifestPath}`);
  }

  const author = typeof manifest.author === 'string' ? manifest.author : manifest.author?.name;
  packages.set(resolvedPath, {
    name: manifest.name,
    version: manifest.version,
    path: resolvedPath,
    license,
    ...(author ? { author } : {}),
    ...(manifest.homepage ? { homepage: manifest.homepage } : {}),
    ...(manifest.description ? { description: manifest.description } : {}),
  });

  const nestedNodeModules = join(resolvedPath, 'node_modules');
  if (existsSync(nestedNodeModules)) await visitNodeModules(nestedNodeModules);
}

async function visitNodeModules(nodeModulesPath) {
  for (const entry of await readdir(nodeModulesPath, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;

    const entryPath = join(nodeModulesPath, entry.name);
    if (entry.name.startsWith('@')) {
      for (const scopedEntry of await readdir(entryPath, { withFileTypes: true })) {
        if (scopedEntry.isDirectory() || scopedEntry.isSymbolicLink()) {
          await visitPackage(join(entryPath, scopedEntry.name));
        }
      }
    } else if (entry.isDirectory() || entry.isSymbolicLink()) {
      await visitPackage(entryPath);
    }
  }
}

await visitNodeModules(resolve(nodeModulesArg));

const dependencies = [...packages.values()].sort((left, right) =>
  `${left.name}@${left.version}:${left.path}`.localeCompare(`${right.name}@${right.version}:${right.path}`),
);
if (dependencies.length === 0) throw new Error(`no Node.js dependencies found under ${nodeModulesArg}`);

await writeFile(resolve(outputArg), `${JSON.stringify({ 'msgvault-web': dependencies }, null, 2)}\n`);
process.stdout.write(`collected license metadata for ${dependencies.length} Node.js packages\n`);
