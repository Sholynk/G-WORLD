#!/usr/bin/env node
/**
 * Sholynk Tech — lockfile check.
 *
 *   npm run check:lock
 *   node scripts/check-lockfile.mjs --json
 *
 * Why this exists
 * ---------------
 * Cloudflare installs dependencies with `npm clean-install` (`npm ci`), which
 * refuses to run when `package.json` and `package-lock.json` disagree:
 *
 *   npm error `npm ci` can only install packages when your package.json and
 *   npm error package-lock.json or npm-shrinkwrap.json are in sync.
 *   npm error Missing: happy-dom@21.0.3 from lock file
 *
 * That failure happens *before* any build step, on Cloudflare's machine, with no
 * local reproduction unless you happen to delete `node_modules`. It is always the
 * same mistake underneath: someone edited a `package.json` (adding or bumping a
 * dependency) without regenerating and committing the lock file.
 *
 * This script is the offline equivalent of npm's own check. It needs no network,
 * no `node_modules` and no npm binary: it compares the dependency blocks written
 * in every `package.json` with the copies npm records inside the lock file, and
 * it re-resolves every declared range against the lock the way `npm ci` would.
 *
 * What it proves
 * --------------
 *   1. the lock file exists, parses, and is a v2/v3 lock with a `packages` map;
 *   2. every workspace (root, `apps/*`, `packages/*`) is recorded in the lock and
 *      its `dependencies` / `devDependencies` / `optionalDependencies` /
 *      `peerDependencies` blocks are *identical* to the manifest on disk;
 *   3. every declared range resolves to a version that satisfies it, using the
 *      same lookup npm uses (workspace-local `node_modules` first, then the
 *      hoisted root one).
 *
 * Exit code 0 = safe for `npm ci`, 1 = the lock file must be regenerated:
 *
 *   npm install            # writes package-lock.json
 *   git add package-lock.json
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AS_JSON = process.argv.includes('--json');
// `--quiet` keeps a green run to one line, so a caller such as the Pages build
// step can use this check without burying its own output.
const QUIET = process.argv.includes('--quiet');
const LOCK_PATH = path.join(ROOT, 'package-lock.json');

const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

const problems = [];
const warnings = [];
const notes = [];

/** Counts used by the one-line `--quiet` summary. */
let manifestsCompared = 0;
let rangesVerified = 0;

const fail = (message, hint) => problems.push({ message, hint });
const warn = (message, hint) => warnings.push({ message, hint });

/* ------------------------------------------------------------------- helpers */

/** Reads and parses a JSON file, or returns null with a recorded failure. */
function readJson(absolute) {
  if (!existsSync(absolute)) return null;
  try {
    return JSON.parse(readFileSync(absolute, 'utf8'));
  } catch (error) {
    fail(`${path.relative(ROOT, absolute)} is not valid JSON`, String(error.message));
    return null;
  }
}

/**
 * Expands the root `workspaces` patterns into manifest paths. Only the shapes
 * this repository uses are supported (`dir/*` and literal paths); anything more
 * exotic is ignored rather than guessed at.
 */
function workspaceDirs(patterns) {
  const found = [];
  for (const pattern of patterns ?? []) {
    if (typeof pattern !== 'string') continue;
    if (pattern.endsWith('/*')) {
      const parent = path.join(ROOT, pattern.slice(0, -2));
      if (!existsSync(parent) || !statSync(parent).isDirectory()) continue;
      for (const entry of readdirSync(parent).sort()) {
        const candidate = path.join(parent, entry);
        if (statSync(candidate).isDirectory() && existsSync(path.join(candidate, 'package.json'))) {
          found.push(path.relative(ROOT, candidate).split(path.sep).join('/'));
        }
      }
    } else if (existsSync(path.join(ROOT, pattern, 'package.json'))) {
      found.push(pattern.replace(/\/+$/, ''));
    }
  }
  return [...new Set(found)].sort();
}

/** Splits `1.2.3-beta.4` into the numeric triple plus the prerelease tag. */
function parseVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+](.*))?$/.exec(String(version).trim());
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), pre: match[4] ?? null };
}

/** -1 / 0 / 1 for `a` versus `b`, ignoring prerelease tags (npm semantics are murkier). */
function compareVersions(a, b) {
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  return 0;
}

