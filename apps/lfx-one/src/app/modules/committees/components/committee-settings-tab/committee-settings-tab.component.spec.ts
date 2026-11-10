// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter, Router } from '@angular/router';
import { CommitteeMemberVotingStatus, MailingListSyncMode } from '@lfx-one/shared/enums';
import { Committee, GroupsIOMailingList } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { LensService } from '@services/lens.service';
import { MailingListService } from '@services/mailing-list.service';
import { PersonaService } from '@services/persona.service';
import { UserService } from '@services/user.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of, Subject, throwError } from 'rxjs';

import { UiDrawerService } from '@shared/uikit/drawer/drawer.service';

import { CommitteeSettingsTabComponent } from './committee-settings-tab.component';

/**
 * Covers the invariants that are only asserted in prose comments on this component: the
 * dirty-gated save payload, the dirty-value-survives-refresh behavior, the impersonation-specific
 * re-disable inside the shared canEdit/impersonating subscription, and the four saveSettings
 * error-code branches. The sibling CommitteeSettingsComponent (presentational) has its own spec;
 * this one exercises the parent that actually owns the save/refresh/authorization logic.
 */
describe('CommitteeSettingsTabComponent — Slack webhook (LFXV2-3080)', () => {
  let fixture: ComponentFixture<CommitteeSettingsTabComponent>;
  let component: CommitteeSettingsTabComponent;
  let updateCommittee: ReturnType<typeof vi.fn>;
  let messageAdd: ReturnType<typeof vi.fn>;
  let impersonating: WritableSignal<boolean>;

  const COMMITTEE: Committee = {
    uid: 'committee-1',
    name: 'Test Committee',
    project_uid: 'project-1',
    category: 'Board',
    has_slack_webhook: false,
  } as Committee;

  beforeEach(async () => {
    updateCommittee = vi.fn(() => of(COMMITTEE));
    messageAdd = vi.fn();
    impersonating = signal(false);

    await TestBed.configureTestingModule({
      imports: [CommitteeSettingsTabComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: CommitteeService, useValue: { updateCommittee, getCommittee: vi.fn(() => of(COMMITTEE)), getCommitteesByProject: vi.fn(() => of([])) } },
        { provide: PersonaService, useValue: { currentPersona: signal('board-member') } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(true)) } },
        { provide: LensService, useValue: { activeLens: signal('project') } },
        {
          provide: MailingListService,
          useValue: {
            getMailingListsByCommittee: vi.fn(() => of([])),
            getMailingListsByProject: vi.fn(() => of([])),
            updateMailingList: vi.fn(() => of({})),
          },
        },
        { provide: MessageService, useValue: { add: messageAdd } },
        // Real service, not a fake: PrimeNG's <p-confirmDialog> in the template subscribes to
        // ConfirmationService's internal Subjects directly in its constructor — a useValue fake
        // without them throws "Cannot read properties of undefined (reading 'subscribe')" the
        // moment the fixture renders. The service itself has no external dependencies.
        ConfirmationService,
        { provide: UserService, useValue: { impersonating } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CommitteeSettingsTabComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('committee', COMMITTEE);
    fixture.componentRef.setInput('canEdit', true);
    await fixture.whenStable();
  });

  it('omits chat_webhook_url from the save payload when the control is pristine', () => {
    component.saveSettings();

    expect(updateCommittee).toHaveBeenCalledOnce();
    const payload = updateCommittee.mock.calls[0][1];
    expect(payload).not.toHaveProperty('chat_webhook_url');
  });

  it('includes chat_webhook_url in the save payload when the control is dirty', () => {
    component.form.controls.chat_webhook_url.setValue('https://hooks.slack.com/services/T1/B1/X');
    component.form.controls.chat_webhook_url.markAsDirty();

    component.saveSettings();

    const payload = updateCommittee.mock.calls[0][1];
    expect(payload.chat_webhook_url).toBe('https://hooks.slack.com/services/T1/B1/X');
  });

  it('omits chat_webhook_url when the control is dirty-but-empty and no removal was staged — Replace-then-cleared-back-to-empty must not silently delete a configured webhook', () => {
    component.form.controls.chat_webhook_url.setValue('https://hooks.slack.com/services/T1/B1/X');
    component.form.controls.chat_webhook_url.setValue('');
    component.form.controls.chat_webhook_url.markAsDirty();
    expect(component.slackWebhookRemovalStaged()).toBe(false);

    component.saveSettings();

    const payload = updateCommittee.mock.calls[0][1];
    expect(payload).not.toHaveProperty('chat_webhook_url');
  });

  it('sends chat_webhook_url: null when the control is dirty-and-empty AND a removal was explicitly staged', () => {
    component.form.controls.chat_webhook_url.setValue('');
    component.form.controls.chat_webhook_url.markAsDirty();
    component.slackWebhookRemovalStaged.set(true);

    component.saveSettings();

    const payload = updateCommittee.mock.calls[0][1];
    expect(payload.chat_webhook_url).toBeNull();
  });

  it('clears a staged removal the moment the user types a non-empty value — typing a replacement supersedes Remove', () => {
    component.slackWebhookRemovalStaged.set(true);

    component.form.controls.chat_webhook_url.setValue('https://hooks.slack.com/services/T1/B1/X');

    expect(component.slackWebhookRemovalStaged()).toBe(false);
  });

  it('end-to-end: clicking the real Remove button on a configured committee, then Save, sends chat_webhook_url: null — exercises the actual child-emit → parent-signal wire, not just the signal set by hand', async () => {
    // The other slackWebhookRemovalStaged tests above set the signal directly — they'd still pass
    // even if the (removeSlackWebhookStaged) or [slackWebhookRemovalStaged] bindings in
    // committee-settings-tab.component.html were deleted or misspelled. Only a real click through
    // the rendered child, plus asserting the hint it feeds back into actually renders, catches that.
    fixture.componentRef.setInput('committee', { ...COMMITTEE, has_slack_webhook: true });
    await fixture.whenStable();

    const removeButton = fixture.nativeElement.querySelector('[data-testid="settings-slack-webhook-remove-button"] button') as HTMLButtonElement;
    if (!removeButton) throw new Error('no native button rendered inside settings-slack-webhook-remove-button');
    removeButton.click();
    await fixture.whenStable();

    expect(component.slackWebhookRemovalStaged()).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-testid="settings-slack-webhook-removal-staged-hint"]')).not.toBeNull();

    component.saveSettings();

    const payload = updateCommittee.mock.calls[0][1];
    expect(payload.chat_webhook_url).toBeNull();
  });

  it('preserves a dirty chat_webhook_url value across a committee input refresh instead of nulling it', async () => {
    component.form.controls.chat_webhook_url.setValue('https://hooks.slack.com/services/T1/B1/X');
    component.form.controls.chat_webhook_url.markAsDirty();

    fixture.componentRef.setInput('committee', { ...COMMITTEE, name: 'Renamed' });
    await fixture.whenStable();

    expect(component.form.controls.chat_webhook_url.value).toBe('https://hooks.slack.com/services/T1/B1/X');
  });

  it("clears a dirty chat_webhook_url when the committee input switches to a DIFFERENT committee — an unsaved edit for committee A must never survive into committee B's form or save payload", async () => {
    const OTHER_COMMITTEE: Committee = { ...COMMITTEE, uid: 'committee-2', name: 'Other Committee' };

    component.form.controls.chat_webhook_url.setValue('https://hooks.slack.com/services/T1/B1/X');
    component.form.controls.chat_webhook_url.markAsDirty();
    component.editingSlackWebhookUrl.set(true);

    fixture.componentRef.setInput('committee', OTHER_COMMITTEE);
    await fixture.whenStable();

    expect(component.form.controls.chat_webhook_url.value).toBeNull();
    expect(component.editingSlackWebhookUrl()).toBe(false);

    component.saveSettings();
    const payload = updateCommittee.mock.calls[0][1];
    expect(payload).not.toHaveProperty('chat_webhook_url');
  });

  it('nulls chat_webhook_url on a committee refresh when the control is pristine — even if it holds a value (e.g. left over from a prior successful save reset)', async () => {
    // Seeded via setValue + markAsPristine, not left at its initial null — a test asserting
    // null-stays-null after a refresh would pass even if the constructor's
    // `...(preserveWebhookEdit ? {} : { chat_webhook_url: null })` clause were deleted entirely.
    component.form.controls.chat_webhook_url.setValue('https://hooks.slack.com/services/T1/B1/X');
    component.form.controls.chat_webhook_url.markAsPristine();

    fixture.componentRef.setInput('committee', { ...COMMITTEE, name: 'Renamed' });
    await fixture.whenStable();

    expect(component.form.controls.chat_webhook_url.value).toBeNull();
  });

  it('disables chat_webhook_url when impersonating flips true while canEdit stays true — the rest of the form stays enabled', async () => {
    expect(component.form.controls.chat_webhook_url.disabled).toBe(false);

    impersonating.set(true);
    await fixture.whenStable();

    expect(component.form.controls.chat_webhook_url.disabled).toBe(true);
    expect(component.form.controls.chat_channel.disabled).toBe(false);
  });

  it('omits chat_webhook_url from the save payload once impersonation disables it, even though it stays dirty — getRawValue() includes disabled controls and disable() never clears dirty, so a value typed BEFORE impersonation started must not still be sent, which would otherwise get the whole save rejected (IMPERSONATION_READ_ONLY) over a field the user can no longer edit', async () => {
    component.form.controls.chat_webhook_url.setValue('https://hooks.slack.com/services/T1/B1/X');
    component.form.controls.chat_webhook_url.markAsDirty();

    impersonating.set(true);
    await fixture.whenStable();
    expect(component.form.controls.chat_webhook_url.disabled).toBe(true);
    expect(component.form.controls.chat_webhook_url.dirty).toBe(true);

    component.saveSettings();

    const payload = updateCommittee.mock.calls[0][1];
    expect(payload).not.toHaveProperty('chat_webhook_url');
  });

  it('does NOT reset the disabled-and-excluded chat_webhook_url control after a successful save of unrelated fields — the success handler used to reset it whenever merely dirty, silently wiping a typed URL that was never actually sent', async () => {
    component.form.controls.chat_webhook_url.setValue('https://hooks.slack.com/services/T1/B1/X');
    component.form.controls.chat_webhook_url.markAsDirty();

    impersonating.set(true);
    await fixture.whenStable();

    component.saveSettings();

    expect(component.form.controls.chat_webhook_url.value).toBe('https://hooks.slack.com/services/T1/B1/X');
    expect(component.form.controls.chat_webhook_url.dirty).toBe(true);
  });

  it('re-disables chat_webhook_url after a canEdit-driven form.enable() re-enables every control', async () => {
    impersonating.set(true);
    await fixture.whenStable();
    expect(component.form.controls.chat_webhook_url.disabled).toBe(true);

    // Auditor toggle: canEdit flips off then back on — form.enable() re-enables every control;
    // the impersonation re-disable must still apply afterward, in the same subscription.
    fixture.componentRef.setInput('canEdit', false);
    await fixture.whenStable();
    fixture.componentRef.setInput('canEdit', true);
    await fixture.whenStable();

    expect(component.form.controls.chat_webhook_url.disabled).toBe(true);
  });

  it('surfaces IMPERSONATION_READ_ONLY (403) without emitting committeeUpdated', () => {
    updateCommittee.mockReturnValueOnce(throwError(() => ({ status: 403, error: { code: 'IMPERSONATION_READ_ONLY' } })));
    component.form.controls.chat_webhook_url.setValue('https://hooks.slack.com/services/T1/B1/X');
    component.form.controls.chat_webhook_url.markAsDirty();

    const emitted: void[] = [];
    component.committeeUpdated.subscribe(() => emitted.push(undefined));

    component.saveSettings();

    expect(emitted).toHaveLength(0);
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.stringContaining('impersonating') }));
  });

  it('surfaces NOT_PROJECT_WRITER (403) without emitting committeeUpdated — nothing on the save persisted', () => {
    updateCommittee.mockReturnValueOnce(throwError(() => ({ status: 403, error: { code: 'NOT_PROJECT_WRITER' } })));

    const emitted: void[] = [];
    component.committeeUpdated.subscribe(() => emitted.push(undefined));

    component.saveSettings();

    expect(emitted).toHaveLength(0);
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.stringContaining('Only project writers') }));
  });

  it('surfaces FEATURE_DISABLED (409) without emitting committeeUpdated — the server checks this before any write, so nothing on the save persisted, and the generic "Failed to save settings" fallback must not be shown instead', () => {
    updateCommittee.mockReturnValueOnce(throwError(() => ({ status: 409, error: { code: 'FEATURE_DISABLED' } })));

    const emitted: void[] = [];
    component.committeeUpdated.subscribe(() => emitted.push(undefined));

    component.saveSettings();

    expect(emitted).toHaveLength(0);
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.stringContaining('not enabled in this environment') }));
  });

  it('surfaces a 400 field-validation error using the server-supplied message, without emitting committeeUpdated', () => {
    updateCommittee.mockReturnValueOnce(throwError(() => ({ status: 400, error: { errors: [{ message: 'Must be a valid Slack Incoming Webhook URL' }] } })));

    const emitted: void[] = [];
    component.committeeUpdated.subscribe(() => emitted.push(undefined));

    component.saveSettings();

    expect(emitted).toHaveLength(0);
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ detail: 'Must be a valid Slack Incoming Webhook URL' }));
  });
});

