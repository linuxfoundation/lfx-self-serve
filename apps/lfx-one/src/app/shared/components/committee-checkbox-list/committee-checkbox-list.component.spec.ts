// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormControl, FormGroup } from '@angular/forms';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Committee, CommitteeReference, CommitteeSelectorOption, VOTING_STATUSES } from '@lfx-one/shared';
import { CommitteeService } from '@services/committee.service';
import { ProjectContextService } from '@services/project-context.service';
import { of } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';

import { CommitteeCheckboxListComponent } from './committee-checkbox-list.component';

const COMMITTEES = [
  { uid: 'group-a', name: 'Alpha Group', total_members: 3 },
  { uid: 'group-b', name: 'Beta Group', total_members: 5 },
] as Committee[];

describe('CommitteeCheckboxListComponent', () => {
  let fixture: ComponentFixture<CommitteeCheckboxListComponent>;

  afterEach(() => fixture?.destroy());

  const render = async (initial: CommitteeReference[] = []): Promise<FormGroup> => {
    await TestBed.configureTestingModule({
      imports: [CommitteeCheckboxListComponent],
      providers: [
        provideNoopAnimations(),
        { provide: CommitteeService, useValue: { getCommitteesByProject: () => of(COMMITTEES) } },
        { provide: ProjectContextService, useValue: { activeContextUid: signal('project-1') } },
      ],
    }).compileComponents();

    const form = new FormGroup({ committees: new FormControl<CommitteeReference[]>(initial) });
    fixture = TestBed.createComponent(CommitteeCheckboxListComponent);
    fixture.componentRef.setInput('form', form);
    fixture.componentRef.setInput('control', 'committees');
    await fixture.whenStable();

    return form;
  };

  const pick = async (ids: string[] | null): Promise<void> => {
    fixture.componentInstance.selectionForm.controls.committeeIds.setValue(ids as string[]);
    await fixture.whenStable();
  };

  it('shows the parent value in the dropdown without emitting a selection change', async () => {
    const emitted: CommitteeSelectorOption[][] = [];
    const form = await render([{ uid: 'group-a', name: 'Alpha Group' }]);
    fixture.componentInstance.selectionChange.subscribe((items) => emitted.push(items));
    await fixture.whenStable();

    expect(fixture.componentInstance.selectionForm.controls.committeeIds.value).toEqual(['group-a']);
    expect(emitted).toEqual([]);
    expect(form.get('committees')?.dirty).toBe(false);
  });

  it('writes the picked groups to the parent control as references and marks it touched', async () => {
    const form = await render();
    const emitted: CommitteeSelectorOption[][] = [];
    fixture.componentInstance.selectionChange.subscribe((items) => emitted.push(items));

    await pick(['group-b', 'group-a']);

    expect(form.get('committees')?.value).toEqual([
      { uid: 'group-b', name: 'Beta Group', allowed_voting_statuses: VOTING_STATUSES.map((status) => status.value) },
      { uid: 'group-a', name: 'Alpha Group', allowed_voting_statuses: VOTING_STATUSES.map((status) => status.value) },
    ]);
    expect(form.get('committees')?.dirty).toBe(true);
    expect(form.get('committees')?.touched).toBe(true);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].map((item) => item.id)).toEqual(['group-b', 'group-a']);
  });

  it('keeps the stored name of a group that is not in the loaded options', async () => {
    const form = await render([{ uid: 'group-gone', name: 'Stored Name' }]);

    await pick(['group-gone', 'group-a']);

    const names = (form.get('committees')?.value as CommitteeReference[]).map((ref) => [ref.uid, ref.name]);
    expect(names).toEqual([
      ['group-gone', 'Stored Name'],
      ['group-a', 'Alpha Group'],
    ]);
  });

  it('treats a null from the dropdown as an empty selection', async () => {
    const form = await render([{ uid: 'group-a', name: 'Alpha Group' }]);

    await pick(null);

    expect(form.get('committees')?.value).toEqual([]);
    expect(fixture.componentInstance.selectedItems()).toEqual([]);
  });

  it('reflects a later programmatic change of the parent control in the dropdown', async () => {
    const form = await render();

    form.get('committees')?.setValue([{ uid: 'group-b', name: 'Beta Group' }]);
    await fixture.whenStable();

    expect(fixture.componentInstance.selectionForm.controls.committeeIds.value).toEqual(['group-b']);
  });
});
