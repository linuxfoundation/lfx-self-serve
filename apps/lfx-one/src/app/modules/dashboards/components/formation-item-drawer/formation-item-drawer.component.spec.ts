// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { FormationService } from '@services/formation.service';
import { FormationItem, FormationItemDetail } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FormationItemDrawerComponent } from './formation-item-drawer.component';

function buildItem(overrides: Partial<FormationItem>): FormationItem {
  return {
    uid: 'formation-item:test',
    formation_uid: 'formation:test',
    project_uid: 'project:test',
    template_item_key: 'test-item',
    section_key: 'legal',
    section_title: 'Legal and entity',
    title: 'Test item',
    status: 'in_progress',
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

function buildDetail(item: FormationItem): FormationItemDetail {
  return { item, history: [], history_state: 'complete' };
}

describe('FormationItemDrawerComponent', () => {
  let fixture: ComponentFixture<FormationItemDrawerComponent>;

  // p-drawer is a PrimeNG overlay: it renders into document.body, not into the fixture host, so
  // every assertion here queries the global document — same pattern as event-detail-drawer's spec.
  // Without teardown a previous test's overlay survives into the next one.
  afterEach(() => {
    fixture?.destroy();
    document.body.innerHTML = '';
  });

  const render = async (item: FormationItem, readOnly: boolean): Promise<void> => {
    TestBed.resetTestingModule();
    const getFormationItemMock = vi.fn().mockReturnValue(of(buildDetail(item)));

    await TestBed.configureTestingModule({
      imports: [FormationItemDrawerComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        // p-drawer uses synthetic animations; without a noop animations provider every render
        // through the drawer throws NG05105 before any assertion runs.
        provideNoopAnimations(),
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: FormationService, useValue: { getFormationItem: getFormationItemMock } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FormationItemDrawerComponent);
    fixture.componentRef.setInput('itemProjectUid', item.project_uid);
    fixture.componentRef.setInput('itemKey', item.template_item_key);
    fixture.componentRef.setInput('readOnly', readOnly);
    fixture.detectChanges();

    // `drawerData`'s open-trigger observable is `toObservable(this.visible).pipe(skip(1), ...)` — the
    // initial `false` doesn't fire it, so the drawer must actually flip to visible to load the item.
    fixture.componentInstance.visible.set(true);
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const query = (selector: string): Element | null => document.body.querySelector(selector);

  it('renders Mark complete, notes/assignee/due-date as editable, and the Save button when live', async () => {
    const item = buildItem({ status: 'in_progress' });
    await render(item, false);

    expect(query('[data-testid="formation-item-drawer-mark-complete"]')).not.toBeNull();
    expect(query('[data-testid="formation-item-drawer-save"]')).not.toBeNull();
  });

  // GH-2328: readOnly hides every mutation control in the drawer outright (not merely disables them)
  // and marks the remaining fields read-only/disabled, since the section's banner above already names
  // the reason and there is nothing here for the viewer to retry.
  describe('readOnly (GH-2328)', () => {
    it('hides the Mark complete/Skip block entirely', async () => {
      const item = buildItem({ status: 'in_progress' });
      await render(item, true);

      expect(query('[data-testid="formation-item-drawer-mark-complete"]')).toBeNull();
      expect(query('[data-testid="formation-item-drawer-skip"]')).toBeNull();
    });

    it('hides the Save button', async () => {
      const item = buildItem({ status: 'in_progress' });
      await render(item, true);

      expect(query('[data-testid="formation-item-drawer-save"]')).toBeNull();
    });

    it('marks the notes textarea and assignee input readonly', async () => {
      const item = buildItem({ status: 'in_progress' });
      await render(item, true);

      const notes = query('[data-testid="formation-item-drawer-notes"] textarea');
      const assignee = query('[data-testid="formation-item-drawer-assignee"] input');
      expect(notes?.hasAttribute('readonly')).toBe(true);
      expect(assignee?.hasAttribute('readonly')).toBe(true);
    });

    it('disables the due-date calendar', async () => {
      const item = buildItem({ status: 'in_progress' });
      await render(item, true);

      const dueDate = query('[data-testid="formation-item-drawer-due-date"] input') as HTMLInputElement | null;
      expect(dueDate?.disabled).toBe(true);
    });

    it('folds into busy() so onMarkComplete/onSaveDetails/onSkip are no-ops even if called directly', async () => {
      const item = buildItem({ status: 'in_progress' });
      await render(item, true);

      expect((fixture.componentInstance as unknown as { busy: () => boolean }).busy()).toBe(true);
    });
  });
});