describe('CommitteeSettingsTabComponent — general settings (name, type, parent)', () => {
  let fixture: ComponentFixture<CommitteeSettingsTabComponent>;
  let component: CommitteeSettingsTabComponent;
  let updateCommittee: ReturnType<typeof vi.fn>;
  let confirmationService: ConfirmationService;

  const COMMITTEE: Committee = {
    uid: 'committee-1',
    name: 'Test Committee',
    project_uid: 'project-1',
    category: 'Board',
    parent_uid: 'parent-1',
    has_slack_webhook: false,
  } as Committee;

  beforeEach(async () => {
    updateCommittee = vi.fn(() => of(COMMITTEE));

    await TestBed.configureTestingModule({
      imports: [CommitteeSettingsTabComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: CommitteeService, useValue: { updateCommittee, getCommittee: vi.fn(() => of(COMMITTEE)), getCommitteesByProject: vi.fn(() => of([])) } },
        { provide: PersonaService, useValue: { currentPersona: signal('board-member') } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(false)) } },
        { provide: LensService, useValue: { activeLens: signal('project') } },
        {
          provide: MailingListService,
          useValue: {
            getMailingListsByCommittee: vi.fn(() => of([])),
            getMailingListsByProject: vi.fn(() => of([])),
            updateMailingList: vi.fn(() => of({})),
          },
        },
        { provide: MessageService, useValue: { add: vi.fn() } },
        ConfirmationService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();

    confirmationService = TestBed.inject(ConfirmationService);
    fixture = TestBed.createComponent(CommitteeSettingsTabComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('committee', COMMITTEE);
    fixture.componentRef.setInput('canEdit', true);
    await fixture.whenStable();
  });

  it('patches name, category and parent_uid from the committee', () => {
    expect(component.form.getRawValue()).toMatchObject({ name: 'Test Committee', category: 'Board', parent_uid: 'parent-1' });
  });

  it('saves a rename without a confirmation, sending only the changed general field', () => {
    const confirm = vi.spyOn(confirmationService, 'confirm');
    component.form.patchValue({ name: '  Renamed  ' });

    component.saveSettings();

    expect(confirm).not.toHaveBeenCalled();
    expect(updateCommittee).toHaveBeenCalledOnce();
    const payload = updateCommittee.mock.calls[0][1];
    expect(payload.name).toBe('Renamed');
    expect(payload).not.toHaveProperty('category');
    expect(payload).not.toHaveProperty('parent_uid');
  });

  it('omits name, category and parent_uid when none were touched — echoing a stale page would revert another writer', () => {
    component.form.patchValue({ join_mode: 'open' });

    component.saveSettings();

    const payload = updateCommittee.mock.calls[0][1];
    expect(payload).not.toHaveProperty('name');
    expect(payload).not.toHaveProperty('category');
    expect(payload).not.toHaveProperty('parent_uid');
    expect(payload.join_mode).toBe('open');
  });

  it('still saves unrelated settings for a group that has no category', async () => {
    fixture.componentRef.setInput('committee', { ...COMMITTEE, category: undefined } as unknown as Committee);
    await fixture.whenStable();
    component.form.patchValue({ join_mode: 'open' });

    expect(component.form.invalid).toBe(false);
    component.saveSettings();

    expect(updateCommittee).toHaveBeenCalledOnce();
    expect(updateCommittee.mock.calls[0][1]).not.toHaveProperty('category');
  });

  it('words the type-change confirmation without "undefined" when the group had no type', async () => {
    const confirm = vi.spyOn(confirmationService, 'confirm');
    fixture.componentRef.setInput('committee', { ...COMMITTEE, category: undefined } as unknown as Committee);
    await fixture.whenStable();
    component.form.patchValue({ category: 'Maintainers' });

    component.saveSettings();

    const { message } = confirm.mock.calls[0][0];
    expect(message).toContain('to Maintainers');
    expect(message).not.toMatch(/undefined|null/);
  });

  it('asks for confirmation before saving a changed type and does not save until accepted', () => {
    const confirm = vi.spyOn(confirmationService, 'confirm');
    component.form.patchValue({ category: 'Maintainers' });

    component.saveSettings();

    expect(confirm).toHaveBeenCalledOnce();
    expect(updateCommittee).not.toHaveBeenCalled();

    confirm.mock.calls[0][0].accept?.();

    expect(updateCommittee).toHaveBeenCalledOnce();
    expect(updateCommittee.mock.calls[0][1]).toMatchObject({ category: 'Maintainers' });
  });

  it('never saves when the type-change confirmation is rejected', () => {
    const confirm = vi.spyOn(confirmationService, 'confirm');
    component.form.patchValue({ category: 'Maintainers' });

    component.saveSettings();
    confirm.mock.calls[0][0].reject?.();

    expect(updateCommittee).not.toHaveBeenCalled();
  });

  it('sends parent_uid: null when the parent is cleared', () => {
    component.form.patchValue({ parent_uid: null });

    component.saveSettings();

    expect(updateCommittee.mock.calls[0][1].parent_uid).toBeNull();
  });

  it('marks the form invalid for a whitespace-only name, so Save is disabled instead of silently dropping it', () => {
    component.form.patchValue({ name: '   ' });

    expect(component.form.controls.name.invalid).toBe(true);
    expect(component.form.invalid).toBe(true);
  });
});

describe('CommitteeSettingsTabComponent — mailing list write access', () => {
  let fixture: ComponentFixture<CommitteeSettingsTabComponent>;
  let component: CommitteeSettingsTabComponent;
  let updateMailingList: ReturnType<typeof vi.fn>;
  let messageAdd: ReturnType<typeof vi.fn>;

  const COMMITTEE = { uid: 'committee-1', name: 'Test Committee', project_uid: 'project-1', category: 'Board', has_slack_webhook: false } as Committee;

  const list = (uid: string, writer: boolean): GroupsIOMailingList => ({ uid, group_name: uid, writer }) as GroupsIOMailingList;

  async function setup(projectLists: GroupsIOMailingList[], associatedLists: GroupsIOMailingList[] = []): Promise<void> {
    updateMailingList = vi.fn(() => of({}));
    messageAdd = vi.fn();

    await TestBed.configureTestingModule({
      imports: [CommitteeSettingsTabComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: CommitteeService,
          useValue: { updateCommittee: vi.fn(), getCommittee: vi.fn(() => of(COMMITTEE)), getCommitteesByProject: vi.fn(() => of([])) },
        },
        { provide: PersonaService, useValue: { currentPersona: signal('board-member') } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(false)) } },
        { provide: LensService, useValue: { activeLens: signal('project') } },
        {
          provide: MailingListService,
          useValue: {
            getMailingListsByCommittee: vi.fn(() => of(associatedLists)),
            getMailingListsByProject: vi.fn(() => of(projectLists)),
            getMailingList: vi.fn((uid: string) => of([...projectLists, ...associatedLists].find((l) => l.uid === uid))),
            updateMailingList,
          },
        },
        { provide: MessageService, useValue: { add: messageAdd } },
        ConfirmationService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CommitteeSettingsTabComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('committee', COMMITTEE);
    fixture.componentRef.setInput('canEdit', true);
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const addButton = (): HTMLElement | null => fixture.nativeElement.querySelector('[data-testid="settings-add-mailing-list-btn"] button');

  it('disables Add List and explains why when lists exist but none are writable', async () => {
    await setup([list('ml-1', false)]);

    expect(component.mailingListLinkBlocked()).toBe(true);
    expect(addButton()?.hasAttribute('disabled')).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('You need Manage access to a mailing list');
  });

  it('keeps Add List enabled when at least one list is writable', async () => {
    await setup([list('ml-1', false), list('ml-2', true)]);

    expect(component.mailingListLinkBlocked()).toBe(false);
    expect(addButton()?.hasAttribute('disabled')).toBe(false);
  });

  it('keeps Add List enabled when the project has no lists, so Create New List stays reachable', async () => {
    await setup([]);

    expect(component.mailingListLinkBlocked()).toBe(false);
  });

  it('disables the remove button on an associated list the user cannot write', async () => {
    await setup([list('ml-1', false)], [list('ml-1', false)]);

    const removeButton = fixture.nativeElement.querySelector('[data-testid="settings-remove-ml-ml-1"] button');
    expect(removeButton?.hasAttribute('disabled')).toBe(true);
  });

  it('shows a permission message when every association update is rejected with 403', async () => {
    await setup([list('ml-1', true), list('ml-2', true)]);
    updateMailingList.mockImplementation(() => throwError(() => ({ status: 403 })));

    (
      component as unknown as { saveMailingListAssociation(a: Set<string>, b: Set<string>, c: Map<string, MailingListSyncMode>): void }
    ).saveMailingListAssociation(new Set(['ml-1', 'ml-2']), new Set(), new Map());

    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Permission denied' }));
  });

  it('falls back to the generic error when only some failures are 403', async () => {
    await setup([list('ml-1', true), list('ml-2', true)]);
    updateMailingList.mockImplementation((uid: string) => throwError(() => ({ status: uid === 'ml-1' ? 403 : 500 })));

    (
      component as unknown as { saveMailingListAssociation(a: Set<string>, b: Set<string>, c: Map<string, MailingListSyncMode>): void }
    ).saveMailingListAssociation(new Set(['ml-1', 'ml-2']), new Set(), new Map());

    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ detail: 'Failed to update mailing list associations' }));
  });

  it('shows the permission message when removing a list is rejected with 403', async () => {
    await setup([list('ml-1', true)], [list('ml-1', true)]);
    updateMailingList.mockImplementation(() => throwError(() => ({ status: 403 })));

    component.removeMailingList(list('ml-1', true));

    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.stringContaining('Manage access') }));
  });

  it('stays on the Settings tab with a toast when the group is no longer writable, instead of redirecting', async () => {
    await setup([list('ml-1', true)]);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    component.openMailingListPicker();

    expect(navigate).not.toHaveBeenCalled();
    expect(messageAdd).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'warn', detail: expect.stringContaining('permission to manage mailing lists') })
    );
  });
});

