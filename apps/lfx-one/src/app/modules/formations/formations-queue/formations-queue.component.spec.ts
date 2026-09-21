// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { FormationService } from '@services/formation.service';
import { ProjectContextService } from '@services/project-context.service';
import { createEmptyFormationsQueueResponse } from '@lfx-one/shared/constants';
import type { FormationsQueueResponse, ProjectContext } from '@lfx-one/shared/interfaces';
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

describe('FormationsQueueComponent — "In formation" tile subLine (GH-2366, GH-2584)', () => {
  let fixture: ComponentFixture<FormationsQueueComponent>;

  const render = async (response: FormationsQueueResponse): Promise<void> => {
    TestBed.resetTestingModule();

    await TestBed.configureTestingModule({
      imports: [FormationsQueueComponent],
      providers: [
        provideRouter([]),
        { provide: FormationService, useValue: { getFormationsQueue: vi.fn(() => of(response)) } },
        { provide: ProjectContextService, useValue: { selectedFoundation: signal<ProjectContext | null>(null) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FormationsQueueComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  // GH-2584 removed the clause this pair used to assert. The queue now lists only formations still
  // in progress, so "outside formation stages" described none of its rows — an unmapped row is
  // inside formation at a sub-stage the tiles have no name for. The count is still computed and
  // still logged server-side as the detector for a new upstream sub-stage; it just has no honest
  // one-line phrasing, so the tile stays silent about it.
  it('never claims rows are outside formation stages, even when tiles.unmapped is non-zero', async () => {
    await render({
      rows: [],
      tiles: { total: 8, foundations: 1, projects: 7, exploratory: 5, engaged: 1, on_hold: 0, unmapped: 2, ready: 0, blocked: 0, blocked_items: 0 },
    });

    const subLine = fixture.nativeElement.querySelector('[data-testid="stat-card-In formation"] .text-xs')?.textContent;
    expect(subLine).not.toContain('outside formation stages');
    // Asserted positively too: `not.toContain` alone would also pass on an empty or missing
    // subLine, which is a different bug that would otherwise ship unnoticed.
    expect(subLine).toContain('1 foundation · 7 projects');
  });

  it('renders the foundations and projects breakdown when there is nothing in the queue', async () => {
    await render(createEmptyFormationsQueueResponse());

    const subLine = fixture.nativeElement.querySelector('[data-testid="stat-card-In formation"] .text-xs')?.textContent;
    expect(subLine).toContain('0 foundations · 0 projects');
  });
});

describe('FormationsQueueComponent — health tiles (#2782)', () => {
  let fixture: ComponentFixture<FormationsQueueComponent>;

  const render = async (response: FormationsQueueResponse): Promise<void> => {
    TestBed.resetTestingModule();

    await TestBed.configureTestingModule({
      imports: [FormationsQueueComponent],
      providers: [
        provideRouter([]),
        { provide: FormationService, useValue: { getFormationsQueue: vi.fn(() => of(response)) } },
        { provide: ProjectContextService, useValue: { selectedFoundation: signal<ProjectContext | null>(null) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FormationsQueueComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const tile = (label: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="stat-card-${label}"]`);

  // "Ready to activate" used to be `rows().filter(gates_cleared).length` — a count over the
  // served, already-filtered rows — while its neighbours came from the server's unfiltered
  // tiles. With rows empty here, that old formula would read 0 against a server count of 2.
  it('reads every tile from the server counts, never from the served rows', async () => {
    await render({
      rows: [],
      tiles: { total: 5, foundations: 2, projects: 3, exploratory: 1, engaged: 3, on_hold: 1, unmapped: 0, ready: 2, blocked: 1, blocked_items: 3 },
    });

    expect(tile('In formation')?.querySelector('p')?.textContent?.trim()).toBe('5');
    expect(tile('Ready to activate')?.querySelector('p')?.textContent?.trim()).toBe('2');
    expect(tile('Blocked')?.querySelector('p')?.textContent?.trim()).toBe('1');
    expect(tile('Blocked')?.textContent).toContain('3 blocked items');
    expect(tile('On hold')?.querySelector('p')?.textContent?.trim()).toBe('1');
    // The per-stage counts moved onto the filter pills, where the stage filter already is.
    expect(tile('Exploratory')).toBeNull();
    expect(tile('Engaged')).toBeNull();
  });

  it('singularises the breakdown copy', async () => {
    await render({
      rows: [],
      tiles: { total: 2, foundations: 1, projects: 1, exploratory: 0, engaged: 2, on_hold: 0, unmapped: 0, ready: 0, blocked: 1, blocked_items: 1 },
    });

    expect(tile('In formation')?.textContent).toContain('1 foundation · 1 project');
    expect(tile('Blocked')?.textContent).toContain('1 blocked item');
  });
});
