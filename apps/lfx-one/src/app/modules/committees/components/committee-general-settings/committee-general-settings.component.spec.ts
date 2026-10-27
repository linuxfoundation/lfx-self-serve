// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { FormControl, FormGroup } from '@angular/forms';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Committee } from '@lfx-one/shared/interfaces';
import { CommitteeService } from '@services/committee.service';
import { PersonaService } from '@services/persona.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';

import { CommitteeGeneralSettingsComponent } from './committee-general-settings.component';

describe('CommitteeGeneralSettingsComponent', () => {
  let fixture: ComponentFixture<CommitteeGeneralSettingsComponent>;
  let component: CommitteeGeneralSettingsComponent;
  let persona: ReturnType<typeof signal<string>>;
  let getCommitteesByProject: ReturnType<typeof vi.fn>;

  const committee = (overrides: Partial<Committee>): Committee =>
    ({ uid: 'c-1', name: 'Self', project_uid: 'p-1', category: 'Board', ...overrides }) as Committee;

  const create = async (current: Committee): Promise<void> => {
    fixture = TestBed.createComponent(CommitteeGeneralSettingsComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput(
      'form',
      new FormGroup({ name: new FormControl(current.name), category: new FormControl(current.category), parent_uid: new FormControl<string | null>(null) })
    );
    fixture.componentRef.setInput('committee', current);
    await fixture.whenStable();
  };

  beforeEach(() => {
    persona = signal('board-member');
    getCommitteesByProject = vi.fn(() =>
      of([
        committee({ uid: 'c-1', name: 'Self' }),
        committee({ uid: 'c-2', name: 'Top Level' }),
        committee({ uid: 'c-3', name: 'Already A Child', parent_uid: 'c-2' }),
      ])
    );

    TestBed.configureTestingModule({
      imports: [CommitteeGeneralSettingsComponent],
      providers: [
        provideNoopAnimations(),
        { provide: CommitteeService, useValue: { getCommitteesByProject } },
        { provide: PersonaService, useValue: { currentPersona: persona } },
      ],
    });
  });

  it('offers only top-level siblings as parents, never the group itself or an existing child', async () => {
    await create(committee({ uid: 'c-1' }));

    expect(getCommitteesByProject).toHaveBeenCalledWith('p-1');
    expect(component.parentCommitteeOptions().map((option) => option.value)).toEqual([null, 'c-2']);
  });

  it("keeps the group's current type selectable for a persona whose set excludes it", async () => {
    persona.set('maintainer');
    await create(committee({ category: 'Technical Oversight Committee/Technical Advisory Committee' }));

    expect(component.categoryOptions()[0]).toEqual({
      label: 'Technical Oversight Committee/Technical Advisory Committee',
      value: 'Technical Oversight Committee/Technical Advisory Committee',
    });
  });

  it('does not duplicate the current type when it is already selectable', async () => {
    await create(committee({ category: 'Board' }));

    expect(component.categoryOptions().filter((option) => option.value === 'Board')).toHaveLength(1);
  });

  it('skips the sibling lookup when the committee has no project', async () => {
    await create(committee({ project_uid: '' }));

    expect(getCommitteesByProject).not.toHaveBeenCalled();
    expect(component.parentCommitteeOptions().map((option) => option.value)).toEqual([null]);
  });
});