// Exercises buildMlUpdatePayload's sync_mode branch (#4880 review) via saveMailingListAssociation,
// the private method the mailing-list-picker dialog's onClose callback invokes. Called directly as
// a private member since the dialog itself (DialogService.open + its onClose) isn't under test here.
describe('CommitteeSettingsTabComponent — mailing list sync_mode on committee change (#4880 review)', () => {
  let fixture: ComponentFixture<CommitteeSettingsTabComponent>;
  let component: CommitteeSettingsTabComponent;
  let updateMailingList: ReturnType<typeof vi.fn>;

  const COMMITTEE: Committee = {
    uid: 'committee-1',
    name: 'Test Committee',
    project_uid: 'project-1',
    category: 'Board',
    has_slack_webhook: false,
  } as Committee;

  const makeMl = (overrides: Partial<GroupsIOMailingList>): GroupsIOMailingList =>
    ({
      uid: 'ml-1',
      group_name: 'test-list',
      public: false,
      type: 'discussion_open',
      audience_access: 'public',
      description: 'A test list',
      title: 'Test List',
      service_uid: 'service-1',
      committees: [{ uid: 'committee-1', sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST }],
      ...overrides,
    }) as GroupsIOMailingList;

  async function createFixture(projectMailingLists: GroupsIOMailingList[]): Promise<void> {
    updateMailingList = vi.fn(() => of({}));

    await TestBed.configureTestingModule({
      imports: [CommitteeSettingsTabComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: CommitteeService,
          useValue: { updateCommittee: vi.fn(() => of(COMMITTEE)), getCommittee: vi.fn(() => of(COMMITTEE)), getCommitteesByProject: vi.fn(() => of([])) },
        },
        { provide: PersonaService, useValue: { currentPersona: signal('board-member') } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(true)) } },
        { provide: LensService, useValue: { activeLens: signal('project') } },
        {
          provide: MailingListService,
          useValue: {
            getMailingListsByCommittee: vi.fn(() => of(projectMailingLists)),
            getMailingListsByProject: vi.fn(() => of(projectMailingLists)),
            getMailingList: vi.fn((uid: string) => of(projectMailingLists.find((l) => l.uid === uid))),
            updateMailingList,
          },
        },
        { provide: MessageService, useValue: { add: vi.fn() } },
        ConfirmationService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CommitteeSettingsTabComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('committee', COMMITTEE);
    fixture.componentRef.setInput('canEdit', true);
    await fixture.whenStable();
  }

  it('keeps sync_mode when the mailing list stays linked to the same committee', async () => {
    const ml = makeMl({ uid: 'ml-1', committees: [{ uid: 'committee-1', sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST }] });
    await createFixture([ml]);

    // Re-selecting the same already-associated list: not in originalSelectedUids → treated as
    // "added" by saveMailingListAssociation, which is exactly the re-link-same-committee case.
    (component as any).saveMailingListAssociation(new Set(['ml-1']), new Set(), new Map());

    expect(updateMailingList).toHaveBeenCalledOnce();
    const payload = updateMailingList.mock.calls[0][1];
    expect(payload.committee_uid).toBe('committee-1');
    expect(payload.sync_mode).toBe(MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST);
  });

  it('resets sync_mode to MANUAL when the mailing list is linked to a different committee', async () => {
    const ml = makeMl({ uid: 'ml-1', committees: [{ uid: 'committee-OLD', sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST }] });
    await createFixture([ml]);

    (component as any).saveMailingListAssociation(new Set(['ml-1']), new Set(), new Map());

    const payload = updateMailingList.mock.calls[0][1];
    expect(payload.committee_uid).toBe('committee-1');
    expect(payload.sync_mode).toBe(MailingListSyncMode.MANUAL);
  });

  it('omits sync_mode when the mailing list is removed from the committee', async () => {
    const ml = makeMl({ uid: 'ml-1', committees: [{ uid: 'committee-1', sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST }] });
    await createFixture([ml]);

    // Not in currentSelection but present in originalSelectedUids → treated as "removed".
    (component as any).saveMailingListAssociation(new Set(), new Set(['ml-1']), new Map());

    const payload = updateMailingList.mock.calls[0][1];
    expect(payload.committee_uid).toBeNull();
    expect(payload.sync_mode).toBeUndefined();
  });

  // #4026: the picker dialog's per-list sync-direction control passes an explicit syncMode that
  // overrides buildMlUpdatePayload's committee-change defaults above.
  it('applies the explicit direction chosen in the picker dialog when linking a list', async () => {
    const ml = makeMl({ uid: 'ml-1', committees: [{ uid: 'committee-OLD', sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST }] });
    await createFixture([ml]);

    (component as any).saveMailingListAssociation(new Set(['ml-1']), new Set(), new Map([['ml-1', MailingListSyncMode.AUTO_MAILING_LIST_TO_COMMITTEE]]));

    const payload = updateMailingList.mock.calls[0][1];
    expect(payload.committee_uid).toBe('committee-1');
    // Without the explicit override this would reset to MANUAL (different-committee re-link).
    expect(payload.sync_mode).toBe(MailingListSyncMode.AUTO_MAILING_LIST_TO_COMMITTEE);
  });

  it('issues an update for a list that stays linked but only has its sync direction changed', async () => {
    const ml = makeMl({ uid: 'ml-1', committees: [{ uid: 'committee-1', sync_mode: MailingListSyncMode.MANUAL }] });
    await createFixture([ml]);

    (component as any).saveMailingListAssociation(
      new Set(['ml-1']),
      new Set(['ml-1']),
      new Map([['ml-1', MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST]])
    );

    expect(updateMailingList).toHaveBeenCalledOnce();
    const payload = updateMailingList.mock.calls[0][1];
    expect(payload.committee_uid).toBe('committee-1');
    expect(payload.sync_mode).toBe(MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST);
  });

  it('skips the update for a list that stays linked with the same sync direction', async () => {
    const ml = makeMl({ uid: 'ml-1', committees: [{ uid: 'committee-1', sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST }] });
    await createFixture([ml]);

    (component as any).saveMailingListAssociation(
      new Set(['ml-1']),
      new Set(['ml-1']),
      new Map([['ml-1', MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST]])
    );

    expect(updateMailingList).not.toHaveBeenCalled();
  });
});

