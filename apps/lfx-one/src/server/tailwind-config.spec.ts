// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { fileURLToPath } from 'node:url';

import createJiti from 'jiti';
import { describe, expect, it } from 'vitest';

// GH-2555 regression guard. Tailwind loads `tailwind.config.js` through jiti's Node/`exports`-map
// resolution, not the tsconfig `@lfx-one/shared/*` path alias — so the config must import shared
// constants via the deep `@lfx-one/shared/src/...` source subpath. Reverting to the public
// `@lfx-one/shared/constants` entrypoint silently resolves to a stale (or missing) built `dist/`
// on dev machines, leaving `lfxColors`/`lfxFontSizes` undefined and Tailwind falling back to its
// stock palette instead of throwing. Loading the config with jiti here reproduces that exact
// resolution path — vitest's own `@lfx-one/shared` → `src` resolve alias would mask a revert — and
// CI runs `yarn test` before `yarn build`, so `packages/shared/dist` does not exist when this runs.
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
});
