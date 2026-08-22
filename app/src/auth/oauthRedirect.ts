interface BrowserLocation {
  origin: string;
  pathname: string;
}

export function oauthRedirectUrl(location: BrowserLocation): string {
  const trustedOrigin = new URL(location.origin).origin;
  const normalizedPath = `/${(location.pathname || '').replace(/^\/+/, '')}`;
  const redirect = new URL(normalizedPath, trustedOrigin);
  if (redirect.origin !== trustedOrigin) {
    throw new Error('OAuth redirect must stay on the app origin.');
  }
  return redirect.toString();
}
