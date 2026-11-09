// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter, Router } from '@angular/router';
import { signal } from '@angular/core';
import { MailingListSyncMode } from '@lfx-one/shared/enums';
import { GroupsIOMailingList } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { FeatureFlagService } from '@services/feature-flag.service';
import { PersonaService } from '@services/persona.service';
import { ProjectService } from '@services/project.service';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of, throwError } from 'rxjs';

import { MailingListPickerDialogComponent } from './mailing-list-picker-dialog.component';

describe('MailingListPickerDialogComponent indexed domains', () => {
  let fixture: ComponentFixture<MailingListPickerDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MailingListPickerDialogComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: {
              mailingLists: [
                { uid: 'ml-1', group_name: 'main', domain: 'lists.example.org', title: 'Main', writer: true },
                { uid: 'ml-2', group_name: 'old', service: { domain: 'lists.example.org' } },
              ] as GroupsIOMailingList[],
              associatedUids: new Set<string>(),
              committeeUid: 'committee-1',
            },
          },
        },
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
        { provide: CommitteeService, useValue: {} },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: PersonaService, useValue: { currentPersona: signal('board-member') } },
        { provide: ProjectService, useValue: { getProjectStrict: vi.fn() } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(false)) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(MailingListPickerDialogComponent);
    await fixture.whenStable();
  });

  it('shows and allows selection of lists with indexed domains even without parent services', async () => {
    expect(fixture.nativeElement.querySelector('[data-testid="settings-ml-picker-row-ml-1"]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('main@lists.example.org');
    expect(fixture.nativeElement.querySelector('[data-testid="settings-ml-picker-row-ml-2"]')).toBeNull();

    fixture.componentInstance.toggleMailingList('ml-1');
    expect(fixture.componentInstance.selectedMailingListUids().has('ml-1')).toBe(true);
  });
});

describe('MailingListPickerDialogComponent write access', () => {
  let fixture: ComponentFixture<MailingListPickerDialogComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MailingListPickerDialogComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: {
              mailingLists: [
                { uid: 'ml-w', group_name: 'writable', domain: 'lists.example.org', writer: true },
                { uid: 'ml-r', group_name: 'readonly', domain: 'lists.example.org', writer: false },
                { uid: 'ml-linked', group_name: 'linked', domain: 'lists.example.org', writer: false },
              ] as GroupsIOMailingList[],
              associatedUids: new Set<string>(['ml-linked']),
              committeeUid: 'committee-1',
            },
          },
        },
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
        { provide: CommitteeService, useValue: {} },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: PersonaService, useValue: { currentPersona: signal('board-member') } },
        { provide: ProjectService, useValue: { getProjectStrict: vi.fn() } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(false)) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(MailingListPickerDialogComponent);
    await fixture.whenStable();
  });

  it('still shows lists the user cannot write, marked as disabled', () => {
    const row = fixture.nativeElement.querySelector('[data-testid="settings-ml-picker-row-ml-r"]');
    expect(row).not.toBeNull();
    expect(row.getAttribute('aria-disabled')).toBe('true');
    expect(fixture.nativeElement.querySelector('[data-testid="settings-ml-picker-row-ml-w"]').getAttribute('aria-disabled')).toBe('false');
  });

  it('does not select a list the user cannot write', () => {
    fixture.componentInstance.toggleMailingList('ml-r');
    expect(fixture.componentInstance.selectedMailingListUids().has('ml-r')).toBe(false);
  });

  it('keeps an already-linked list the user cannot write selected', () => {
    fixture.componentInstance.toggleMailingList('ml-linked');
    expect(fixture.componentInstance.selectedMailingListUids().has('ml-linked')).toBe(true);
  });

  it('selects a writable list', () => {
    fixture.componentInstance.toggleMailingList('ml-w');
    expect(fixture.componentInstance.selectedMailingListUids().has('ml-w')).toBe(true);
  });
});

