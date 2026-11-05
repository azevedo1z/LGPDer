/**
 * Built-in integrations of the scripts layer: the cookies each one writes and the script addresses
 * that reveal it. The Consent Mode types of the same integrations belong to the google layer.
 */
import type { Integration } from './index.ts';

/** Cookies written by each integration; a trailing `*` matches any suffix. */
export const COOKIES: Readonly<Record<Integration, readonly string[]>> = {
  'google-analytics': ['_ga', '_ga_*', '_gid', '_gat', '_gat_*', '_gac_*'],
  'google-ads': ['_gcl_*'],
};

/** Addresses of the scripts of each integration, for the development warning. */
const DETECTION: Readonly<Record<Integration, RegExp>> = {
  'google-analytics': /googletagmanager\.com\/gtag\/js\?id=G-|google-analytics\.com\//,
  'google-ads':
    /googletagmanager\.com\/gtag\/js\?id=AW-|googleadservices\.com\/|googlesyndication\.com\/|doubleclick\.net\//,
};

/** Whether `value` is the id of a built-in integration. */
export function isIntegration(value: unknown): value is Integration {
  return typeof value === 'string' && Object.hasOwn(COOKIES, value);
}

/** The integration whose script is served from `src`, if any. */
export function detectIntegration(src: string): Integration | undefined {
  return (Object.keys(DETECTION) as Integration[]).find((integration) =>
    DETECTION[integration].test(src),
  );
}
