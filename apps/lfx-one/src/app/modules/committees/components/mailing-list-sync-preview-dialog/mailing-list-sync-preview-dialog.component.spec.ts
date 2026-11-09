// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { MailingListSyncMode, SyncMemberType } from '@lfx-one/shared/enums';
import { MailingListSyncPreviewDialogData, SyncDiff } from '@lfx-one/shared/interfaces';
import { MailingListService } from '@services/mailing-list.service';
import { UserService } from '@services/user.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';

import { MailingListSyncPreviewDialogComponent } from './mailing-list-sync-preview-dialog.component';

const DIFF: SyncDiff = {
  mailing_list_id: 'ml-1',
  committee_uid: 'committee-1',
  sync_mode: MailingListSyncMode.AUTO_COMMITTEE_TO_MAILING_LIST,
  adds: [
    { email: 'add-one@example.org', member_id: 'add-1', member_type: SyncMemberType.COMMITTEE_MEMBER, name: 'Add One' },
    { email: 'add-two@example.org', member_id: 'add-2', member_type: SyncMemberType.COMMITTEE_MEMBER, name: 'Add Two' },
  ],
  removes: [{ email: 'remove-one@example.org', member_id: 'remove-1', member_type: SyncMemberType.MAILING_LIST_MEMBER }],
  conflicts: [],
};

async function setup(options: { diff?: SyncDiff | null; impersonating?: boolean; committeeUid?: string }): Promise<{
  fixture: ComponentFixture<MailingListSyncPreviewDialogComponent>;
  applySyncDiff: ReturnType<typeof vi.fn>;
}> {
  const applySyncDiff = vi.fn(() => of({ added: [], removed: [] }));

  await TestBed.configureTestingModule({
    imports: [MailingListSyncPreviewDialogComponent],
    providers: [
      provideNoopAnimations(),
      {
        provide: DynamicDialogConfig,
        useValue: {
          data: {
            mailingListUid: 'ml-1',
            mailingListName: 'Main List',
            committeeUid: options.committeeUid ?? 'committee-1',
          } as MailingListSyncPreviewDialogData,
        },
      },
      { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
      {
        provide: MailingListService,
        useValue: {
          getSyncDiff: vi.fn(() => of(options.diff === undefined ? DIFF : options.diff)),
          applySyncDiff,
        },
      },
      { provide: UserService, useValue: { impersonating: signal(options.impersonating ?? false) } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(MailingListSyncPreviewDialogComponent);
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, applySyncDiff };
}

describe('MailingListSyncPreviewDialogComponent diff selection', () => {
  it('loads the diff and selects everything by default', async () => {
    const { fixture } = await setup({});

    expect(fixture.componentInstance.selectedAdds().map((a) => a.member_id)).toEqual(['add-1', 'add-2']);
    expect(fixture.componentInstance.selectedRemoves().map((r) => r.member_id)).toEqual(['remove-1']);
  });

  it('excludes an add when its checkbox row is unchecked', async () => {
    const { fixture } = await setup({});

    fixture.componentInstance.addCheckboxForm.get('add-1')?.setValue(false);

    expect(fixture.componentInstance.selectedAdds().map((a) => a.member_id)).toEqual(['add-2']);
    expect(fixture.componentInstance.selectedRemoves().map((r) => r.member_id)).toEqual(['remove-1']);
  });

  it('excludes a remove when its checkbox row is unchecked', async () => {
    const { fixture } = await setup({});

    fixture.componentInstance.removeCheckboxForm.get('remove-1')?.setValue(false);

    expect(fixture.componentInstance.selectedRemoves()).toEqual([]);
  });

  it('disables Apply once every row is deselected', async () => {
    const { fixture } = await setup({});

    fixture.componentInstance.addCheckboxForm.get('add-1')?.setValue(false);
    fixture.componentInstance.addCheckboxForm.get('add-2')?.setValue(false);
    fixture.componentInstance.removeCheckboxForm.get('remove-1')?.setValue(false);
    fixture.detectChanges();

    const applyBtn = fixture.nativeElement.querySelector('[data-testid="sync-preview-apply-btn"] button') as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);
    expect(fixture.componentInstance.selectedAdds()).toEqual([]);
    expect(fixture.componentInstance.selectedRemoves()).toEqual([]);
  });
});

describe('MailingListSyncPreviewDialogComponent committee mismatch', () => {
  it('shows an error and never populates the diff when the committee UID has changed', async () => {
    const { fixture } = await setup({ committeeUid: 'committee-1', diff: { ...DIFF, committee_uid: 'committee-2' } });

    expect(fixture.componentInstance.diff()).toBeNull();
    expect(fixture.componentInstance.loadError()).toContain('different committee');
    expect(fixture.nativeElement.querySelector('[data-testid="sync-preview-error"]')).not.toBeNull();
  });
});

describe('MailingListSyncPreviewDialogComponent impersonation', () => {
  it('disables Apply and shows a notice while impersonating', async () => {
    const { fixture } = await setup({ impersonating: true });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="sync-preview-impersonating-notice"]')).not.toBeNull();
    const applyBtn = fixture.nativeElement.querySelector('[data-testid="sync-preview-apply-btn"] button') as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);
  });

  it('does not apply when impersonating even if apply() is called directly', async () => {
    const { fixture, applySyncDiff } = await setup({ impersonating: true });

    fixture.componentInstance.apply();

    expect(applySyncDiff).not.toHaveBeenCalled();
  });

  it('allows apply when not impersonating', async () => {
    const { fixture, applySyncDiff } = await setup({ impersonating: false });

    fixture.componentInstance.apply();

    expect(applySyncDiff).toHaveBeenCalledWith('ml-1', expect.objectContaining({ committee_uid: 'committee-1' }));
  });
});
