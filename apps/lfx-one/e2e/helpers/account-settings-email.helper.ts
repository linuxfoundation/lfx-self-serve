// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Shared mock surface for the Account Settings email-management specs (#1852).
 *
 * The page's email section loads its address list and its meeting-invitation preference
 * as one pair (forkJoin in AccountSettingsComponent), and re-fetches that pair after every
 * successful write. These mocks model that with mutable state so a post-write refetch
 * returns the *new* value — which is what makes the badge-refresh assertions meaningful
 * rather than a check on optimistic rendering.
 */

import { expect, Page, test } from '@playwright/test';

// Synthetic fixtures only — check-fixture-emails.sh blocks real customer/vendor domains.
export const PRIMARY_EMAIL = 'primary.user@example.com';
export const ALTERNATE_EMAIL = 'alt.user@example.com';
// A third row exists so the in-flight guard can be proven on a row other than the one clicked.
export const SECOND_ALTERNATE_EMAIL = 'second.alt@example.com';

// Mirrors MEETING_INVITE_PRIMARY_SENTINEL in @lfx-one/shared/constants. Inlined rather than
// imported because the shared constants barrel transitively pulls Angular runtime code that
// the Playwright Node loader can't compile (same reason as profile-identities-support-link).
export const MEETING_INVITE_PRIMARY_SENTINEL = 'primary';

// Upstream copy for a rejected address, as profile.controller.ts returns it on a 400.
export const INVITE_VALIDATION_MESSAGE =
  'This email is not an active, verified address on your account yet. Choose a different email, or verify it and try again.';

export const DELETE_BLOCKED_BY_INVITE_TITLE = 'This email is set for meeting invitations. Choose a different meeting-invitation email before deleting it.';
export const DELETE_BLOCKED_BY_SAVE_TITLE = 'Updating the meeting-invitation email. Wait for it to finish before deleting an address.';

export const MENU_USE_FOR_INVITES = 'Use for Meeting Invitations';
export const MENU_RESET_TO_PRIMARY = 'Reset to Default (Primary Email)';
export const MENU_MAKE_PRIMARY = 'Make Primary';
export const MENU_DELETE = 'Delete';

export const DATA_LOAD_TIMEOUT = 30_000;
export const ELEMENT_TIMEOUT = 10_000;

const EMAIL_ROUTE_GLOB = '**/api/profile/emails**';

/** Shape of GET/PUT /api/profile/emails/meeting-invite (MeetingInviteEmail). */
export interface InviteState {
  email_id: string | null;
  email: string | null;
}

export const NO_INVITE_OVERRIDE: InviteState = { email_id: null, email: null };

export type PutBehavior = { kind: 'success' } | { kind: 'error'; status: number; message: string };

export interface EmailMockOptions {
  /** Meeting-invitation override the first GET reports. Defaults to none (falls back to primary). */
  initialInvite?: InviteState;
  /** How PUT /emails/meeting-invite responds. Defaults to success. */
  putBehavior?: PutBehavior;
  /** Artificial delay on GET /emails, used to observe the loading state. */
  emailsDelayMs?: number;
}

export interface EmailMocks {
  /** Request bodies recorded from PUT /emails/meeting-invite, in order. */
  putBodies: () => { email: string }[];
  /** How many times GET /emails/meeting-invite has been served. */
  inviteGetCount: () => number;
  /** Suspend the next PUT so the write stays in flight; call the returned fn to complete it. */
  holdPut: () => () => void;
}

function emailListPayload(): Record<string, unknown> {
  return {
    primary_email: PRIMARY_EMAIL,
    alternate_emails: [
      // user_id is what makes canDelete true — without it the Delete item never renders.
      { email: ALTERNATE_EMAIL, verified: true, user_id: 'auth0|alt-user' },
      { email: SECOND_ALTERNATE_EMAIL, verified: true, user_id: 'auth0|second-alt-user' },
    ],
  };
}

/**
 * The exact body BaseApiError.toResponse() emits, so the specs run the branch of
 * extractErrorMessage production runs: errors[].message for the 400 (the endpoint's only 400 is a
 * ServiceValidationError) and the top-level error for anything else. There is no top-level message.
 */
function errorBody(behavior: { status: number; message: string }): Record<string, unknown> {
  const base = { error: behavior.message, service: 'profile_controller', path: '/api/profile/emails/meeting-invite' };
  return behavior.status === 400
    ? { ...base, code: 'VALIDATION_ERROR', errors: [{ field: 'email', message: behavior.message, code: 'FIELD_VALIDATION_ERROR' }] }
    : { ...base, code: 'SERVICE_UNAVAILABLE' };
}

