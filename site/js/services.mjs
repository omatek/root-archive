import { CONFIG } from './config.mjs';
import { $ } from './dom.mjs';

const scripts = new Map();
function loadScript(id, src) {
  if (scripts.has(id)) return scripts.get(id);
  const promise = new Promise((resolve, reject) => {
    document.getElementById(id)?.remove();
    const script = document.createElement('script');
    script.id = id; script.src = src; script.async = true; script.defer = true;
    const timer = setTimeout(() => fail(), 20000);
    function fail() {
      clearTimeout(timer); script.remove(); scripts.delete(id);
      reject(new Error('The service could not be loaded.'));
    }
    script.onload = () => { clearTimeout(timer); resolve(); };
    script.onerror = fail;
    document.head.append(script);
  });
  scripts.set(id, promise);
  return promise;
}

// This is only a local expiry hint AFTER the Worker verifies the credential.
// Neither decoded claims nor the GIS hosted-domain hint authorize an upload.
function tokenExpiry(token) {
  try {
    const value = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(value.padEnd(Math.ceil(value.length / 4) * 4, '=')));
    return Number.isFinite(payload.exp) ? payload.exp * 1000 : 0;
  } catch { return 0; }
}
export function createStudentAuth() {
  let credential = null;
  let expires = 0;
  let generation = 0;
  let initialized = false;
  let loading = false;
  function message(text) { $('auth-message').textContent = text; }
  function paint() {
    $('auth-status').textContent = credential ? 'University account verified.' : '';
    $('google-signin-slot').hidden = !!credential;
    $('retry-signin').hidden = initialized || !!credential;
    $('signout').hidden = !credential;
  }
  function clear() {
    generation++;
    credential = null; expires = 0;
    try { window.google?.accounts.id.disableAutoSelect(); } catch { /* No token persists. */ }
    paint();
  }
  async function verify(response) {
    const requestGeneration = ++generation;
    credential = null; expires = 0;
    if (!response || typeof response.credential !== 'string' || !response.credential.trim()) {
      paint(); message('Google sign-in did not finish. Please try again.'); return;
    }
    const candidate = response.credential.trim();
    $('google-signin-slot').hidden = true;
    $('auth-status').textContent = 'Verifying your university account…';
    message('');
    try {
      const endpoint = CONFIG.submissionEndpoint.replace(/\/+$/, '').replace(/\/submit$/, '') + '/auth/verify';
      const result = await fetch(endpoint, {
        method: 'POST', headers: { Authorization: `Bearer ${candidate}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(20000)
      });
      const payload = await result.json().catch(() => null);
      if (generation !== requestGeneration) return;
      if (result.ok && payload?.success === true && payload.authorized === true) {
        credential = candidate; expires = tokenExpiry(candidate); paint();
        message('You can now submit your resource. Your draft is ready below.');
      } else {
        clear();
        message(result.status === 403
          ? 'Please use your @std.aum.edu.jo student account. This account is not eligible to contribute.'
          : 'We couldn’t verify this sign-in. Please sign in again, or try later.');
      }
    } catch {
      if (generation !== requestGeneration) return;
      clear(); message('We couldn’t reach account verification. Check your connection and try signing in again.');
    }
  }
  async function init() {
    if (loading || initialized) { paint(); return; }
    loading = true;
    $('retry-signin').disabled = true;
    $('auth-status').textContent = 'Loading Google sign-in…';
    try {
      await loadScript('google-gsi-script', 'https://accounts.google.com/gsi/client');
      const identity = window.google?.accounts.id;
      if (!identity) throw new Error('Google unavailable');
      identity.initialize({
        client_id: CONFIG.googleClientId, callback: verify, hd: CONFIG.allowedStudentDomain,
        ux_mode: 'popup', auto_select: false, cancel_on_tap_outside: true, context: 'signin'
      });
      $('google-signin-slot').replaceChildren();
      identity.renderButton($('google-signin-slot'), {
        type: 'standard', theme: 'outline', size: 'large', text: 'signin_with', shape: 'rectangular', width: 230
      });
      initialized = true; message('');
    } catch {
      scripts.delete('google-gsi-script');
      message('Google sign-in couldn’t load. Check your connection or content blocker, then try again. You can still prepare your draft.');
    } finally { loading = false; $('retry-signin').disabled = false; paint(); }
  }
  function getToken() {
    if (credential && expires && Date.now() + 30000 >= expires) {
      clear(); message('Your sign-in has expired. Sign in again; your draft is still here.');
    }
    return credential;
  }
  $('retry-signin').addEventListener('click', init);
  return { init, getToken, clear, requireSignIn() {
    message('Sign in with your @std.aum.edu.jo account before submitting. Your draft is still here.');
    $('auth-heading').scrollIntoView({ block: 'nearest' });
    const target = $('google-signin-slot').querySelector('[role=button], button, iframe') || $('retry-signin');
    target.focus();
  } };
}

export function createSecurityCheck() {
  let widget = null;
  let token = '';
  let loading = false;
  function status(text, retry = false) {
    $('turnstile-status').textContent = text;
    $('retry-security').hidden = !retry;
  }
  function expire() { token = ''; status('The security check expired. Please verify again.', true); }
  async function reset() {
    token = '';
    if (loading) return;
    loading = true; status('Loading the security check…');
    try {
      await loadScript('cf-turnstile-script', 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit');
      if (!window.turnstile) throw new Error('Security check unavailable');
      if (widget !== null) { window.turnstile.reset(widget); return; }
      widget = window.turnstile.render($('turnstile-slot'), {
        sitekey: CONFIG.turnstileSiteKey, theme: 'light', size: 'compact',
        callback(value) {
          token = typeof value === 'string' ? value.trim() : '';
          if (token) { status('Security check complete.'); $('turnstile-error').hidden = true; }
        },
        'expired-callback': expire, 'timeout-callback': expire,
        'error-callback'() { token = ''; status('The security check failed. Please try again.', true); }
      });
    } catch {
      scripts.delete('cf-turnstile-script');
      status('The security check couldn’t load. Check your connection or content blocker and try again.', true);
    } finally { loading = false; }
  }
  $('retry-security').addEventListener('click', reset);
  return { reset, getToken() {
    try { if (widget !== null && window.turnstile?.isExpired(widget)) token = ''; } catch { token = ''; }
    return token;
  } };
}
