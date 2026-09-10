// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
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
    links: [],
    sub_items: [],
    skip_reason: null,
    can_complete: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    version: 1,
    ...overrides,
  };
}

describe('FormationChecklistRowComponent', () => {
  let fixture: ComponentFixture<FormationChecklistRowComponent>;

  const render = async (item: FormationItem): Promise<void> => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [FormationChecklistRowComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: MessageService, useValue: { add: vi.fn() } }],
    }).compileComponents();

    fixture = TestBed.createComponent(FormationChecklistRowComponent);
    fixture.componentRef.setInput('item', item);
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
});
