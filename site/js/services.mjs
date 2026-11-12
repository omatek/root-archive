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
// Decoded claims never authorize an upload; the Worker checks every request.
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
  let verifying = false;
  let pending = null;
  let expiryTimer = 0;
  function message(text) { $('auth-message').textContent = text; }
  function paint() {
    $('auth-status').textContent = verifying ? 'Verifying your account…' : credential ? 'Student account verified.' : '';
    $('google-signin-slot').hidden = !!credential || verifying;
    $('retry-signin').hidden = initialized || !!credential || verifying;
    $('signout').hidden = !credential;
    $('switch-account').hidden = !initialized;
  }
  function clear() {
    generation++;
    pending?.abort(); pending = null;
    clearTimeout(expiryTimer); expiryTimer = 0;
    verifying = false;
    credential = null; expires = 0;
    message('');
    try { window.google?.accounts.id.disableAutoSelect(); } catch { /* No token persists. */ }
    paint();
  }
  async function verify(response) {
    clear();
    const requestGeneration = ++generation;
    if (!response || typeof response.credential !== 'string' || !response.credential.trim()) {
      paint(); message('Google sign-in did not finish. Please try again.'); return;
    }
    const candidate = response.credential.trim();
    verifying = true; paint();
    message('');
    const controller = new AbortController();
    pending = controller;
    try {
      const endpoint = CONFIG.submissionEndpoint.replace(/\/+$/, '').replace(/\/submit$/, '') + '/auth/verify';
      const result = await fetch(endpoint, {
        method: 'POST', headers: { Authorization: `Bearer ${candidate}`, Accept: 'application/json' },
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)])
      });
      const payload = await result.json().catch(() => null);
      if (generation !== requestGeneration) return;
      pending = null; verifying = false;
      if (result.ok && payload?.success === true && payload.authorized === true) {
        credential = candidate; expires = tokenExpiry(candidate); paint();
        if (expires) expiryTimer = setTimeout(getToken, Math.max(0, expires - Date.now() - 30000));
        message('You can now submit your resource. Your draft is ready below.');
      } else {
        clear();
        message(result.status === 403
          ? 'This account isn’t currently eligible to contribute. Contributions require a verified @std.aum.edu.jo student account. Use a different Google account to try again; your draft is still here.'
          : 'We couldn’t verify this sign-in. Please sign in again, or try later.');
      }
    } catch {
      if (generation !== requestGeneration) return;
      clear(); message('We couldn’t reach account verification. Check your connection and try signing in again.');
    }
  }
  async function init() {
    getToken();
    if (loading || initialized) { paint(); return; }
    loading = true;
    $('retry-signin').disabled = true;
    $('auth-status').textContent = 'Loading Google sign-in…';
    try {
      await loadScript('google-gsi-script', 'https://accounts.google.com/gsi/client');
      const identity = window.google?.accounts.id;
      if (!identity) throw new Error('Google unavailable');
      identity.initialize({
        client_id: CONFIG.googleClientId, callback: verify,
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
  function chooseAccount(text) {
    clear(); message(text);
    const target = $('google-signin-slot').querySelector('[role=button], button, iframe') || $('retry-signin');
    target.focus();
  }
  $('switch-account').addEventListener('click', () => chooseAccount('Choose another account using Google sign-in. Your draft is still here.'));
  $('signout').addEventListener('click', () => chooseAccount('You’re signed out. You can sign in again; your draft is still here.'));
  return { init, getToken, clear, requireSignIn() {
    // Keep an eligibility/expiry explanation visible when submission is attempted again.
    if (!$('auth-message').textContent) message('Sign in to contribute before submitting. Your draft is still here.');
    $('auth-heading').scrollIntoView({ block: 'nearest' });
    const target = verifying ? $('switch-account') : $('google-signin-slot').querySelector('[role=button], button, iframe') || $('retry-signin');
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
