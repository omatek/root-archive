// Run from a trusted main checkout, with the submission checkout as --repo.
// Produces a merge commit without changing the working tree or moving a ref.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { git, sha, readJson, inspectSubmission } from './submission-git.mjs';
import { validateRecord } from './moderation-policy.mjs';

export function reconcile(repo, base, head, config) {
  sha(base); sha(head);
  const ancestor = sha(git(repo, ['merge-base', base, head]));
  const {record, resource} = inspectSubmission(repo, ancestor, head, config);
  const courses = readJson(repo, base, 'site/courses.json');
  const catalog = readJson(repo, base, 'site/resources.json');
  validateRecord(record, courses, config.asset_base_url);
  if (catalog.some(r => r.id === resource.id || r.asset_url === resource.asset_url)) throw new Error('Resource already published');
  try {
    git(repo, ['cat-file', '-e', `${base}:submissions/${resource.id}.json`]);
    throw new Error('Receipt already exists');
  } catch (error) { if (error.status !== 128) throw error; }
  const dir = mkdtempSync(join(tmpdir(), 'archive-reconcile-'));
  const env = {GIT_INDEX_FILE: join(dir, 'index')};
  try {
    git(repo, ['read-tree', base], undefined, env);
    for (const [path, value] of [['site/resources.json', [...catalog, resource]], [`submissions/${resource.id}.json`, record]]) {
      const blob = sha(git(repo, ['hash-object', '-w', '--stdin'], JSON.stringify(value, null, 2) + '\n'));
      git(repo, ['update-index', '--add', '--cacheinfo', `100644,${blob},${path}`], undefined, env);
    }
    const tree = sha(git(repo, ['write-tree'], undefined, env));
    return sha(git(repo, ['commit-tree', tree, '-p', head, '-p', base], 'Reconcile submission with current main\n'));
  } finally { rmSync(dir, {recursive: true, force: true}); }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--repo') throw new Error('Usage: node trusted/scripts/reconcile-submission.mjs --repo /submission/checkout');
  const repo = args[1];
  const base = sha(git(repo, ['rev-parse', 'origin/main']));
  const head = sha(git(repo, ['rev-parse', 'HEAD']));
  // Configuration comes from this trusted checkout, never from the submission.
  const config = readJson(fileURLToPath(new URL('..', import.meta.url)), sha(git(fileURLToPath(new URL('..', import.meta.url)), ['rev-parse', 'HEAD'])), 'moderation.config.json');
  console.log(reconcile(repo, base, head, config));
}
