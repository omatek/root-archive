import { execFileSync } from 'node:child_process';
import { validateProposal, submissionIdPattern } from './moderation-policy.mjs';

export function git(repo, args, input, extraEnv = {}) {
  return execFileSync('git', ['-C', repo, ...args], {input, encoding: 'utf8', stdio: 'pipe',
    maxBuffer: 8 * 1024 * 1024, env: {...process.env, ...extraEnv}}).trimEnd();
}
export const sha = value => {
  if (!/^[a-f0-9]{40}$/.test(value)) throw new Error('Expected exact Git SHA');
  return value;
};
export function readJson(repo, ref, path) {
  sha(ref);
  return JSON.parse(git(repo, ['show', `${ref}:${path}`]));
}
export function changesBetween(repo, base, head) {
  const raw = git(repo, ['diff-tree', '--no-commit-id', '--raw', '-r', '-z', '--no-renames', base, head]);
  if (!raw) return [];
  const fields = raw.split('\0');
  const changes = [];
  for (let i = 0; i < fields.length - 1; i += 2) {
    const [, , mode, , , status] = fields[i].split(/[ :]/);
    changes.push({path: fields[i + 1], mode, status});
  }
  return changes;
}
export function inspectSubmission(repo, base, head, config) {
  sha(base); sha(head);
  const changes = changesBetween(repo, base, head);
  const records = changes.filter(c => /^submissions\/[0-9a-f-]{36}\.json$/.test(c.path));
  if (records.length !== 1) throw new Error('Expected one v1 receipt; legacy PRs must be closed and resubmitted');
  const record = readJson(repo, head, records[0].path);
  const courses = readJson(repo, base, 'site/courses.json');
  const catalog = readJson(repo, base, 'site/resources.json');
  const proposed = readJson(repo, head, 'site/resources.json');
  const resource = validateProposal({courses, base: catalog, proposed, record, changes, assetBase: config.asset_base_url});
  if (!submissionIdPattern.test(resource.id)) throw new Error('Invalid submission ID');
  return {record, resource};
}
