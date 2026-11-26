// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import type { Committee, MeetingCommittee } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { ProjectContextService } from '@services/project-context.service';
import { Observable, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ComposerGroupPickerComponent } from './composer-group-picker.component';

const TSC = { uid: 'committee-tsc', name: 'TSC', category: 'Technical', total_members: 12, enable_voting: true } as Committee;
const LEGAL = { uid: 'committee-legal', name: 'Legal', category: 'Legal', total_members: 1, enable_voting: false } as Committee;

describe('ComposerGroupPickerComponent', () => {
  let fixture: ComponentFixture<ComposerGroupPickerComponent>;
  let form: FormGroup;
  let committees$: () => Observable<Committee[]>;

  const el = (testId: string): HTMLElement | null => document.querySelector(`[data-testid="${testId}"]`);
  const click = (testId: string): void => {
    const target = el(testId);
    (target?.querySelector<HTMLElement>('button, input') ?? target)?.click();
  };
  const render = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const committeesValue = (): MeetingCommittee[] => form.get('committees')?.value;

  const mount = async (options: { visibility?: string; context?: Committee | null; selected?: MeetingCommittee[] } = {}): Promise<void> => {
    form = new FormGroup({
      visibility: new FormControl(options.visibility ?? 'private'),
      committees: new FormControl(options.selected ?? []),
      show_meeting_attendees: new FormControl(false),
      meeting_type: new FormControl('Technical'),
      restricted: new FormControl(false),
      cancel_on_committee_removal: new FormControl('inherit'),
    });
    fixture = TestBed.createComponent(ComposerGroupPickerComponent);
    fixture.componentRef.setInput('form', form);
    fixture.componentRef.setInput('selectedCommittees', options.selected ?? []);
    fixture.componentRef.setInput('committeeContext', options.context ?? null);
    await render();
  };

  beforeEach(() => {
    committees$ = () => of([TSC, LEGAL]);
    TestBed.configureTestingModule({
      providers: [
        { provide: ProjectContextService, useValue: { activeContextUid: () => 'project-1' } },
        {
          provide: CommitteeService,
          useValue: { getCommitteesByProjectOrThrow: () => committees$(), getCommitteeMembers: vi.fn().mockReturnValue(of([])) },
        },
      ],
    });
  });

  it('lists the project groups with their category and member count', async () => {
    await mount();

    click('meeting-committee-multi-select');
    await render();

    expect(document.body.textContent).toContain('Technical · 12 members');
    expect(document.body.textContent).toContain('Legal · 1 member');
  });

  it('adds a picked group to the list and the meeting, and removes it again', async () => {
    await mount();

    fixture.componentInstance['committeesControl'].setValue([TSC.uid]);
    await render();

    expect(el(`meeting-committee-chip-${TSC.uid}`)?.textContent).toContain('Technical · 12 members');
    expect(committeesValue().map((committee) => committee.uid)).toEqual([TSC.uid]);

    click(`meeting-committee-chip-remove-${TSC.uid}`);
    await render();

    expect(el(`meeting-committee-chip-${TSC.uid}`)).toBeNull();
    expect(committeesValue()).toEqual([]);
  });

  it('filters a voting group by voting status from its menu', async () => {
    await mount({ selected: [{ uid: TSC.uid }] });

    click(`composer-group-menu-button-${TSC.uid}`);
    await render();
    expect(el(`composer-group-menu-${TSC.uid}`)).not.toBeNull();
    expect(el('cancel-on-committee-removal-select')).toBeNull();

    click('composer-group-voting-Voting Rep');
    await render();

    expect(committeesValue()[0].allowed_voting_statuses?.length).toBe(1);
  });

  it('gives a non-voting group a menu only on public meetings, holding the removal setting', async () => {
    await mount({ selected: [{ uid: LEGAL.uid }] });
    expect(el(`composer-group-menu-button-${LEGAL.uid}`)).toBeNull();

    form.get('visibility')?.setValue('public');
    await render();
    click(`composer-group-menu-button-${LEGAL.uid}`);
    await render();

    expect(el('cancel-on-committee-removal-select')).not.toBeNull();
    expect(el('composer-group-voting-Voting Rep')).toBeNull();
  });

  it('says the voting filter is shared when several voting groups are picked', async () => {
    const OTHER = { ...TSC, uid: 'committee-other', name: 'Other' } as Committee;
    committees$ = () => of([TSC, OTHER]);
    await mount({ selected: [{ uid: TSC.uid }, { uid: OTHER.uid }] });

    click(`composer-group-menu-button-${TSC.uid}`);
    await render();

    expect(el('composer-group-voting-shared')).not.toBeNull();
  });

  it('shows the group of a group-scoped create locked, without a picker', async () => {
    await mount({ context: TSC });

    expect(el('meeting-committee-multi-select')).toBeNull();
    expect(el(`meeting-committee-chip-${TSC.uid}`)?.textContent).toContain('TSC');
    expect(el('meeting-committee-locked')).not.toBeNull();
    expect(el(`meeting-committee-chip-remove-${TSC.uid}`)).toBeNull();
  });

  it('drops a voting status when it is unticked', async () => {
    await mount({ selected: [{ uid: TSC.uid }] });
    click(`composer-group-menu-button-${TSC.uid}`);
    await render();

    click('composer-group-voting-Voting Rep');
    await render();
    click('composer-group-voting-Voting Rep');
    await render();

    expect(committeesValue()[0].allowed_voting_statuses).toEqual([]);
  });

  it('shows loading while the scoping group resolves', async () => {
    await mount();
    fixture.componentRef.setInput('contextLoading', true);
    await render();

    expect(el('composer-group-picker-loading')).not.toBeNull();
    expect(el('meeting-committee-multi-select')).toBeNull();
  });

  it('asks the host to retry a scoping group that failed to load', async () => {
    await mount();
    const retry = vi.fn();
    fixture.componentInstance.retryContext.subscribe(retry);
    fixture.componentRef.setInput('contextFailed', true);
    await render();

    expect(el('meeting-committee-context-error')?.getAttribute('role')).toBe('alert');
    click('meeting-committee-context-retry');

    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('announces a member load failure and retries it', async () => {
    const members = TestBed.inject(CommitteeService).getCommitteeMembers as ReturnType<typeof vi.fn>;
    members.mockReturnValue(throwError(() => new Error('down')));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await mount({ selected: [{ uid: TSC.uid }] });

    expect(el('meeting-committee-members-error')?.getAttribute('role')).toBe('alert');

    members.mockReturnValue(of([]));
    click('meeting-committee-members-retry');
    await render();

    expect(el('meeting-committee-members-error')).toBeNull();
  });

  it('offers a retry when the groups fail to load', async () => {
    committees$ = () => throwError(() => new Error('down'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await mount();

    expect(el('meeting-committee-options-error')).not.toBeNull();
    expect(el('meeting-committee-multi-select')).toBeNull();

    committees$ = () => of([TSC]);
    click('meeting-committee-options-retry');
    await render();

    expect(el('meeting-committee-multi-select')).not.toBeNull();
  });
});
