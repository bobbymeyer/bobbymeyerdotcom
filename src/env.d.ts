/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

declare module '*.glsl?raw' {
  const src: string;
  export default src;
}
