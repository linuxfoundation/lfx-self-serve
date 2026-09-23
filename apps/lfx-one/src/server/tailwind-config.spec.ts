// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import createJiti from 'jiti';
import { describe, expect, it } from 'vitest';

// GH-2555 regression guard. Tailwind loads `tailwind.config.js` through jiti's Node/`exports`-map
// resolution, not the tsconfig `@lfx-one/shared/*` path alias — so the config must import shared
// constants via the deep `@lfx-one/shared/src/...` source subpath. Reverting to the public
// `@lfx-one/shared/constants` entrypoint silently resolves to a stale (or missing) built `dist/`
// on dev machines, leaving `lfxColors`/`lfxFontSizes` undefined and Tailwind falling back to its
// stock palette instead of throwing.
//
// Two guard layers, because neither covers the other's blind spot:
// 1. Source-specifier assertion — catches an import revert in EVERY environment. The jiti
//    assertions alone cannot: `yarn test` is `turbo run test`, and turbo's `test` task has
//    `dependsOn: ["^build"]`, so CI builds a fresh `packages/shared/dist` before this spec runs
//    and a reverted import resolves to correct values.
// 2. jiti load + shape assertions — prove the config loads through the same Node resolution
//    Tailwind uses (vitest's own `@lfx-one/shared` → `src` resolve alias would mask breakage),
//    and catch removal of the `"./src/*"` export entry in packages/shared/package.json, which
//    throws here regardless of `dist/` state.
// Lives under `src/server/` because vitest.config.ts scopes the plain-Node half of the suite to
// `src/server/**/*.spec.ts`; the Angular half (`tsconfig.spec.json`) only collects `src/app/**`.
interface TailwindConfigShape {
  safelist?: unknown[];
  theme?: {
    extend?: { colors?: Record<string, unknown> };
    fontSize?: Record<string, unknown>;
  };
}

const configPath = fileURLToPath(new URL('../../tailwind.config.js', import.meta.url));
const jiti = createJiti(import.meta.url);
const loaded = jiti(configPath) as { default?: TailwindConfigShape } & TailwindConfigShape;
const config: TailwindConfigShape = loaded.default ?? loaded;

describe('tailwind.config.js (jiti/Node resolution, GH-2555)', () => {
  it('loads through Node resolution and defines the brand color palette', () => {
    expect(config.theme?.extend?.colors).toBeDefined();
    expect(Object.keys(config.theme?.extend?.colors ?? {}).length).toBeGreaterThan(0);
  });

  it('defines brand font sizes and a non-empty shared-constants safelist', () => {
    expect(config.theme?.fontSize).toBeDefined();
    expect(Array.isArray(config.safelist)).toBe(true);
    expect(config.safelist?.length).toBeGreaterThan(0);
  });

  it('imports shared constants from the src subpath, never the built package entrypoint', () => {
    const source = readFileSync(configPath, 'utf8');
    expect(source).toMatch(/from '@lfx-one\/shared\/src\//);
    expect(source).not.toMatch(/from '@lfx-one\/shared\/constants'/);
  });
});
