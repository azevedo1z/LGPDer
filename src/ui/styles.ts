/**
 * Style sheet of the shadow root of every component. The theme is set from outside by the
 * `--lgpder-*` custom properties, which inherit into the shadow tree, and by `::part()`. Each
 * property is read once, in `:host`, into a private `--_*` property with its default.
 *
 * Default theme: text contrast of at least 4.5:1 and focus outline of at least 3:1 against its
 * background; every button and switch at least 24 by 24 CSS pixels; the banner scrolls inside the
 * viewport instead of growing past it (WCAG 2.2 AA).
 *
 * Every button is neutral, so the three of the banner and the two of the placeholder have the same
 * emphasis (ANPD guidance); only the part `primary` (the save button of the center) is filled.
 */
export const STYLES: string = [
  ':host{',
  '--_bg:var(--lgpder-color-background,#ffffff);',
  '--_tx:var(--lgpder-color-text,#1f2328);',
  '--_mu:var(--lgpder-color-muted,#57606a);',
  '--_pr:var(--lgpder-color-primary,#0b57d0);',
  '--_on:var(--lgpder-color-primary-text,#ffffff);',
  '--_bd:var(--lgpder-color-border,#d0d7de);',
  '--_fo:var(--lgpder-color-focus,#0b57d0);',
  '--_ra:var(--lgpder-radius,8px);',
  'all:initial;display:block;color:var(--_tx);',
  'font:16px/1.5 var(--lgpder-font-family,system-ui,sans-serif);',
  '-webkit-font-smoothing:antialiased}',
  ':host([hidden]){display:none}',
  ':host(lgpder-banner),:host(lgpder-button),:host(lgpder-preferences){',
  'position:fixed;z-index:var(--lgpder-z-index,2147483000)}',
  ':host(lgpder-banner){left:0;right:0;bottom:0;padding:16px}',
  ':host(lgpder-button){left:16px;bottom:16px}',
  ':host(lgpder-preferences){inset:0}',
  ':host(lgpder-placeholder){max-width:100%}',
  '*{box-sizing:border-box}',
  'h2,h3,p,ul{margin:0}',
  'h2{font-size:1.125em;font-weight:600;letter-spacing:-.01em}',
  'h3{font-size:.875em;font-weight:600}',
  '[part~=banner],[part~=dialog]{display:grid;gap:16px;padding:20px;',
  'border:1px solid var(--_bd);border-radius:calc(var(--_ra) + 4px);background:var(--_bg);',
  'color:var(--_tx);',
  'box-shadow:var(--lgpder-shadow,0 1px 2px rgba(0,0,0,.06),0 12px 32px rgba(0,0,0,.12))}',
  // Never taller than the viewport, less the padding of the host: a fixed element does not scroll
  // with the page, so the top of a taller banner (zoom, small screen) could not be reached. The
  // `vh` line is the fallback of the browsers without `dvh`.
  '[part~=banner]{max-width:720px;max-height:calc(100vh - 32px);max-height:calc(100dvh - 32px);',
  'margin:0 auto;overflow:auto}',
  '[part~=backdrop]{position:absolute;inset:0;display:grid;place-items:center;padding:16px;',
  'background:rgba(0,0,0,.4)}',
  '[part~=dialog]{width:100%;max-width:560px;max-height:100%;padding:24px;gap:20px;overflow:auto}',
  // Inside the page, not over it: flat, without shadow.
  '[part~=placeholder]{display:grid;gap:16px;height:100%;padding:24px;place-content:center;',
  'justify-items:center;text-align:center;border:1px solid var(--_bd);border-radius:var(--_ra);',
  'background:var(--_bg);color:var(--_tx)}',
  '[part~=description],[part~=purpose-description]{color:var(--_mu)}',
  // The description reads as part of the title above it.
  '[part~=title]+[part~=description]{margin-top:-8px}',
  '[part~=purpose-description]{font-size:.875em}',
  '[part~=necessary]{display:grid;gap:4px}',
  '[part~=necessary]>[part~=description]{font-size:.875em}',
  '[part~=category]{display:grid}',
  '[part~=category-title]{padding-bottom:4px;color:var(--_mu)}',
  '[part~=purpose]{display:flex;gap:16px;align-items:center;justify-content:space-between;',
  'padding:12px 0;border-top:1px solid var(--_bd)}',
  // The purposes of the banner: one line of plain text, read as a list, not as controls.
  '[part~=purposes]{display:flex;flex-wrap:wrap;padding:0;list-style:none;font-weight:500}',
  '[part~=purposes]>[part~=purpose]{display:block;padding:0;border:0}',
  '[part~=purposes]>[part~=purpose]:not(:last-child)::after{content:"·";content:"·"/"";',
  'padding:0 8px;color:var(--_mu)}',
  '[part~=purpose-title]{font-weight:500}',
  '[part~=individual]{margin-top:8px;padding:12px;border:2px solid var(--_pr);',
  'border-radius:var(--_ra)}',
  '[part~=badge]{display:block;color:var(--_pr);font-size:.875em;font-weight:600}',
  '[part~=actions],[part~=footer]{display:flex;flex-wrap:wrap;gap:8px}',
  '[part~=actions]>button{flex:1 1 auto}',
  // The three of the banner side by side when they fit, one per line on a narrow screen.
  '[part~=banner]>[part~=actions]>button{flex-basis:180px}',
  '[part~=footer]{justify-content:flex-end}',
  'button{min-width:24px;min-height:24px;font:inherit;cursor:pointer}',
  'button:focus-visible{outline:3px solid var(--_fo);outline-offset:2px}',
  '[part~=button]{min-height:40px;padding:8px 16px;border:1px solid var(--_bd);',
  'border-radius:var(--_ra);background:var(--_bg);color:var(--_tx);font-weight:500}',
  '[part~=button]:hover{background:color-mix(in srgb,var(--_tx) 6%,var(--_bg))}',
  '[part~=primary]{border-color:var(--_pr);background:var(--_pr);color:var(--_on)}',
  '[part~=primary]:hover{background:color-mix(in srgb,var(--_pr) 88%,#000000)}',
  ':host(lgpder-button) button{width:48px;height:48px;padding:12px;border-radius:50%;',
  'box-shadow:var(--lgpder-shadow,0 1px 2px rgba(0,0,0,.06),0 4px 16px rgba(0,0,0,.12))}',
  'svg{display:block;width:24px;height:24px;fill:currentColor}',
  '[role=switch]{position:relative;flex:none;width:44px;height:24px;padding:0;',
  'border:2px solid var(--_mu);border-radius:12px;background:var(--_bg)}',
  '[role=switch]::before{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;',
  'border-radius:50%;background:var(--_mu)}',
  '[aria-checked=true]{border-color:var(--_pr);background:var(--_pr)}',
  '[aria-checked=true]::before{left:22px;background:var(--_on)}',
].join('');
