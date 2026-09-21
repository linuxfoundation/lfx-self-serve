// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormGroup } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { UserSearchComponent } from '@components/user-search/user-search.component';
import { FormationService } from '@services/formation.service';
import { createFormationAllAvailableActions } from '@lfx-one/shared/constants';
import { FormationItem, FormationItemDetail, UserSearchResult } from '@lfx-one/shared/interfaces';
import { MessageService } from 'primeng/api';
import { AutoCompleteSelectEvent } from 'primeng/autocomplete';
import { NEVER, of, Subject, throwError } from 'rxjs';
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
    // Default to every action published — the state of a live, mutable item (GH-2576, Copilot review
    // PR #2596): defaulting to `[]` left canMarkDone()/canSkip() false in every test, so the Mark
    // complete/Skip buttons rendered disabled while the tests asserting only their presence passed.
    // The negative-path gate tests below pass an explicit reduced list instead.
    available_actions: createFormationAllAvailableActions(),
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
    overrides?: {
      getFormationItem?: ReturnType<typeof vi.fn>;
      updateFormationItem?: ReturnType<typeof vi.fn>;
      updateFormationItemAssignment?: ReturnType<typeof vi.fn>;
      updateFormationItemStatus?: ReturnType<typeof vi.fn>;
      messageServiceAdd?: ReturnType<typeof vi.fn>;
    },
    canWrite = true,
    // Defaults to canWrite for fixture brevity; production keeps them independent (GH-2705:
    // can_set_status = can_write ∧ team:formation membership) and the canSetStatus tests set them apart.
    canSetStatus = canWrite
  ): Promise<void> => {
    TestBed.resetTestingModule();
    const getFormationItemMock = overrides?.getFormationItem ?? vi.fn().mockReturnValue(of(buildDetail(item)));
    const updateFormationItemMock = overrides?.updateFormationItem ?? vi.fn().mockReturnValue(of({ item, etag: null }));
    const updateFormationItemAssignmentMock = overrides?.updateFormationItemAssignment ?? vi.fn().mockReturnValue(of({ item, etag: null }));
    const updateFormationItemStatusMock = overrides?.updateFormationItemStatus ?? vi.fn().mockReturnValue(of({ item, etag: null }));
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
        {
          provide: FormationService,
          useValue: {
            getFormationItem: getFormationItemMock,
            updateFormationItem: updateFormationItemMock,
            updateFormationItemAssignment: updateFormationItemAssignmentMock,
            updateFormationItemStatus: updateFormationItemStatusMock,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FormationItemDrawerComponent);
    fixture.componentRef.setInput('itemProjectUid', item.project_uid);
    fixture.componentRef.setInput('itemKey', item.template_item_key);
    fixture.componentRef.setInput('readOnly', readOnly);
    fixture.componentRef.setInput('canWrite', canWrite);
    fixture.componentRef.setInput('canSetStatus', canSetStatus);
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

    // Assert the native button is enabled, not merely rendered — presence alone passes even when
    // canMarkDone() leaves it disabled (Copilot review, PR #2596).
    const markComplete = query('[data-testid="formation-item-drawer-mark-complete"] button') as HTMLButtonElement | null;
    expect(markComplete).not.toBeNull();
    expect(markComplete?.disabled).toBe(false);
    expect(query('[data-testid="formation-item-drawer-save"]')).not.toBeNull();
  });

  // #2774: the header carries the same three facts the checklist row shows, and sub-items render
  // through the shared lfx-formation-sub-item-list instead of an inline title + status-chip list.
  describe('header meta line and sub-items (#2774)', () => {
    it('spells out "Required for Active" behind the red asterisk for a gating item', async () => {
      const item = buildItem({ is_gating: true });
      await render(item, false);

      const gating = query(`[data-testid="formation-item-drawer-gates-active-${item.uid}"]`);
      expect(gating?.textContent).toContain('*');
      expect(gating?.textContent).toContain('Required for Active');
      expect(gating?.querySelector('lfx-tag')).toBeNull();
    });

    it('renders no gating text for a non-gating item', async () => {
      const item = buildItem({ is_gating: false });
      await render(item, false);

      expect(query(`[data-testid="formation-item-drawer-gates-active-${item.uid}"]`)).toBeNull();
    });

    it('shows the humanized owner team and the full audience label with a globe for an external-involving audience', async () => {
      const item = buildItem({ owner_team: 'brand_counsel', audience: 'both' });
      await render(item, false);

      expect(query(`[data-testid="formation-item-drawer-owner-team-${item.uid}"]`)?.textContent).toContain('Brand Counsel');
      const audience = query(`[data-testid="formation-item-drawer-audience-${item.uid}"]`);
      expect(audience?.textContent).toContain('Internal + External');
      expect(audience?.querySelector('i.fa-globe')).not.toBeNull();
    });

    it('shows an internal audience as text without the globe', async () => {
      const item = buildItem({ audience: 'internal' });
      await render(item, false);

      const audience = query(`[data-testid="formation-item-drawer-audience-${item.uid}"]`);
      expect(audience?.textContent).toContain('Internal');
      expect(audience?.querySelector('i.fa-globe')).toBeNull();
    });

    it('renders sub-items through the shared list with a done count and status glyphs, not status chips', async () => {
      const item = buildItem({
        sub_items: [
          { uid: 'sub_a', title: 'Create workspace', status: 'done' },
          { uid: 'sub_b', title: 'Configure channels', status: 'not_started' },
        ],
      });
      await render(item, false);

      const block = query('[data-testid="formation-item-drawer-sub-items"]');
      expect(block?.textContent).toContain('1 of 2 done');
      expect(block?.querySelectorAll('[data-testid^="formation-sub-item-row-"]').length).toBe(2);
      expect(block?.querySelector('[data-testid="formation-sub-item-row-sub_a"] i.fa-circle-check')).not.toBeNull();
      expect(block?.querySelector('lfx-tag')).toBeNull();
    });

    it('renders no sub-items block for an item without sub-items', async () => {
      await render(buildItem({ sub_items: [] }), false);

      expect(query('[data-testid="formation-item-drawer-sub-items"]')).toBeNull();
    });
  });

  // GH-2576 (Copilot review, PR #2596): Mark complete/Skip gate on `available_actions` via
  // canMarkDone()/canSkip() — cover each signal's positive and negative path so a dropped gate (or a
  // fixture silently defaulting to no actions) can't leave a disabled button looking correct.
  describe('available_actions gates (GH-2576)', () => {
    const nativeButton = (testid: string): HTMLButtonElement | null => query(`[data-testid="${testid}"] button`) as HTMLButtonElement | null;

    it('enables Mark complete when mark_done is published', async () => {
      const item = buildItem({ status: 'in_progress' });
      await render(item, false);

      expect(nativeButton('formation-item-drawer-mark-complete')?.disabled).toBe(false);
    });

    it('disables Mark complete when mark_done is absent from available_actions', async () => {
      const item = buildItem({
        status: 'in_progress',
        available_actions: createFormationAllAvailableActions().filter((entry) => entry.action !== 'mark_done'),
      });
      await render(item, false);

      const button = nativeButton('formation-item-drawer-mark-complete');
      expect(button).not.toBeNull();
      expect(button?.disabled).toBe(true);
    });

    it('enables Skip when skip is published', async () => {
      const item = buildItem({ status: 'not_started', is_gating: true });
      await render(item, false);

      expect(nativeButton('formation-item-drawer-skip')?.disabled).toBe(false);
    });

    it('disables Skip when skip is absent from available_actions', async () => {
      const item = buildItem({
        status: 'not_started',
        is_gating: true,
        available_actions: createFormationAllAvailableActions().filter((entry) => entry.action !== 'skip'),
      });
      await render(item, false);

      const button = nativeButton('formation-item-drawer-skip');
      expect(button).not.toBeNull();
      expect(button?.disabled).toBe(true);
    });
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

    it('marks the assignee search input readonly, not disabled (stays focusable/announced)', async () => {
      const item = buildItem({ status: 'in_progress' });
      await render(item, true);

      const assignee = query('[data-testid="formation-item-drawer-assignee"] input') as HTMLInputElement | null;
      expect(assignee?.readOnly).toBe(true);
      expect(assignee?.disabled).toBe(false);
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

  // GH-2613 review: canWrite gates Mark complete/Skip only, not Save's note-only leg — the PATCH
  // item route is read-access-gated upstream (GH-2576's guard-tier audit), so an auditor-only
  // caller must still be able to save a note.
  describe('canWrite (GH-2613 review)', () => {
    it('does not disable Save for a note-only edit when canWrite is false', async () => {
      const item = buildItem({ status: 'in_progress', notes: 'old note' });
      await render(item, false, undefined, false);

      const notes = query('[data-testid="formation-item-drawer-notes"] textarea') as HTMLTextAreaElement;
      notes.value = 'new note';
      notes.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      fixture.detectChanges();

      const saveButton = query('[data-testid="formation-item-drawer-save"] button') as HTMLButtonElement | null;
      expect(saveButton?.disabled).toBe(false);
    });

    it('still disables Mark complete and Skip when canWrite is false', async () => {
      const item = buildItem({ status: 'in_progress', is_gating: true });
      await render(item, false, undefined, false);

      const markComplete = query('[data-testid="formation-item-drawer-mark-complete"] button') as HTMLButtonElement | null;
      expect(markComplete?.disabled).toBe(true);
    });

    it('shows the write-access message scoped to Mark complete/Skip', async () => {
      const item = buildItem({ status: 'in_progress' });
      await render(item, false, undefined, false);

      expect(query('[data-testid="formation-item-drawer-no-write-access"]')).not.toBeNull();
    });

    it('allows a note-only Save to actually call the service when canWrite is false', async () => {
      const item = buildItem({ status: 'in_progress', notes: 'old note' });
      const updateFormationItemMock = vi.fn().mockReturnValue(of({ item: { ...item, notes: 'new note' }, etag: null }));
      await render(item, false, { updateFormationItem: updateFormationItemMock }, false);

      const notes = query('[data-testid="formation-item-drawer-notes"] textarea') as HTMLTextAreaElement;
      notes.value = 'new note';
      notes.dispatchEvent(new Event('input'));
      await fixture.whenStable();

      (query('[data-testid="formation-item-drawer-save"] button') as HTMLElement)?.click();
      await fixture.whenStable();

      expect(updateFormationItemMock).toHaveBeenCalledWith(item.project_uid, item.template_item_key, String(item.version), { note: 'new note' });
    });

    // Copilot review, PR #2613: an auditor-only caller may save notes (auditor-gated PATCH) but not
    // assignee/due-date edits (writer-gated POST .../assignment) — those controls lock, and Save
    // ignores any stray difference instead of firing a deterministic 403 after the note leg already
    // persisted.
    it('makes the assignee read-only and the due date disabled when canWrite is false, while notes stay editable', async () => {
      const item = buildItem({ status: 'in_progress' });
      await render(item, false, undefined, false);

      const assignee = query('[data-testid="formation-item-drawer-assignee"] input') as HTMLInputElement | null;
      expect(assignee?.readOnly).toBe(true);
      expect(assignee?.disabled).toBe(false);
      const dueDate = query('[data-testid="formation-item-drawer-due-date"] input') as HTMLInputElement | null;
      expect(dueDate?.disabled).toBe(true);
      const notes = query('[data-testid="formation-item-drawer-notes"] textarea') as HTMLTextAreaElement;
      expect(notes?.hasAttribute('readonly')).toBe(false);
    });

    it('explains the assignee/due-date lock with visible text when canWrite is false', async () => {
      const item = buildItem({ status: 'in_progress' });
      await render(item, false, undefined, false);

      expect(query('[data-testid="formation-item-drawer-no-write-access-assignment"]')).not.toBeNull();
    });

    it('sends only the note leg on Save when canWrite is false, ignoring assignee/due-date differences', async () => {
      // The item has both an assignee and a due date. The disabled due-date control drops out of
      // `form.value` entirely, so without the gate this save would read the date as "cleared" ('')
      // and fire the writer-gated assignment leg into a deterministic 403 — after the note had
      // already persisted upstream.
      const item = buildItem({ status: 'in_progress', notes: 'old note', owner: { username: 'jdoe', name: 'jdoe' }, due_date: '2026-03-01' });
      const updateFormationItemMock = vi.fn().mockReturnValue(of({ item: { ...item, notes: 'new note' }, etag: null }));
      const updateFormationItemAssignmentMock = vi.fn();
      await render(item, false, { updateFormationItem: updateFormationItemMock, updateFormationItemAssignment: updateFormationItemAssignmentMock }, false);

      // A stray assignee difference must be ignored too — the gate lives in onSaveDetails, not just
      // in the disabled controls.
      (fixture.componentInstance as unknown as { editForm: FormGroup }).editForm.get('ownerUsername')?.setValue('mallory');

      const notes = query('[data-testid="formation-item-drawer-notes"] textarea') as HTMLTextAreaElement;
      notes.value = 'new note';
      notes.dispatchEvent(new Event('input'));
      await fixture.whenStable();

      (query('[data-testid="formation-item-drawer-save"] button') as HTMLElement)?.click();
      await fixture.whenStable();

      expect(updateFormationItemMock).toHaveBeenCalledWith(item.project_uid, item.template_item_key, String(item.version), { note: 'new note' });
      expect(updateFormationItemAssignmentMock).not.toHaveBeenCalled();
    });
  });

  // GH-2705: Mark complete/Skip ride POST .../status, whose gateway rule ANDs writer_guard with
  // `member` on `team:formation` — the writer half alone (canWrite) must not enable them. This was
  // the shipped defect on this surface: a writer outside the formation team got enabled status
  // controls whose every write 403'd.
  describe('canSetStatus (GH-2705)', () => {
    it('disables Mark complete for a writer who is not on the formation team', async () => {
      const item = buildItem({ status: 'in_progress', is_gating: true });
      await render(item, false, undefined, true, false);

      const markComplete = query('[data-testid="formation-item-drawer-mark-complete"] button') as HTMLButtonElement | null;
      expect(markComplete?.disabled).toBe(true);
    });

    it('shows the visible standing explanation for that same writer — disabled buttons alone explain nothing', async () => {
      const item = buildItem({ status: 'in_progress' });
      await render(item, false, undefined, true, false);

      expect(query('[data-testid="formation-item-drawer-no-write-access"]')).not.toBeNull();
    });

    it('renders no standing explanation when no status control renders — e.g. a blocked item', async () => {
      // Mark complete renders only for in_progress and Skip only for gating not_started; a blocked
      // item offers neither, so a lone explanation about absent controls must not appear.
      const item = buildItem({ status: 'blocked' });
      await render(item, false, undefined, true, false);

      expect(query('[data-testid="formation-item-drawer-no-write-access"]')).toBeNull();
    });

    it('keeps assignee and due date editable for that same writer — /assignment needs writer_guard alone', async () => {
      const item = buildItem({ status: 'in_progress' });
      await render(item, false, undefined, true, false);

      const assignee = query('[data-testid="formation-item-drawer-assignee"] input') as HTMLInputElement | null;
      expect(assignee?.readOnly).toBe(false);
      const dueDate = query('[data-testid="formation-item-drawer-due-date"] input') as HTMLInputElement | null;
      expect(dueDate?.disabled).toBe(false);
    });
  });

  // GH-2705 review: upstream's `no_fields_to_update` on the note/assignment routes is raised on
  // field PRESENCE only (item_mutator.go / item_assignment.go), and every save leg always includes
  // its field — so on this chain it can only mean the body was lost in transit. It must therefore
  // fail the save loudly (with the server-authored reason), never be absorbed as a no-op "Saved".
  describe('no_fields_to_update stays a failure (GH-2705 review)', () => {
    it('reports the failed note leg with the server-authored reason instead of claiming Saved', async () => {
      const noFieldsError = () => new HttpErrorResponse({ status: 400, error: { code: 'NO_FIELDS_TO_UPDATE', error: 'the request changes no field' } });
      const item = buildItem({ status: 'in_progress', notes: 'old note' });
      const updateFormationItemMock = vi.fn().mockReturnValue(throwError(noFieldsError));
      const messageServiceAddMock = vi.fn();
      await render(item, false, { updateFormationItem: updateFormationItemMock, messageServiceAdd: messageServiceAddMock });

      const notes = query('[data-testid="formation-item-drawer-notes"] textarea') as HTMLTextAreaElement;
      notes.value = 'new note';
      notes.dispatchEvent(new Event('input'));
      await fixture.whenStable();

      (query('[data-testid="formation-item-drawer-save"] button') as HTMLElement)?.click();
      await fixture.whenStable();

      const toast = messageServiceAddMock.mock.calls.at(-1)?.[0] as { severity: string; detail: string };
      expect(toast.severity).toBe('error');
      expect(toast.detail).toContain('the request changes no field');
    });
  });

  describe('assignee (#2583)', () => {
    it('renders an existing assignee on open', async () => {
      const item = buildItem({ owner: { username: 'jdoe', name: 'jdoe' } });
      await render(item, false);

      // Also assert the visible input's value, not just the backing form control — a regression in
      // the assigneeDisplayValue/lfx-user-search binding could leave the box blank while the
      // control still held the right value.
      expect(ownerUsernameValue()).toBe('jdoe');
      const assignee = query('[data-testid="formation-item-drawer-assignee"] input') as HTMLInputElement | null;
      expect(assignee?.value).toBe('jdoe');
    });

    it('loads a never-assigned item as an empty string, not null', async () => {
      const item = buildItem({ owner: null });
      await render(item, false);

      expect(ownerUsernameValue()).toBe('');
    });

    it('selecting a user sets ownerUsername, and Save sends it to the assignment API', async () => {
      const item = buildItem({ owner: null });
      const updateFormationItemAssignmentMock = vi.fn().mockReturnValue(of({ item, etag: null }));
      await render(item, false, { updateFormationItemAssignment: updateFormationItemAssignmentMock });

      queryUserSearch().onUserSelected({ value: buildUserSearchResult({ username: 'jdoe' }) } as AutoCompleteSelectEvent);
      expect(ownerUsernameValue()).toBe('jdoe');

      (query('[data-testid="formation-item-drawer-save"] button') as HTMLElement)?.click();
      await fixture.whenStable();

      expect(updateFormationItemAssignmentMock).toHaveBeenCalledWith(
        item.project_uid,
        item.template_item_key,
        String(item.version),
        expect.objectContaining({ assignee: 'jdoe' })
      );
    });

    it('saves note and assignee sequentially when both changed — the assignment write uses the version the note write just returned, not the original', async () => {
      const item = buildItem({ owner: null, notes: 'old note', version: 3 });
      const updateFormationItemMock = vi.fn().mockReturnValue(of({ item: { ...item, notes: 'new note', version: 4 }, etag: '4' }));
      const updateFormationItemAssignmentMock = vi.fn().mockReturnValue(of({ item: { ...item, notes: 'new note', version: 5 }, etag: '5' }));
      await render(item, false, { updateFormationItem: updateFormationItemMock, updateFormationItemAssignment: updateFormationItemAssignmentMock });

      const notes = query('[data-testid="formation-item-drawer-notes"] textarea') as HTMLTextAreaElement;
      notes.value = 'new note';
      notes.dispatchEvent(new Event('input'));
      queryUserSearch().onUserSelected({ value: buildUserSearchResult({ username: 'jdoe' }) } as AutoCompleteSelectEvent);
      await fixture.whenStable();

      (query('[data-testid="formation-item-drawer-save"] button') as HTMLElement)?.click();
      await fixture.whenStable();

      expect(updateFormationItemMock).toHaveBeenCalledWith(item.project_uid, item.template_item_key, String(item.version), { note: 'new note' });
      // The assignment write must use '4' (the note write's returned version), not '3' (the item's
      // original version) — sending both against the original version would race, since the note
      // write already advanced it by the time the assignment write reaches upstream.
      expect(updateFormationItemAssignmentMock).toHaveBeenCalledWith(
        item.project_uid,
        item.template_item_key,
        '4',
        expect.objectContaining({ assignee: 'jdoe' })
      );
    });

    it('reloads after the note leg succeeds but the assignment leg fails, so a retry does not resend the already-persisted note against a stale version (GH-2613 review)', async () => {
      const item = buildItem({ owner: null, notes: 'old note', version: 3 });
      const afterNoteWrite = { ...item, notes: 'new note', version: 4 };
      const updateFormationItemMock = vi.fn().mockReturnValue(of({ item: afterNoteWrite, etag: '4' }));
      const updateFormationItemAssignmentMock = vi.fn().mockReturnValue(throwError(() => new Error('412 Precondition Failed')));
      const getFormationItemMock = vi.fn().mockReturnValue(of(buildDetail(item)));
      const messageServiceAddMock = vi.fn();
      await render(item, false, {
        getFormationItem: getFormationItemMock,
        updateFormationItem: updateFormationItemMock,
        updateFormationItemAssignment: updateFormationItemAssignmentMock,
        messageServiceAdd: messageServiceAddMock,
      });
      // One call from the initial open — the assertion below checks it fires again after the
      // partial failure, proving local state gets refreshed rather than left pointing at the
      // pre-save version.
      expect(getFormationItemMock).toHaveBeenCalledTimes(1);

      const notes = query('[data-testid="formation-item-drawer-notes"] textarea') as HTMLTextAreaElement;
      notes.value = 'new note';
      notes.dispatchEvent(new Event('input'));
      queryUserSearch().onUserSelected({ value: buildUserSearchResult({ username: 'jdoe' }) } as AutoCompleteSelectEvent);
      await fixture.whenStable();

      (query('[data-testid="formation-item-drawer-save"] button') as HTMLElement)?.click();
      await fixture.whenStable();

      // The note write landed (version advanced to 4 upstream); the assignment write then failed.
      // GH-2694: a partial failure is reported as exactly that — the landed leg and the failed leg
      // both named — not as the old single generic error that read as if nothing had saved.
      expect(updateFormationItemMock).toHaveBeenCalledWith(item.project_uid, item.template_item_key, String(item.version), { note: 'new note' });
      expect(messageServiceAddMock).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'warn', summary: 'Partially saved', detail: expect.stringContaining('note saved, but the assignee did not') })
      );
      // The reload (triggered because the note leg actually ran) re-fetches the item — a retry would
      // now resend the note write, if any, against the reloaded (current) version, not the stale '3'.
      expect(getFormationItemMock).toHaveBeenCalledTimes(2);
      // The reload must NOT resync the form back to the server's (unchanged) owner — that would
      // silently drop the user's still-unsaved 'jdoe' pick, the very edit this reload exists to let
      // them retry (Cursor Bugbot, PR #2613 second pass).
      expect(ownerUsernameValue()).toBe('jdoe');
    });

    it('does not reload when the assignment leg fails and no note was changed — nothing advanced the version', async () => {
      const item = buildItem({ owner: null, notes: 'old note', version: 3 });
      const updateFormationItemMock = vi.fn();
      const updateFormationItemAssignmentMock = vi.fn().mockReturnValue(throwError(() => new Error('412 Precondition Failed')));
      const getFormationItemMock = vi.fn().mockReturnValue(of(buildDetail(item)));
      await render(item, false, {
        getFormationItem: getFormationItemMock,
        updateFormationItem: updateFormationItemMock,
        updateFormationItemAssignment: updateFormationItemAssignmentMock,
      });
      expect(getFormationItemMock).toHaveBeenCalledTimes(1);

      queryUserSearch().onUserSelected({ value: buildUserSearchResult({ username: 'jdoe' }) } as AutoCompleteSelectEvent);
      await fixture.whenStable();

      (query('[data-testid="formation-item-drawer-save"] button') as HTMLElement)?.click();
      await fixture.whenStable();

      expect(updateFormationItemMock).not.toHaveBeenCalled();
      expect(getFormationItemMock).toHaveBeenCalledTimes(1);
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

    it('clearing produces a cleared state that saves as an empty assignee, distinct from never-assigned', async () => {
      const item = buildItem({ owner: { username: 'jdoe', name: 'jdoe' } });
      const updateFormationItemAssignmentMock = vi.fn().mockReturnValue(of({ item, etag: null }));
      await render(item, false, { updateFormationItemAssignment: updateFormationItemAssignmentMock });

      queryUserSearch().onSearchClear();
      expect(ownerUsernameValue()).toBeNull();

      (query('[data-testid="formation-item-drawer-save"] button') as HTMLElement)?.click();
      await fixture.whenStable();

      expect(updateFormationItemAssignmentMock).toHaveBeenCalledWith(
        item.project_uid,
        item.template_item_key,
        String(item.version),
        expect.objectContaining({ assignee: '' })
      );
    });

    it('rejecting a no-account pick on a never-assigned item restores the empty (never-assigned) state', async () => {
      const item = buildItem({ owner: null });
      const messageServiceAddMock = vi.fn();
      await render(item, false, { messageServiceAdd: messageServiceAddMock });

      queryUserSearch().onUserSelected({ value: buildUserSearchResult({ username: null }) } as AutoCompleteSelectEvent);

      expect(ownerUsernameValue()).toBe('');
      expect(messageServiceAddMock).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn' }));
    });

    it('rejecting a no-account pick on an already-assigned item leaves the prior assignee untouched', async () => {
      const item = buildItem({ owner: { username: 'jdoe', name: 'jdoe' } });
      const messageServiceAddMock = vi.fn();
      await render(item, false, { messageServiceAdd: messageServiceAddMock });

      queryUserSearch().onUserSelected({ value: buildUserSearchResult({ username: null }) } as AutoCompleteSelectEvent);

      // requireLfAccount rejects the pick inside lfx-user-search itself, before ownerUsername is
      // ever touched — so the prior value is simply never overwritten, not "restored".
      expect(ownerUsernameValue()).toBe('jdoe');
      expect(messageServiceAddMock).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn' }));
    });

    it('rejecting a no-account pick after a valid unsaved reassignment preserves that reassignment, not the original owner', async () => {
      const item = buildItem({ owner: { username: 'alice', name: 'alice' } });
      const messageServiceAddMock = vi.fn();
      await render(item, false, { messageServiceAdd: messageServiceAddMock });

      queryUserSearch().onUserSelected({ value: buildUserSearchResult({ username: 'bob' }) } as AutoCompleteSelectEvent);
      expect(ownerUsernameValue()).toBe('bob');

      queryUserSearch().onUserSelected({ value: buildUserSearchResult({ username: null }) } as AutoCompleteSelectEvent);

      // A restore-to-the-original-owner fix would wrongly revert this to 'alice', silently
      // discarding the user's still-unsaved pick of 'bob'. requireLfAccount rejecting the bad pick
      // before it ever touches ownerUsername is what keeps 'bob' intact.
      expect(ownerUsernameValue()).toBe('bob');
      expect(messageServiceAddMock).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn' }));
    });
  });

  // GH-2694: the assignee and due date are separate sequential assignment writes (due date first)
  // even though they share upstream's route — a combined body is rejected wholesale when the
  // assignee is refused (`assignee_not_on_project`), which used to silently discard the due date
  // sent beside it. These tests pin the leg order, the version chaining across them, the
  // keep-what-landed behavior, and the reason-specific error copy.
  describe('split save legs (GH-2694)', () => {
    const setDueDate = (value: Date): void => {
      (fixture.componentInstance as unknown as { editForm: FormGroup }).editForm.get('dueDate')?.setValue(value);
    };

    it('sends the due date and the assignee as two sequential assignment writes — due date first, versions chained', async () => {
      const item = buildItem({ owner: null, due_date: null, version: 3 });
      const updateFormationItemAssignmentMock = vi
        .fn()
        .mockReturnValueOnce(of({ item: { ...item, due_date: '2026-03-31', version: 4 }, etag: '4' }))
        .mockReturnValueOnce(of({ item: { ...item, due_date: '2026-03-31', version: 5 }, etag: '5' }));
      await render(item, false, { updateFormationItemAssignment: updateFormationItemAssignmentMock });

      setDueDate(new Date(2026, 2, 31));
      queryUserSearch().onUserSelected({ value: buildUserSearchResult({ username: 'jdoe' }) } as AutoCompleteSelectEvent);
      await fixture.whenStable();

      (query('[data-testid="formation-item-drawer-save"] button') as HTMLElement)?.click();
      await fixture.whenStable();

      expect(updateFormationItemAssignmentMock).toHaveBeenCalledTimes(2);
      expect(updateFormationItemAssignmentMock).toHaveBeenNthCalledWith(1, item.project_uid, item.template_item_key, '3', { due_date: '2026-03-31' });
      // The assignee leg must use '4' (the due-date leg's returned version), not the original '3'.
      expect(updateFormationItemAssignmentMock).toHaveBeenNthCalledWith(2, item.project_uid, item.template_item_key, '4', { assignee: 'jdoe' });
    });

    it('keeps a landed due date when the assignee is then refused — partial toast naming both legs, with the assignee_not_on_project copy', async () => {
      const item = buildItem({ owner: null, due_date: null, version: 3 });
      const afterDueDateWrite = { ...item, due_date: '2026-03-31', version: 4 };
      const updateFormationItemAssignmentMock = vi
        .fn()
        .mockReturnValueOnce(of({ item: afterDueDateWrite, etag: '4' }))
        .mockReturnValueOnce(
          throwError(() => new HttpErrorResponse({ status: 400, error: { error: 'assignee holds no grant on the project', code: 'ASSIGNEE_NOT_ON_PROJECT' } }))
        );
      const getFormationItemMock = vi.fn().mockReturnValue(of(buildDetail(item)));
      const messageServiceAddMock = vi.fn();
      await render(item, false, {
        getFormationItem: getFormationItemMock,
        updateFormationItemAssignment: updateFormationItemAssignmentMock,
        messageServiceAdd: messageServiceAddMock,
      });
      const itemUpdatedSpy = vi.fn();
      fixture.componentInstance.itemUpdated.subscribe(itemUpdatedSpy);

      setDueDate(new Date(2026, 2, 31));
      queryUserSearch().onUserSelected({ value: buildUserSearchResult({ username: 'jdoe' }) } as AutoCompleteSelectEvent);
      await fixture.whenStable();

      (query('[data-testid="formation-item-drawer-save"] button') as HTMLElement)?.click();
      await fixture.whenStable();

      // The failed assignee leg cost nothing else: the due date's write already landed, the section
      // is told to refresh its rows (they surface the due date, GH-2692), and the drawer reloads so
      // a retry resends only the assignee against the current version.
      expect(itemUpdatedSpy).toHaveBeenCalledWith(afterDueDateWrite);
      expect(getFormationItemMock).toHaveBeenCalledTimes(2);
      expect(messageServiceAddMock).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'warn',
          summary: 'Partially saved',
          detail: expect.stringContaining('The due date saved, but the assignee did not'),
        })
      );
      expect(messageServiceAddMock).toHaveBeenCalledWith(
        expect.objectContaining({ detail: expect.stringContaining('"jdoe" doesn\'t hold a role on this project yet') })
      );
    });

    it('blocks Save once when the preceding blur discarded typed-but-unselected assignee text — the observed production repro', async () => {
      const item = buildItem({ owner: null, notes: 'old note' });
      const updateFormationItemMock = vi.fn().mockReturnValue(of({ item: { ...item, notes: 'new note', version: 2 }, etag: '2' }));
      const updateFormationItemAssignmentMock = vi.fn();
      const messageServiceAddMock = vi.fn();
      await render(item, false, {
        updateFormationItem: updateFormationItemMock,
        updateFormationItemAssignment: updateFormationItemAssignmentMock,
        messageServiceAdd: messageServiceAddMock,
      });

      const notes = query('[data-testid="formation-item-drawer-notes"] textarea') as HTMLTextAreaElement;
      notes.value = 'new note';
      notes.dispatchEvent(new Event('input'));
      // Type into the assignee search without picking a result, then blur — which is what clicking
      // Save does first: the box snaps back to the committed (empty) value, and the typed text is
      // recorded as discarded by lfx-user-search.
      const search = queryUserSearch();
      (search as unknown as { userSearchForm: FormGroup }).userSearchForm.get('userSearch')?.setValue('Nirav', { emitEvent: false });
      search.onSearchBlur();
      await fixture.whenStable();

      (query('[data-testid="formation-item-drawer-save"] button') as HTMLElement)?.click();
      await fixture.whenStable();

      // First Save: blocked outright — nothing sent (not even the changed note), so the warn can't
      // be mistaken for a partial success; the toast names the exact text that didn't take.
      expect(updateFormationItemMock).not.toHaveBeenCalled();
      expect(updateFormationItemAssignmentMock).not.toHaveBeenCalled();
      expect(messageServiceAddMock).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'warn', summary: 'Assignee not selected', detail: expect.stringContaining('"Nirav"') })
      );

      // Second Save: the record was consumed by the warning — a deliberate repeat proceeds with
      // what actually committed (the note), still without inventing an assignee.
      (query('[data-testid="formation-item-drawer-save"] button') as HTMLElement)?.click();
      await fixture.whenStable();

      expect(updateFormationItemMock).toHaveBeenCalledWith(item.project_uid, item.template_item_key, String(item.version), { note: 'new note' });
      expect(updateFormationItemAssignmentMock).not.toHaveBeenCalled();
    });

    it('names unattempted trailing legs when a middle leg fails — a failed due date must not silently drop the pending assignee', async () => {
      const item = buildItem({ owner: null, notes: 'old note', due_date: null, version: 3 });
      const updateFormationItemMock = vi.fn().mockReturnValue(of({ item: { ...item, notes: 'new note', version: 4 }, etag: '4' }));
      const updateFormationItemAssignmentMock = vi
        .fn()
        .mockReturnValue(throwError(() => new HttpErrorResponse({ status: 400, error: { error: 'due_date must be YYYY-MM-DD', code: 'DUE_DATE_INVALID' } })));
      const getFormationItemMock = vi.fn().mockReturnValue(of(buildDetail(item)));
      const messageServiceAddMock = vi.fn();
      await render(item, false, {
        getFormationItem: getFormationItemMock,
        updateFormationItem: updateFormationItemMock,
        updateFormationItemAssignment: updateFormationItemAssignmentMock,
        messageServiceAdd: messageServiceAddMock,
      });

      const notes = query('[data-testid="formation-item-drawer-notes"] textarea') as HTMLTextAreaElement;
      notes.value = 'new note';
      notes.dispatchEvent(new Event('input'));
      setDueDate(new Date(2026, 2, 31));
      queryUserSearch().onUserSelected({ value: buildUserSearchResult({ username: 'jdoe' }) } as AutoCompleteSelectEvent);
      await fixture.whenStable();

      (query('[data-testid="formation-item-drawer-save"] button') as HTMLElement)?.click();
      await fixture.whenStable();

      // The chain died on the due-date leg — the assignee leg was never sent.
      expect(updateFormationItemAssignmentMock).toHaveBeenCalledTimes(1);
      expect(updateFormationItemAssignmentMock).toHaveBeenCalledWith(item.project_uid, item.template_item_key, '4', { due_date: '2026-03-31' });
      expect(messageServiceAddMock).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: 'warn',
          summary: 'Partially saved',
          detail: expect.stringContaining('The assignee was not attempted'),
        })
      );
    });

    it('a Save with nothing committed reports "Nothing to save" instead of silently doing nothing', async () => {
      const item = buildItem({ owner: null });
      const updateFormationItemMock = vi.fn();
      const updateFormationItemAssignmentMock = vi.fn();
      const messageServiceAddMock = vi.fn();
      await render(item, false, {
        updateFormationItem: updateFormationItemMock,
        updateFormationItemAssignment: updateFormationItemAssignmentMock,
        messageServiceAdd: messageServiceAddMock,
      });

      (query('[data-testid="formation-item-drawer-save"] button') as HTMLElement)?.click();
      await fixture.whenStable();

      expect(updateFormationItemMock).not.toHaveBeenCalled();
      expect(updateFormationItemAssignmentMock).not.toHaveBeenCalled();
      expect(messageServiceAddMock).toHaveBeenCalledWith(expect.objectContaining({ severity: 'info', summary: 'Nothing to save' }));
    });

    it('names the write-access requirement when the assignment leg 403s', async () => {
      const item = buildItem({ owner: null, version: 3 });
      const updateFormationItemAssignmentMock = vi
        .fn()
        .mockReturnValue(throwError(() => new HttpErrorResponse({ status: 403, error: { error: 'forbidden' } })));
      const messageServiceAddMock = vi.fn();
      await render(item, false, { updateFormationItemAssignment: updateFormationItemAssignmentMock, messageServiceAdd: messageServiceAddMock });

      queryUserSearch().onUserSelected({ value: buildUserSearchResult({ username: 'jdoe' }) } as AutoCompleteSelectEvent);
      await fixture.whenStable();

      (query('[data-testid="formation-item-drawer-save"] button') as HTMLElement)?.click();
      await fixture.whenStable();

      expect(messageServiceAddMock).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'error', detail: 'You need write access on this project to change the assignee or due date.' })
      );
    });
  });

  describe('save-twice-in-a-row (Cursor Bugbot, PR #2613)', () => {
    it("a second Save fired before the reload lands uses the first save's own returned version, not the stale pre-save one", async () => {
      // The reload triggered by the first save is mocked to never resolve (`NEVER`) — this is the
      // exact race the bug report describes: a second Save fired before that GET has a chance to
      // land. If the fix only relied on the reload to learn the new version, this second save would
      // resend the stale original version and 412. Fixing a typo, then fixing it again before the
      // page has re-fetched, is the ordinary way a user hits this.
      const item = buildItem({ notes: 'old note', version: 3 });
      const afterFirstSave = { ...item, notes: 'typo fixed', version: 4 };
      const afterSecondSave = { ...item, notes: 'typo fixed twice', version: 5 };
      const updateFormationItemMock = vi
        .fn()
        .mockReturnValueOnce(of({ item: afterFirstSave, etag: '4', item_state: 'complete' as const }))
        .mockReturnValueOnce(of({ item: afterSecondSave, etag: '5', item_state: 'complete' as const }));
      const getFormationItemMock = vi
        .fn()
        .mockReturnValueOnce(of(buildDetail(item)))
        .mockReturnValue(NEVER);
      await render(item, false, { getFormationItem: getFormationItemMock, updateFormationItem: updateFormationItemMock });

      const notes = query('[data-testid="formation-item-drawer-notes"] textarea') as HTMLTextAreaElement;
      const saveButton = (): HTMLElement | null => query('[data-testid="formation-item-drawer-save"] button') as HTMLElement | null;

      notes.value = 'typo fixed';
      notes.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      saveButton()?.click();
      await fixture.whenStable();

      expect(updateFormationItemMock).toHaveBeenNthCalledWith(1, item.project_uid, item.template_item_key, '3', { note: 'typo fixed' });

      notes.value = 'typo fixed twice';
      notes.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      saveButton()?.click();
      await fixture.whenStable();

      // '4' — the first save's own returned version — not the stale original '3'. The reload was
      // never going to resolve in this test, so this can only be correct if the write's own response
      // was consumed synchronously, which is the fix.
      expect(updateFormationItemMock).toHaveBeenNthCalledWith(2, item.project_uid, item.template_item_key, '4', { note: 'typo fixed twice' });
    });
  });

  // Cursor Bugbot, PR #2613: this drawer instance is reused across items, so a Mark complete/Save
  // started on item A can resolve after the user has opened item B and B's GET has landed. Applying
  // that late response to `optimisticItem` unconditionally would flip `item()` back to A while the
  // form still holds B's values — and the next Save would then write B's notes/assignee/due date
  // onto A. The application must be guarded exactly like `reloadIfStillShowing` already is.
  describe('mid-write item switch (Cursor Bugbot, PR #2613)', () => {
    const itemA = (): FormationItem =>
      buildItem({
        uid: 'formation-item:a',
        project_uid: 'project:a',
        template_item_key: 'item-a',
        notes: 'a note',
        owner: { username: 'alice', name: 'alice' },
        status: 'in_progress',
        version: 3,
      });
    const itemB = (): FormationItem =>
      buildItem({
        uid: 'formation-item:b',
        project_uid: 'project:b',
        template_item_key: 'item-b',
        notes: 'b note',
        owner: { username: 'bob', name: 'bob' },
        status: 'in_progress',
        version: 7,
      });

    // The drawer's open fetch re-triggers off `visible` flips only (see `initDrawerData`), so
    // switching items mid-write means toggling visibility with the new item's inputs — exactly what
    // the section host does when the user opens a different row.
    const switchToItem = async (item: FormationItem): Promise<void> => {
      fixture.componentInstance.visible.set(false);
      await fixture.whenStable();
      fixture.detectChanges();
      fixture.componentRef.setInput('itemProjectUid', item.project_uid);
      fixture.componentRef.setInput('itemKey', item.template_item_key);
      fixture.componentInstance.visible.set(true);
      await fixture.whenStable();
      fixture.detectChanges();
    };

    // `item` is protected — same cast pattern the existing `busy()` assertion uses.
    const shownItemUid = (): string | undefined => (fixture.componentInstance as unknown as { item: () => FormationItem | null }).item()?.uid;

    it('a Mark complete resolving after the user switched items must not flip the drawer back to the completed item', async () => {
      const a = itemA();
      const b = itemB();
      const markDone$ = new Subject<{ item: FormationItem; etag: string | null }>();
      const updateFormationItemStatusMock = vi.fn().mockReturnValue(markDone$.asObservable());
      const getFormationItemMock = vi.fn().mockImplementation((_projectUid: string, itemKey: string) => of(buildDetail(itemKey === 'item-a' ? a : b)));
      const updateFormationItemMock = vi.fn().mockReturnValue(of({ item: b, etag: null }));
      await render(a, false, {
        getFormationItem: getFormationItemMock,
        updateFormationItem: updateFormationItemMock,
        updateFormationItemStatus: updateFormationItemStatusMock,
      });

      (query('[data-testid="formation-item-drawer-mark-complete"] button') as HTMLElement)?.click();
      await fixture.whenStable();
      expect(updateFormationItemStatusMock).toHaveBeenCalledWith(a.project_uid, a.template_item_key, '3', { status: 'done' });

      // The user moves on to item B while A's write is still in flight, and B's own GET lands.
      await switchToItem(b);
      expect(shownItemUid()).toBe(b.uid);
      expect(ownerUsernameValue()).toBe('bob');

      // Only now does A's write resolve.
      markDone$.next({ item: { ...a, status: 'done', version: 4 }, etag: '4' });
      await fixture.whenStable();
      fixture.detectChanges();

      // The drawer must keep showing B with B's form values — an unguarded optimistic application
      // would have flipped `item()` back to A here.
      expect(shownItemUid()).toBe(b.uid);
      expect(ownerUsernameValue()).toBe('bob');

      // The follow-up Save — Bugbot's corruption scenario — must target B, not A.
      const notes = query('[data-testid="formation-item-drawer-notes"] textarea') as HTMLTextAreaElement;
      notes.value = 'edited b note';
      notes.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      (query('[data-testid="formation-item-drawer-save"] button') as HTMLElement)?.click();
      await fixture.whenStable();

      expect(updateFormationItemMock).toHaveBeenCalledWith(b.project_uid, b.template_item_key, '7', { note: 'edited b note' });
    });

    it('a Save resolving after the user switched items must not flip the drawer back to the saved item', async () => {
      const a = itemA();
      const b = itemB();
      const noteWrite$ = new Subject<{ item: FormationItem; etag: string | null }>();
      const updateFormationItemMock = vi.fn().mockReturnValue(noteWrite$.asObservable());
      const getFormationItemMock = vi.fn().mockImplementation((_projectUid: string, itemKey: string) => of(buildDetail(itemKey === 'item-a' ? a : b)));
      await render(a, false, { getFormationItem: getFormationItemMock, updateFormationItem: updateFormationItemMock });

      const notes = query('[data-testid="formation-item-drawer-notes"] textarea') as HTMLTextAreaElement;
      notes.value = 'edited a note';
      notes.dispatchEvent(new Event('input'));
      await fixture.whenStable();
      (query('[data-testid="formation-item-drawer-save"] button') as HTMLElement)?.click();
      await fixture.whenStable();
      expect(updateFormationItemMock).toHaveBeenCalledWith(a.project_uid, a.template_item_key, '3', { note: 'edited a note' });

      // The user switches to B (and B's GET lands) while A's save is still in flight.
      await switchToItem(b);
      const getCallCountAfterSwitch = getFormationItemMock.mock.calls.length;

      noteWrite$.next({ item: { ...a, notes: 'edited a note', version: 4 }, etag: '4' });
      await fixture.whenStable();
      fixture.detectChanges();

      expect(shownItemUid()).toBe(b.uid);
      expect(ownerUsernameValue()).toBe('bob');
      // The stale save's reload must not fire either — it would refetch whatever item is now showing.
      expect(getFormationItemMock.mock.calls.length).toBe(getCallCountAfterSwitch);
    });

    it('a partial Save failure surfacing after the user switched items must not apply the note-leg result to the newly shown item', async () => {
      const a = itemA();
      const b = itemB();
      const afterNoteWrite = { ...a, notes: 'edited a note', version: 4 };
      const updateFormationItemMock = vi.fn().mockReturnValue(of({ item: afterNoteWrite, etag: '4' }));
      const assignmentWrite$ = new Subject<{ item: FormationItem; etag: string | null }>();
      const updateFormationItemAssignmentMock = vi.fn().mockReturnValue(assignmentWrite$.asObservable());
      const getFormationItemMock = vi.fn().mockImplementation((_projectUid: string, itemKey: string) => of(buildDetail(itemKey === 'item-a' ? a : b)));
      await render(a, false, {
        getFormationItem: getFormationItemMock,
        updateFormationItem: updateFormationItemMock,
        updateFormationItemAssignment: updateFormationItemAssignmentMock,
      });

      // Change both the note and the assignee so the save runs both legs; the note leg succeeds
      // synchronously while the assignment leg stays in flight.
      const notes = query('[data-testid="formation-item-drawer-notes"] textarea') as HTMLTextAreaElement;
      notes.value = 'edited a note';
      notes.dispatchEvent(new Event('input'));
      queryUserSearch().onUserSelected({ value: buildUserSearchResult({ username: 'carol' }) } as AutoCompleteSelectEvent);
      await fixture.whenStable();
      (query('[data-testid="formation-item-drawer-save"] button') as HTMLElement)?.click();
      await fixture.whenStable();
      expect(updateFormationItemAssignmentMock).toHaveBeenCalledWith(a.project_uid, a.template_item_key, '4', expect.objectContaining({ assignee: 'carol' }));

      // The user switches to B before the assignment leg fails.
      await switchToItem(b);
      const getCallCountAfterSwitch = getFormationItemMock.mock.calls.length;

      assignmentWrite$.error(new Error('412 Precondition Failed'));
      await fixture.whenStable();
      fixture.detectChanges();

      // The note leg already landed upstream, but its result must not be applied onto the drawer
      // now showing B — and the partial-failure reload must not fire under B's identity either.
      expect(shownItemUid()).toBe(b.uid);
      expect(ownerUsernameValue()).toBe('bob');
      expect(getFormationItemMock.mock.calls.length).toBe(getCallCountAfterSwitch);
    });
  });
});
