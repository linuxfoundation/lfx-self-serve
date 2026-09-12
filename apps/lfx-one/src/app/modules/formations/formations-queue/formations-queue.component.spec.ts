// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { FormationService } from '@services/formation.service';
import { ProjectContextService } from '@services/project-context.service';
import { createEmptyFormationsQueueResponse } from '@lfx-one/shared/constants';
import type { ProjectContext } from '@lfx-one/shared/interfaces';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { FormationsQueueComponent } from './formations-queue.component';

describe('FormationsQueueComponent — foundation scoping (GH-2367)', () => {
  let fixture: ComponentFixture<FormationsQueueComponent>;
  let getFormationsQueue: ReturnType<typeof vi.fn>;
  let selectedFoundation: ReturnType<typeof signal<ProjectContext | null>>;

  const render = async (): Promise<void> => {
    TestBed.resetTestingModule();
    getFormationsQueue = vi.fn(() => of(createEmptyFormationsQueueResponse()));
    selectedFoundation = signal<ProjectContext | null>(null);

    await TestBed.configureTestingModule({
      imports: [FormationsQueueComponent],
      providers: [
        provideRouter([]),
        { provide: FormationService, useValue: { getFormationsQueue } },
        { provide: ProjectContextService, useValue: { selectedFoundation } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FormationsQueueComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  it('fetches root-scoped (no foundation_uid) when no foundation is selected', async () => {
    await render();

    expect(getFormationsQueue).toHaveBeenCalledWith(undefined, '', undefined);
  });

  it('forwards the selected foundation uid once a foundation is chosen', async () => {
    await render();

    selectedFoundation.set({ uid: 'aaif-uid-1', name: 'AAIF', slug: 'aaif' } as ProjectContext);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(getFormationsQueue).toHaveBeenLastCalledWith(undefined, '', 'aaif-uid-1');
  });

  it('drops the foundation_uid param again once the selection is cleared', async () => {
    await render();

    selectedFoundation.set({ uid: 'aaif-uid-1', name: 'AAIF', slug: 'aaif' } as ProjectContext);
    fixture.detectChanges();
    await fixture.whenStable();

    selectedFoundation.set(null);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(getFormationsQueue).toHaveBeenLastCalledWith(undefined, '', undefined);
  });
});
