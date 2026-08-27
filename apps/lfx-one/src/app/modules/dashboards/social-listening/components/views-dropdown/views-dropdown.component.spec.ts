// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DEFAULT_MENTION_PREDICATE, VIEWS_DROPDOWN_NAME_TOOLTIP_THRESHOLD } from '@lfx-one/shared/constants';
import { ConfirmationService } from 'primeng/api';
import { Tooltip } from 'primeng/tooltip';
import { By } from '@angular/platform-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ViewsDropdownComponent } from './views-dropdown.component';

import type { FilterPredicate, SavedFilter, SavedViewScope } from '@lfx-one/shared/interfaces';

describe('ViewsDropdownComponent', () => {
  let fixture: ComponentFixture<ViewsDropdownComponent>;
  let confirmationService: { confirm: ReturnType<typeof vi.fn> };

  const validScope: SavedViewScope = { period: '2026-03', sourceProjectId: 'proj-1', platform: 'reddit' };

  function view(overrides: Partial<SavedFilter> = {}): SavedFilter {
    return {
      id: 'v1',
      name: 'Crisis',
      predicate: { ...DEFAULT_MENTION_PREDICATE, keywords: [], tags: [], authors: [] } as FilterPredicate,
      scope: { ...validScope },
      createdAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    };
  }

  function applyButtons(): HTMLButtonElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('.view-row__apply'));
  }

  beforeEach(async () => {
    confirmationService = { confirm: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [ViewsDropdownComponent],
      providers: [{ provide: ConfirmationService, useValue: confirmationService }],
    }).compileComponents();

    fixture = TestBed.createComponent(ViewsDropdownComponent);
    // Attach to the document so focus assertions work.
    document.body.appendChild(fixture.nativeElement);
  });

  afterEach(() => {
    document.body.removeChild(fixture.nativeElement);
  });

  async function render(inputs: Partial<Parameters<typeof fixture.componentRef.setInput>[1]> = {}, views: SavedFilter[] = []): Promise<void> {
    fixture.componentRef.setInput('savedViews', views);
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
    await fixture.whenStable();
  }

  it('renders the default row and saved views, with a checkmark on the active one', async () => {
    await render({ activeViewId: 'v2' }, [view(), view({ id: 'v2', name: 'Second' })]);

    const rows = fixture.nativeElement.querySelectorAll('[data-testid="views-dropdown-view-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Crisis');
    expect(rows[1].textContent).toContain('Second');
    // Checkmark lands on the active row only; the default row shows none.
    expect(rows[0].querySelector('.view-row__check')).toBeNull();
    expect(rows[1].querySelector('.view-row__check')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="views-dropdown-default-row"] .view-row__check')).toBeNull();
  });

  it('marks the default row active when no view is selected and emits defaultViewSelected on click', async () => {
    const emitted: string[] = [];
    fixture.componentInstance.defaultViewSelected.subscribe(() => emitted.push('default'));

    await render({ activeViewId: null }, [view()]);

    const defaultRow: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="views-dropdown-default-row"]');
    expect(defaultRow.closest('.view-row')?.classList).toContain('view-row--active');

    defaultRow.click();
    expect(emitted).toEqual(['default']);
  });

  it('emits viewSelected with the clicked view', async () => {
    const selected: SavedFilter[] = [];
    fixture.componentInstance.viewSelected.subscribe((v: SavedFilter) => selected.push(v));
    const viewB = view({ id: 'v2', name: 'Second' });

    await render({}, [view(), viewB]);

    applyButtons()[2]?.click();
    expect(selected).toEqual([viewB]);
  });

  it('shows the empty state when there are no saved views and nothing is loading', async () => {
    await render({ isLoading: false });

    expect(fixture.nativeElement.querySelector('[data-testid="views-dropdown-empty"]')).not.toBeNull();
  });

  it('renders skeleton rows while loading and suppresses the empty state', async () => {
    await render({ isLoading: true });

    expect(fixture.nativeElement.querySelectorAll('[data-testid="views-dropdown-skeleton"]')).toHaveLength(3);
    expect(fixture.nativeElement.querySelector('[data-testid="views-dropdown-empty"]')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('[data-testid="views-dropdown-view-row"]')).toHaveLength(0);
  });

  it('opens the delete confirm and emits viewDeleted on accept', async () => {
    const deleted: SavedFilter[] = [];
    fixture.componentInstance.viewDeleted.subscribe((v: SavedFilter) => deleted.push(v));
    const viewA = view({ id: 'a', name: 'Alpha' });
    confirmationService.confirm.mockImplementation((options: { accept: () => void }) => options.accept());

    await render({}, [viewA]);

    fixture.nativeElement.querySelector('[data-testid="views-dropdown-delete"]').click();

    expect(confirmationService.confirm).toHaveBeenCalledTimes(1);
    const options = confirmationService.confirm.mock.calls[0]?.[0];
    expect(options.header).toBe('Remove saved view?');
    expect(options.message).toBe('Are you sure you want to remove "Alpha"? This action cannot be undone.');
    expect(options.acceptLabel).toBe('Remove');
    expect(options.rejectLabel).toBe('Cancel');
    expect(deleted).toEqual([viewA]);
  });

  it('renders a spinner in place of the delete button for a view being removed', async () => {
    await render({ deletingViewIds: new Set(['v1']) }, [view()]);

    expect(fixture.nativeElement.querySelector('[data-testid="views-dropdown-deleting"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="views-dropdown-delete"]')).toBeNull();
  });

  it('disables the delete buttons when read-only', async () => {
    await render({ readOnly: true }, [view()]);

    const deleteButton: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="views-dropdown-delete"]');
    expect(deleteButton.disabled).toBe(true);
  });

  it('moves focus with Arrow/Home/End keys and closes on Escape', async () => {
    const closed: string[] = [];
    fixture.componentInstance.close.subscribe(() => closed.push('closed'));
    await render({}, [view(), view({ id: 'v2', name: 'Second' }), view({ id: 'v3', name: 'Third' })]);

    const list: HTMLElement = fixture.nativeElement.querySelector('.views-list');
    const buttons = applyButtons();
    buttons[0]?.focus();
    expect(document.activeElement).toBe(buttons[0]);

    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(buttons[1]);

    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(document.activeElement).toBe(buttons[3]);

    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(document.activeElement).toBe(buttons[0]);

    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    expect(document.activeElement).toBe(buttons[0]); // clamped at the top

    list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(closed).toEqual(['closed']);
  });

  it('enables the name tooltip only past the shared threshold', async () => {
    const shortName = view({ id: 'short', name: 'Short' });
    const longName = view({ id: 'long', name: 'X'.repeat(VIEWS_DROPDOWN_NAME_TOOLTIP_THRESHOLD + 1) });
    await render({}, [shortName, longName]);

    const spans = fixture.debugElement.queryAll(By.css('.view-row__name'));
    // Index 0 is the default row (no tooltip directive); the two view rows follow.
    const shortTooltip = spans[1]?.injector.get(Tooltip, null, { self: true });
    const longTooltip = spans[2]?.injector.get(Tooltip, null, { self: true });

    expect(shortTooltip?.disabled).toBe(true);
    expect(longTooltip?.disabled).toBe(false);
  });

  it('shows the footer save action when the current view can be saved', async () => {
    const requested: string[] = [];
    fixture.componentInstance.saveCurrentViewRequested.subscribe(() => requested.push('go'));

    await render({ canSaveCurrentView: true }, [view()]);

    const footer: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="views-dropdown-save-current"]');
    expect(footer.disabled).toBe(false);
    footer.click();
    expect(requested).toEqual(['go']);
  });

  it('hides the footer save action when there is nothing to save', async () => {
    await render({ canSaveCurrentView: false });

    expect(fixture.nativeElement.querySelector('[data-testid="views-dropdown-save-current"]')).toBeNull();
  });

  it('disables the footer save action at the limit or when read-only', async () => {
    await render({ canSaveCurrentView: true, atSavedViewLimit: true, savedViewLimit: 50 }, [view()]);
    const footer: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="views-dropdown-save-current"]');
    expect(footer.disabled).toBe(true);
  });
});
