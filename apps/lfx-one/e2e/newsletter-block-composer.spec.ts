// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Newsletter Block Composer — Phase-1 editor (LFXV2-2381).
 *
 * Exercises the native-Angular, Puck-style block composer at the dev/preview
 * route `/newsletters/composer-preview`:
 *   - The palette renders block chips from the bundled manifest.
 *   - Clicking a palette block appends it to the canvas (add).
 *   - Adding multiple blocks renders multiple canvas blocks (compose).
 *   - The remove control deletes a block from the canvas (remove).
 *   - The emitted NewsletterLayout reflects the composed blocks.
 *
 * The manifest fetch is stubbed so the spec is deterministic and independent of
 * the committed asset / template repo. The composer-preview route takes the ED
 * persona fast-path through newsletterAccessGuard (seeded via the persona
 * cookie), so no project/context API round-trip is required.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD
 */

import type { NewsletterTemplateManifest, PersistedPersonaState, PersonaType } from '@lfx-one/shared/interfaces';
import { PERSONA_COOKIE_KEY } from '@lfx-one/shared/constants';
import { expect, Page, test } from '@playwright/test';

test.setTimeout(60_000);

const PAGE_LOAD_TIMEOUT = 20_000;
const ELEMENT_TIMEOUT = 10_000;

const PREVIEW_URL = '/newsletters/composer-preview';

// A small, deterministic manifest: one plain block, one container block.
const MOCK_MANIFEST: NewsletterTemplateManifest = {
  wrapper_key: 'default',
  blocks: [
    {
      block_type: 'intro_paragraph',
      label: 'Intro Paragraph',
      category: 'block',
      schema: { text: { type: 'richtext', label: 'Text' } },
    },
    {
      block_type: 'sponsored_ad',
      label: 'Sponsored Ad',
      category: 'block',
      schema: { headline: { type: 'text', label: 'Headline' } },
    },
    {
      block_type: 'mlops_community',
      label: 'Mlops Community',
      category: 'block',
      is_container: true,
      schema: { children: { type: 'slot', label: 'Bricks' } },
    },
  ],
};

async function stubManifest(page: Page): Promise<void> {
  await page.route('**/assets/newsletter-block-manifest.json', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_MANIFEST) })
  );
}

async function stubPersona(page: Page): Promise<void> {
  await page.route('**/api/user/personas*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ personas: ['executive-director'], personaProjects: {}, projects: [], organizations: [], isRootWriter: true }),
    })
  );
}

async function setPersonaCookie(page: Page): Promise<void> {
  const state: PersistedPersonaState = {
    primary: 'executive-director' as PersonaType,
    all: ['executive-director'] as PersonaType[],
  };
  await page.context().addCookies([
    {
      name: PERSONA_COOKIE_KEY,
      value: encodeURIComponent(JSON.stringify(state)),
      domain: 'localhost',
      path: '/',
      sameSite: 'Lax',
    },
  ]);
}

const AUTH_CREDS_PRESENT = !!process.env.TEST_USERNAME && !!process.env.TEST_PASSWORD;

function skipWhenAuthMissing(): void {
  if (!AUTH_CREDS_PRESENT) {
    test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
  }
}

async function gotoPreview(page: Page): Promise<void> {
  skipWhenAuthMissing();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await page.goto(PREVIEW_URL, { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
}

test.describe('Newsletter Block Composer — Phase 1', () => {
  test.beforeEach(async ({ page }) => {
    await setPersonaCookie(page);
    await stubPersona(page);
    await stubManifest(page);
  });

  test('renders the palette from the manifest', async ({ page }) => {
    await gotoPreview(page);

    await expect(page.getByTestId('newsletter-composer')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('newsletter-composer-palette')).toBeVisible();
    await expect(page.getByTestId('newsletter-composer-palette-item-intro_paragraph')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('newsletter-composer-palette-item-sponsored_ad')).toBeVisible();
    await expect(page.getByTestId('newsletter-composer-palette-item-mlops_community')).toBeVisible();
  });

  test('starts with an empty canvas', async ({ page }) => {
    await gotoPreview(page);

    await expect(page.getByTestId('newsletter-composer-canvas')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('newsletter-composer-canvas-empty')).toBeVisible();
  });

  test('clicking a palette block adds it to the canvas', async ({ page }) => {
    await gotoPreview(page);

    await page.getByTestId('newsletter-composer-palette-item-intro_paragraph').click();

    await expect(page.getByTestId('newsletter-composer-block-intro_paragraph')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('newsletter-composer-canvas-empty')).toHaveCount(0);
    // The emitted layout reflects the added block.
    await expect(page.getByTestId('newsletter-composer-preview-output')).toContainText('intro_paragraph');
  });

  test('composes multiple blocks including a container', async ({ page }) => {
    await gotoPreview(page);

    await page.getByTestId('newsletter-composer-palette-item-intro_paragraph').click();
    await page.getByTestId('newsletter-composer-palette-item-mlops_community').click();

    await expect(page.getByTestId('newsletter-composer-block-intro_paragraph')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('newsletter-composer-block-mlops_community')).toBeVisible();
    // The container block exposes its own nested drop list.
    await expect(page.getByTestId('newsletter-composer-container-mlops_community')).toBeVisible();
  });

  test('nests a block into a container via drag-and-drop', async ({ page }) => {
    await gotoPreview(page);

    // Add a container and a plain block at the top level.
    await page.getByTestId('newsletter-composer-palette-item-mlops_community').click();
    await page.getByTestId('newsletter-composer-palette-item-intro_paragraph').click();
    await expect(page.getByTestId('newsletter-composer-container-mlops_community')).toBeVisible({ timeout: ELEMENT_TIMEOUT });

    // Drag the intro_paragraph canvas block into the container's nested list.
    const source = page.getByTestId('newsletter-composer-block-intro_paragraph');
    const target = page.getByTestId('newsletter-composer-container-mlops_community');
    await source.dragTo(target);

    // The block now lives inside the container as a child, and the emitted layout
    // nests it under the container's `blocks`.
    await expect(target.getByTestId('newsletter-composer-child-intro_paragraph')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
  });

  test('removing a block clears it from the canvas and layout', async ({ page }) => {
    await gotoPreview(page);

    await page.getByTestId('newsletter-composer-palette-item-sponsored_ad').click();
    await expect(page.getByTestId('newsletter-composer-block-sponsored_ad')).toBeVisible({ timeout: ELEMENT_TIMEOUT });

    await page.getByTestId('newsletter-composer-remove-sponsored_ad').click();

    await expect(page.getByTestId('newsletter-composer-block-sponsored_ad')).toHaveCount(0);
    await expect(page.getByTestId('newsletter-composer-canvas-empty')).toBeVisible();
  });
});
