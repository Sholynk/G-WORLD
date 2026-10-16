#!/usr/bin/env node
/**
 * G WORLD — build the frontend for Cloudflare Pages.
 *
 *   npm run build:web                 # from the repository root
 *   npm run build                     # from apps/web (same script)
 *   npm run build:web -- --strict     # placeholders fail the build too
 *
 * There is no bundler, and there is nothing to compile: `apps/web/public` is the
 * deployment artifact exactly as it is committed (Cloudflare uploads it, the
 * Pages Function in `apps/web/functions` is compiled by Cloudflare itself). So
 * this "build" is the gate that decides whether the artifact is worth uploading.
 * It is deliberately dependency-free — plain Node, no network, no `node_modules`
 * — because Cloudflare may install with dev dependencies omitted, and because a
 * build that cannot run is worse than no build at all.
 *
 * What it checks (in order, cheapest first):
 *
 *   1. `npm ci` would succeed here — the lock file is in sync with every
 *      `package.json`. This is the failure that stops Cloudflare before any
 *      build step runs, so it is checked first, and it is the only check that
 *      inspects anything outside `apps/web`.
 *   2. the files Pages needs exist: the output directory with an `index.html`,
 *      the hosting files (`_headers`, `_redirects`), the runtime config, and the
 *      `/api/*` Pages Function.
 *   3. every rule in `_redirects` points at a document that exists, every status
 *      code is one Pages accepts, and no `200` rewrite targets a `.html` file —
 *      Pages strips `.html` with a 308, so such a rule redirects forever
 *      (Cloudflare reports it as "Infinite loop detected ... and has been
 *      ignored" when it parses the file).
 *   4. no page links to a local file that is not in the deployment — a nav link
 *      to a page that was renamed is a 404 in production otherwise.
 *   5. the module graph parses (`node --check` on every ES module) and the web
 *      app manifest / sitemap only reference files that ship.
 *   6. the deployment is inside Pages' limits (20,000 files, 25 MiB per file).
 *
 * Exit code 0 = the artifact is deployable, 1 = fix the reported problem. Nothing
 * is written: the committed tree *is* the build output.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB_DIR = path.join(ROOT, 'apps/web');
const PUBLIC_DIR = path.join(WEB_DIR, 'public');
const MODULES_DIR = path.join(PUBLIC_DIR, 'assets/js');
const PAGES_FUNCTION = 'functions/api/[[path]].ts';

const STRICT = process.argv.includes('--strict') || process.env.CI_STRICT === '1';
const AS_JSON = process.argv.includes('--json');
const SKIP_LOCKFILE = process.argv.includes('--skip-lockfile');

/** Cloudflare Pages limits that a static deployment can realistically hit. */
const MAX_FILES = 20_000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

const REQUIRED = [
  'index.html',
  'config.js',
  '_headers',
  '_redirects',
  '404.html',
  'robots.txt',
  'sitemap.xml',
  'manifest.webmanifest',
  'favicon.svg',
];

const problems = [];
const warnings = [];
const notes = [];

const fail = (message, hint) => problems.push({ message, hint });
const warn = (message, hint) => warnings.push({ message, hint });

/* ------------------------------------------------------------------- helpers */

/** Every file under `directory`, recursively, as absolute paths. */
function walk(directory) {
  const files = [];
  if (!existsSync(directory)) return files;
  for (const entry of readdirSync(directory).sort()) {
    const absolute = path.join(directory, entry);
    if (statSync(absolute).isDirectory()) files.push(...walk(absolute));
    else files.push(absolute);
  }
  return files;
}

/** Path of a deployment file, relative to the output directory, with `/` separators. */
const served = (absolute) => path.relative(PUBLIC_DIR, absolute).split(path.sep).join('/');

/**
 * Resolves a root-relative or document-relative reference the way Pages would:
 * exact file, then `.html`, then `index.html` inside the directory. Returns the
 * absolute path that exists, or null.
 */
