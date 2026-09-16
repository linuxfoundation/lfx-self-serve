// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { MenuComponent } from '@components/menu/menu.component';
import { FORMATION_ALL_AVAILABLE_ACTIONS } from '@lfx-one/shared/constants';
import { FormationItem } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    owner: null,
    due_date: null,
    action: 'manual',
    action_href: null,
    detail: null,
    notes: null,
    evidence_link: null,
    sub_items: [],
    skip_reason: null,
    available_actions: FORMATION_ALL_AVAILABLE_ACTIONS,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    version: 1,
    ...overrides,
  };
}

describe('FormationChecklistRowComponent', () => {
  let fixture: ComponentFixture<FormationChecklistRowComponent>;

  const render = async (item: FormationItem, readOnly = false): Promise<void> => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [FormationChecklistRowComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: MessageService, useValue: { add: vi.fn() } }],
    }).compileComponents();

    fixture = TestBed.createComponent(FormationChecklistRowComponent);
    fixture.componentRef.setInput('item', item);
    fixture.componentRef.setInput('readOnly', readOnly);
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

  beforeEach(() => {
    // no shared state between tests; each `render` builds a fresh TestBed
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

  it('renders a disabled gated button with the gate_writer-access note when the matching available_actions entry is absent', async () => {
    await render(buildItem({ uid: 'no-access-request', status: 'in_progress', action: 'request', available_actions: [] }));

    const button = fixture.nativeElement.querySelector('[data-testid="formation-checklist-row-request-no-access-request"] button');
    expect(button?.disabled).toBe(true);
    expect(fullText()).toContain("This item's current status doesn't allow this action yet");
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
  describe('responsive layout (GH-2440)', () => {
    it('stacks the root below sm: and restores a row at sm: and above', async () => {
      const item = buildItem({ uid: 'responsive-row' });
      await render(item);

      const root = fixture.nativeElement.querySelector('[data-testid="formation-checklist-row-responsive-row"]');
      expect(root?.className).toContain('flex-col');
      expect(root?.className).toContain('sm:flex-row');
    });
  });
});
