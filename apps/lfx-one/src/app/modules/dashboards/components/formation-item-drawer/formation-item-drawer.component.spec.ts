// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { UserSearchComponent } from '@components/user-search/user-search.component';
import { FormationService } from '@services/formation.service';
import { FormationItem, FormationItemDetail, UserSearchResult } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { AutoCompleteSelectEvent } from 'primeng/autocomplete';
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

function buildUserSearchResult(overrides: Partial<UserSearchResult>): UserSearchResult {
  return {
    uid: 'user:test',
    email: 'jdoe@example.com',
    first_name: 'Jane',
    last_name: 'Doe',
    job_title: null,
    organization: null,
    type: 'committee_member',
    username: 'jdoe',
    ...overrides,
  };
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

  const render = async (
    item: FormationItem,
    readOnly: boolean,
    overrides?: { updateFormationItem?: ReturnType<typeof vi.fn>; messageServiceAdd?: ReturnType<typeof vi.fn> }
  ): Promise<void> => {
    TestBed.resetTestingModule();
    const getFormationItemMock = vi.fn().mockReturnValue(of(buildDetail(item)));
    const updateFormationItemMock = overrides?.updateFormationItem ?? vi.fn().mockReturnValue(of(item));
    const messageServiceAddMock = overrides?.messageServiceAdd ?? vi.fn();

    await TestBed.configureTestingModule({
      imports: [FormationItemDrawerComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        // p-drawer uses synthetic animations; without a noop animations provider every render
        // through the drawer throws NG05105 before any assertion runs.
        provideNoopAnimations(),
        { provide: MessageService, useValue: { add: messageServiceAddMock } },
        { provide: FormationService, useValue: { getFormationItem: getFormationItemMock, updateFormationItem: updateFormationItemMock } },
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

  // lfx-user-search is a PrimeNG-backed overlay component too; driving it through its own
  // component instance (rather than the rendered p-autocomplete's DOM/panel) keeps these tests
  // focused on this drawer's own wiring (usernameControl/displayValue/onUserSelect), not on
  // lfx-user-search's already-covered internal search/select/clear behavior.
  const queryUserSearch = (): UserSearchComponent => fixture.debugElement.query(By.directive(UserSearchComponent)).componentInstance as UserSearchComponent;

  // `editForm` is protected — same cast pattern the existing `busy()` assertion above uses.
  const ownerUsernameValue = (): string | null =>
    (fixture.componentInstance as unknown as { editForm: FormGroup }).editForm.get('ownerUsername')?.value ?? null;

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

    it('marks the notes textarea readonly', async () => {
      const item = buildItem({ status: 'in_progress' });
      await render(item, true);

      const notes = query('[data-testid="formation-item-drawer-notes"] textarea');
      expect(notes?.hasAttribute('readonly')).toBe(true);
    });

    it('disables the assignee search input', async () => {
      const item = buildItem({ status: 'in_progress' });
      await render(item, true);

      const assignee = query('[data-testid="formation-item-drawer-assignee"] input') as HTMLInputElement | null;
      expect(assignee?.disabled).toBe(true);
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

  describe('assignee (GH-2583)', () => {
    it('renders an existing assignee on open', async () => {
      const item = buildItem({ owner: { username: 'jdoe', name: 'jdoe' } });
      await render(item, false);

      expect(ownerUsernameValue()).toBe('jdoe');
    });

    it('loads a never-assigned item as an empty string, not null', async () => {
      const item = buildItem({ owner: null });
      await render(item, false);

      expect(ownerUsernameValue()).toBe('');
    });

    it('selecting a user sets ownerUsername, and Save sends it to the API', async () => {
      const item = buildItem({ owner: null });
      const updateFormationItemMock = vi.fn().mockReturnValue(of(item));
      await render(item, false, { updateFormationItem: updateFormationItemMock });

      queryUserSearch().onUserSelected({ value: buildUserSearchResult({ username: 'jdoe' }) } as AutoCompleteSelectEvent);
      expect(ownerUsernameValue()).toBe('jdoe');

      (query('[data-testid="formation-item-drawer-save"] button') as HTMLElement)?.click();
      await fixture.whenStable();

      expect(updateFormationItemMock).toHaveBeenCalledWith(item.project_uid, item.template_item_key, expect.objectContaining({ owner_username: 'jdoe' }));
    });

    it('typed-but-unselected text does not set ownerUsername', async () => {
      const item = buildItem({ owner: null });
      await render(item, false);

      const assignee = query('[data-testid="formation-item-drawer-assignee"] input') as HTMLInputElement;
      assignee.value = 'som';
      assignee.dispatchEvent(new Event('input'));
      await fixture.whenStable();

      expect(ownerUsernameValue()).toBe('');
    });

    it('clearing produces a cleared state that saves as an empty owner_username, distinct from never-assigned', async () => {
      const item = buildItem({ owner: { username: 'jdoe', name: 'jdoe' } });
      const updateFormationItemMock = vi.fn().mockReturnValue(of(item));
      await render(item, false, { updateFormationItem: updateFormationItemMock });

      queryUserSearch().onSearchClear();
      expect(ownerUsernameValue()).toBeNull();

      (query('[data-testid="formation-item-drawer-save"] button') as HTMLElement)?.click();
      await fixture.whenStable();

      expect(updateFormationItemMock).toHaveBeenCalledWith(item.project_uid, item.template_item_key, expect.objectContaining({ owner_username: '' }));
    });

    it('rejecting a no-account pick on a never-assigned item restores the empty (never-assigned) state', async () => {
      const item = buildItem({ owner: null });
      const messageServiceAddMock = vi.fn();
      await render(item, false, { messageServiceAdd: messageServiceAddMock });

      queryUserSearch().onUserSelected({ value: buildUserSearchResult({ username: null }) } as AutoCompleteSelectEvent);

      expect(ownerUsernameValue()).toBe('');
      expect(messageServiceAddMock).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn' }));
    });

    it('rejecting a no-account pick on an already-assigned item restores the prior assignee, not null', async () => {
      const item = buildItem({ owner: { username: 'jdoe', name: 'jdoe' } });
      const messageServiceAddMock = vi.fn();
      await render(item, false, { messageServiceAdd: messageServiceAddMock });

      queryUserSearch().onUserSelected({ value: buildUserSearchResult({ username: null }) } as AutoCompleteSelectEvent);

      // lfx-user-search itself already wrote `null` into ownerUsername before emitting onUserSelect
      // — this asserts the drawer restores the real assignee rather than leaving that write in
      // place, which would otherwise silently unassign the item on the next Save.
      expect(ownerUsernameValue()).toBe('jdoe');
      expect(messageServiceAddMock).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn' }));
    });

    it("warns when lfx-user-search's manual-entry footer is used, since manual entry is not supported", async () => {
      const item = buildItem({ owner: null });
      const messageServiceAddMock = vi.fn();
      await render(item, false, { messageServiceAdd: messageServiceAddMock });

      queryUserSearch().onEnterManually();

      expect(messageServiceAddMock).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn' }));
    });
  });
});
