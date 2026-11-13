// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AccountContextService } from './account-context.service';
import { OrgClaReturnService } from './org-cla-return.service';
import { OrgNavigationService } from './org-navigation.service';
import { OrgRoleGrantsService } from './org-role-grants.service';
import { PersonaService } from './persona.service';

describe('OrgClaReturnService', () => {
  const NAMED = { uid: '0014100000ExamplAAA', accountId: '0014100000ExamplAAA', name: 'Example Holdings' };
  const ELSEWHERE = { uid: '0014100000Other0AAA', accountId: '0014100000Other0AAA', name: 'Other Org' };

  let items: ReturnType<typeof signal>;
  let loaded: ReturnType<typeof signal<boolean>>;
  let claOnlyPending: ReturnType<typeof signal<boolean>>;
  let generation: ReturnType<typeof signal<number>>;
  let firstPageLandedGeneration: ReturnType<typeof signal<number>>;
  let resetAndReload: ReturnType<typeof vi.fn>;
  let adoptFromAddress: ReturnType<typeof vi.fn>;
  let service: OrgClaReturnService;

  /** A reload's first page landing, as the real service reports it. */
  const landReload = (rows: ReturnType<typeof catalogueItem>[], claOnlyRowsPending = false): void => {
    items.set(rows);
    claOnlyPending.set(claOnlyRowsPending);
    firstPageLandedGeneration.set(generation());
  };

  beforeEach(() => {
    items = signal([catalogueItem(ELSEWHERE)]);
    loaded = signal(true);
    claOnlyPending = signal(false);
    generation = signal(1);
    firstPageLandedGeneration = signal(1);
    // Like the real service: the reload starts a new generation and clears the CLA-only rows at once.
    resetAndReload = vi.fn(() => {
      generation.update((g) => g + 1);
      claOnlyPending.set(false);
    });
    adoptFromAddress = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        OrgClaReturnService,
        {
          provide: AccountContextService,
          useValue: {
            hasOrgSelectorAccess: signal(true),
            adoptFromAddress,
            refreshCanonicalRecord: vi.fn().mockResolvedValue(undefined),
          },
        },
        { provide: OrgNavigationService, useValue: { items, loaded, claOnlyPending, generation, firstPageLandedGeneration, resetAndReload } },
        { provide: OrgRoleGrantsService, useValue: { loaded: signal(true) } },
        { provide: PersonaService, useValue: { personaLoaded: signal(true) } },
      ],
    });
    service = TestBed.inject(OrgClaReturnService);
  });

  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('resolves null when the catalogue pin reload never re-emits', async () => {
    vi.useFakeTimers();

    const result = firstValueFrom(service.organizationNamed(NAMED.uid));
    await vi.advanceTimersByTimeAsync(0);

    expect(resetAndReload).toHaveBeenCalledWith(NAMED.uid);

    await vi.advanceTimersByTimeAsync(10_000);
    await expect(result).resolves.toBeNull();
  });

  it('selects the named organization when the pin reload answers in time', async () => {
    resetAndReload.mockImplementation(() => {
      generation.update((g) => g + 1);
      landReload([catalogueItem(ELSEWHERE), catalogueItem(NAMED)]);
    });

    const match = await firstValueFrom(service.adopt(NAMED.uid));

    expect(resetAndReload).toHaveBeenCalledWith(NAMED.uid);
    expect(match?.uid).toBe(NAMED.uid);
    expect(adoptFromAddress).toHaveBeenCalledWith(expect.objectContaining({ uid: NAMED.uid, accountName: NAMED.name }));
  });

  it('does not start a pin reload when the catalogue already lists the name', async () => {
    items.set([catalogueItem(NAMED)]);

    const match = await firstValueFrom(service.organizationNamed(NAMED.uid));

    expect(resetAndReload).not.toHaveBeenCalled();
    expect(match?.uid).toBe(NAMED.uid);
  });

  it('waits for the CLA-only rows before treating the name as missing', async () => {
    vi.useFakeTimers();
    claOnlyPending.set(true);

    const result = firstValueFrom(service.organizationNamed(NAMED.uid));
    await vi.advanceTimersByTimeAsync(0);
    expect(resetAndReload).not.toHaveBeenCalled();

    items.set([catalogueItem(ELSEWHERE), catalogueItem(NAMED)]);
    claOnlyPending.set(false);
    await vi.advanceTimersByTimeAsync(0);

    await expect(result).resolves.toEqual(expect.objectContaining({ uid: NAMED.uid }));
    expect(resetAndReload).not.toHaveBeenCalled();
  });

  it('matches a CLA-only row that arrives after the pin reload lands its held page', async () => {
    vi.useFakeTimers();

    const result = firstValueFrom(service.organizationNamed(NAMED.uid));
    await vi.advanceTimersByTimeAsync(0);
    expect(resetAndReload).toHaveBeenCalledWith(NAMED.uid);

    landReload([catalogueItem(ELSEWHERE)], true);
    await vi.advanceTimersByTimeAsync(0);

    items.set([catalogueItem(ELSEWHERE), catalogueItem(NAMED)]);
    claOnlyPending.set(false);
    await vi.advanceTimersByTimeAsync(0);

    await expect(result).resolves.toEqual(expect.objectContaining({ uid: NAMED.uid }));
  });
});

function catalogueItem(org: { uid: string; accountId: string; name: string }): { uid: string; accountId: string; name: string; logoUrl: null } {
  return { uid: org.uid, accountId: org.accountId, name: org.name, logoUrl: null };
}