function resolveReference(reference, fromDirectory) {
  const clean = reference.split('#')[0].split('?')[0];
  if (!clean) return null;

  const base = clean.startsWith('/') ? PUBLIC_DIR : fromDirectory;
  const candidate = path.resolve(base, clean.startsWith('/') ? clean.slice(1) : clean);

  // A reference that climbs out of the output directory could never be served.
  if (candidate !== PUBLIC_DIR && !candidate.startsWith(PUBLIC_DIR + path.sep)) return null;

  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  if (existsSync(`${candidate}.html`)) return `${candidate}.html`;
  if (existsSync(candidate) && statSync(candidate).isDirectory()) {
    const index = path.join(candidate, 'index.html');
    if (existsSync(index)) return index;
  }
  return null;
}

/** `true` when a reference is not this deployment's business (external, mail, #anchor). */
function isExternal(reference) {
  return (
    reference === '' ||
    reference.startsWith('#') ||
    reference.startsWith('//') ||
    /^[a-z][a-z0-9+.-]*:/i.test(reference) === true
  );
}

const red = (text) => `\u001b[31m✘\u001b[0m ${text}`;
const green = (text) => `\u001b[32m✓\u001b[0m ${text}`;
const yellow = (text) => `\u001b[33m▲\u001b[0m ${text}`;
const dim = (text) => `\u001b[90m${text}\u001b[0m`;

/* ------------------------------------------- 1. the install Cloudflare runs first */

if (SKIP_LOCKFILE) {
  notes.push('lockfile check skipped (--skip-lockfile)');
} else {
  const check = spawnSync(process.execPath, [path.join(ROOT, 'scripts/check-lockfile.mjs'), '--quiet'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (check.status === 0) {
    notes.push((check.stdout ?? '').trim().split('\n').pop() ?? 'lockfile: in sync');
  } else {
    for (const line of `${check.stdout ?? ''}${check.stderr ?? ''}`.trim().split('\n')) console.log(line);
    fail(
      'package-lock.json is not in sync with package.json, so `npm ci` would fail before the build starts',
      'Run `npm install` at the repository root and commit package-lock.json.',
    );
  }
}

/* ------------------------------------------------------ 2. the deployment artifact */

for (const relative of REQUIRED) {
  if (!existsSync(path.join(PUBLIC_DIR, relative))) {
    fail(`apps/web/public/${relative} is missing`, 'Pages serves this file directly; it must be committed.');
  }
}

if (existsSync(path.join(WEB_DIR, PAGES_FUNCTION))) {
  notes.push(`Pages Function present: apps/web/${PAGES_FUNCTION}`);
} else {
  fail(
    `apps/web/${PAGES_FUNCTION} is missing`,
    'Without it the Pages project does not proxy /api/*, and the frontend has no API.',
  );
}

const wranglerToml = path.join(WEB_DIR, 'wrangler.toml');
if (existsSync(wranglerToml)) {
  const config = readFileSync(wranglerToml, 'utf8');
  const outputDir = /pages_build_output_dir\s*=\s*"([^"]+)"/.exec(config)?.[1];
  if (outputDir !== 'public') {
    fail(
      `apps/web/wrangler.toml declares pages_build_output_dir = "${outputDir ?? ''}" but this build produces "public"`,
      'Cloudflare reads that value, so the upload would come from the wrong directory.',
    );
  }
  const origin = /API_ORIGIN\s*=\s*"([^"]*)"/.exec(config)?.[1] ?? '';
  const bound = /\[\[services\]\]/.test(config);
  if (origin.includes('<your-subdomain>') && !bound) {
    const message =
      'API_ORIGIN is still the placeholder in apps/web/wrangler.toml and no `[[services]]` binding is configured';
    const hint = 'The site deploys fine, but /api/* answers 502 until it points at the deployed worker. See docs/06-deployment.md.';
    if (STRICT) fail(message, hint);
    else warn(message, hint);
  }
} else {
  fail('apps/web/wrangler.toml is missing', 'Cloudflare Pages reads the project name and output directory from it.');
}

