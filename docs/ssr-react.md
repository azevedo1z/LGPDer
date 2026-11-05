# SSR, Next.js and React

LGPDer has no framework binding: the manager already has what React needs (`subscribe`, `getSnapshot` and `getServerSnapshot`, functions that do not depend on `this`), and the components are Web Components, which render only on the client. This guide has the recipes for React, server rendering and Next.js.

## What runs on the server

Every subpath can be imported on the server, and none has a side effect on import. Outside the browser (the only signal is the absence of `document`), the layers validate their options and do nothing: the storage never reads or writes (not even a global `localStorage` of Node.js, which would be shared by every request), no script is activated, nothing is pushed to the `dataLayer`, nothing is sent and no component is defined. `init` works in memory, with every layer inert.

An instance created at module scope on the server is shared by every request and must never receive decisions. To render with the consent of the data subject, create one manager per request, from the `Cookie` header of the request:

```ts
import { createConsentManager } from 'lgpder';

/**
 * The record in the Cookie header of a request: the value of the only cookie lgpder, decoded.
 * Absent, repeated or not percent-encoded, it is undefined: nothing is adopted.
 */
export function recordFromCookies(header: string | null): string | undefined {
  const values = (header ?? '')
    .split(';')
    .map((pair) => pair.trim())
    .filter((pair) => pair.startsWith('lgpder='));
  const [only] = values;
  if (only === undefined || values.length > 1) return undefined;
  try {
    return decodeURIComponent(only.slice('lgpder='.length));
  } catch {
    return undefined;
  }
}

// One manager per request; the record is read as untrusted data.
export function requestConsent(cookieHeader: string | null) {
  return createConsentManager({ purposes: PURPOSES, record: recordFromCookies(cookieHeader) });
}
```

