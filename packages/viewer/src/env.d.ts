/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly REMEMBER_API: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
