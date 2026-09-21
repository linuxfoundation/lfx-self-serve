// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { PLATFORM_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { MenuComponent } from '@components/menu/menu.component';
import {
  createFormationAllAvailableActions,
  FORMATION_CHECKLIST_GRID_CLASSES,
  FORMATION_GATING_ICON_TOOLTIP,
  FORMATION_ITEM_AUDIENCE_TOOLTIPS,
  FORMATION_ITEM_SEGMENT_COLORS,
} from '@lfx-one/shared/constants';
import { FormationItem, FormationKnownAvailableAction, FormationRowReasonedStatusChange, FormationRowStatusChange } from '@lfx-one/shared/interfaces';
import { toLocalDateOnlyString } from '@lfx-one/shared/utils';
import { MessageService } from 'primeng/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FormationChecklistRowComponent } from './formation-checklist-row.component';

function buildItem(overrides: Partial<FormationItem>): FormationItem {
  return {
    uid: 'formation-item:test',
    formation_uid: 'formation:test',
    project_uid: 'project:test',
    template_item_key: 'test-item',
    section_key: 'legal',
    section_title: 'Legal and entity',
    title: 'Test item',
    status: 'not_started',
    is_gating: false,
    owner_team: null,
    audience: null,
    owner: null,
    due_date: null,
    action: 'manual',
    action_href: null,
    detail: null,
    notes: null,
    evidence_link: null,
    sub_items: [],
    skip_reason: null,
    available_actions: createFormationAllAvailableActions(),
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    version: 1,
    ...overrides,
  };
}