describe('MailingListPickerDialogComponent create new list access', () => {
  let component: MailingListPickerDialogComponent;
  let messageAdd: ReturnType<typeof vi.fn>;
  let dialogClose: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;
  let getCommittee: ReturnType<typeof vi.fn>;
  let getProjectStrict: ReturnType<typeof vi.fn>;
  let persona: ReturnType<typeof signal<string>>;

  async function setup(projectSlug: string | null = 'project-slug'): Promise<void> {
    messageAdd = vi.fn();
    dialogClose = vi.fn();
    getCommittee = vi.fn(() => of({ uid: 'committee-1', writer: true }));
    getProjectStrict = vi.fn(() => of({ writer: true }));
    persona = signal('board-member');

    await TestBed.configureTestingModule({
      imports: [MailingListPickerDialogComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: DynamicDialogConfig,
          useValue: { data: { mailingLists: [], associatedUids: new Set<string>(), committeeUid: 'committee-1', projectSlug: projectSlug ?? undefined } },
        },
        { provide: DynamicDialogRef, useValue: { close: dialogClose } },
        { provide: CommitteeService, useValue: { getCommittee } },
        { provide: MessageService, useValue: { add: messageAdd } },
        { provide: PersonaService, useValue: { currentPersona: persona } },
        { provide: ProjectService, useValue: { getProjectStrict } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(false)) } },
      ],
    }).compileComponents();

    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true) as unknown as ReturnType<typeof vi.fn>;
    component = TestBed.createComponent(MailingListPickerDialogComponent).componentInstance;
  }

  it('navigates to the create page when the user can write the group and the project', async () => {
    await setup();

    component.onCreateNewList();

    expect(navigate).toHaveBeenCalledWith(['/mailing-lists', 'create'], { queryParams: { project: 'project-slug' } });
    expect(dialogClose).toHaveBeenCalledWith(null);
    expect(messageAdd).not.toHaveBeenCalled();
  });

  it('stays on the page with a toast when the user can write the group but not the project', async () => {
    await setup();
    getProjectStrict.mockReturnValue(of({ writer: false }));

    component.onCreateNewList();

    expect(navigate).not.toHaveBeenCalled();
    expect(dialogClose).not.toHaveBeenCalled();
    expect(messageAdd).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'warn', detail: expect.stringContaining('permission to manage mailing lists') })
    );
  });

  it('stays on the page with a toast when the user cannot write the group', async () => {
    await setup();
    getCommittee.mockReturnValue(of({ uid: 'committee-1', writer: false }));

    component.onCreateNewList();

    expect(getProjectStrict).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'warn' }));
  });

  it('lets an executive director through without a project check', async () => {
    await setup();
    persona.set('executive-director');
    getProjectStrict.mockReturnValue(of({ writer: false }));

    component.onCreateNewList();

    expect(navigate).toHaveBeenCalled();
    expect(messageAdd).not.toHaveBeenCalled();
  });

  it('leaves the decision to the route guard when no project slug is known', async () => {
    await setup(null);

    component.onCreateNewList();

    expect(getProjectStrict).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/mailing-lists', 'create'], { queryParams: {} });
  });

  it('shows a verification error instead of leaving the page when the access check fails', async () => {
    await setup();
    getProjectStrict.mockReturnValue(throwError(() => ({ status: 500 })));

    component.onCreateNewList();

    expect(navigate).not.toHaveBeenCalled();
    expect(messageAdd).toHaveBeenCalledWith(expect.objectContaining({ severity: 'error' }));
  });
});