/* ------------------------------------------------------------ 3. routing rules */

const VALID_STATUS = new Set([200, 301, 302, 303, 307, 308, 404, 410]);
const redirectsPath = path.join(PUBLIC_DIR, '_redirects');
let ruleCount = 0;
let parameterised = 0;

if (existsSync(redirectsPath)) {
  const lines = readFileSync(redirectsPath, 'utf8').split('\n');
  lines.forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    ruleCount += 1;
    const [source, destination, status, ...rest] = line.split(/\s+/);
    const where = `_redirects:${index + 1}`;

    if (!source || !destination || rest.length) {
      fail(`${where} is not a valid rule: ${line}`, 'A rule is `<source> <destination> [status]`.');
      return;
    }
    if (status !== undefined && !VALID_STATUS.has(Number(status))) {
      fail(`${where} uses status ${status}, which Pages does not accept`, `Use one of: ${[...VALID_STATUS].join(', ')}.`);
      return;
    }
    // `200` is a transparent rewrite, but Pages redirects any request for a
    // `.html` file to its extensionless URL first — so a rewrite that *lands* on
    // a `.html` file returns the visitor to the URL they asked for, forever.
    // Pages already serves /browse from browse.html without any rule.
    if (Number(status ?? 302) === 200 && /\.html?$/i.test(destination.split('?')[0])) {
      fail(
        `${where} rewrites ${source} to ${destination}, which Pages immediately redirects back to ${source} — an infinite redirect loop`,
        'Delete the rule: Pages serves the clean URL from the .html file by itself (docs/06-deployment.md).',
      );
      return;
    }
    if (isExternal(destination)) return; // a proxy or rewrite to another origin

    // Placeholders (`:code`, `:splat`) cannot be resolved statically; the rule is
    // still checked for shape, then skipped with a note.
    if (destination.includes(':')) {
      parameterised += 1; // e.g. /verify.html?code=:code — nothing static to resolve
      return;
    }
    if (!resolveReference(destination, PUBLIC_DIR)) {
      fail(
        `${where} sends traffic to ${destination}, which is not in the deployment`,
        'A typo here turns a clean URL into a 404.',
      );
    }
  });
  notes.push(
    `_redirects: ${ruleCount} rule(s), ${ruleCount - parameterised} destination(s) checked on disk${
      parameterised ? `, ${parameterised} parameterised (e.g. \`/verify/:code\`)` : ''
    }`,
  );
}

/* --------------------------------------------------------------- 4. page links */

const htmlFiles = walk(PUBLIC_DIR).filter((file) => file.endsWith('.html'));
const attributePattern = /\b(?:href|src|poster)=("([^"]*)"|'([^']*)')/gi;
const brokenLinks = new Map(); // deployment file → the references it breaks on
let linkCount = 0;

for (const file of htmlFiles) {
  const html = readFileSync(file, 'utf8');
  for (const match of html.matchAll(attributePattern)) {
    const reference = (match[2] ?? match[3] ?? '').trim();
    if (isExternal(reference)) continue;
    linkCount += 1;
    if (resolveReference(reference, path.dirname(file))) continue;
    const list = brokenLinks.get(served(file)) ?? [];
    if (!list.includes(reference)) list.push(reference);
    brokenLinks.set(served(file), list);
  }
}

for (const [file, references] of brokenLinks) {
  fail(`${file} links to ${references.length} missing local file(s): ${references.join(', ')}`);
}
notes.push(`links: ${linkCount} local reference(s) across ${htmlFiles.length} HTML document(s)`);

/* ------------------------------------------------------- 5. modules, manifest, sitemap */

const modules = walk(MODULES_DIR).filter((file) => file.endsWith('.js'));
const brokenModules = [];
for (const file of modules) {
  const parsed = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (parsed.status !== 0) {
    brokenModules.push(`${served(file)}: ${(parsed.stderr ?? '').split('\n').find((line) => line.includes('SyntaxError')) ?? 'does not parse'}`);
  }
}
for (const entry of brokenModules) fail(`${entry}`, 'The browser would only report this on the page that loads it.');
notes.push(`modules: ${modules.length} ES module(s) parsed`);

const manifestPath = path.join(PUBLIC_DIR, 'manifest.webmanifest');
if (existsSync(manifestPath)) {
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const referenced = [
      manifest.start_url,
      ...(manifest.icons ?? []).map((icon) => icon?.src),
      ...(manifest.shortcuts ?? []).map((shortcut) => shortcut?.url),
    ].filter((value) => typeof value === 'string' && !isExternal(value));
    for (const reference of referenced) {
      if (!resolveReference(reference, PUBLIC_DIR)) fail(`manifest.webmanifest references ${reference}, which is not in the deployment`);
    }
  } catch (error) {
    fail(`manifest.webmanifest is not valid JSON (${String(error.message).split('\n')[0]})`, 'The browser ignores a manifest it cannot parse.');
  }
}

const sitemapPath = path.join(PUBLIC_DIR, 'sitemap.xml');
if (existsSync(sitemapPath)) {
  const sitemap = readFileSync(sitemapPath, 'utf8');
  const locations = [...sitemap.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((match) => match[1]);
  const origins = new Set(locations.map((location) => new URL(location).origin));
  for (const location of locations) {
    const { pathname } = new URL(location);
    if (!resolveReference(pathname, PUBLIC_DIR)) fail(`sitemap.xml lists ${pathname}, which is not in the deployment`);
  }
  if (locations.length) notes.push(`sitemap: ${locations.length} URL(s) · origin ${[...origins].join(', ')}`);
}

/* ------------------------------------------------------- 6. Pages deployment limits */

const files = walk(PUBLIC_DIR);
const bytes = files.reduce((total, file) => total + statSync(file).size, 0);
const oversized = files.filter((file) => statSync(file).size > MAX_FILE_BYTES).map(served);
if (files.length > MAX_FILES) fail(`the deployment holds ${files.length} files; Pages allows ${MAX_FILES} per deployment`);
if (oversized.length) fail(`${oversized.length} file(s) exceed 25 MiB, which Pages rejects: ${oversized.slice(0, 5).join(', ')}`);

/* -------------------------------------------------------------------- report */

const ok = problems.length === 0;
const megabytes = (bytes / (1024 * 1024)).toFixed(2);
const fromWebDir = path.resolve(process.cwd()) === WEB_DIR;

if (AS_JSON) {
  console.log(JSON.stringify({ ok, problems, warnings, notes, files: files.length, bytes }, null, 2));
} else {
  for (const line of notes) console.log(`\u001b[90m·\u001b[0m ${line}`);
  for (const { message, hint } of warnings) {
    console.log(yellow(message));
    if (hint) console.log(dim(`  ${hint}`));
  }
  for (const { message, hint } of problems) {
    console.log(red(message));
    if (hint) console.log(dim(`  ${hint}`));
  }

  if (ok) {
    console.log(
      `\n${green(`frontend build ok — ${files.length} file(s), ${megabytes} MiB ready in apps/web/public`)}`,
    );
    console.log(dim('  Cloudflare Pages settings for this checkout:'));
    if (fromWebDir) {
      console.log(dim('    Root directory          apps/web'));
      console.log(dim('    Build command           npm run build'));
      console.log(dim('    Build output directory  public'));
    } else {
      console.log(dim('    Root directory          (repository root)'));
      console.log(dim('    Build command           npm run build:web'));
      console.log(dim('    Build output directory  apps/web/public'));
      console.log(dim('    ▲ With the repository root as the build root, Cloudflare looks for `functions/`'));
      console.log(dim('      there and does not find apps/web/functions, so /api/* is not proxied. Prefer'));
      console.log(dim('      the `apps/web` root directory (docs/06-deployment.md).'));
    }
  } else {
    console.log(`\n${red(`frontend build failed — ${problems.length} problem(s)`)}`);
  }
}

process.exit(ok ? 0 : 1);
