/**
 * Dev-only UI (debug skeleton toggle, sticker testing hints, etc.).
 * Production builds set this false automatically via Vite `import.meta.env.DEV`.
 * To force-hide in local/dev as well, change to: `export const SHOW_DEV_TOOLS = false;`
 */
export const SHOW_DEV_TOOLS = import.meta.env.DEV;
