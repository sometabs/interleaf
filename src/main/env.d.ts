/// <reference types="electron-vite/node" />

/** Migration SQL is inlined into the main bundle at build time. */
declare module '*.sql?raw' {
  const content: string
  export default content
}
