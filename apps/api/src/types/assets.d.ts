/**
 * Ambient module declarations for non-TS imports.
 *
 * `*.html` files are imported as text (wrangler.jsonc → rules: Text), which is
 * how the SSR renderer shares the exact article shell the static site ships.
 * This file must stay free of imports/exports so the wildcard declarations
 * remain ambient.
 */
declare module '*.html' {
  const content: string;
  export default content;
}
