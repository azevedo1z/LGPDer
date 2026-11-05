/**
 * Style sheet of the shadow root of every component. The theme is set from outside by the
 * `--lgpder-*` custom properties, which inherit into the shadow tree, and by `::part()`. Each
 * property is read once, in `:host`, into a private `--_*` property with its default.
 *
 * Default theme: text contrast of at least 4.5:1 and focus outline of at least 3:1 against its
 * background; every button and switch at least 24 by 24 CSS pixels; the banner scrolls inside the
 * viewport instead of growing past it (WCAG 2.2 AA).
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
  'font:16px/1.5 var(--lgpder-font-family,system-ui,sans-serif)}',
  ':host([hidden]){display:none}',
  ':host(lgpder-banner),:host(lgpder-button),:host(lgpder-preferences){',
  'position:fixed;z-index:var(--lgpder-z-index,2147483000)}',
  ':host(lgpder-banner){left:0;right:0;bottom:0;padding:8px}',
  ':host(lgpder-button){left:16px;bottom:16px}',
  ':host(lgpder-preferences){inset:0}',
  ':host(lgpder-placeholder){max-width:100%}',
  '*{box-sizing:border-box}',
  'h2,h3,p,ul{margin:0}',
  'h2{font-size:1.25em}',
  'h3{font-size:1em}',
  'ul{padding-left:1.25em}',
  '[part~=banner],[part~=dialog],[part~=placeholder]{display:grid;gap:12px;padding:16px;',
  'border:1px solid var(--_bd);border-radius:var(--_ra);background:var(--_bg);color:var(--_tx);',
  'box-shadow:var(--lgpder-shadow,0 4px 24px rgba(0,0,0,.2))}',
  // Never taller than the viewport, less the padding of the host: a fixed element does not scroll
  // with the page, so the top of a taller banner (zoom, small screen) could not be reached. The
  // `vh` line is the fallback of the browsers without `dvh`.
  '[part~=banner]{max-width:960px;max-height:calc(100vh - 16px);max-height:calc(100dvh - 16px);',
  'margin:0 auto;overflow:auto}',
  '[part~=backdrop]{position:absolute;inset:0;display:grid;place-items:center;padding:16px;',
  'background:rgba(0,0,0,.5)}',
  '[part~=dialog]{width:100%;max-width:640px;max-height:100%;overflow:auto}',
  '[part~=placeholder]{height:100%;place-content:center;justify-items:center;text-align:center}',
  '[part~=description],[part~=purpose-description]{color:var(--_mu)}',
  '[part~=category],[part~=necessary]{display:grid;gap:8px}',
  '[part~=purpose]{display:flex;gap:12px;align-items:flex-start;justify-content:space-between;',
  'padding-top:8px;border-top:1px solid var(--_bd)}',
  '[part~=individual]{padding:8px;border:2px solid var(--_pr);border-radius:var(--_ra)}',
  '[part~=purpose-title]{font-weight:600}',
  '[part~=badge]{display:inline-block;margin-left:8px;padding:0 8px;border-radius:999px;',
  'background:var(--_pr);color:var(--_on);font-size:.875em}',
  '[part~=actions],[part~=footer]{display:flex;flex-wrap:wrap;gap:8px}',
  '[part~=actions]>button{flex:1 1 auto}',
  '[part~=footer]{justify-content:flex-end}',
  'button{min-width:24px;min-height:24px;font:inherit;cursor:pointer}',
  'button:focus-visible{outline:3px solid var(--_fo);outline-offset:2px}',
  '[part~=button]{min-height:40px;padding:8px 16px;border:2px solid var(--_pr);',
  'border-radius:var(--_ra);background:var(--_pr);color:var(--_on);font-weight:600}',
  '[part~=close]{background:var(--_bg);color:var(--_pr)}',
  ':host(lgpder-button) button{width:48px;height:48px;padding:10px;border-radius:50%}',
  'svg{display:block;width:24px;height:24px;fill:currentColor}',
  '[role=switch]{position:relative;flex:none;width:44px;height:24px;padding:0;',
  'border:2px solid var(--_mu);border-radius:12px;background:var(--_bg)}',
  '[role=switch]::before{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;',
  'border-radius:50%;background:var(--_mu)}',
  '[aria-checked=true]{border-color:var(--_pr);background:var(--_pr)}',
  '[aria-checked=true]::before{left:22px;background:var(--_on)}',
].join('');