function inviteStateFor(email: string | null): InviteState {
  return email === null ? NO_INVITE_OVERRIDE : { email_id: `email-id-${email}`, email };
}

/**
 * Registers a single handler for the whole /api/profile/emails surface and branches on
 * pathname + method. One handler is deliberate: a second route on `**\/api/profile/emails*`
 * would also swallow `/emails/meeting-invite`, making behavior depend on registration order.
 */
export async function installEmailMocks(page: Page, options: EmailMockOptions = {}): Promise<EmailMocks> {
  let invite: InviteState = options.initialInvite ?? NO_INVITE_OVERRIDE;
  const putBehavior: PutBehavior = options.putBehavior ?? { kind: 'success' };
  const emailsDelayMs = options.emailsDelayMs ?? 0;

  const recordedPutBodies: { email: string }[] = [];
  let inviteGets = 0;
  let putGate: Promise<void> | null = null;

  await page.route(EMAIL_ROUTE_GLOB, async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();

    if (pathname.endsWith('/api/profile/emails') && method === 'GET') {
      if (emailsDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, emailsDelayMs));
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(emailListPayload()) });
    }

    if (pathname.endsWith('/api/profile/emails/meeting-invite')) {
      if (method === 'GET') {
        inviteGets += 1;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(invite) });
      }

      if (method === 'PUT') {
        const body = request.postDataJSON() as { email: string };
        recordedPutBodies.push(body);

        if (putGate) {
          await putGate;
        }

        if (putBehavior.kind === 'error') {
          return route.fulfill({
            status: putBehavior.status,
            contentType: 'application/json',
            body: JSON.stringify(errorBody(putBehavior)),
          });
        }

        const isReset = body.email.trim().toLowerCase() === MEETING_INVITE_PRIMARY_SENTINEL;
        invite = inviteStateFor(isReset ? null : body.email);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(invite) });
      }
    }

    return route.fallback();
  });

  return {
    putBodies: () => recordedPutBodies,
    inviteGetCount: () => inviteGets,
    holdPut: () => {
      let release: () => void = () => undefined;
      putGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => {
        putGate = null;
        release();
      };
    },
  };
}

/**
 * Neutralize the Osano consent overlay, which otherwise intercepts pointer events on the
 * kebab triggers. Registered via addInitScript so it applies before page scripts on every
 * navigation (mirrors profile-identities-support-link / profile-edit-drawer).
 */
export async function suppressCookieBanner(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const hide = (): void => {
      if (document.getElementById('e2e-hide-osano')) {
        return;
      }
      const style = document.createElement('style');
      style.id = 'e2e-hide-osano';
      style.textContent = '.osano-cm-window { display: none !important; pointer-events: none !important; }';
      (document.head ?? document.documentElement).appendChild(style);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', hide);
    } else {
      hide();
    }
  });
}

// Gated on env vars rather than on URL sniffing so genuine auth-flow regressions (expired
// storageState, broken Auth0 login helper) still fail loudly when creds ARE configured —
// URL-based detection silently turned those into green skips instead. Matches the pattern in
// helpers/org-groups.helper.ts.
const AUTH_CREDS_PRESENT = !!process.env['TEST_USERNAME'] && !!process.env['TEST_PASSWORD'];

export function skipWhenAuthMissing(): void {
  if (!AUTH_CREDS_PRESENT) {
    test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
  }
}

/** Install mocks, land on /profile/settings, and wait for the email list to render. */
export async function openEmailSettings(page: Page, options: EmailMockOptions = {}): Promise<EmailMocks> {
  skipWhenAuthMissing();
  await suppressCookieBanner(page);
  const mocks = await installEmailMocks(page, options);
  await page.goto('/profile/settings', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await expect(page.getByTestId('email-list-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  return mocks;
}

export function emailRow(page: Page, email: string) {
  return page.getByTestId(`email-row-${email}`);
}

/**
 * Open a row's kebab menu. The popup is appended to <body>, so menu items are always queried
 * at page level — never scoped to the row element.
 */
export async function openRowMenu(page: Page, email: string): Promise<void> {
  await page.getByTestId(`email-menu-${email}`).locator('button').click();
  await expect(page.getByRole('menu')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
}

/** Close an open kebab popup so the next row's menu can be opened cleanly. */
export async function closeRowMenu(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0, { timeout: ELEMENT_TIMEOUT });
}

export function menuItem(page: Page, label: string) {
  return page.getByRole('menuitem', { name: label, exact: true });
}
