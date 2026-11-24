// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, Locator, Page } from '@playwright/test';
import { MKTG_POLL_RETRYING_TEXT } from '../../../../packages/shared/src/constants/mktg-run.constants';

/** The longest wait between two automatic checks (the shared 30 s cap) plus a margin for the read and the render. */
export const OUTAGE_AUTO_RETRY_TIMEOUT = 35_000;
/** A wake (reconnect, tab return, focus) re-reads at once: the line must clear within a read and a render. */
export const OUTAGE_WAKE_CLEAR_TIMEOUT = 5_000;
/** The app's `gray-500` and `red-700` as the browser computes them: the status line is grey, a final refusal is red. */
export const OUTAGE_GREY = 'rgb(98, 116, 142)';
export const OUTAGE_RED = 'rgb(193, 0, 7)';
/** The names a re-read control has had on these screens. */
export const OUTAGE_RETRY_CONTROLS = ['Try again', 'Retry', 'Refresh', 'Check again'];

/**
 * A connection failure on the Marketing OS API, switched on and off inside one test.
 * @description While `down`, every request `match` selects fails as a lost connection (status 0 in the app), and the
 * page hears `offline`; `up` lets the test's own stubs answer again and the page hears `online`, the wake that makes
 * the shared poller re-read at once. `upQuietly` restores the stubs without the wake, for the automatic-retry case.
 * Register it AFTER the feature's stubs: Playwright runs the newest route first. The stubs mirror the BFF, so this
 * proves the browser's behaviour, not the server's.
 */
export async function setupOutage(page: Page, match: (url: URL) => boolean = (url) => url.pathname.startsWith('/api/mktg-')) {
  let down = false;
  let failed = 0;
  await page.route(
    (url) => down && match(url),
    (route) => {
      failed++;
      return route.abort('internetdisconnected');
    }
  );
  const signal = (name: 'offline' | 'online') => page.evaluate((event) => window.dispatchEvent(new Event(event)), name);
  return {
    down: async () => {
      down = true;
      await signal('offline');
    },
    up: async () => {
      down = false;
      await signal('online');
    },
    upQuietly: () => {
      down = false;
    },
    /** Requests refused so far: proof the page kept checking by itself. */
    failed: () => failed,
  };
}

/** The one grey line: exact text, polite status role, grey, and no retry control anywhere on the page. */
export async function expectRetryingLine(page: Page, line: Locator): Promise<void> {
  await expect(line).toHaveText(MKTG_POLL_RETRYING_TEXT, { timeout: OUTAGE_AUTO_RETRY_TIMEOUT });
  await expect(line).toHaveRole('status');
  await expect(line).toHaveCSS('color', OUTAGE_GREY);
  await expectNoRetryControl(page);
}

/** A final refusal: one red line with role alert that names what is not available, and no retry control. */
export async function expectFinalLine(page: Page, line: Locator, text: string): Promise<void> {
  await expect(line).toContainText(text);
  await expect(line).toHaveRole('alert');
  await expect(line).toHaveCSS('color', OUTAGE_RED);
  await expect(page.getByText(MKTG_POLL_RETRYING_TEXT)).toHaveCount(0);
  await expectNoRetryControl(page);
}

const marketingPage = (page: Page): Locator => page.locator('lfx-mktg-kit, lfx-mktg-family, lfx-mktg-document-view, lfx-mktg-agent-run');

/** No re-read control: by accessible name on the Marketing OS page, whatever its test id. */
export async function expectNoRetryControl(page: Page): Promise<void> {
  for (const name of OUTAGE_RETRY_CONTROLS) await expect(marketingPage(page).getByRole('button', { name, exact: true })).toHaveCount(0);
}

/** What the browser shows for a line, read from the page itself: the strings that go verbatim into the hand-test brief. */
export async function readLine(page: Page, line: Locator): Promise<{ text: string; role: string | null; color: string; retryControls: number }> {
  let retryControls = 0;
  for (const name of OUTAGE_RETRY_CONTROLS) retryControls += await marketingPage(page).getByRole('button', { name, exact: true }).count();
  return {
    text: (await line.innerText()).trim(),
    role: await line.getAttribute('role'),
    color: await line.evaluate((element) => getComputedStyle(element).color),
    retryControls,
  };
}

/** Milliseconds from the wake to the line being gone. */
export async function clearsAfter(wake: () => Promise<void>, line: Locator, timeout = OUTAGE_WAKE_CLEAR_TIMEOUT): Promise<number> {
  const started = Date.now();
  await wake();
  await expect(line).toHaveCount(0, { timeout });
  return Date.now() - started;
}