// Exercises buildMlUpdatePayload's committee_filters/committee_role_filters resolution and
// saveMailingListAssociation's broadened configChanged detection (#4026 criterion 3).
describe('CommitteeSettingsTabComponent — committee/role filters for auto_c_to_ml sync (#4026)', () => {
  let fixture: ComponentFixture<CommitteeSettingsTabComponent>;
  let component: CommitteeSettingsTabComponent;
  let updateMailingList: ReturnType<typeof vi.fn>;

  const COMMITTEE: Committee = {
    uid: 'committee-1',
    name: 'Test Committee',
    project_uid: 'project-1',
    category: 'Board',
    has_slack_webhook: false,
  } as Committee;

  const makeMl = (overrides: Partial<GroupsIOMailingList>): GroupsIOMailingList =>
    ({
      uid: 'ml-1',
      group_name: 'test-list',
      public: false,
      type: 'discussion_open',
      audience_access: 'public',
      description: 'A test list',
      title: 'Test List',
      service_uid: 'service-1',
      committees: [
        { uid: 'committee-1', sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST, allowed_voting_statuses: [], committee_role_filters: [] },
      ],
      ...overrides,
    }) as GroupsIOMailingList;

  async function createFixture(projectMailingLists: GroupsIOMailingList[]): Promise<void> {
    updateMailingList = vi.fn(() => of({}));

    await TestBed.configureTestingModule({
      imports: [CommitteeSettingsTabComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: CommitteeService,
          useValue: { updateCommittee: vi.fn(() => of(COMMITTEE)), getCommittee: vi.fn(() => of(COMMITTEE)), getCommitteesByProject: vi.fn(() => of([])) },
        },
        { provide: PersonaService, useValue: { currentPersona: signal('board-member') } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(true)) } },
        { provide: LensService, useValue: { activeLens: signal('project') } },
        {
          provide: MailingListService,
          useValue: {
            getMailingListsByCommittee: vi.fn(() => of(projectMailingLists)),
            getMailingListsByProject: vi.fn(() => of(projectMailingLists)),
            getMailingList: vi.fn((uid: string) => of(projectMailingLists.find((m) => m.uid === uid))),
            updateMailingList,
          },
        },
        { provide: MessageService, useValue: { add: vi.fn() } },
        ConfirmationService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CommitteeSettingsTabComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('committee', COMMITTEE);
    fixture.componentRef.setInput('canEdit', true);
    await fixture.whenStable();
  }

  it('includes committee_filters and committee_role_filters when linking a list with auto_c_to_ml direction', async () => {
    const ml = makeMl({ uid: 'ml-1', committees: [{ uid: 'committee-OLD', sync_mode: MailingListSyncMode.MANUAL }] });
    await createFixture([ml]);

    (component as any).saveMailingListAssociation(
      new Set(['ml-1']),
      new Set(),
      new Map([['ml-1', MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST]]),
      new Map([['ml-1', [CommitteeMemberVotingStatus.VOTING_REP]]]),
      new Map([['ml-1', ['Chair']]])
    );

    expect(updateMailingList).toHaveBeenCalledOnce();
    const payload = updateMailingList.mock.calls[0][1];
    expect(payload.sync_mode).toBe(MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST);
    expect(payload.committee_filters).toEqual([CommitteeMemberVotingStatus.VOTING_REP]);
    expect(payload.committee_role_filters).toEqual(['Chair']);
  });

  it('preserves existing committee_filters/committee_role_filters when re-linking the same committee without an explicit override', async () => {
    const ml = makeMl({
      uid: 'ml-1',
      committees: [
        {
          uid: 'committee-1',
          sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST,
          allowed_voting_statuses: [CommitteeMemberVotingStatus.VOTING_REP],
          committee_role_filters: ['Chair'],
        },
      ],
    });
    await createFixture([ml]);

    (component as any).saveMailingListAssociation(new Set(['ml-1']), new Set(), new Map());

    const payload = updateMailingList.mock.calls[0][1];
    expect(payload.committee_filters).toEqual([CommitteeMemberVotingStatus.VOTING_REP]);
    expect(payload.committee_role_filters).toEqual(['Chair']);
  });

  it('resets committee_filters/committee_role_filters when the mailing list is linked to a different committee', async () => {
    const ml = makeMl({
      uid: 'ml-1',
      committees: [
        {
          uid: 'committee-OLD',
          sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST,
          allowed_voting_statuses: [CommitteeMemberVotingStatus.VOTING_REP],
          committee_role_filters: ['Chair'],
        },
      ],
    });
    await createFixture([ml]);

    // No explicit filter maps passed, matching the different-committee re-link path.
    (component as any).saveMailingListAssociation(new Set(['ml-1']), new Set(), new Map([['ml-1', MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST]]));

    const payload = updateMailingList.mock.calls[0][1];
    expect(payload.sync_mode).toBe(MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST);
    expect(payload.committee_filters).toEqual([]);
    expect(payload.committee_role_filters).toEqual([]);
  });

  it('clears committee_filters/committee_role_filters to empty arrays when direction is not auto_c_to_ml', async () => {
    const ml = makeMl({
      uid: 'ml-1',
      committees: [
        {
          uid: 'committee-1',
          sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST,
          allowed_voting_statuses: [CommitteeMemberVotingStatus.VOTING_REP],
          committee_role_filters: ['Chair'],
        },
      ],
    });
    await createFixture([ml]);

    (component as any).saveMailingListAssociation(
      new Set(['ml-1']),
      new Set(['ml-1']),
      new Map([['ml-1', MailingListSyncMode.MANUAL]]),
      new Map([['ml-1', [CommitteeMemberVotingStatus.VOTING_REP]]]),
      new Map([['ml-1', ['Chair']]])
    );

    expect(updateMailingList).toHaveBeenCalledOnce();
    const payload = updateMailingList.mock.calls[0][1];
    expect(payload.sync_mode).toBe(MailingListSyncMode.MANUAL);
    expect(payload.committee_filters).toEqual([]);
    expect(payload.committee_role_filters).toEqual([]);
  });

  it('omits committee_filters/committee_role_filters entirely when the mailing list is fully unlinked', async () => {
    const ml = makeMl({
      uid: 'ml-1',
      committees: [
        {
          uid: 'committee-1',
          sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST,
          allowed_voting_statuses: [CommitteeMemberVotingStatus.VOTING_REP],
          committee_role_filters: ['Chair'],
        },
      ],
    });
    await createFixture([ml]);

    (component as any).saveMailingListAssociation(new Set(), new Set(['ml-1']), new Map());

    const payload = updateMailingList.mock.calls[0][1];
    expect(payload.committee_uid).toBeNull();
    expect(payload.committee_filters).toBeUndefined();
    expect(payload.committee_role_filters).toBeUndefined();
  });

  it('issues an update for a list that stays linked with the same direction but a changed filter set', async () => {
    const ml = makeMl({
      uid: 'ml-1',
      committees: [
        {
          uid: 'committee-1',
          sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST,
          allowed_voting_statuses: [CommitteeMemberVotingStatus.VOTING_REP],
          committee_role_filters: ['Chair'],
        },
      ],
    });
    await createFixture([ml]);

    (component as any).saveMailingListAssociation(
      new Set(['ml-1']),
      new Set(['ml-1']),
      new Map([['ml-1', MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST]]),
      new Map([['ml-1', [CommitteeMemberVotingStatus.ALTERNATE_VOTING_REP]]]),
      new Map([['ml-1', ['Chair']]])
    );

    expect(updateMailingList).toHaveBeenCalledOnce();
    const payload = updateMailingList.mock.calls[0][1];
    expect(payload.committee_filters).toEqual([CommitteeMemberVotingStatus.ALTERNATE_VOTING_REP]);
  });

  it('skips the update for a list that stays linked with the same direction and the same filter set (order-insensitive)', async () => {
    const ml = makeMl({
      uid: 'ml-1',
      committees: [
        {
          uid: 'committee-1',
          sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST,
          allowed_voting_statuses: [CommitteeMemberVotingStatus.VOTING_REP, CommitteeMemberVotingStatus.ALTERNATE_VOTING_REP],
          committee_role_filters: ['Chair'],
        },
      ],
    });
    await createFixture([ml]);

    (component as any).saveMailingListAssociation(
      new Set(['ml-1']),
      new Set(['ml-1']),
      new Map([['ml-1', MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST]]),
      new Map([['ml-1', [CommitteeMemberVotingStatus.ALTERNATE_VOTING_REP, CommitteeMemberVotingStatus.VOTING_REP]]]),
      new Map([['ml-1', ['Chair']]])
    );

    expect(updateMailingList).not.toHaveBeenCalled();
  });
});

