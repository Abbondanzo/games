/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** CORS reverse proxy used as a fallback in production builds. Empty disables it. */
  readonly VITE_CORS_PROXY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