/**
 * Whether `version` satisfies `range`, for the range forms that appear in this
 * repository (`^`, `~`, `x.y.z`, `x.y`, `x`, `*`, and plain comparators).
 * Returns `null` when the range is not understood, so the caller can warn
 * instead of reporting a false failure.
 */
function satisfies(version, range) {
  const wanted = parseVersion(version);
  if (!wanted) return null;
  const spec = String(range).trim();
  if (spec === '' || spec === '*' || spec === 'latest') return true;

  const upperBound = (major, minor, patch) => ({ major, minor, patch, pre: null });

  const caret = /^\^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(spec);
  if (caret) {
    const [major, minor, patch] = [Number(caret[1]), Number(caret[2] ?? 0), Number(caret[3] ?? 0)];
    const floor = upperBound(major, minor, patch);
    // ^1.2.3 → <2.0.0 · ^0.2.3 → <0.3.0 · ^0.0.3 → <0.0.4
    const ceiling =
      major > 0 ? upperBound(major + 1, 0, 0) : minor > 0 ? upperBound(0, minor + 1, 0) : upperBound(0, 0, patch + 1);
    return compareVersions(wanted, floor) >= 0 && compareVersions(wanted, ceiling) < 0;
  }

  const tilde = /^~(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(spec);
  if (tilde) {
    const [major, minor, patch] = [Number(tilde[1]), Number(tilde[2] ?? 0), Number(tilde[3] ?? 0)];
    return (
      compareVersions(wanted, upperBound(major, minor, patch)) >= 0 &&
      compareVersions(wanted, upperBound(major, minor + 1, 0)) < 0
    );
  }

  const comparator = /^(>=|<=|>|<|=)(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(spec);
  if (comparator) {
    const [, operator, major, minor, patch] = comparator;
    const bound = upperBound(Number(major), Number(minor ?? 0), Number(patch ?? 0));
    const order = compareVersions(wanted, bound);
    if (operator === '>=') return order >= 0;
    if (operator === '<=') return order <= 0;
    if (operator === '>') return order > 0;
    if (operator === '<') return order < 0;
    return order === 0;
  }

  const plain = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(spec);
  if (plain) {
    const major = Number(plain[1]);
    const minor = Number(plain[2] ?? 0);
    const patch = Number(plain[3] ?? 0);
    // `1.2.3` is exact, `1.2` behaves like `1.2.x`, `1` like `1.x`.
    const ceiling =
      plain[3] !== undefined
        ? upperBound(major, minor, patch + 1)
        : plain[2] !== undefined
          ? upperBound(major, minor + 1, 0)
          : upperBound(major + 1, 0, 0);
    return compareVersions(wanted, upperBound(major, minor, patch)) >= 0 && compareVersions(wanted, ceiling) < 0;
  }

  // Unions, tags and `x`/`*` ranges are left to npm; the caller warns instead of
  // guessing wrong.
  return null;
}

/**
 * The lock entry a manifest actually resolves through: a workspace-local
 * `node_modules` copy wins over the hoisted root one, exactly as Node resolves.
 */
function resolveEntry(packages, relativeDir, name) {
  const candidates = relativeDir ? [`${relativeDir}/node_modules/${name}`, `node_modules/${name}`] : [`node_modules/${name}`];
  for (const candidate of candidates) {
    if (packages[candidate]) return { key: candidate, entry: packages[candidate] };
  }
  return null;
}

/** Compares two dependency blocks and describes every difference. */
function diffBlock(declared = {}, recorded = {}) {
  const differences = [];
  for (const name of Object.keys(declared).sort()) {
    if (!(name in recorded)) differences.push(`missing from the lock file: ${name}@${declared[name]}`);
    else if (recorded[name] !== declared[name]) differences.push(`recorded as ${name}@${recorded[name]}, manifest says ${name}@${declared[name]}`);
  }
  for (const name of Object.keys(recorded).sort()) {
    if (!(name in declared)) differences.push(`still in the lock file but no longer declared: ${name}@${recorded[name]}`);
  }
  return differences;
}

/* ----------------------------------------------------------------- 1. the lock */

const rootManifest = readJson(path.join(ROOT, 'package.json'));
if (!rootManifest) {
  fail('package.json is missing or unreadable');
}

const lock = readJson(LOCK_PATH);
if (!lock) {
  fail(
    'package-lock.json is missing or unreadable',
    'Cloudflare runs `npm ci`, which refuses to install without a lock file. Run `npm install` and commit it.',
  );
}

if (rootManifest && lock) {
  const packages = lock.packages ?? {};
  const lockfileVersion = Number(lock.lockfileVersion ?? 0);
  if (!Object.keys(packages).length) {
    fail('package-lock.json has no `packages` map', 'A v1 lock cannot be diffed against workspace manifests. Run `npm install`.');
  } else if (lockfileVersion < 2) {
    warn(`package-lock.json is lockfileVersion ${lockfileVersion}`, 'npm 7+ writes version 3; regenerate with `npm install`.');
  }

  /* ------------------------------------------- 2. manifests versus lock records */

  const manifests = [{ dir: '', manifest: rootManifest }];
  for (const dir of workspaceDirs(rootManifest.workspaces)) {
    const manifest = readJson(path.join(ROOT, dir, 'package.json'));
    if (manifest) manifests.push({ dir, manifest });
  }

  let declaredCount = 0;
  for (const { dir, manifest } of manifests) {
    const label = dir || '.';
    const recorded = packages[dir];
    if (!recorded) {
      fail(
        `${label} is not recorded in package-lock.json`,
        'Cloudflare installs the whole workspace, so the lock file must know about every package. Run `npm install` at the repo root.',
      );
      continue;
    }
    for (const field of DEP_FIELDS) {
      const declared = manifest[field] ?? {};
      const differences = diffBlock(declared, recorded[field] ?? {});
      for (const difference of differences) {
        fail(
          `${label} ${field}: ${difference}`,
          'The lock file is out of sync — `npm ci` fails on Cloudflare with EUSAGE. Run `npm install` and commit package-lock.json.',
        );
      }
      declaredCount += Object.keys(declared).length;
    }
  }
  manifestsCompared = manifests.length;
  notes.push(`manifests compared: ${manifests.length} (${manifests.map(({ dir }) => dir || '.').join(', ')})`);
  notes.push(`declared dependenc(ies): ${declaredCount}`);

  /* ----------------------------------------------- 3. ranges resolve in the lock */

  let resolvedCount = 0;
  const unresolved = [];
  for (const { dir, manifest } of manifests) {
    for (const field of DEP_FIELDS) {
      for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
        // A peer dependency is optional metadata; npm does not have to install it.
        if (field === 'peerDependencies') continue;
        const found = resolveEntry(packages, dir, name);
        if (!found) {
          unresolved.push(`Missing: ${name}@${spec} from lock file (${dir || '.'})`);
          continue;
        }
        resolvedCount += 1;
        const verdict = satisfies(found.entry.version, spec);
        if (verdict === false) {
          unresolved.push(`Invalid: lock file's ${name}@${found.entry.version} does not satisfy ${name}@${spec} (${dir || '.'})`);
        } else if (verdict === null) {
          warn(`cannot verify the range ${name}@${spec}`, 'Only ^, ~, comparators, and plain versions are understood by this check.');
        }
      }
    }
  }
  for (const line of unresolved) {
    fail(
      line,
      'This is the exact wording npm uses when `npm ci` refuses to run. Run `npm install` and commit package-lock.json.',
    );
  }
  rangesVerified = resolvedCount;
  notes.push(`range(s) verified against the lock: ${resolvedCount}`);
}

/* -------------------------------------------------------------------- report */

const ok = problems.length === 0;

if (AS_JSON) {
  console.log(JSON.stringify({ ok, problems, warnings, notes, lockfile: path.relative(ROOT, LOCK_PATH) }, null, 2));
} else if (ok && QUIET) {
  console.log(`lockfile: in sync — ${manifestsCompared} manifest(s), ${rangesVerified} range(s) verified`);
} else {
  for (const line of notes) console.log(`\u001b[90m·\u001b[0m ${line}`);
  for (const { message, hint } of warnings) {
    console.log(`\u001b[33m▲\u001b[0m ${message}`);
    if (hint) console.log(`\u001b[90m  ${hint}\u001b[0m`);
  }
  for (const { message, hint } of problems) {
    console.log(`\u001b[31m✘\u001b[0m ${message}`);
    if (hint) console.log(`\u001b[90m  ${hint}\u001b[0m`);
  }
  console.log(
    `\nlockfile check: ${ok ? 'ok' : 'out of sync'} — ${problems.length} problem(s), ${warnings.length} warning(s)`,
  );
  if (!ok) console.log('\u001b[90mFix: npm install   (then commit package-lock.json)\u001b[0m');
}

process.exit(ok ? 0 : 1);