describe('FormationChecklistRowComponent', () => {
  let fixture: ComponentFixture<FormationChecklistRowComponent>;

  // `canSetStatus` defaults to `canWrite` here purely for fixture brevity — in production the two
  // are independent BFF flags (GH-2705: can_set_status = can_write ∧ team:formation membership) and
  // the dedicated canSetStatus tests below set them apart.
  const render = async (item: FormationItem, readOnly = false, canWrite = true, canSetStatus = canWrite): Promise<void> => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [FormationChecklistRowComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        // p-menu (opened by the status-gate tests below) uses synthetic animations; without a noop
        // animations provider every overlay open throws NG05105 before any assertion runs.
        provideNoopAnimations(),
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FormationChecklistRowComponent);
    fixture.componentRef.setInput('item', item);
    fixture.componentRef.setInput('readOnly', readOnly);
    fixture.componentRef.setInput('canWrite', canWrite);
    fixture.componentRef.setInput('canSetStatus', canSetStatus);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  /** `[attr.data-testid]` on `<lfx-button>` lands on the host custom element, not the inner `<a>` — query into it for the real anchor so `href`/`target`/`rel` assertions see PrimeNG's rendered attributes and `.click()` fires the anchor's own listener. */
  const openLink = (): HTMLAnchorElement | null =>
    fixture.nativeElement.querySelector(
      `[data-testid="formation-checklist-row-link-${fixture.componentInstance.item().uid}"] a, [data-testid="formation-checklist-row-status-only-${fixture.componentInstance.item().uid}"] a`
    );
  /** No `href`/`routerLink` bound, so `ButtonComponent` renders a plain `<button>` (PrimeNG `p-button`), not an `<a>`. */
  const viewDetailsButton = (): HTMLButtonElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="formation-checklist-row-manual-${fixture.componentInstance.item().uid}"] button`);
  const fullText = (): string => fixture.nativeElement.textContent;

  const openStatusMenu = async (uid: string): Promise<void> => {
    (fixture.nativeElement.querySelector(`[data-testid="formation-checklist-row-status-trigger-${uid}"]`) as HTMLElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  // PrimeNG renders each offered item into the body-appended overlay as
  // `<li role="menuitem" aria-label="<label>" aria-disabled="true|false">`.
  const statusMenuItem = (label: string): HTMLLIElement | null => document.body.querySelector(`li[role="menuitem"][aria-label="${label}"]`);

  beforeEach(() => {
    // no shared state between tests; each `render` builds a fresh TestBed
  });

  // The status/overflow menus are PrimeNG overlays appended to document.body — without teardown a
  // menu opened by one test survives into the next (same pattern as formation-item-drawer's spec).
  afterEach(() => {
    fixture?.destroy();
    document.body.innerHTML = '';
  });

  it('renders "Open" for a status_only row with a valid absolute action_href', async () => {
    await render(buildItem({ uid: 'domain-dns', action: 'status_only', action_href: 'https://dns.example.com/status' }));

    const link = openLink();
    expect(link).not.toBeNull();
    expect(link?.textContent).toContain('Open');
    expect(viewDetailsButton()).toBeNull();
  });

  it('renders "View details" (not a disabled Open) for a status_only row with no action_href', async () => {
    await render(buildItem({ uid: 'chat-workspace', action: 'status_only', action_href: null }));

    expect(openLink()).toBeNull();
    const button = viewDetailsButton();
    expect(button).not.toBeNull();
    expect(button?.textContent).toContain('View details');
    expect(fullText()).not.toContain('Link unavailable');
  });

  // GH-2571: `viewDetailsAction` is one shared template rendered for five different call sites — with
  // 17 seeded items, an unlabeled "View details" button announces the same string 17 times. The fix
  // must use `[ariaLabel]` (ButtonComponent's real `@Input`, threaded to the inner `<button>` PrimeNG
  // renders), not `[attr.aria-label]`, which would only reach `<lfx-button>`'s own outer host tag.
  it('gives the "View details" fallback an item-specific accessible name', async () => {
    await render(buildItem({ uid: 'chat-workspace', action: 'status_only', action_href: null, title: 'Set up chat workspace' }));

    expect(viewDetailsButton()?.getAttribute('aria-label')).toBe('View details for Set up chat workspace');
  });

  it('emits openDrawer when "View details" is clicked', async () => {
    const item = buildItem({ uid: 'chat-workspace', action: 'status_only', action_href: null });
    await render(item);

    let emitted: FormationItem | undefined;
    fixture.componentInstance.openDrawer.subscribe((value) => (emitted = value));

    viewDetailsButton()?.click();
    fixture.detectChanges();

    expect(emitted).toEqual(item);
  });

  it('renders "View details" (not a disabled Open) for a link row with no action_href', async () => {
    await render(buildItem({ uid: 'contribution-agreement', action: 'link', action_href: null }));

    expect(openLink()).toBeNull();
    expect(viewDetailsButton()).not.toBeNull();
    expect(fullText()).not.toContain('Link unavailable');
  });

  it('renders a relative in-app action_href as an in-app link via routerLink, not an external anchor', async () => {
    await render(buildItem({ uid: 'committee-link', action: 'link', action_href: '/project/abc/committees/new' }));

    const link = openLink();
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('/project/abc/committees/new');
    expect(link?.getAttribute('target')).not.toBe('_blank');
    expect(link?.getAttribute('rel')).not.toBe('noopener noreferrer');
  });

  it('still opens a valid absolute action_href externally with target=_blank rel=noopener noreferrer', async () => {
    await render(buildItem({ uid: 'link-row', action: 'link', action_href: 'https://docusign.example.com/agreement' }));

    const link = openLink();
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('https://docusign.example.com/agreement');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('never renders "Link unavailable" for any action/href combination', async () => {
    for (const item of [
      buildItem({ uid: 'a', action: 'status_only', action_href: null }),
      buildItem({ uid: 'b', action: 'link', action_href: null }),
      buildItem({ uid: 'c', action: 'manual', action_href: null }),
    ]) {
      await render(item);
      expect(fullText()).not.toContain('Link unavailable');
    }
  });

  // GH-2442: `provisionable`/`request` had no fallback when not actionable, so every such row was a
  // dead cell in production (100% of items are `not_started` today). `viewDetailsAction` is the
  // shared "nothing to open, but there's still detail" affordance every other action kind already falls
  // back to.
  it('renders "View details" (not nothing) for a not-actionable (not_started) provisionable item', async () => {
    await render(buildItem({ uid: 'not-started-provisionable', status: 'not_started', action: 'provisionable' }));

    expect(fixture.nativeElement.querySelector('[data-testid="formation-checklist-row-provision-not-started-provisionable"]')).toBeNull();
    expect(viewDetailsButton()).not.toBeNull();
  });

  it('renders "View details" (not nothing) for a not-actionable (not_started) request item', async () => {
    await render(buildItem({ uid: 'not-started-request', status: 'not_started', action: 'request' }));

    expect(fixture.nativeElement.querySelector('[data-testid="formation-checklist-row-request-not-started-request"]')).toBeNull();
    expect(viewDetailsButton()).not.toBeNull();
  });

  it('renders and fires the gated action button for an in_progress provisionable item', async () => {
    const item = buildItem({ uid: 'in-progress-provisionable', status: 'in_progress', action: 'provisionable' });
    await render(item);

    const button = fixture.nativeElement.querySelector('[data-testid="formation-checklist-row-provision-in-progress-provisionable"] button');
    expect(button).not.toBeNull();
    expect(viewDetailsButton()).toBeNull();

    let emitted: FormationItem | undefined;
    fixture.componentInstance.actionTriggered.subscribe((value) => (emitted = value));
    button?.click();
    fixture.detectChanges();

    expect(emitted).toEqual(item);
  });

  it('renders a disabled gated button when the matching available_actions entry is absent (GH-2576)', async () => {
    await render(buildItem({ uid: 'no-access-request', status: 'in_progress', action: 'request', available_actions: [] }));

    const button = fixture.nativeElement.querySelector('[data-testid="formation-checklist-row-request-no-access-request"] button');
    expect(button?.disabled).toBe(true);
  });

  // GH-2576 Phase 2: a gating item's completion access (as opposed to its current STATE, gated above)
  // is enforced by the API gateway (writer_guard + team:formation membership on POST .../status).
  // Since GH-2705 the caller half is predicted client-side via canSetStatus (controls are hidden,
  // not annotated), so this component still never renders caller-standing explanation text — the
  // retired gate_writer copy must not resurface.
  it('never renders a caller-standing explanation for the gated action button', async () => {
    await render(buildItem({ uid: 'no-access-request-2', status: 'in_progress', action: 'request' }));

    expect(fullText()).not.toContain('Requires gate_writer access');
  });

  // GH-2576 (Copilot review, PR #2596): every status-menu item's disabled state derives from the
  // item's `available_actions`, but only the gated action button had coverage — a regression that
  // dropped `disabled:` from any of these four menu items passed the suite. Each case opens the real
  // menu overlay (via the status chip's own trigger) with the gating action published vs absent and
  // asserts the item's `aria-disabled`.
  describe('status menu action gates (GH-2576)', () => {
    const statusMenuGateCases: { status: FormationItem['status']; label: string; action: FormationKnownAvailableAction }[] = [
      { status: 'not_started', label: 'Mark in progress', action: 'mark_in_progress' },
      { status: 'in_progress', label: 'Mark done', action: 'mark_done' },
      { status: 'in_progress', label: 'Mark blocked…', action: 'mark_blocked' },
      { status: 'skipped', label: 'Back to not started', action: 'back_to_not_started' },
    ];

    it.each(statusMenuGateCases)('offers "$label" ($status) enabled when its action is published', async ({ status, label }) => {
      const uid = `menu-gate-on-${status}`;
      await render(buildItem({ uid, status }));
      await openStatusMenu(uid);

      const menuItem = statusMenuItem(label);
      expect(menuItem).not.toBeNull();
      expect(menuItem?.getAttribute('aria-disabled')).toBe('false');
    });

    it.each(statusMenuGateCases)('offers "$label" ($status) disabled when its action is absent from available_actions', async ({ status, label, action }) => {
      const uid = `menu-gate-off-${status}`;
      await render(buildItem({ uid, status, available_actions: createFormationAllAvailableActions().filter((entry) => entry.action !== action) }));
      await openStatusMenu(uid);

      const menuItem = statusMenuItem(label);
      expect(menuItem).not.toBeNull();
      expect(menuItem?.getAttribute('aria-disabled')).toBe('true');
    });
  });

  // Copilot review, PR #2613: the menu is built from `available_actions`, not a hard-coded
  // source-status graph — v0.1.4 advertises not_started→done/blocked, blocked→done/not_started, and
  // done→not_started, none of which the old graph ever offered. Pin the newly reachable transitions
  // (enabled with their flags published) and the reason routing off them.
  describe('status menu transition coverage (Copilot review, PR #2613)', () => {
    const newlyReachableCases: { status: FormationItem['status']; label: string }[] = [
      { status: 'not_started', label: 'Mark done' },
      { status: 'not_started', label: 'Mark blocked…' },
      { status: 'blocked', label: 'Mark done' },
      { status: 'blocked', label: 'Back to not started' },
      { status: 'done', label: 'Mark blocked…' },
      { status: 'done', label: 'Back to not started' },
    ];

    it.each(newlyReachableCases)('offers "$label" from $status, enabled when its action is published', async ({ status, label }) => {
      const uid = `menu-reachable-${status}`;
      await render(buildItem({ uid, status }));
      await openStatusMenu(uid);

      const menuItem = statusMenuItem(label);
      expect(menuItem).not.toBeNull();
      expect(menuItem?.getAttribute('aria-disabled')).toBe('false');
    });

    it("never lists the current status's own target — upstream never advertises a self-transition, so it would sit permanently disabled", async () => {
      for (const { status, selfLabel } of [
        { status: 'not_started', selfLabel: 'Back to not started' },
        { status: 'in_progress', selfLabel: 'Mark in progress' },
        { status: 'blocked', selfLabel: 'Mark blocked…' },
        { status: 'done', selfLabel: 'Mark done' },
      ] as { status: FormationItem['status']; selfLabel: string }[]) {
        const uid = `menu-self-${status}`;
        await render(buildItem({ uid, status }));
        await openStatusMenu(uid);

        expect(statusMenuItem(selfLabel)).toBeNull();
      }
    });

    it('routes "Mark blocked…" from not_started through reasonedStatusRequested (reason required), not statusChanged', async () => {
      const item = buildItem({ uid: 'route-blocked', status: 'not_started' });
      await render(item);

      let reasoned: FormationRowReasonedStatusChange | undefined;
      let direct: FormationRowStatusChange | undefined;
      fixture.componentInstance.reasonedStatusRequested.subscribe((value) => (reasoned = value));
      fixture.componentInstance.statusChanged.subscribe((value) => (direct = value));

      await openStatusMenu(item.uid);
      (statusMenuItem('Mark blocked…')?.querySelector('a') as HTMLElement | null)?.click();
      fixture.detectChanges();

      expect(reasoned).toEqual({ item, status: 'blocked' });
      expect(direct).toBeUndefined();
    });

    it('emits statusChanged directly for "Mark done" from not_started (no reason required)', async () => {
      const item = buildItem({ uid: 'route-done', status: 'not_started' });
      await render(item);

      let reasoned: FormationRowReasonedStatusChange | undefined;
      let direct: FormationRowStatusChange | undefined;
      fixture.componentInstance.reasonedStatusRequested.subscribe((value) => (reasoned = value));
      fixture.componentInstance.statusChanged.subscribe((value) => (direct = value));

      await openStatusMenu(item.uid);
      (statusMenuItem('Mark done')?.querySelector('a') as HTMLElement | null)?.click();
      fixture.detectChanges();

      expect(direct).toEqual({ item, status: 'done' });
      expect(reasoned).toBeUndefined();
    });
  });

  // GH-2328: readOnly suppresses every mutation surface at the row (status menu, overflow menu,
  // gated action button) while leaving navigation — the external-link/"View details" affordance and
  // the drawer-open title button — untouched.
  describe('readOnly (GH-2328)', () => {
    const statusTrigger = (uid: string): HTMLElement | null =>
      fixture.nativeElement.querySelector(`[data-testid="formation-checklist-row-status-trigger-${uid}"]`);
    const overflowButton = (uid: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="formation-checklist-row-overflow-${uid}"]`);

    it('renders the status chip as a plain non-interactive tag, not a menu trigger button', async () => {
      const item = buildItem({ uid: 'ro-status', status: 'in_progress', action: 'manual' });
      await render(item, true);

      expect(statusTrigger('ro-status')?.tagName).not.toBe('BUTTON');
      expect(fixture.nativeElement.querySelector('[data-testid="formation-checklist-row-status-trigger-ro-status"] button')).toBeNull();
    });

    it('hides the overflow menu button', async () => {
      const item = buildItem({ uid: 'ro-overflow', status: 'in_progress', action: 'manual' });
      await render(item, true);

      expect(overflowButton('ro-overflow')).toBeNull();
    });

    it('renders the View details fallback (not the gated action button) for a provisionable item when readOnly, even though it would be actionable when live', async () => {
      const item = buildItem({ uid: 'ro-provisionable', status: 'in_progress', action: 'provisionable' });

      await render(item, false);
      expect(fixture.nativeElement.querySelector('[data-testid="formation-checklist-row-provision-ro-provisionable"]')).not.toBeNull();

      await render(item, true);
      expect(fixture.nativeElement.querySelector('[data-testid="formation-checklist-row-provision-ro-provisionable"]')).toBeNull();
      expect(viewDetailsButton()).not.toBeNull();
    });

    it('still renders the external-link affordance and the title button that opens the drawer', async () => {
      const item = buildItem({ uid: 'ro-link', action: 'link', action_href: 'https://docusign.example.com/agreement' });
      await render(item, true);

      const link = openLink();
      expect(link).not.toBeNull();
      expect(link?.getAttribute('href')).toBe('https://docusign.example.com/agreement');

      let emitted: FormationItem | undefined;
      fixture.componentInstance.openDrawer.subscribe((value) => (emitted = value));
      fixture.nativeElement.querySelector(`[data-testid="formation-checklist-row-title-${item.uid}"]`)?.click();
      fixture.detectChanges();
      expect(emitted).toEqual(item);
    });

    it('still renders "View details" for a manual item', async () => {
      const item = buildItem({ uid: 'ro-manual', action: 'manual' });
      await render(item, true);

      expect(viewDetailsButton()).not.toBeNull();
    });
  });

  // GH-2694: a non-writer caller gets the same mutation-surface suppression readOnly provides —
  // the status menu, overflow menu, and gated quick action all ride writer-gated upstream routes
  // that can only 403 for them — while navigation (links, View details, drawer open) stays. This
  // was the row half of the "writer-gated controls offered to every caller" defect; the drawer half
  // is gated via its own canWrite input.
  describe('canWrite (GH-2694)', () => {
    it('renders the status chip as a plain non-interactive tag for a non-writer', async () => {
      const item = buildItem({ uid: 'cw-status', status: 'in_progress', action: 'manual' });
      await render(item, false, false);

      expect(fixture.nativeElement.querySelector('[data-testid="formation-checklist-row-status-trigger-cw-status"] button')).toBeNull();
    });

    it('hides the overflow menu button for a non-writer', async () => {
      const item = buildItem({ uid: 'cw-overflow', status: 'in_progress', action: 'manual' });
      await render(item, false, false);

      expect(fixture.nativeElement.querySelector('[data-testid="formation-checklist-row-overflow-cw-overflow"]')).toBeNull();
    });

    it('renders the View details fallback (not the gated action button) for a provisionable item', async () => {
      const item = buildItem({ uid: 'cw-provisionable', status: 'in_progress', action: 'provisionable' });

      await render(item, false, true);
      expect(fixture.nativeElement.querySelector('[data-testid="formation-checklist-row-provision-cw-provisionable"]')).not.toBeNull();

      await render(item, false, false);
      expect(fixture.nativeElement.querySelector('[data-testid="formation-checklist-row-provision-cw-provisionable"]')).toBeNull();
      expect(viewDetailsButton()).not.toBeNull();
    });

    it('still renders the title button that opens the drawer — notes stay auditor-editable there', async () => {
      const item = buildItem({ uid: 'cw-title', action: 'manual' });
      await render(item, false, false);

      let emitted: FormationItem | undefined;
      fixture.componentInstance.openDrawer.subscribe((value) => (emitted = value));
      fixture.nativeElement.querySelector(`[data-testid="formation-checklist-row-title-${item.uid}"]`)?.click();
      fixture.detectChanges();
      expect(emitted).toEqual(item);
    });
  });

  // GH-2705: the gateway's set_item_status rule ANDs writer_guard with `member` on `team:formation`,
  // so the writer half (canWrite) alone must not offer status-moving controls — that was the shipped
  // defect: a writer outside the formation team got a status dropdown whose every write 403'd as
  // "Could not change this item's status." Status controls gate on canSetStatus; Assign/Set due date
  // stay writer-gated (their /assignment route checks writer_guard alone).
  describe('canSetStatus (GH-2705)', () => {
    it('renders the status chip as a plain non-interactive tag for a writer who is not on the formation team', async () => {
      const item = buildItem({ uid: 'css-status', status: 'in_progress', action: 'manual' });
      await render(item, false, true, false);

      expect(fixture.nativeElement.querySelector('[data-testid="formation-checklist-row-status-trigger-css-status"] button')).toBeNull();
    });

    it('renders the View details fallback (not the gated quick action) for a provisionable item without status standing', async () => {
      const item = buildItem({ uid: 'css-provisionable', status: 'in_progress', action: 'provisionable' });
      await render(item, false, true, false);

      expect(fixture.nativeElement.querySelector('[data-testid="formation-checklist-row-provision-css-provisionable"]')).toBeNull();
      expect(viewDetailsButton()).not.toBeNull();
    });

    it('keeps the overflow menu for a writer without status standing but omits the Skip entry', async () => {
      const item = buildItem({ uid: 'css-overflow', status: 'in_progress', action: 'manual' });
      await render(item, false, true, false);

      const trigger = fixture.nativeElement.querySelector('[data-testid="formation-checklist-row-overflow-css-overflow"] button') as HTMLElement | null;
      expect(trigger).not.toBeNull();
      trigger?.click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(document.body.querySelector('li[role="menuitem"][aria-label="Assign"]')).not.toBeNull();
      expect(document.body.querySelector('li[role="menuitem"][aria-label="Set due date"]')).not.toBeNull();
      expect(document.body.querySelector('li[role="menuitem"][aria-label="Skip with reason"]')).toBeNull();
    });
  });

  // GH-2571: the status chip and overflow buttons open menus without declaring them — a screen
  // reader announced plain buttons with no popup indication, and no open/closed state once one did
  // appear. `aria-expanded` must be bound to the menu's actual state, not hardcoded, since a static
  // `false` is worse than none (it asserts something false once the menu opens).
  describe('menu trigger accessibility (GH-2571)', () => {
    const statusTriggerButton = (uid: string): HTMLElement | null =>
      fixture.nativeElement.querySelector(`[data-testid="formation-checklist-row-status-trigger-${uid}"]`);
    const overflowButton = (uid: string): HTMLElement | null =>
      fixture.nativeElement.querySelector(`[data-testid="formation-checklist-row-overflow-${uid}"] button`);
    const statusMenu = (): MenuComponent => fixture.debugElement.queryAll(By.directive(MenuComponent))[0].componentInstance as MenuComponent;
    const overflowMenu = (): MenuComponent => fixture.debugElement.queryAll(By.directive(MenuComponent))[1].componentInstance as MenuComponent;

    it('declares the status trigger as a menu popup and toggles aria-expanded with the menu', async () => {
      const item = buildItem({ uid: 'status-popup', status: 'in_progress' });
      await render(item);

      const trigger = statusTriggerButton('status-popup');
      expect(trigger?.getAttribute('aria-haspopup')).toBe('menu');
      expect(trigger?.getAttribute('aria-expanded')).toBe('false');

      statusMenu().onShow.emit(new Event('show'));
      fixture.detectChanges();
      expect(statusTriggerButton('status-popup')?.getAttribute('aria-expanded')).toBe('true');

      statusMenu().onHide.emit(new Event('hide'));
      fixture.detectChanges();
      expect(statusTriggerButton('status-popup')?.getAttribute('aria-expanded')).toBe('false');
    });

    it('declares the overflow trigger as a menu popup and toggles aria-expanded with the menu', async () => {
      const item = buildItem({ uid: 'overflow-popup' });
      await render(item);

      const trigger = overflowButton('overflow-popup');
      expect(trigger?.getAttribute('aria-haspopup')).toBe('menu');
      expect(trigger?.getAttribute('aria-expanded')).toBe('false');

      overflowMenu().onShow.emit(new Event('show'));
      fixture.detectChanges();
      expect(overflowButton('overflow-popup')?.getAttribute('aria-expanded')).toBe('true');

      overflowMenu().onHide.emit(new Event('hide'));
      fixture.detectChanges();
      expect(overflowButton('overflow-popup')?.getAttribute('aria-expanded')).toBe('false');
    });
  });

  // GH-2440: the row's three-column single-row layout crushed the title column at phone width. This
  // asserts the responsive classes stay in place rather than the visual result (JSDOM doesn't evaluate
  // real breakpoint media queries) — a manual check at 390/360/320px is the actual regression guard.
  // #2689 moved the stack breakpoint sm: → md:: the assignee/due-date meta columns re-created the
  // same crush between 640–768px with a side-by-side layout.
  describe('responsive layout (GH-2440, #2774)', () => {
    // #2774 wrapped the row in a column container (main row + sub-item panel) and switched the
    // tiers from viewport breakpoints to container queries on the section panel: stacked below
    // @2xl, the compact grid from @2xl, the full column grid (shared with the header captions) from
    // @5xl. JSDOM evaluates neither, so this pins the classes; a manual pass is the visual guard.
    it('stacks the main row by default and carries the compact and full grid templates', async () => {
      const item = buildItem({ uid: 'responsive-row' });
      await render(item);

      const mainRow = fixture.nativeElement.querySelector('[data-testid="formation-checklist-row-main-responsive-row"]');
      expect(mainRow?.className).toContain('flex-col');
      expect(mainRow?.className).toContain('@2xl:grid');
      expect(mainRow?.classList.contains(FORMATION_CHECKLIST_GRID_CLASSES.compact)).toBe(true);
      expect(mainRow?.classList.contains(FORMATION_CHECKLIST_GRID_CLASSES.full)).toBe(true);
      expect(fixture.nativeElement.querySelector('[data-testid="formation-checklist-row-responsive-row"]')?.contains(mainRow)).toBe(true);
    });
  });

  describe('row metadata (#2689)', () => {
    const byTestId = (name: string): HTMLElement | null =>
      fixture.nativeElement.querySelector(`[data-testid="formation-checklist-row-${name}-${fixture.componentInstance.item().uid}"]`);

    // #2774: the audience is one keyboard-reachable globe icon for the external-involving audiences,
    // with the description as its tooltip and accessible name; the full label lives in the drawer.
    it('renders the globe icon with the external description for an external audience', async () => {
      await render(buildItem({ uid: 'audience-external', audience: 'external' }));

      const icon = byTestId('audience-chip');
      expect(icon?.querySelector('i.fa-globe')).not.toBeNull();
      expect(icon?.getAttribute('aria-label')).toBe(FORMATION_ITEM_AUDIENCE_TOOLTIPS.external);
      expect(icon?.getAttribute('role')).toBe('img');
      expect(icon?.getAttribute('tabindex')).toBe('0');
      expect(icon?.querySelector('.p-component')).toBeNull();
    });

    it('renders the globe icon with the internal-and-external description for a both audience — no label text on the row', async () => {
      await render(buildItem({ uid: 'audience-both', audience: 'both' }));

      expect(byTestId('audience-chip')?.getAttribute('aria-label')).toBe(FORMATION_ITEM_AUDIENCE_TOOLTIPS.both);
      expect(fullText()).not.toContain('Internal + External');
    });

    it('renders no audience icon for an internal audience', async () => {
      await render(buildItem({ uid: 'audience-internal', audience: 'internal' }));

      expect(byTestId('audience-chip')).toBeNull();
    });

    it('renders no audience icon when audience is null', async () => {
      await render(buildItem({ uid: 'audience-null', audience: null }));

      expect(byTestId('audience-chip')).toBeNull();
    });

    it('humanizes the owner-team cell through the curated label map', async () => {
      await render(buildItem({ uid: 'owner-curated', owner_team: 'brand_counsel' }));

      expect(byTestId('owner-chip')?.textContent).toContain('Brand Counsel');
      expect(byTestId('owner-chip')?.textContent).toContain('Team:');
      expect(fullText()).not.toContain('brand_counsel');
    });

    it('cases the acronym owner team as IT, not It', async () => {
      await render(buildItem({ uid: 'owner-acronym', owner_team: 'it' }));

      expect(byTestId('owner-chip')?.textContent).toContain('IT');
    });

    // The full tier's fixed team track truncates an upstream-controlled label, so — like the assignee
    // name — the label is a focusable tooltip host that exposes the full string to keyboard users.
    it('keeps the team label keyboard-reachable via a focusable tooltip host', async () => {
      await render(buildItem({ uid: 'owner-tooltip', owner_team: 'legal_review' }));

      const label = byTestId('owner-chip')?.querySelector('span[tabindex="0"]');
      expect(label?.textContent).toContain('Legal Review');
      expect(label?.querySelector('.p-component')).toBeNull();
    });

    // #2774: the team is a fixed column now, so an unset team still renders its placeholder cell
    // (mirroring the assignee/due-date cells) rather than dropping the column.
    it('renders an em-dash placeholder cell when there is no owner team', async () => {
      await render(buildItem({ uid: 'owner-null', owner_team: null }));

      expect(byTestId('owner-chip')?.textContent).toContain('—');
      expect(byTestId('owner-chip')?.textContent).toContain('No team');
    });

    // Username-shaped on purpose: production's mapper sets name === assignee username (no
    // display-name resolution exists), so this is what the cell actually shows (#2689 review).
    it('renders the assignee name with an sr-only field prefix', async () => {
      await render(buildItem({ uid: 'assignee-set', owner: { username: 'jdoe', name: 'jdoe' } }));

      expect(byTestId('assignee')?.textContent).toContain('jdoe');
      // PR #2692 review: the populated branch must name its column for screen readers, mirroring
      // the empty branch's "No assignee".
      expect(byTestId('assignee')?.textContent).toContain('Assignee:');
    });

    it('renders an em-dash placeholder when there is no assignee', async () => {
      await render(buildItem({ uid: 'assignee-null', owner: null }));

      expect(byTestId('assignee')?.textContent).toContain('—');
      expect(byTestId('assignee')?.textContent).toContain('No assignee');
    });

    it('renders the due date as a short absolute date with an sr-only field prefix', async () => {
      await render(buildItem({ uid: 'due-set', due_date: '2030-03-31' }));

      expect(byTestId('due-date')?.textContent).toContain('Mar 31, 2030');
      expect(byTestId('due-date')?.textContent).toContain('Due date:');
    });

    it('renders an em-dash placeholder when there is no due date', async () => {
      await render(buildItem({ uid: 'due-null', due_date: null }));

      expect(byTestId('due-date')?.textContent).toContain('—');
      expect(byTestId('due-date')?.textContent).toContain('No due date');
    });

    // PR #2692 review: a native hover-only title is unreachable for keyboard/touch users, so the
    // truncating span is a focusable pTooltip host instead. The distinct name/username pair also
    // pins that the component binds owner.name, not owner.username.
    it('keeps the truncated assignee name keyboard-reachable via a focusable tooltip host', async () => {
      await render(buildItem({ uid: 'assignee-title', owner: { username: 'jdoe', name: 'J. Doe' } }));

      const nameSpan = byTestId('assignee')?.querySelector('span[tabindex="0"]');
      expect(nameSpan?.textContent).toContain('J. Doe');
      expect(nameSpan?.getAttribute('title')).toBeNull();
    });
  });

  // #2689 learnings review: due_date is DATE-ONLY, so banding must use the LOCAL calendar day —
  // `new Date('YYYY-MM-DD')` (UTC midnight) plus the poll pipes' legacy-LA timezone fallback fired
  // the urgency color a day early for most viewers and never on the actual due date.
  describe('due-date urgency color (#2689)', () => {
    const localDateOnly = (daysFromToday: number): string => {
      const now = new Date();
      return toLocalDateOnlyString(new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysFromToday));
    };
    const dueDateSpan = (): HTMLElement | null =>
      fixture.nativeElement.querySelector(`[data-testid="formation-checklist-row-due-date-${fixture.componentInstance.item().uid}"] span`);

    it('colors a due-today date red', async () => {
      await render(buildItem({ uid: 'due-today', due_date: localDateOnly(0) }));

      expect(dueDateSpan()?.className).toContain('text-red-600');
    });

    it('colors a due-tomorrow date amber', async () => {
      await render(buildItem({ uid: 'due-tomorrow', due_date: localDateOnly(1) }));

      expect(dueDateSpan()?.className).toContain('text-amber-600');
    });

    it('colors a far-future date neutral gray', async () => {
      await render(buildItem({ uid: 'due-future', due_date: localDateOnly(30) }));

      expect(dueDateSpan()?.className).toContain('text-gray-500');
    });

    it('colors a past-due date neutral gray — deliberate parity with votes/surveys', async () => {
      await render(buildItem({ uid: 'due-past', due_date: localDateOnly(-3) }));

      expect(dueDateSpan()?.className).toContain('text-gray-500');
    });

    // PR #2692 review: the server never learns the viewer's local day, so SSR must render the
    // deterministic neutral band even for a due-today item — the browser corrects it after
    // hydration (localDayStart is set only in the constructor's isPlatformBrowser branch).
    it('renders the neutral band on the server, even for a due-today item', async () => {
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [FormationChecklistRowComponent],
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          provideRouter([]),
          provideNoopAnimations(),
          { provide: MessageService, useValue: { add: vi.fn() } },
          { provide: PLATFORM_ID, useValue: 'server' },
        ],
      }).compileComponents();
      fixture = TestBed.createComponent(FormationChecklistRowComponent);
      fixture.componentRef.setInput('item', buildItem({ uid: 'due-ssr', due_date: localDateOnly(0) }));
      fixture.componentRef.setInput('readOnly', false);
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(dueDateSpan()?.className).toContain('text-gray-500');
      expect(dueDateSpan()?.className).not.toContain('text-red-600');
    });
  });

  describe('gating indicator (#2689, #2774)', () => {
    const gatingIcon = (uid: string): HTMLElement | null =>
      fixture.nativeElement.querySelector(`[data-testid="formation-checklist-row-gates-active-chip-${uid}"]`);

    it('renders a solid red asterisk whose accessible name is the shared tooltip copy — no row-level "Required for Active" text', async () => {
      await render(buildItem({ uid: 'gating-row', is_gating: true }));

      const icon = gatingIcon('gating-row');
      expect(icon).not.toBeNull();
      // #2774: the form-field "required" convention — a text asterisk, not a FontAwesome glyph.
      expect(icon?.textContent?.trim()).toBe('*');
      expect(icon?.querySelector('i')).toBeNull();
      expect(icon?.className).toContain('text-red-500');
      expect(icon?.getAttribute('role')).toBe('img');
      expect(icon?.getAttribute('tabindex')).toBe('0');
      expect(icon?.getAttribute('aria-label')).toBe(FORMATION_GATING_ICON_TOOLTIP);
      // aria-label is an attribute, not text content: the full wording lives in the drawer and the strip legend.
      expect(fullText()).not.toContain('Required for Active');
    });

    it('renders no gating indicator on a non-gating row', async () => {
      await render(buildItem({ uid: 'non-gating-row', is_gating: false }));

      expect(gatingIcon('non-gating-row')).toBeNull();
    });
  });

  // #2774: sub-items surface as a disclosure — a "N of M sub-items" trigger with a mini per-status
  // bar, expanding an inline read-only list inside the row's own wrapper.
  describe('sub-items disclosure (#2774)', () => {
    const byTestId = (name: string): HTMLElement | null =>
      fixture.nativeElement.querySelector(`[data-testid="formation-checklist-row-${name}-${fixture.componentInstance.item().uid}"]`);
    const withSubItems = (uid: string): FormationItem =>
      buildItem({
        uid,
        sub_items: [
          { uid: 'sub_a', title: 'Create workspace', status: 'done' },
          { uid: 'sub_b', title: 'Configure channels', status: 'in_progress' },
          { uid: 'sub_c', title: 'Onboard admins', status: 'not_started' },
        ],
      });

    it('renders no trigger, bar or panel for an item without sub-items', async () => {
      await render(buildItem({ uid: 'no-subs', sub_items: [] }));

      expect(byTestId('sub-items')).toBeNull();
      expect(byTestId('sub-items-bar')).toBeNull();
      expect(byTestId('sub-items-panel')).toBeNull();
    });

    it('renders a collapsed trigger with the done count and a mini bar with one segment per sub-item', async () => {
      await render(withSubItems('subs-collapsed'));

      const trigger = byTestId('sub-items');
      expect(trigger?.textContent).toContain('1 of 3 sub-items');
      expect(trigger?.getAttribute('aria-expanded')).toBe('false');
      expect(trigger?.getAttribute('aria-controls')).toBeNull();
      expect(byTestId('sub-items-panel')).toBeNull();

      const bar = byTestId('sub-items-bar');
      expect(bar?.getAttribute('role')).toBe('img');
      expect(bar?.getAttribute('aria-label')).toBe('1 of 3 sub-items done');
      const segments = Array.from(bar?.children ?? []) as HTMLElement[];
      expect(segments.map((segment) => segment.className)).toEqual([
        expect.stringContaining(FORMATION_ITEM_SEGMENT_COLORS.done),
        expect.stringContaining(FORMATION_ITEM_SEGMENT_COLORS.in_progress),
        expect.stringContaining(FORMATION_ITEM_SEGMENT_COLORS.not_started),
      ]);
    });

    it('expands an inline list inside the row on click and collapses it again', async () => {
      await render(withSubItems('subs-toggle'));

      (byTestId('sub-items') as HTMLButtonElement).click();
      fixture.detectChanges();

      const trigger = byTestId('sub-items');
      const panel = byTestId('sub-items-panel');
      expect(trigger?.getAttribute('aria-expanded')).toBe('true');
      expect(trigger?.getAttribute('aria-controls')).toBe('formation-checklist-row-sub-items-panel-subs-toggle');
      expect(panel?.id).toBe('formation-checklist-row-sub-items-panel-subs-toggle');
      expect(fixture.nativeElement.querySelector('[data-testid="formation-checklist-row-subs-toggle"]')?.contains(panel)).toBe(true);
      expect(panel?.querySelectorAll('[data-testid^="formation-sub-item-row-"]').length).toBe(3);
      // The trigger already carries the count and bar, so the inline list renders without its own summary.
      expect(panel?.querySelector('[data-testid="formation-sub-item-list-summary"]')).toBeNull();

      (byTestId('sub-items') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(byTestId('sub-items')?.getAttribute('aria-expanded')).toBe('false');
      expect(byTestId('sub-items-panel')).toBeNull();
    });
  });

  describe('status control affordance (#2689)', () => {
    const statusChevron = (uid: string): HTMLElement | null =>
      fixture.nativeElement.querySelector(`[data-testid="formation-checklist-row-status-caret-${uid}"]`);

    it('shows a chevron on the editable status trigger', async () => {
      await render(buildItem({ uid: 'status-editable' }));

      expect(statusChevron('status-editable')).not.toBeNull();
    });

    it('shows no chevron on the read-only status chip', async () => {
      await render(buildItem({ uid: 'status-readonly' }), true);

      expect(statusChevron('status-readonly')).toBeNull();
    });
  });
});