- **A repeated cookie adopts nothing.** A cookie named `lgpder` may appear more than once in the request, for example when another host of the same registrable domain also sets one with `Domain`. Which copy is the record cannot be told, so the server must not pick one: in the browser, the [cookie adapter](storage.md#cookieadapteroptions) refuses the duplicated name and every purpose stays `'pending'`, and the server must render the same state. Read the raw header, as above, and not a helper of the framework that returns only one of the copies (such as `cookies().get` of Next.js).
- **What the core discards.** The core discards the expired decisions and whatever is malformed, and keeps a decision of another version `'pending'`, so an expired, outdated or malformed cookie never grants anything. A record with a valid structure is accepted even if the data subject or a script of the page edited it, as any record is (see the [notice](../README.md#notice-lgpder-does-not-guarantee-lgpd-compliance)).

The record is only in a cookie when the browser saves it there: use `storage: 'cookie'` (see [storage](storage.md#cookie)).

## React

Use `useSyncExternalStore` with the functions of the manager. In a client-only application (such as one built with Vite), create the app once, at module scope, and read the state with a hook:

```ts
// consent.ts
import { init } from 'lgpder/init';

export const app = init({
  purposes: {
    analytics: {
      category: 'statistics',
      title: 'Estatísticas',
      integrations: ['google-analytics'],
    },
    maps: { category: 'functional', title: 'Mapas', description: 'Mapas do Google Maps.' },
  },
});
```

```tsx
// use-consent.ts
import { useSyncExternalStore } from 'react';
import { app } from './consent';

export function useConsent() {
  const { manager } = app;
  return useSyncExternalStore(manager.subscribe, manager.getSnapshot);
}

// store-map.tsx
export function StoreMap() {
  const { status } = useConsent();
  if (status.maps !== 'granted') {
    return (
      <button type="button" onClick={() => app.openPreferences(['maps'])}>
        Mostrar o mapa
      </button>
    );
  }
  return <iframe src="https://www.google.com/maps/embed?pb=..." title="Mapa da loja" />;
}
```

- Read the state from `app.manager`, but decide through the app (`app.decide`, `app.grantAll`, `app.denyAll`) or the components, never on the manager (see [`ConsentApp`](init.md#consentapp)).
- Call `init` once per page, at module scope, not in a component or an effect: StrictMode runs effects twice in development, and a second `init` while the first is alive throws (see [One instance per page](init.md#one-instance-per-page)).
- The snapshot changes reference only on a notification, so the hook re-renders only when the consent changes. The callback of React receives the notification and ignores it.
- Content rendered by React from the state, such as the map above, is removed by React itself on a revocation: no reload is needed for it.

### Blocked elements in a React tree

The scripts layer replaces the elements it activates or blocks again (`replaceWith`), which React does not expect in a tree it manages: React would keep a reference to the old node. In a React application, load third-party scripts with [`onGranted`](scripts.md#ongrantedpurpose-fn) instead of `<script type="text/plain">` in JSX, and render iframes from the state, as above. Elements with `data-consent` stay fine in the static HTML outside the React root (such as the `index.html` of a Vite application).

```ts
// consent.ts, after init
declare function gtag(...args: unknown[]): void; // defined by consentDefaultSnippet

app.onGranted('analytics', () => {
  const tag = document.createElement('script');
  tag.src = 'https://www.googletagmanager.com/gtag/js?id=G-XXXX';
  document.head.append(tag);
  gtag('js', new Date());
  gtag('config', 'G-XXXX');
  // No cleanup: the tag cannot be unloaded, so revoking analytics reloads the page.
});
```

### Server rendering with React

With server rendering, the third argument of `useSyncExternalStore` gives the snapshot used on the server and during hydration, which must be the same on both sides:

- **Record only in the browser (`localStorage`).** The server does not know the consent: pass `manager.getServerSnapshot`, a state without decisions, so the server and the hydration start with every purpose `'pending'`; right after hydration, React renders again with the saved state. Consent-dependent content appears only after hydration.
- **Record in a cookie.** The server reads the cookie of the request and renders with the consent of the data subject; pass `manager.getSnapshot` on both sides. Content and a banner of the application (headless) are right from the first byte, and the banner does not flash for whoever already decided. This is the recipe below.

The components of `lgpder/ui` are not rendered by the server either way: `init` mounts them in the browser after reading the storage, so the banner shows only when there is something to ask.

## Next.js (App Router)

The recipe uses the cookie as storage, reads it on the server, and renders with the same snapshot on the server and in the hydration. Four files:

```ts
// app/consent-config.ts: the core configuration, shared by the server and the browser.
export const PURPOSES = {
  analytics: { version: '2026-10', category: 'statistics' },
  ads: { version: '2026-10', category: 'marketing' },
} as const;

export type PurposeId = keyof typeof PURPOSES;

// Also here: recordFromCookies, from "What runs on the server" above.
```

```ts
// app/consent-app.ts: the app, created once, in the browser, when the module is evaluated.
import { init } from 'lgpder/init';
import { PURPOSES } from './consent-config';

declare function gtag(...args: unknown[]): void; // defined by consentDefaultSnippet

function start() {
  const app = init({
    storage: 'cookie', // the cookie lgpder goes to the server on each request
    purposes: {
      analytics: {
        ...PURPOSES.analytics,
        title: 'Estatísticas',
        description: 'Usamos o Google Analytics para entender como o site é usado.',
        integrations: ['google-analytics'],
      },
      ads: {
        ...PURPOSES.ads,
        title: 'Publicidade',
        description: 'Anúncios personalizados do Google Ads.',
        integrations: ['google-ads'],
      },
    },
  });
  app.onGranted('analytics', () => {
    const tag = document.createElement('script');
    tag.src = 'https://www.googletagmanager.com/gtag/js?id=G-XXXX';
    document.head.append(tag);
    gtag('js', new Date());
    gtag('config', 'G-XXXX');
  });
  return app;
}

// On the server, this module is also evaluated, to render the client components: no app there.
export const app = typeof document === 'undefined' ? undefined : start();
```

```tsx
// app/consent-provider.tsx
'use client';

import { createContext, useContext, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createConsentManager, type ConsentManager } from 'lgpder';
import { app } from './consent-app';
import { PURPOSES, type PurposeId } from './consent-config';

const ConsentContext = createContext<ConsentManager<PurposeId> | null>(null);

export function ConsentProvider(props: { record: string | undefined; children: ReactNode }) {
  // In the browser, the manager of init, which read the same cookie. On the server, one manager
  // per request, from the cookie the layout read.
  const [manager] = useState(
    () => app?.manager ?? createConsentManager({ purposes: PURPOSES, record: props.record }),
  );
  return <ConsentContext.Provider value={manager}>{props.children}</ConsentContext.Provider>;
}

export function useConsent() {
  const manager = useContext(ConsentContext);
  if (manager === null) throw new Error('useConsent() needs a <ConsentProvider>.');
  // The record comes from the cookie on both sides: the server snapshot is the current one.
  return useSyncExternalStore(manager.subscribe, manager.getSnapshot, manager.getSnapshot);
}
```

```tsx
// app/layout.tsx
import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { consentDefaultSnippet } from 'lgpder/google';
import { recordFromCookies } from './consent-config';
import { ConsentProvider } from './consent-provider';

export default async function RootLayout({ children }: { children: ReactNode }) {
  // The raw header, so that a repeated lgpder cookie adopts nothing, as in the browser.
  const record = recordFromCookies((await headers()).get('cookie'));
  return (
    <html lang="pt-BR">
      <head>
        <script dangerouslySetInnerHTML={{ __html: consentDefaultSnippet }} />
      </head>
      <body>
        <ConsentProvider record={record}>{children}</ConsentProvider>
      </body>
    </html>
  );
}
```

Notes:

- `PURPOSES` holds only the keys of the core (`version`, `category`, `individualGrant`), since `createConsentManager` refuses the texts and the integrations; the client spreads it into the options of `init`. Both sides must use the same versions, or the server would see the decisions as outdated.
- Reading `headers()` makes the route dynamic. The snippet of the Consent Mode default is in the `<head>`, before any Google tag; with a strict CSP, allow it by nonce or by its hash (see [google](google.md#content-security-policy)).
- The app is created when the client module is evaluated, before React hydrates, so the manager already has the consent of the cookie and the hydration matches the server. The components are inserted at the start of the `<body>` once the document is parsed; React 19 skips elements that third-party scripts insert in the `<body>` during hydration. With an earlier version of React, call `init` after hydration instead, and pass `getServerSnapshot` until then.
- If the data subject decides in another tab between the server render and the hydration, the two snapshots differ, and React renders that part again on the client.
- The cookie is named `lgpder` (`init` does not expose the key) and is read by the server on every request. On a site served only over HTTPS, `connectStorage` with `key: '__Host-lgpder'`, used without `init`, gives a stronger cookie (see [storage](storage.md#cookie)).
