/**
 * Global type definitions for polyfills
 */

declare global {
  interface Window {
    Buffer: typeof Buffer;
    process: typeof process;
    global: typeof globalThis;
  }
  
  const Buffer: typeof import('buffer').Buffer;
  const process: typeof import('process');
}

export {};

