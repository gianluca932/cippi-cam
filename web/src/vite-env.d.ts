/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" nella build per AWS: nasconde la pagina Live. */
  readonly VITE_ONLINE?: string;
}
