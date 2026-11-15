/* Owner-run ONLY after live-test approval, in the staging student's console.
 * Loading sends zero requests. The next actual UI submit carries a deliberately
 * invalid synthetic challenge; the normal Google header is forwarded untouched.
 * Never print, save or inspect authentication headers or challenge credentials.
 */
(() => {
  'use strict';
  if (location.origin !== 'https://archive-staging.rootamman.com') throw new Error('Staging student origin required.');
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
    body.set('turnstile_token', 'synthetic-invalid-staging-acceptance');
    return original.call(window, input, {...options, body});
  };
})();
