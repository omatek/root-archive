/* Owner-run ONLY after live-test approval, in the staging student's console.
 * Loading sends zero requests. The next actual UI submit carries a deliberately
 * invalid synthetic challenge; the normal Google header is forwarded untouched.
 * Never print, save or inspect authentication headers or challenge credentials.
 */
(() => {
  'use strict';
  if (location.origin !== 'https://archive-staging.rootamman.com') throw new Error('Staging student origin required.');
  // For the missing-token case, set window.rootStagingTurnstileFailure='missing'
  // before loading. Default is the invalid-token case. Neither reads credentials.
  const failureMode = window.rootStagingTurnstileFailure ?? 'invalid';
  if (!['invalid','missing'].includes(failureMode)) throw new Error('Use invalid or missing.');
  delete window.rootStagingTurnstileFailure;
  const original = window.fetch;
  const endpoint = 'https://api-staging.rootamman.com/submit';
  window.fetch = function(input, options) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
    if (url.href !== endpoint || options?.method !== 'POST' || !(options.body instanceof FormData)) {
      return original.call(window, input, options);
    }
    window.fetch = original; // One request only; ordinary subsequent retries recover.
    const body = new FormData();
    for (const [name, value] of options.body) body.append(name, value);
    if (failureMode === 'missing') body.delete('turnstile_token');
    else body.set('turnstile_token', 'synthetic-invalid-staging-acceptance');
    return original.call(window, input, {...options, body});
  };
})();
