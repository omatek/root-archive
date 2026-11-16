import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {buildPolicies, policyArtifacts, POLICIES} from './build-policies.mjs';
import {CONTRIBUTOR_AUTHORIZATION} from '../site/js/contributor-authorization.mjs';
import {CONTRIBUTOR_PRIVACY_CONSENT} from '../site/js/contributor-privacy-consent.mjs';

test('six public policies and the accepted declaration snapshot match the reconciled Markdown',async () => {
  await buildPolicies({check:true});
  const artifacts=await policyArtifacts();
  assert.equal(artifacts.size,8);
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
  const notice=await readFile(new URL('../docs/legal/root-archive-privacy-notice.md',import.meta.url),'utf8');
  assert.ok(notice.includes(`**Consent version** ${CONTRIBUTOR_PRIVACY_CONSENT.version}\n\n${CONTRIBUTOR_PRIVACY_CONSENT.text}`));
  assert.ok(!CONTRIBUTOR_AUTHORIZATION.text.includes(CONTRIBUTOR_PRIVACY_CONSENT.text));
});


test('concise privacy consent retains the original processing and transfer disclosures', async () => {
  const old = JSON.parse(await readFile(new URL('../worker/tests/fixtures/privacy-consent-v1.json',import.meta.url),'utf8'));
  const notice = await readFile(new URL('../docs/legal/root-archive-privacy-notice.md',import.meta.url),'utf8');
  assert.equal(CONTRIBUTOR_PRIVACY_CONSENT.version, '1.1-2026-11-16');
  assert.equal(CONTRIBUTOR_PRIVACY_CONSENT.text, 'I consent to root/archive processing my submission data and transferring it to Cloudflare outside Jordan, as described in the Privacy Notice.');
  assert.ok(notice.includes(old.text), 'full original disclosures remain in the linked notice');
  assert.notEqual(CONTRIBUTOR_PRIVACY_CONSENT.version,old.version);
});