// Covers the release-before-activate sequencing added to free up the committee's single auto-sync
// slot before handing it to a different list (PR #5375 review feedback from Greptile, Cursor
// bugbot, lfx-one and Copilot). Each case uses deferred Subjects so the two forkJoins' relative
// timing is directly observable rather than inferred from already-synchronous `of(...)` mocks.
describe('CommitteeSettingsTabComponent — release-before-activate sequencing (#5375 review)', () => {
  let fixture: ComponentFixture<CommitteeSettingsTabComponent>;
  let component: CommitteeSettingsTabComponent;
  let messageAdd: ReturnType<typeof vi.fn>;
  let calls: Record<string, Subject<object>>;
  let updateMailingList: ReturnType<typeof vi.fn>;

  const COMMITTEE: Committee = {
    uid: 'committee-1',
    name: 'Test Committee',
    project_uid: 'project-1',
    category: 'Board',
    has_slack_webhook: false,
  } as Committee;

  const makeMl = (overrides: Partial<GroupsIOMailingList>): GroupsIOMailingList =>
    ({
      uid: 'ml-1',
      group_name: 'test-list',
      public: false,
      type: 'discussion_open',
      audience_access: 'public',
      description: 'A test list',
      title: 'Test List',
      service_uid: 'service-1',
      committees: [{ uid: 'committee-1', sync_mode: MailingListSyncMode.MANUAL }],
      writer: true,
      ...overrides,
    }) as GroupsIOMailingList;

  async function createFixture(projectMailingLists: GroupsIOMailingList[]): Promise<void> {
    calls = {};
    messageAdd = vi.fn();
    updateMailingList = vi.fn((uid: string) => {
      const subject = new Subject<object>();
      calls[uid] = subject;
      return subject.asObservable();
    });

    await TestBed.configureTestingModule({
      imports: [CommitteeSettingsTabComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: CommitteeService,
          useValue: { updateCommittee: vi.fn(() => of(COMMITTEE)), getCommittee: vi.fn(() => of(COMMITTEE)), getCommitteesByProject: vi.fn(() => of([])) },
        },
        { provide: PersonaService, useValue: { currentPersona: signal('board-member') } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(true)) } },
        { provide: LensService, useValue: { activeLens: signal('project') } },
        {
          provide: MailingListService,
          useValue: {
            getMailingListsByCommittee: vi.fn(() => of(projectMailingLists)),
            getMailingListsByProject: vi.fn(() => of(projectMailingLists)),
            // Missing this mock let the GET throw before any PUT was issued, caught as a failed
            // release, so every sequencing test below failed before exercising its intended
            // behavior (#4899 review, Copilot).
            getMailingList: vi.fn((uid: string) => of(projectMailingLists.find((l) => l.uid === uid))),
            updateMailingList,
          },
        },
        { provide: MessageService, useValue: { add: messageAdd } },
        ConfirmationService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CommitteeSettingsTabComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('committee', COMMITTEE);
    fixture.componentRef.setInput('canEdit', true);
    await fixture.whenStable();
  }

  it('does not activate list B until list A — the slot it is handing off from — resolves its release', async () => {
    const listA = makeMl({ uid: 'ml-A', committees: [{ uid: 'committee-1', sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST }] });
    const listB = makeMl({ uid: 'ml-B', committees: [{ uid: 'committee-1', sync_mode: MailingListSyncMode.MANUAL }] });
    await createFixture([listA, listB]);

    (component as any).saveMailingListAssociation(
      new Set(['ml-A', 'ml-B']),
      new Set(['ml-A', 'ml-B']),
      new Map([
        ['ml-A', MailingListSyncMode.MANUAL],
        ['ml-B', MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST],
      ])
    );

    expect(updateMailingList).toHaveBeenCalledWith('ml-A', expect.objectContaining({ sync_mode: MailingListSyncMode.MANUAL }));
    expect(updateMailingList).not.toHaveBeenCalledWith('ml-B', expect.anything());

    calls['ml-A'].next({});
    calls['ml-A'].complete();

    expect(updateMailingList).toHaveBeenCalledWith('ml-B', expect.objectContaining({ sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST }));
    expect(component.savingMl()).toBe(true);

    calls['ml-B'].next({});
    calls['ml-B'].complete();

    expect(component.savingMl()).toBe(false);
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'success' }));
  });

  it('skips activating list B and reports failure when releasing its slot from list A fails', async () => {
    const listA = makeMl({ uid: 'ml-A', committees: [{ uid: 'committee-1', sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST }] });
    const listB = makeMl({ uid: 'ml-B', committees: [{ uid: 'committee-1', sync_mode: MailingListSyncMode.MANUAL }] });
    await createFixture([listA, listB]);

    (component as any).saveMailingListAssociation(
      new Set(['ml-A', 'ml-B']),
      new Set(['ml-A', 'ml-B']),
      new Map([
        ['ml-A', MailingListSyncMode.MANUAL],
        ['ml-B', MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST],
      ])
    );

    calls['ml-A'].error({ status: 500 });

    expect(updateMailingList).not.toHaveBeenCalledWith('ml-B', expect.anything());
    expect(component.savingMl()).toBe(false);
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ detail: 'Failed to update mailing list associations' }));
  });

  it('reports permission-denied, not a generic error, when the skipped slot release failed with 403', async () => {
    const listA = makeMl({ uid: 'ml-A', committees: [{ uid: 'committee-1', sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST }] });
    const listB = makeMl({ uid: 'ml-B', committees: [{ uid: 'committee-1', sync_mode: MailingListSyncMode.MANUAL }] });
    await createFixture([listA, listB]);

    (component as any).saveMailingListAssociation(
      new Set(['ml-A', 'ml-B']),
      new Set(['ml-A', 'ml-B']),
      new Map([
        ['ml-A', MailingListSyncMode.MANUAL],
        ['ml-B', MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST],
      ])
    );

    calls['ml-A'].error({ status: 403 });

    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Permission denied' }));
  });

  it('still activates list B when an unrelated Manual-list update fails in the same save', async () => {
    const listA = makeMl({ uid: 'ml-A', committees: [{ uid: 'committee-1', sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST }] });
    const listB = makeMl({ uid: 'ml-B', committees: [{ uid: 'committee-1', sync_mode: MailingListSyncMode.MANUAL }] });
    const listC = makeMl({ uid: 'ml-C', committees: [{ uid: 'committee-1', sync_mode: MailingListSyncMode.MANUAL }] });
    await createFixture([listA, listB, listC]);

    // ml-C is a brand-new Manual link in this same save — it never held the auto-sync slot, so its
    // failure must not block ml-B's activation (the bug reported by Greptile/Cursor/lfx-one/Copilot).
    (component as any).saveMailingListAssociation(
      new Set(['ml-A', 'ml-B', 'ml-C']),
      new Set(['ml-A', 'ml-B']),
      new Map([
        ['ml-A', MailingListSyncMode.MANUAL],
        ['ml-B', MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST],
      ])
    );

    calls['ml-A'].next({});
    calls['ml-A'].complete();
    calls['ml-C'].error({ status: 500 });

    expect(updateMailingList).toHaveBeenCalledWith('ml-B', expect.objectContaining({ sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST }));

    calls['ml-B'].next({});
    calls['ml-B'].complete();

    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Partial Success' }));
  });
});

