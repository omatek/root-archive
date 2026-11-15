import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildPolicies, policyArtifacts, POLICIES} from './build-policies.mjs';
import {CONTRIBUTOR_AUTHORIZATION} from '../site/js/contributor-authorization.mjs';

test('six public policies and the accepted declaration snapshot match the reconciled Markdown',async () => {
  await buildPolicies({check:true});
  const artifacts=await policyArtifacts();
  assert.equal(artifacts.size,7);
  assert.equal([...artifacts.keys()].filter(path=>path.startsWith('site/policies/')).length,6);
  for (const [path,html] of artifacts) {
    if (!path.endsWith('.html')) continue;
    assert.ok(!html.includes('implementation-checklist'));
    assert.ok(!/href="root-archive-.*\.md/.test(html));
    for (const match of html.matchAll(/href="(?:\/policies\/)?([a-z-]+)\.html"/g)) {
      assert.ok(POLICIES.some(([slug])=>slug===match[1]),match[0]);
    }
  }
  const declaration=await readFile(new URL('../docs/legal/root-archive-contributor-declaration.md',import.meta.url),'utf8');
  assert.ok(declaration.includes(CONTRIBUTOR_AUTHORIZATION.version));
  assert.ok(CONTRIBUTOR_AUTHORIZATION.text.includes('Omar Khaldoon Jaber Tahrawi'));
  assert.ok(CONTRIBUTOR_AUTHORIZATION.text.includes('Changes beyond that scope require appropriate permission'));
  assert.equal(CONTRIBUTOR_AUTHORIZATION.language,'en');
  assert.ok(!CONTRIBUTOR_AUTHORIZATION.text.includes('BLOCKED FOR LIVE USE'));
});
