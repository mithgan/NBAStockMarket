export type DataballrPopupResult = { type: 'success'; url: string } | { type: 'cancel' };
export interface DataballrPopup {
  result: Promise<DataballrPopupResult>;
  cancel: () => void;
}

/** Main pages may start login on the registered callback's origin. Only the
 * exact callback path may complete it (checked separately below and at exchange). */
export function canStartDataballrLogin(redirectUri: string, currentUrl: string): boolean {
  try {
    const current = new URL(currentUrl);
    return !current.username && !current.password
      && current.origin === new URL(redirectUri).origin;
  } catch {
    return false;
  }
}

/** Expo 54's web dismiss leaves its auth promise pending. Own the web popup
 * lifetime while retaining Expo's AuthRequest for URL/state/S256 PKCE setup. */
export function openDataballrPopup(
  authorizationUrl: string,
  redirectUri: string,
  browser: Window = window,
): DataballrPopup {
  const origin = new URL(redirectUri).origin;
  let popup: Window | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let settled = false;
  let resolve!: (result: DataballrPopupResult) => void;
  let reject!: (reason: Error) => void;
  const result = new Promise<DataballrPopupResult>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  const cleanup = () => {
    if (interval !== null) clearInterval(interval);
    if (timeout !== null) clearTimeout(timeout);
    browser.removeEventListener('message', receive);
    try {
      popup?.close();
    } catch {
      /* The browser may already have closed it. */
    }
  };
  const finish = (value: DataballrPopupResult) => {
    if (settled) return;
    settled = true;
    cleanup();
    resolve(value);
  };
  const receive = (event: MessageEvent) => {
    if (!event.isTrusted || event.origin !== origin || event.source !== popup) return;
    const data: unknown = event.data;
    if (
      !data ||
      typeof data !== 'object' ||
      !('type' in data) ||
      !('url' in data) ||
      data.type !== 'databallr-oauth-callback' ||
      typeof data.url !== 'string'
    )
      return;
    // The session layer separately validates the exact URL, state, issuer and
    // one-use code before issuing any token request.
    finish({ type: 'success', url: data.url });
  };
  browser.addEventListener('message', receive);
  try {
    popup = browser.open(authorizationUrl, '_blank', 'popup,width=500,height=650');
    if (!popup) throw new Error('blocked');
    interval = setInterval(() => {
      if (popup?.closed) finish({ type: 'cancel' });
    }, 250);
    timeout = setTimeout(() => finish({ type: 'cancel' }), 10 * 60 * 1000);
  } catch {
    settled = true;
    cleanup();
    reject(new Error('The sign-in popup could not open. Allow popups and try again.'));
  }
  return { result, cancel: () => finish({ type: 'cancel' }) };
}

export function completeDataballrPopup(
  redirectUri: string,
  browser: Window = window,
): 'none' | 'invalid' | 'orphan' | 'delivered' {
  const url = new URL(browser.location.href);
  const expected = new URL(redirectUri);
  if (url.origin !== expected.origin || url.pathname !== expected.pathname) return 'invalid';
  if (!url.searchParams.has('code') && !url.searchParams.has('error')) return 'none';
  try {
    if (!browser.opener) return 'orphan';
    browser.opener.postMessage(
      { type: 'databallr-oauth-callback', url: url.toString() },
      expected.origin,
    );
    return 'delivered';
  } catch {
    return 'orphan';
  } finally {
    browser.history.replaceState(browser.history.state, '', redirectUri);
  }
}
