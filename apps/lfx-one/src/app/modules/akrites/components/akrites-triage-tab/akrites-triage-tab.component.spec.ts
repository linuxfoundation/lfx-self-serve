// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ApplicationRef, PLATFORM_ID, TransferState, makeStateKey, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AKRITES_TRIAGE_COLUMNS } from '@lfx-one/shared/constants';
import type {
  AkritesPackage,
  AkritesPackagesResponse,
  AkritesTriageBoardPageState,
  AkritesTriageColumnState,
  AkritesTriagePackageVM,
  AkritesTriageStatus,
} from '@lfx-one/shared/interfaces';
import { AkritesService } from '@shared/services/akrites.service';
import { ProjectContextService } from '@shared/services/project-context.service';
import { MessageService } from 'primeng/api';
import { of, Subject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AkritesTriageTabComponent } from './akrites-triage-tab.component';

const AKRITES_TRIAGE_STATE_KEY = makeStateKey<AkritesTriageBoardPageState>('akritesTriageBoardState');

function pkg(over: Partial<AkritesPackage> = {}): AkritesPackage {
  return {
    id: 'pkg-1',
    name: 'leftpad',
    purl: 'pkg:npm/leftpad@1.0.0',
    ecosystem: 'npm',
    lifecycle: 'active',
    healthScore: 80,
    healthLabel: 'Healthy',
    impactScore: 40,
    busFactor: 3,
    monthsStale: 0,
    vulnCount: 0,
    vulnSeverity: null,
    status: 'unassigned',
    stewardshipId: null,
    stewards: [],
    lastActivityLabel: '',
    lastActivityTime: '',
    downloadsLastMonth: null,
    dependentPackages: null,
    dependentRepos: null,
    scoreCardScore: null,
    lastRelease: null,
    lastCommit: null,
    repoUrl: null,
    mappingConfidence: null,
    supplyChainMapping: null,
    provenance: null,
    pvrEnabled: null,
    criticalVulnFlag: null,
    hasSecurityMd: null,
    ecosystemReach: null,
    contactGroup: null,
    healthBreakdown: [],
    assessment: null,
    advisories: [],
    history: [],
    ...over,
  };
}

function packageVm(over: Partial<AkritesTriagePackageVM> = {}): AkritesTriagePackageVM {
  return {
    ...pkg(),
    healthColor: '#10b981',
    healthLabel: 'Healthy',
    vulnColor: '#10b981',
    ...over,
  };
}

function emptyColumn(): AkritesTriageColumnState {
  return { packages: [], total: 0, loading: false, error: false };
}

function seededBoard(unassigned: AkritesTriagePackageVM[] = [packageVm()]): Record<AkritesTriageStatus, AkritesTriageColumnState> {
  const board = Object.fromEntries(AKRITES_TRIAGE_COLUMNS.map((c) => [c.status, emptyColumn()])) as Record<AkritesTriageStatus, AkritesTriageColumnState>;
  board.unassigned = { packages: unassigned, total: unassigned.length, loading: false, error: false };
  return board;
}

function seededSuccess(): AkritesTriageBoardPageState {
  return { loading: false, board: seededBoard() };
}

describe('AkritesTriageTabComponent — TransferState seeding (GH-2080)', () => {
  let getPackages: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    getPackages = vi.fn((params: { status?: string } = {}) =>
      of<AkritesPackagesResponse>({
        packages: params.status === 'unassigned' ? [pkg()] : [],
        total: params.status === 'unassigned' ? 1 : 0,
      })
    );

    await TestBed.configureTestingModule({
      imports: [AkritesTriageTabComponent],
      providers: [
        { provide: AkritesService, useValue: { getPackages, searchStewards: () => of([]) } },
        { provide: ProjectContextService, useValue: { canWrite: signal(false) } },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    }).compileComponents();
  });

  it('paints synchronously from a browser TransferState seed with no skeleton flash', () => {
    const transferState = TestBed.inject(TransferState);
    transferState.set(AKRITES_TRIAGE_STATE_KEY, seededSuccess());

    const fixture = TestBed.createComponent(AkritesTriageTabComponent);
    const component = fixture.componentInstance as unknown as { loading: () => boolean; boardData: () => AkritesTriageBoardPageState['board'] };

    // Assert before any stabilization — the regression this guards against only reproduces if
    // the seed lands after the first CD pass.
    expect(component.loading()).toBe(false);
    expect(component.boardData()?.unassigned.packages[0]?.id).toBe('pkg-1');
    expect(transferState.get(AKRITES_TRIAGE_STATE_KEY, null)).toBeNull();

    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="akrites-triage-loading"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="akrites-triage-board"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="akrites-triage-card-pkg-1"]')).not.toBeNull();
  });

  it('shows the skeleton on the initial render when there is no seed and the fetch has not resolved yet', () => {
    getPackages.mockReturnValue(new Subject<AkritesPackagesResponse>());

    const fixture = TestBed.createComponent(AkritesTriageTabComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="akrites-triage-loading"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="akrites-triage-board"]')).toBeNull();
  });

  it('holds the seeded board, without an intermediate skeleton flash, while the hydration refetch is in flight', async () => {
    // Held open so there is an in-flight window between the first paint and the refetch settling —
    // otherwise a startWith(loading) + sync of() would both land in one tick and hide a regression.
    // One shared Subject is returned to every column fetch so forkJoin can be completed with a
    // single next/complete, matching the groups GH-2081 spec.
    const refetch$ = new Subject<AkritesPackagesResponse>();
    getPackages.mockReturnValue(refetch$);

    TestBed.inject(TransferState).set(AKRITES_TRIAGE_STATE_KEY, seededSuccess());

    const fixture = TestBed.createComponent(AkritesTriageTabComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="akrites-triage-loading"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="akrites-triage-card-pkg-1"]')).not.toBeNull();

    refetch$.next({ packages: [pkg()], total: 1 });
    refetch$.complete();
    await TestBed.inject(ApplicationRef).whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="akrites-triage-loading"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="akrites-triage-board"]')).not.toBeNull();
  });

  it('persists the resolved board to TransferState on the server once the fetch settles', async () => {
    TestBed.overrideProvider(PLATFORM_ID, { useValue: 'server' });
    getPackages.mockImplementation((params: { status?: string } = {}) =>
      of<AkritesPackagesResponse>({
        packages: params.status === 'unassigned' ? [pkg()] : [],
        total: params.status === 'unassigned' ? 1 : 0,
      })
    );

    TestBed.createComponent(AkritesTriageTabComponent);
    await TestBed.inject(ApplicationRef).whenStable();

    const seeded = TestBed.inject(TransferState).get(AKRITES_TRIAGE_STATE_KEY, null);
    expect(seeded?.loading).toBe(false);
    expect(seeded?.board?.unassigned.total).toBe(1);
    expect(seeded?.board?.unassigned.packages[0]?.id).toBe('pkg-1');
  });

  it('re-enters loading when sort changes after the seeded first paint', () => {
    getPackages.mockImplementation(() => new Subject<AkritesPackagesResponse>());
    TestBed.inject(TransferState).set(AKRITES_TRIAGE_STATE_KEY, seededSuccess());

    const fixture: ComponentFixture<AkritesTriageTabComponent> = TestBed.createComponent(AkritesTriageTabComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="akrites-triage-card-pkg-1"]')).not.toBeNull();

    fixture.componentRef.setInput('sortBy', 'name');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="akrites-triage-loading"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="akrites-triage-board"]')).toBeNull();
  });
});
