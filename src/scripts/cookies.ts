/**
 * Removal of the cookies of a purpose: the patterns of its integrations and its own patterns,
 * expired on the current host and on each parent domain.
 */

/**
 * Cookie pattern: a cookie name (an HTTP token, RFC 9110, section 5.6.2) without `*`, optionally
 * followed by one `*` that matches any suffix. A lone `*` is refused: it would also remove the
 * consent record and the session of the application.
 */
const PATTERN = /^[!#$%&'+.^_`|~0-9A-Za-z-]+\*?$/;

/** IPv4 or IPv6 hostname, which has no parent domain. */
const IP_ADDRESS = /^[\d.]+$|:/;

/** Tells whether a cookie name belongs to a purpose. */
export type CookieMatcher = (name: string) => boolean;

/**
 * Validates a cookie pattern.
 *
 * @throws {TypeError} `pattern` is not a cookie name optionally ending in `*`.
 */
export function parsePattern(pattern: unknown): string {
  if (typeof pattern !== 'string' || !PATTERN.test(pattern)) {
    throw new TypeError(
      `[lgpder] Invalid cookie pattern: ${JSON.stringify(String(pattern))}; use a cookie name, optionally ending in "*".`,
    );
  }
  return pattern;
}

/** Matcher of validated patterns: equal names, and the prefix of the patterns ending in `*`. */
export function cookieMatcher(patterns: readonly string[]): CookieMatcher {
  const names = new Set<string>();
  const prefixes: string[] = [];
  for (const pattern of patterns) {
    if (pattern.endsWith('*')) prefixes.push(pattern.slice(0, -1));
    else names.add(pattern);
  }
  return (name) => names.has(name) || prefixes.some((prefix) => name.startsWith(prefix));
}

/**
 * Expires every cookie visible to the page whose name `matches`: the host-only cookie and the
 * cookie of each parent domain, with `Path=/`, and `Secure` on HTTPS, which the `__Secure-` and
 * `__Host-` names require. `HttpOnly` cookies, cookies of other paths and cookies of other domains
 * are out of reach.
 */
export function deleteCookies(matches: CookieMatcher): void {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  const domains = parentDomains(location.hostname);
  for (const pair of document.cookie.split('; ')) {
    const name = pair.slice(0, Math.max(pair.indexOf('='), 0));
    if (name === '' || !matches(name)) continue;
    const expired = `${name}=; Path=/; Max-Age=0${secure}`;
    document.cookie = expired;
    for (const domain of domains) document.cookie = `${expired}; Domain=${domain}`;
  }
}

/**
 * Every suffix of `hostname` with at least two labels, from the longest: `www.example.com.br`
 * gives itself, `example.com.br` and `com.br`. The browser ignores the public suffixes. None for an
 * IP address or a hostname without a dot. Same rule as the cookie adapter of the storage layer,
 * which no layer may import.
 */
function parentDomains(hostname: string): string[] {
  if (IP_ADDRESS.test(hostname)) return [];
  const labels = hostname.split('.');
  return labels.slice(0, -1).map((_, index) => labels.slice(index).join('.'));
}
