// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GroupsIOMailingList, VoteTableRow } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VoteMailingListReminderDialogComponent } from './vote-mailing-list-reminder-dialog.component';

const VOTE = { uid: 'vote-1', name: 'Approve the 2027 budget', committee_uid: 'committee-1' } as VoteTableRow;
const TSC = { uid: 'ml-1', group_name: 'tsc', domain: 'lists.example.org', title: 'TSC' } as GroupsIOMailingList;
const MAIN = { uid: 'ml-2', group_name: 'main', domain: 'lists.example.org', title: 'Main' } as GroupsIOMailingList;

/**
 * Mounts the picker over `VOTE` with two lists.
 * @returns the fixture, the component, and the close spy.
 */
async function mount() {
  TestBed.resetTestingModule();

  const close = vi.fn();

  TestBed.configureTestingModule({
    imports: [VoteMailingListReminderDialogComponent],
    providers: [
      { provide: DynamicDialogConfig, useValue: { data: { vote: VOTE, lists: [TSC, MAIN] } } },
      { provide: DynamicDialogRef, useValue: { close } },
    ],
  });

  const fixture = TestBed.createComponent(VoteMailingListReminderDialogComponent);
  fixture.detectChanges();
  await fixture.whenStable();

  return { fixture, component: fixture.componentInstance, close };
}

function byTestId(fixture: ComponentFixture<VoteMailingListReminderDialogComponent>, id: string): HTMLElement | null {
  return fixture.nativeElement.querySelector(`[data-testid="${id}"]`);
}

function openEmailButton(fixture: ComponentFixture<VoteMailingListReminderDialogComponent>): HTMLButtonElement {
  return byTestId(fixture, 'vote-mailing-list-reminder-open-email')!.querySelector('button')!;
}

describe('VoteMailingListReminderDialogComponent', () => {
  let current: ComponentFixture<VoteMailingListReminderDialogComponent> | undefined;
  afterEach(() => current?.destroy());

  it('lists every mailing list by name and address with none preselected', async () => {
    const { fixture, component } = await mount();
    current = fixture;

    const radios = byTestId(fixture, 'vote-mailing-list-reminder-lists')!;
    expect(radios.getAttribute('role')).toBe('radiogroup');
    expect(radios.textContent).toContain('tsc (tsc@lists.example.org)');
    expect(radios.textContent).toContain('main (main@lists.example.org)');
    expect(fixture.nativeElement.textContent).toContain('"Approve the 2027 budget"');
    expect(component['listForm'].controls.listUid.value).toBeNull();
    expect(openEmailButton(fixture).disabled).toBe(true);
  });

  it('closes with the picked list on Open in email', async () => {
    const { fixture, component, close } = await mount();
    current = fixture;

    component['listForm'].controls.listUid.setValue('ml-2');
    fixture.detectChanges();
    expect(openEmailButton(fixture).disabled).toBe(false);

    openEmailButton(fixture).click();

    expect(close).toHaveBeenCalledWith(MAIN);
  });

  it('closes without a list on Cancel', async () => {
    const { fixture, close } = await mount();
    current = fixture;

    byTestId(fixture, 'vote-mailing-list-reminder-cancel')!.querySelector('button')!.click();

    expect(close).toHaveBeenCalledWith();
  });
});
