// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Ambient declaration for `process.loadEnvFile`, added in Node 20.12.0/21.7.0
// (repo runs Node >=22) but absent from the app's pinned @types/node@18.
// tsconfig registers src/types as a typeRoot so this is picked up automatically.

declare global {
  namespace NodeJS {
    interface Process {
      loadEnvFile(path?: string | URL | Buffer): void;
    }
  }
}

export {};
