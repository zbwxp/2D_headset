import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// This deliberately copies a small allowlist, never the author's full workspace.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const marker = '.contour-sites-checkout';
if (existsSync(join(root, marker))) throw new Error('Run site:prepare in the main Contour checkout, not its publication copy.');
const manifest = JSON.parse(readFileSync(join(root, '.openai/hosting.json'), 'utf8'));
if (!manifest.project_id || manifest.static?.directory !== 'dist') throw new Error('Expected a registered static Sites project.');
const destination = join(root, '.sites/contour');
for (const path of [join(root, '.sites'), destination]) {
  if (existsSync(path) && (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory())) throw new Error(`Unsafe publication directory: ${path}`);
}
if (existsSync(destination) && !existsSync(join(destination, marker))) throw new Error('Publication directory is not a managed Contour copy; preserve its contents and inspect it first.');
const targetManifest = join(destination, '.openai/hosting.json');
if (existsSync(targetManifest) && JSON.parse(readFileSync(targetManifest, 'utf8')).project_id !== manifest.project_id) throw new Error('Publication copy belongs to a different Site.');
mkdirSync(destination, { recursive: true });
for (const directory of ['src', 'public', 'scripts', 'tests/helpers', 'tests/fixtures']) {
  rmSync(join(destination, directory), { recursive: true, force: true });
  mkdirSync(dirname(join(destination, directory)), { recursive: true });
  cpSync(join(root, directory), join(destination, directory), { recursive: true });
}
for (const file of ['package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'playwright.config.ts', 'index.html', '.gitignore']) cpSync(join(root, file), join(destination, file));
mkdirSync(join(destination, 'docs'), { recursive: true });
for (const file of ['sites-release.md', 'ai-drawing-room-guide.md', 'v0130-snapshot-recording.md', 'v0140-hairstyle-room.md']) cpSync(join(root, 'docs', file), join(destination, 'docs', file));
// These existing regression fixtures are source-only, never placed in public/dist.
for (const file of ['docs/assets/front-face-v1/基础脸模·正面·v1.json', 'artifacts/recording-performance/fixture.json']) {
  mkdirSync(dirname(join(destination, file)), { recursive: true });
  cpSync(join(root, file), join(destination, file));
}
mkdirSync(dirname(targetManifest), { recursive: true });
writeFileSync(targetManifest, JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(join(destination, marker), 'Managed publication copy; edit the main Contour checkout.\n');
writeFileSync(join(destination, 'README.md'), '# Contour web release\n\nManaged publication copy of the Contour browser editor.\n\nRun `npm ci`, `npm run test:release`, then `npm run build`.\n\nSee [release workflow](docs/sites-release.md). Help for visitors is in `public/help.html`. The approved starter project in src/assets is published; other personal projects are not included.\n');
console.log(`Prepared ${destination}\nSite: ${manifest.project_id}\nNo deployment performed. Use the Sites workflow to build, version and publish.`);