// #4026: per-linked-list sync direction control, gated behind MAILING_LIST_COMMITTEE_SYNC_ENABLED_FLAG.
describe('MailingListPickerDialogComponent sync direction', () => {
  let fixture: ComponentFixture<MailingListPickerDialogComponent>;
  let dialogClose: ReturnType<typeof vi.fn>;

  const MAILING_LISTS: GroupsIOMailingList[] = [
    { uid: 'ml-synced', group_name: 'synced', domain: 'lists.example.org', writer: true, sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST },
    { uid: 'ml-manual', group_name: 'manual', domain: 'lists.example.org', writer: true },
    { uid: 'ml-unlinked', group_name: 'unlinked', domain: 'lists.example.org', writer: true },
    {
      uid: 'ml-elsewhere',
      group_name: 'elsewhere',
      domain: 'lists.example.org',
      writer: true,
      sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST,
    },
  ] as GroupsIOMailingList[];

  async function setup(flagEnabled: boolean): Promise<void> {
    dialogClose = vi.fn();
    await TestBed.configureTestingModule({
      imports: [MailingListPickerDialogComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: DynamicDialogConfig,
          useValue: {
            data: {
              mailingLists: MAILING_LISTS,
              associatedUids: new Set<string>(['ml-synced', 'ml-manual']),
              committeeUid: 'committee-1',
            },
          },
        },
        { provide: DynamicDialogRef, useValue: { close: dialogClose } },
        { provide: CommitteeService, useValue: {} },
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: PersonaService, useValue: { currentPersona: signal('board-member') } },
        { provide: ProjectService, useValue: { getProjectStrict: vi.fn() } },
        { provide: FeatureFlagService, useValue: { getBooleanFlag: vi.fn(() => signal(flagEnabled)) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(MailingListPickerDialogComponent);
    await fixture.whenStable();
  }

  it('hides the sync direction column when the feature flag is off', async () => {
    await setup(false);

    expect(fixture.nativeElement.querySelector('[data-testid="settings-ml-picker-direction-cell"]')).toBeNull();
    fixture.componentInstance.save();
    expect(dialogClose).toHaveBeenCalledWith(expect.objectContaining({ syncModes: new Map() }));
  });

  it('shows the sync direction column seeded from each list’s persisted sync_mode when the flag is on', async () => {
    await setup(true);

    expect(fixture.componentInstance.mlDirectionForm.get('ml-synced')?.value).toBe(MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST);
    expect(fixture.componentInstance.mlDirectionForm.get('ml-manual')?.value).toBe(MailingListSyncMode.MANUAL);
  });

  it('disables every other direction control once one list has an automatic direction', async () => {
    await setup(true);

    expect(fixture.componentInstance.activeAutoSyncUid()).toBe('ml-synced');
    expect(fixture.componentInstance.mlDirectionForm.get('ml-manual')?.disabled).toBe(true);
  });

  it('frees the active-sync slot once that list is set back to manual', async () => {
    await setup(true);

    fixture.componentInstance.mlDirectionForm.get('ml-synced')?.setValue(MailingListSyncMode.MANUAL);
    await fixture.whenStable();

    expect(fixture.componentInstance.activeAutoSyncUid()).toBeNull();
    expect(fixture.componentInstance.mlDirectionForm.get('ml-manual')?.disabled).toBe(false);
  });

  it('disables the direction control for a list that is not linked', async () => {
    await setup(true);

    expect(fixture.componentInstance.mlDirectionForm.get('ml-unlinked')?.disabled).toBe(true);
  });

  it('resets the direction to manual when a list is unlinked', async () => {
    await setup(true);

    fixture.componentInstance.mlDirectionForm.get('ml-manual')?.setValue(MailingListSyncMode.AUTO_MAILING_LIST_TO_COMMITTEE);
    fixture.componentInstance.toggleMailingList('ml-manual');
    await fixture.whenStable();

    expect(fixture.componentInstance.mlDirectionForm.get('ml-manual')?.value).toBe(MailingListSyncMode.MANUAL);
  });

  it('returns the chosen directions in save() when the flag is on', async () => {
    await setup(true);

    fixture.componentInstance.save();

    expect(dialogClose).toHaveBeenCalledWith(
      expect.objectContaining({
        syncModes: new Map([
          ['ml-synced', MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST],
          ['ml-manual', MailingListSyncMode.MANUAL],
          ['ml-unlinked', MailingListSyncMode.MANUAL],
          ['ml-elsewhere', MailingListSyncMode.MANUAL],
        ]),
      })
    );
  });

  it('seeds a list linked to another committee as Manual, not its inherited sync_mode', async () => {
    await setup(true);

    // ml-elsewhere carries AUTO_COMMITTEE_TO_MAILING_LIST from its own committee, but it isn't in
    // associatedUids for this one — the #4880 safeguard must still seed Manual, since the admin
    // never chose that direction for this committee.
    expect(fixture.componentInstance.mlDirectionForm.get('ml-elsewhere')?.value).toBe(MailingListSyncMode.MANUAL);

    fixture.componentInstance.toggleMailingList('ml-elsewhere');
    fixture.componentInstance.save();

    expect(dialogClose).toHaveBeenCalledWith(expect.objectContaining({ syncModes: expect.any(Map) }));
    const syncModes = dialogClose.mock.calls[0][0].syncModes as Map<string, MailingListSyncMode>;
    expect(syncModes.get('ml-elsewhere')).toBe(MailingListSyncMode.MANUAL);
  });
});