// Covers showAutoSyncButton's three gates and the drawer's cross-card save tracking (#4899 review).
describe('CommitteeSettingsTabComponent — Auto Sync drawer (#4899 review)', () => {
  let fixture: ComponentFixture<CommitteeSettingsTabComponent>;
  let component: CommitteeSettingsTabComponent;

  const COMMITTEE: Committee = {
    uid: 'committee-1',
    name: 'Test Committee',
    project_uid: 'project-1',
    category: 'Board',
    has_slack_webhook: false,
  } as Committee;

  const makeMl = (overrides: Partial<GroupsIOMailingList>): GroupsIOMailingList =>
    ({
      uid: 'ml-1',
      group_name: 'test-list',
      public: false,
      type: 'discussion_open',
      audience_access: 'public',
      description: 'A test list',
      title: 'Test List',
      service_uid: 'service-1',
      writer: true,
      committees: [{ uid: 'committee-1' }],
      ...overrides,
    }) as GroupsIOMailingList;

  async function createFixture(options: { canEdit?: boolean; flagEnabled?: boolean; associatedMailingLists?: GroupsIOMailingList[] }): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [CommitteeSettingsTabComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: CommitteeService,
          useValue: { updateCommittee: vi.fn(() => of(COMMITTEE)), getCommittee: vi.fn(() => of(COMMITTEE)), getCommitteesByProject: vi.fn(() => of([])) },
        },
        { provide: PersonaService, useValue: { currentPersona: signal('board-member') } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(options.flagEnabled ?? true)) } },
        { provide: LensService, useValue: { activeLens: signal('project') } },
        {
          provide: MailingListService,
          useValue: {
            getMailingListsByCommittee: vi.fn(() => of(options.associatedMailingLists ?? [])),
            getMailingListsByProject: vi.fn(() => of([])),
            updateMailingList: vi.fn(() => of({})),
          },
        },
        { provide: MessageService, useValue: { add: vi.fn() } },
        ConfirmationService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CommitteeSettingsTabComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('committee', COMMITTEE);
    fixture.componentRef.setInput('canEdit', options.canEdit ?? true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('hides the Auto Sync button when the feature flag is off', async () => {
    await createFixture({ flagEnabled: false, associatedMailingLists: [makeMl({})] });
    expect(component.showAutoSyncButton()).toBe(false);
  });

  it('hides the Auto Sync button when the viewer cannot edit the committee', async () => {
    await createFixture({ canEdit: false, associatedMailingLists: [makeMl({})] });
    expect(component.showAutoSyncButton()).toBe(false);
  });

  it('hides the Auto Sync button when the committee has no linked mailing lists', async () => {
    await createFixture({ associatedMailingLists: [] });
    expect(component.showAutoSyncButton()).toBe(false);
  });

  it('shows the Auto Sync button when the flag is on, the viewer can edit, and a list is linked', async () => {
    await createFixture({ associatedMailingLists: [makeMl({})] });
    expect(component.showAutoSyncButton()).toBe(true);
  });

  it('tracks drawerSavingCount across multiple open cards, keyed by mailing list uid', async () => {
    await createFixture({ associatedMailingLists: [makeMl({ uid: 'ml-1' }), makeMl({ uid: 'ml-2' })] });

    component.onSyncSettingsSavingChange('ml-1', true);
    component.onSyncSettingsSavingChange('ml-2', true);
    expect(component.drawerSavingCount()).toBe(2);

    component.onSyncSettingsSavingChange('ml-1', false);
    expect(component.drawerSavingCount()).toBe(1);

    component.onSyncSettingsSavingChange('ml-2', false);
    expect(component.drawerSavingCount()).toBe(0);
  });

  it('refreshes associatedMailingLists when a drawer card reports an update, so sibling cards see the change', async () => {
    await createFixture({ associatedMailingLists: [makeMl({ uid: 'ml-1' }), makeMl({ uid: 'ml-2' })] });
    const mlService = TestBed.inject(MailingListService) as unknown as { getMailingListsByCommittee: ReturnType<typeof vi.fn> };

    const callsBefore = mlService.getMailingListsByCommittee.mock.calls.length;
    component.onSyncSettingsUpdated(makeMl({ uid: 'ml-1' }));
    await fixture.whenStable();

    expect(mlService.getMailingListsByCommittee.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('keeps refreshingMl locked while a superseded refresh is cancelled, only clearing it when the latest refresh actually completes (#4899 review)', async () => {
    const requests: Subject<GroupsIOMailingList[]>[] = [];
    await TestBed.configureTestingModule({
      imports: [CommitteeSettingsTabComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: CommitteeService,
          useValue: { updateCommittee: vi.fn(() => of(COMMITTEE)), getCommittee: vi.fn(() => of(COMMITTEE)), getCommitteesByProject: vi.fn(() => of([])) },
        },
        { provide: PersonaService, useValue: { currentPersona: signal('board-member') } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(true)) } },
        { provide: LensService, useValue: { activeLens: signal('project') } },
        {
          provide: MailingListService,
          useValue: {
            getMailingListsByCommittee: vi.fn(() => {
              const subject = new Subject<GroupsIOMailingList[]>();
              requests.push(subject);
              return subject.asObservable();
            }),
            getMailingListsByProject: vi.fn(() => of([])),
            updateMailingList: vi.fn(() => of({})),
          },
        },
        { provide: MessageService, useValue: { add: vi.fn() } },
        ConfirmationService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CommitteeSettingsTabComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('committee', COMMITTEE);
    fixture.componentRef.setInput('canEdit', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // The initial committee-driven load is the first request; resolve it so the drawer tests start clean.
    requests[0].next([makeMl({})]);
    requests[0].complete();
    await fixture.whenStable();

    component.onSyncSettingsUpdated(makeMl({}));
    component.onSyncSettingsUpdated(makeMl({}));
    await fixture.whenStable();

    // switchMap cancels the first of the two refresh requests in favor of the second — that
    // cancellation must not clear refreshingMl while the second request is still in flight.
    expect(requests.length).toBe(3);
    expect(component.refreshingMl()).toBe(true);

    requests[2].next([makeMl({})]);
    requests[2].complete();
    await fixture.whenStable();

    expect(component.refreshingMl()).toBe(false);
  });

  it('leaves refreshingMl locked and shows an error toast when a refresh fails, instead of unlocking sibling cards against stale data (#4899 review)', async () => {
    const messageAdd = vi.fn();
    await TestBed.configureTestingModule({
      imports: [CommitteeSettingsTabComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: CommitteeService,
          useValue: { updateCommittee: vi.fn(() => of(COMMITTEE)), getCommittee: vi.fn(() => of(COMMITTEE)), getCommitteesByProject: vi.fn(() => of([])) },
        },
        { provide: PersonaService, useValue: { currentPersona: signal('board-member') } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(true)) } },
        { provide: LensService, useValue: { activeLens: signal('project') } },
        {
          provide: MailingListService,
          useValue: {
            getMailingListsByCommittee: vi
              .fn()
              .mockReturnValueOnce(of([makeMl({})]))
              .mockReturnValueOnce(throwError(() => new Error('network error'))),
            getMailingListsByProject: vi.fn(() => of([])),
            updateMailingList: vi.fn(() => of({})),
          },
        },
        { provide: MessageService, useValue: { add: messageAdd } },
        ConfirmationService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CommitteeSettingsTabComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('committee', COMMITTEE);
    fixture.componentRef.setInput('canEdit', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    component.onSyncSettingsUpdated(makeMl({}));
    await fixture.whenStable();

    expect(component.refreshingMl()).toBe(true);
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
    expect(component.associatedMailingLists().length).toBe(1);
  });

  it('falls back to the last-good project mailing lists on a failed refresh instead of emptying the Add List picker (#4899 review)', async () => {
    const PROJECT_LISTS = [makeMl({ uid: 'proj-ml-1' })];
    await TestBed.configureTestingModule({
      imports: [CommitteeSettingsTabComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: CommitteeService,
          useValue: { updateCommittee: vi.fn(() => of(COMMITTEE)), getCommittee: vi.fn(() => of(COMMITTEE)), getCommitteesByProject: vi.fn(() => of([])) },
        },
        { provide: PersonaService, useValue: { currentPersona: signal('board-member') } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(true)) } },
        { provide: LensService, useValue: { activeLens: signal('project') } },
        {
          provide: MailingListService,
          useValue: {
            getMailingListsByCommittee: vi.fn(() => of([])),
            getMailingListsByProject: vi
              .fn()
              .mockReturnValueOnce(of(PROJECT_LISTS))
              .mockReturnValueOnce(throwError(() => new Error('network error'))),
            updateMailingList: vi.fn(() => of({})),
          },
        },
        { provide: MessageService, useValue: { add: vi.fn() } },
        ConfirmationService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CommitteeSettingsTabComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('committee', COMMITTEE);
    fixture.componentRef.setInput('canEdit', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect((component as any).projectMailingLists()).toEqual(PROJECT_LISTS);

    // onSyncSettingsUpdated only fires refreshMl$, not refreshProjectMl$ (see initProjectMailingLists'
    // doc comment), so it would never exercise the mocked second GET here — use removeMailingList
    // instead, which is one of the paths that actually fires refreshProjectMl$ (#4899 review).
    const mlService = TestBed.inject(MailingListService) as unknown as { getMailingListsByProject: ReturnType<typeof vi.fn> };
    component.removeMailingList(makeMl({ uid: 'other-ml' }));
    await fixture.whenStable();

    expect(mlService.getMailingListsByProject).toHaveBeenCalledTimes(2);
    expect((component as any).projectMailingLists()).toEqual(PROJECT_LISTS);
  });

  it('keeps showing the override after onSyncSettingsUpdated even when the next refetch still returns the old sync_mode (#4899 review)', async () => {
    await createFixture({ associatedMailingLists: [makeMl({ uid: 'ml-1', sync_mode: undefined })] });
    const mlService = TestBed.inject(MailingListService) as unknown as { getMailingListsByCommittee: ReturnType<typeof vi.fn> };
    mlService.getMailingListsByCommittee.mockReturnValue(of([makeMl({ uid: 'ml-1', sync_mode: undefined })]));

    component.onSyncSettingsUpdated(makeMl({ uid: 'ml-1', sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST }));
    await fixture.whenStable();

    const ml = component.associatedMailingLists().find((m) => m.uid === 'ml-1');
    expect(ml?.sync_mode).toBe(MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST);
  });

  it('drops the override once a refetch confirms the same sync_mode (#4899 review)', async () => {
    await createFixture({ associatedMailingLists: [makeMl({ uid: 'ml-1', sync_mode: undefined })] });
    const mlService = TestBed.inject(MailingListService) as unknown as { getMailingListsByCommittee: ReturnType<typeof vi.fn> };

    // Set the matching response before triggering the refresh — onSyncSettingsUpdated fires
    // refreshMl$ synchronously, and a synchronous of() response subscribes immediately.
    mlService.getMailingListsByCommittee.mockReturnValue(
      of([
        makeMl({
          uid: 'ml-1',
          sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST,
          committees: [{ uid: 'committee-1', sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST }],
        }),
      ])
    );
    component.onSyncSettingsUpdated(
      makeMl({
        uid: 'ml-1',
        sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST,
        committees: [{ uid: 'committee-1', sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST }],
      })
    );
    await fixture.whenStable();

    expect((component as any).associatedMlOverrides().size).toBe(0);
  });

  it('drops the override once removeMailingList succeeds for that uid (#4899 review)', async () => {
    await createFixture({ associatedMailingLists: [makeMl({ uid: 'ml-1', sync_mode: undefined, writer: true })] });

    component.onSyncSettingsUpdated(makeMl({ uid: 'ml-1', sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST }));
    expect((component as any).associatedMlOverrides().size).toBe(1);

    component.removeMailingList(makeMl({ uid: 'ml-1', writer: true }));
    await fixture.whenStable();

    expect((component as any).associatedMlOverrides().size).toBe(0);
  });

  it('gives a pending add row a committees[] entry for the current committee, so the drawer can resolve its sync controls (#4899 review)', async () => {
    // Simulates index lag: the list exists on the project but the committee refetch hasn't caught up
    // with the just-added link yet, so it comes back without this uid at all.
    const NEW_ML = makeMl({ uid: 'ml-new', committees: [] });
    await TestBed.configureTestingModule({
      imports: [CommitteeSettingsTabComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: CommitteeService,
          useValue: { updateCommittee: vi.fn(() => of(COMMITTEE)), getCommittee: vi.fn(() => of(COMMITTEE)), getCommitteesByProject: vi.fn(() => of([])) },
        },
        { provide: PersonaService, useValue: { currentPersona: signal('board-member') } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(true)) } },
        { provide: LensService, useValue: { activeLens: signal('project') } },
        {
          provide: MailingListService,
          useValue: {
            getMailingListsByCommittee: vi.fn(() => of([])),
            getMailingListsByProject: vi.fn(() => of([NEW_ML])),
            getMailingList: vi.fn(() => of(NEW_ML)),
            updateMailingList: vi.fn(() => of(NEW_ML)),
          },
        },
        { provide: MessageService, useValue: { add: vi.fn() } },
        ConfirmationService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CommitteeSettingsTabComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('committee', COMMITTEE);
    fixture.componentRef.setInput('canEdit', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    (component as any).saveMailingListAssociation(new Set(['ml-new']), new Set(), new Map([['ml-new', MailingListSyncMode.MANUAL]]));
    await fixture.whenStable();

    const pendingRow = component.associatedMailingLists().find((m) => m.uid === 'ml-new');
    // Before the fix, this pending row carried the raw project snapshot's `committees: []` straight
    // through, so `lfx-mailing-list-sync-settings`' own `committee()` lookup (which scans
    // `committees[]` for the committee uid) resolved to null and the card rendered with no sync
    // controls at all (greptile/Copilot/cursor #4899 review: "Pending add rows skip committee patch").
    expect(pendingRow?.committees?.some((c) => c.uid === 'committee-1')).toBe(true);
  });

  it('resets all overrides when the committee uid changes (#4899 review)', async () => {
    await createFixture({ associatedMailingLists: [makeMl({ uid: 'ml-1', sync_mode: undefined })] });

    component.onSyncSettingsUpdated(makeMl({ uid: 'ml-1', sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST }));
    expect((component as any).associatedMlOverrides().size).toBe(1);

    fixture.componentRef.setInput('committee', { ...COMMITTEE, uid: 'committee-2' });
    fixture.detectChanges();
    await fixture.whenStable();

    expect((component as any).associatedMlOverrides().size).toBe(0);
  });

  it('does not resurface committee A lists when a refresh for committee B fails (#4899 review)', async () => {
    const LISTS_A = [makeMl({ uid: 'ml-a' })];
    await TestBed.configureTestingModule({
      imports: [CommitteeSettingsTabComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: CommitteeService,
          useValue: { updateCommittee: vi.fn(() => of(COMMITTEE)), getCommittee: vi.fn(() => of(COMMITTEE)), getCommitteesByProject: vi.fn(() => of([])) },
        },
        { provide: PersonaService, useValue: { currentPersona: signal('board-member') } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(true)) } },
        { provide: LensService, useValue: { activeLens: signal('project') } },
        {
          provide: MailingListService,
          useValue: {
            getMailingListsByCommittee: vi
              .fn()
              .mockReturnValueOnce(of(LISTS_A))
              .mockReturnValueOnce(throwError(() => new Error('network error'))),
            getMailingListsByProject: vi.fn(() => of([])),
            updateMailingList: vi.fn(() => of({})),
          },
        },
        { provide: MessageService, useValue: { add: vi.fn() } },
        ConfirmationService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CommitteeSettingsTabComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('committee', COMMITTEE);
    fixture.componentRef.setInput('canEdit', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.associatedMailingLists().map((m) => m.uid)).toEqual(['ml-a']);

    // Navigate to a different committee — its fetch fails, so committee A's lists must not leak through.
    fixture.componentRef.setInput('committee', { ...COMMITTEE, uid: 'committee-2' });
    fixture.detectChanges();
    await fixture.whenStable();

    expect(component.associatedMailingLists()).toEqual([]);
  });

  it('clears mlRefreshFailed once retryMlRefresh succeeds (#4899 review)', async () => {
    await TestBed.configureTestingModule({
      imports: [CommitteeSettingsTabComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: CommitteeService,
          useValue: { updateCommittee: vi.fn(() => of(COMMITTEE)), getCommittee: vi.fn(() => of(COMMITTEE)), getCommitteesByProject: vi.fn(() => of([])) },
        },
        { provide: PersonaService, useValue: { currentPersona: signal('board-member') } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(true)) } },
        { provide: LensService, useValue: { activeLens: signal('project') } },
        {
          provide: MailingListService,
          useValue: {
            getMailingListsByCommittee: vi
              .fn()
              .mockReturnValueOnce(of([makeMl({})]))
              .mockReturnValueOnce(throwError(() => new Error('network error')))
              .mockReturnValueOnce(of([makeMl({})])),
            getMailingListsByProject: vi.fn(() => of([])),
            updateMailingList: vi.fn(() => of({})),
          },
        },
        { provide: MessageService, useValue: { add: vi.fn() } },
        ConfirmationService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CommitteeSettingsTabComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('committee', COMMITTEE);
    fixture.componentRef.setInput('canEdit', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    component.onSyncSettingsUpdated(makeMl({}));
    await fixture.whenStable();
    expect(component.mlRefreshFailed()).toBe(true);

    component.retryMlRefresh();
    await fixture.whenStable();

    expect(component.mlRefreshFailed()).toBe(false);
  });

  it('suppresses a removed list from associatedMailingLists until relinked, even if a stale refetch still returns it (#4899 review)', async () => {
    const ML = makeMl({ uid: 'ml-1', writer: true });
    await TestBed.configureTestingModule({
      imports: [CommitteeSettingsTabComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: CommitteeService,
          useValue: { updateCommittee: vi.fn(() => of(COMMITTEE)), getCommittee: vi.fn(() => of(COMMITTEE)), getCommitteesByProject: vi.fn(() => of([])) },
        },
        { provide: PersonaService, useValue: { currentPersona: signal('board-member') } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(true)) } },
        { provide: LensService, useValue: { activeLens: signal('project') } },
        {
          provide: MailingListService,
          useValue: {
            // Keeps returning the uid on every refetch to simulate eventual-consistency staleness —
            // suppression must hide it from associatedMailingLists() regardless (#4899 review).
            getMailingListsByCommittee: vi.fn(() => of([ML])),
            getMailingListsByProject: vi.fn(() => of([ML])),
            getMailingList: vi.fn(() => of(ML)),
            updateMailingList: vi.fn(() => of(ML)),
          },
        },
        { provide: MessageService, useValue: { add: vi.fn() } },
        ConfirmationService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CommitteeSettingsTabComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('committee', COMMITTEE);
    fixture.componentRef.setInput('canEdit', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.associatedMailingLists().map((m) => m.uid)).toEqual(['ml-1']);

    component.removeMailingList(ML);
    await fixture.whenStable();

    // Still returned by the (stale) fetch, but suppressed from view.
    expect(component.associatedMailingLists().map((m) => m.uid)).toEqual([]);

    // Relink via the picker's "added" path lifts the suppression.
    await (component as any).saveMailingListAssociation(new Set(['ml-1']), new Set(), new Map());
    await fixture.whenStable();

    expect(component.associatedMailingLists().map((m) => m.uid)).toEqual(['ml-1']);
  });

  it('clears unlinkedMlUids once a real refetch confirms the uid is gone, not only via the picker relink path (#4899 review)', async () => {
    const ML = makeMl({ uid: 'ml-1', writer: true });
    let callCount = 0;
    const getMailingListsByCommittee = vi.fn(() => {
      callCount++;
      // First call is the initial load; every call after that is the refetch removeMailingList
      // triggers via refreshMl$ — by then the index has caught up and genuinely no longer returns
      // ml-1, confirming its absence rather than staying stale (the relink path is already covered
      // by the test above) (#4899 review).
      return of(callCount === 1 ? [ML] : []);
    });

    await TestBed.configureTestingModule({
      imports: [CommitteeSettingsTabComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: CommitteeService,
          useValue: { updateCommittee: vi.fn(() => of(COMMITTEE)), getCommittee: vi.fn(() => of(COMMITTEE)), getCommitteesByProject: vi.fn(() => of([])) },
        },
        { provide: PersonaService, useValue: { currentPersona: signal('board-member') } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(true)) } },
        { provide: LensService, useValue: { activeLens: signal('project') } },
        {
          provide: MailingListService,
          useValue: {
            getMailingListsByCommittee,
            getMailingListsByProject: vi.fn(() => of([])),
            updateMailingList: vi.fn(() => of(ML)),
          },
        },
        { provide: MessageService, useValue: { add: vi.fn() } },
        ConfirmationService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CommitteeSettingsTabComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('committee', COMMITTEE);
    fixture.componentRef.setInput('canEdit', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.associatedMailingLists().map((m) => m.uid)).toEqual(['ml-1']);

    component.removeMailingList(ML);
    await fixture.whenStable();
    fixture.detectChanges();

    // The refetch triggered by removeMailingList's refreshMl$.next() now genuinely confirms ml-1
    // is gone, so unlinkedMlUids should have self-cleared instead of suppressing the uid forever.
    expect((component as any).unlinkedMlUids().size).toBe(0);
    expect(component.associatedMailingLists().map((m) => m.uid)).toEqual([]);
  });

  it('replaces a pending drawer-set override with the picker dialog direction change for the same list (#4899 review)', async () => {
    const ML = makeMl({ uid: 'ml-1', writer: true, sync_mode: undefined });
    await TestBed.configureTestingModule({
      imports: [CommitteeSettingsTabComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: CommitteeService,
          useValue: { updateCommittee: vi.fn(() => of(COMMITTEE)), getCommittee: vi.fn(() => of(COMMITTEE)), getCommitteesByProject: vi.fn(() => of([])) },
        },
        { provide: PersonaService, useValue: { currentPersona: signal('board-member') } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(true)) } },
        { provide: LensService, useValue: { activeLens: signal('project') } },
        {
          provide: MailingListService,
          useValue: {
            getMailingListsByCommittee: vi.fn(() => of([ML])),
            getMailingListsByProject: vi.fn(() => of([ML])),
            getMailingList: vi.fn(() => of(ML)),
            updateMailingList: vi.fn(() => of(ML)),
          },
        },
        { provide: MessageService, useValue: { add: vi.fn() } },
        ConfirmationService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CommitteeSettingsTabComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('committee', COMMITTEE);
    fixture.componentRef.setInput('canEdit', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    component.onSyncSettingsUpdated(makeMl({ uid: 'ml-1', sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST }));
    await fixture.whenStable();
    expect((component as any).associatedMlOverrides().get('ml-1').sync_mode).toBe(MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST);

    await (component as any).saveMailingListAssociation(
      new Set(['ml-1']),
      new Set(['ml-1']),
      new Map([['ml-1', MailingListSyncMode.AUTO_MAILING_LIST_TO_COMMITTEE]])
    );
    await fixture.whenStable();

    expect((component as any).associatedMlOverrides().get('ml-1').sync_mode).toBe(MailingListSyncMode.AUTO_MAILING_LIST_TO_COMMITTEE);
  });

  it('locks the drawer sync controls when the initial committee-driven mailing list fetch fails (#4899 review)', async () => {
    await TestBed.configureTestingModule({
      imports: [CommitteeSettingsTabComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: CommitteeService,
          useValue: { updateCommittee: vi.fn(() => of(COMMITTEE)), getCommittee: vi.fn(() => of(COMMITTEE)), getCommitteesByProject: vi.fn(() => of([])) },
        },
        { provide: PersonaService, useValue: { currentPersona: signal('board-member') } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(true)) } },
        { provide: LensService, useValue: { activeLens: signal('project') } },
        {
          provide: MailingListService,
          useValue: {
            getMailingListsByCommittee: vi.fn(() => throwError(() => new Error('network error'))),
            getMailingListsByProject: vi.fn(() => of([])),
            updateMailingList: vi.fn(() => of({})),
          },
        },
        { provide: MessageService, useValue: { add: vi.fn() } },
        ConfirmationService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CommitteeSettingsTabComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('committee', COMMITTEE);
    fixture.componentRef.setInput('canEdit', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.refreshingMl()).toBe(true);
    expect(component.mlRefreshFailed()).toBe(true);
    expect(component.autoSyncButtonDisabled()).toBe(false);

    // A failed first load has no last-good snapshot, so the card itself must surface a retry
    // affordance instead of just the (unreachable, since showAutoSyncButton requires a writable
    // list) drawer retry button (dealako/Copilot #4899 review).
    const retryButton = fixture.nativeElement.querySelector('[data-testid="settings-ml-refresh-retry-button"]');
    expect(retryButton).toBeTruthy();
  });

  it('still shows the card-level retry affordance when a refresh fails while a pending add row keeps the list non-empty (cursor #4899 review: "Retry lost after pending add")', async () => {
    const NEW_ML = makeMl({ uid: 'ml-new', committees: [] });
    const getMailingListsByCommittee = vi
      .fn()
      .mockReturnValueOnce(of([]))
      .mockReturnValue(throwError(() => new Error('network error')));
    await TestBed.configureTestingModule({
      imports: [CommitteeSettingsTabComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: CommitteeService,
          useValue: { updateCommittee: vi.fn(() => of(COMMITTEE)), getCommittee: vi.fn(() => of(COMMITTEE)), getCommitteesByProject: vi.fn(() => of([])) },
        },
        { provide: PersonaService, useValue: { currentPersona: signal('board-member') } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(true)) } },
        { provide: LensService, useValue: { activeLens: signal('project') } },
        {
          provide: MailingListService,
          useValue: {
            getMailingListsByCommittee,
            getMailingListsByProject: vi.fn(() => of([NEW_ML])),
            getMailingList: vi.fn(() => of(NEW_ML)),
            updateMailingList: vi.fn(() => of(NEW_ML)),
          },
        },
        { provide: MessageService, useValue: { add: vi.fn() } },
        ConfirmationService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CommitteeSettingsTabComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('committee', COMMITTEE);
    fixture.componentRef.setInput('canEdit', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    (component as any).saveMailingListAssociation(new Set(['ml-new']), new Set(), new Map([['ml-new', MailingListSyncMode.MANUAL]]));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.associatedMailingLists().length).toBeGreaterThan(0);
    expect(component.mlRefreshFailed()).toBe(true);

    // Before the fix, the failed-refresh notice only rendered when associatedMailingLists() was
    // empty — the pending row above kept it non-empty, so the Retry button disappeared even though
    // the refresh genuinely failed and this pending row has no retry affordance of its own.
    const retryButton = fixture.nativeElement.querySelector('[data-testid="settings-ml-refresh-retry-button"]');
    expect(retryButton).toBeTruthy();
  });

  it('keeps a removed list excluded from associatedMailingLists even if the next refresh fails (#4899 review, R3-T case 2)', async () => {
    const ML = makeMl({ uid: 'ml-1', writer: true });
    await TestBed.configureTestingModule({
      imports: [CommitteeSettingsTabComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: CommitteeService,
          useValue: { updateCommittee: vi.fn(() => of(COMMITTEE)), getCommittee: vi.fn(() => of(COMMITTEE)), getCommitteesByProject: vi.fn(() => of([])) },
        },
        { provide: PersonaService, useValue: { currentPersona: signal('board-member') } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(true)) } },
        { provide: LensService, useValue: { activeLens: signal('project') } },
        {
          provide: MailingListService,
          useValue: {
            getMailingListsByCommittee: vi
              .fn()
              .mockReturnValueOnce(of([ML]))
              .mockReturnValueOnce(throwError(() => new Error('network error'))),
            getMailingListsByProject: vi.fn(() => of([ML])),
            getMailingList: vi.fn(() => of(ML)),
            updateMailingList: vi.fn(() => of(ML)),
          },
        },
        { provide: MessageService, useValue: { add: vi.fn() } },
        ConfirmationService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CommitteeSettingsTabComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('committee', COMMITTEE);
    fixture.componentRef.setInput('canEdit', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(component.associatedMailingLists().map((m) => m.uid)).toEqual(['ml-1']);

    component.removeMailingList(ML);
    await fixture.whenStable();
    expect(component.associatedMailingLists()).toEqual([]);

    // removeMailingList's own refreshMl$.next() is the "next refresh" that fails here — the
    // suppression (pruneLastGoodAssociatedList) must survive it rather than resurrecting ml-1 from
    // whatever stale fallback the failed refresh falls back to.
    expect(component.mlRefreshFailed()).toBe(true);
    expect(component.associatedMailingLists()).toEqual([]);
  });

  it("patches this committee's committees[] entry (not just the top-level field) when an override is pending, so the picker dialog resolves the current direction (#4899 review, R3-T case 3)", async () => {
    const ML = makeMl({
      uid: 'ml-1',
      writer: true,
      sync_mode: undefined,
      committees: [{ uid: 'committee-1', sync_mode: MailingListSyncMode.MANUAL }],
    });
    await TestBed.configureTestingModule({
      imports: [CommitteeSettingsTabComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: CommitteeService,
          useValue: { updateCommittee: vi.fn(() => of(COMMITTEE)), getCommittee: vi.fn(() => of(COMMITTEE)), getCommitteesByProject: vi.fn(() => of([])) },
        },
        { provide: PersonaService, useValue: { currentPersona: signal('board-member') } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(true)) } },
        { provide: LensService, useValue: { activeLens: signal('project') } },
        {
          provide: MailingListService,
          useValue: {
            getMailingListsByCommittee: vi.fn(() => of([ML])),
            getMailingListsByProject: vi.fn(() => of([ML])),
            getMailingList: vi.fn(() => of(ML)),
            updateMailingList: vi.fn(() => of(ML)),
          },
        },
        { provide: MessageService, useValue: { add: vi.fn() } },
        ConfirmationService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CommitteeSettingsTabComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('committee', COMMITTEE);
    fixture.componentRef.setInput('canEdit', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    component.onSyncSettingsUpdated(makeMl({ uid: 'ml-1', sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST }));
    await fixture.whenStable();

    const projectMl = (component as any).projectMailingLists().find((m: GroupsIOMailingList) => m.uid === 'ml-1');
    expect(projectMl.committees.find((c: { uid: string }) => c.uid === 'committee-1').sync_mode).toBe(MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST);
  });

  it("appends this committee's entry to committees[] when an override is pending but the fetched list has none yet, instead of silently dropping it (#4899 review, cursor bugbot)", async () => {
    const ML = makeMl({
      uid: 'ml-1',
      writer: true,
      sync_mode: undefined,
      committees: [],
    });
    await TestBed.configureTestingModule({
      imports: [CommitteeSettingsTabComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: CommitteeService,
          useValue: { updateCommittee: vi.fn(() => of(COMMITTEE)), getCommittee: vi.fn(() => of(COMMITTEE)), getCommitteesByProject: vi.fn(() => of([])) },
        },
        { provide: PersonaService, useValue: { currentPersona: signal('board-member') } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(true)) } },
        { provide: LensService, useValue: { activeLens: signal('project') } },
        {
          provide: MailingListService,
          useValue: {
            getMailingListsByCommittee: vi.fn(() => of([ML])),
            getMailingListsByProject: vi.fn(() => of([ML])),
            getMailingList: vi.fn(() => of(ML)),
            updateMailingList: vi.fn(() => of(ML)),
          },
        },
        { provide: MessageService, useValue: { add: vi.fn() } },
        ConfirmationService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CommitteeSettingsTabComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('committee', COMMITTEE);
    fixture.componentRef.setInput('canEdit', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    component.onSyncSettingsUpdated(makeMl({ uid: 'ml-1', sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST, committees: [] }));
    await fixture.whenStable();

    const associatedMl = component.associatedMailingLists().find((m) => m.uid === 'ml-1');
    expect(associatedMl?.committees?.find((c) => c.uid === COMMITTEE.uid)?.sync_mode).toBe(MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST);

    const projectMl = (component as any).projectMailingLists().find((m: GroupsIOMailingList) => m.uid === 'ml-1');
    expect(projectMl.committees.find((c: { uid: string }) => c.uid === COMMITTEE.uid).sync_mode).toBe(MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST);
  });

  it('resets savingMlUids to empty once the drawer closes, and gates canClose on drawerSavingCount (#4899 review)', async () => {
    const closed = new Subject<void>();
    const openSpy = vi.fn(() => ({ closed }));
    await TestBed.configureTestingModule({
      imports: [CommitteeSettingsTabComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: CommitteeService,
          useValue: { updateCommittee: vi.fn(() => of(COMMITTEE)), getCommittee: vi.fn(() => of(COMMITTEE)), getCommitteesByProject: vi.fn(() => of([])) },
        },
        { provide: PersonaService, useValue: { currentPersona: signal('board-member') } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(true)) } },
        { provide: LensService, useValue: { activeLens: signal('project') } },
        {
          provide: MailingListService,
          useValue: {
            getMailingListsByCommittee: vi.fn(() => of([makeMl({ uid: 'ml-1' })])),
            getMailingListsByProject: vi.fn(() => of([])),
            updateMailingList: vi.fn(() => of({})),
          },
        },
        { provide: MessageService, useValue: { add: vi.fn() } },
        ConfirmationService,
        { provide: UserService, useValue: { impersonating: signal(false) } },
        { provide: UiDrawerService, useValue: { open: openSpy } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CommitteeSettingsTabComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('committee', COMMITTEE);
    fixture.componentRef.setInput('canEdit', true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    component.openAutoSyncDrawer();

    expect(openSpy).toHaveBeenCalledTimes(1);
    const calls = openSpy.mock.calls as unknown as [unknown, { canClose: () => boolean }][];
    const config = calls[0][1];

    expect(config.canClose()).toBe(true);

    component.onSyncSettingsSavingChange('ml-1', true);
    expect(config.canClose()).toBe(false);

    component.onSyncSettingsSavingChange('ml-1', false);
    expect(config.canClose()).toBe(true);

    component.onSyncSettingsSavingChange('ml-1', true);
    expect(component.savingMlUids().size).toBe(1);

    closed.next();

    expect(component.savingMlUids().size).toBe(0);
  });

  it('evaluates showAutoSyncButton to false when every associated mailing list has writer: false (#4899 review)', async () => {
    await createFixture({ associatedMailingLists: [makeMl({ uid: 'ml-1', writer: false }), makeMl({ uid: 'ml-2', writer: false })] });
    expect(component.showAutoSyncButton()).toBe(false);
  });
});
