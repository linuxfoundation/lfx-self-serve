// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter, Router } from '@angular/router';
import { MailingListSyncMode } from '@lfx-one/shared/enums';
import { Committee, GroupsIOMailingList } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { LensService } from '@services/lens.service';
import { MailingListService } from '@services/mailing-list.service';
import { PersonaService } from '@services/persona.service';
import { UserService } from '@services/user.service';
import { ConfirmationService, MessageService } from 'primeng/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of, throwError } from 'rxjs';

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
      sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST,
      committees: [{ uid: 'committee-1' }],
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
    const ml = makeMl({ uid: 'ml-1', committees: [{ uid: 'committee-1' }], sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST });
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
    const ml = makeMl({ uid: 'ml-1', committees: [{ uid: 'committee-OLD' }], sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST });
    await createFixture([ml]);

    (component as any).saveMailingListAssociation(new Set(['ml-1']), new Set(), new Map());

    const payload = updateMailingList.mock.calls[0][1];
    expect(payload.committee_uid).toBe('committee-1');
    expect(payload.sync_mode).toBe(MailingListSyncMode.MANUAL);
  });

  it('omits sync_mode when the mailing list is removed from the committee', async () => {
    const ml = makeMl({ uid: 'ml-1', committees: [{ uid: 'committee-1' }], sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST });
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
    const ml = makeMl({ uid: 'ml-1', committees: [{ uid: 'committee-OLD' }], sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST });
    await createFixture([ml]);

    (component as any).saveMailingListAssociation(new Set(['ml-1']), new Set(), new Map([['ml-1', MailingListSyncMode.AUTO_MAILING_LIST_TO_COMMITTEE]]));

    const payload = updateMailingList.mock.calls[0][1];
    expect(payload.committee_uid).toBe('committee-1');
    // Without the explicit override this would reset to MANUAL (different-committee re-link).
    expect(payload.sync_mode).toBe(MailingListSyncMode.AUTO_MAILING_LIST_TO_COMMITTEE);
  });

  it('issues an update for a list that stays linked but only has its sync direction changed', async () => {
    const ml = makeMl({ uid: 'ml-1', committees: [{ uid: 'committee-1' }], sync_mode: MailingListSyncMode.MANUAL });
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
    const ml = makeMl({ uid: 'ml-1', committees: [{ uid: 'committee-1' }], sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST });
    await createFixture([ml]);

    (component as any).saveMailingListAssociation(
      new Set(['ml-1']),
      new Set(['ml-1']),
      new Map([['ml-1', MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST]])
    );

    expect(updateMailingList).not.toHaveBeenCalled();
  });
});
