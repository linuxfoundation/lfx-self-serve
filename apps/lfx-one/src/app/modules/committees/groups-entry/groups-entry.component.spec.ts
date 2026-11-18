// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { PLATFORM_ID, signal, Component } from '@angular/core';
import { ComponentFixture, DeferBlockBehavior, DeferBlockState, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { GROUPS_REDESIGN_FLAG } from '@lfx-one/shared/constants';
import { FeatureFlagService } from '@services/feature-flag.service';
import { LensService } from '@services/lens.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CommitteeDashboardComponent } from '../committee-dashboard/committee-dashboard.component';
import { GroupsRedesignComponent } from '../groups-redesign/groups-redesign.component';
import { GroupsEntryComponent } from './groups-entry.component';

@Component({ selector: 'lfx-committee-dashboard', template: '<div data-testid="stub-v1"></div>' })
class StubV1Component {}

@Component({ selector: 'lfx-groups-redesign', template: '<div data-testid="stub-redesign"></div>' })
class StubRedesignComponent {}

describe('GroupsEntryComponent', () => {
  let getFlagOverride: ReturnType<typeof vi.fn>;
  let providerReady: ReturnType<typeof signal<boolean>>;
  let flagValue: ReturnType<typeof signal<boolean>>;
  let waitForReady: ReturnType<typeof vi.fn>;
  let getBooleanFlag: ReturnType<typeof vi.fn>;
  let activeLens: ReturnType<typeof signal<string>>;
  let urlPath: string;
  let resolveReady: (ready: boolean) => void;

  const create = async (platform: 'browser' | 'server' = 'browser'): Promise<ComponentFixture<GroupsEntryComponent>> => {
    TestBed.overrideProvider(PLATFORM_ID, { useValue: platform });
    await TestBed.compileComponents();
    const fixture = TestBed.createComponent(GroupsEntryComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  };

  const has = (fixture: ComponentFixture<GroupsEntryComponent>, testId: string): boolean => !!fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  beforeEach(() => {
    getFlagOverride = vi.fn().mockReturnValue(undefined);
    providerReady = signal(true);
    flagValue = signal(false);
    activeLens = signal('me');
    getBooleanFlag = vi.fn().mockReturnValue(flagValue);
    urlPath = 'groups';
    // Stands in for the service's own timeout: the test settles the wait by hand.
    waitForReady = vi.fn().mockImplementation(() => new Promise<boolean>((resolve) => (resolveReady = resolve)));

    TestBed.overrideComponent(GroupsEntryComponent, {
      remove: { imports: [CommitteeDashboardComponent, GroupsRedesignComponent] },
      add: { imports: [StubV1Component, StubRedesignComponent] },
    });
    TestBed.configureTestingModule({
      providers: [
        {
          provide: FeatureFlagService,
          useValue: { getFlagOverride, providerReady: providerReady.asReadonly(), getBooleanFlag, waitForReady },
        },
        { provide: LensService, useValue: { activeLens } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { pathFromRoot: urlPath.split('/').map((path) => ({ url: [{ path }] })) } },
        },
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    });
  });

  it('renders the existing dashboard when the flag is off', async () => {
    const fixture = await create();

    expect(has(fixture, 'stub-v1')).toBe(true);
    expect(has(fixture, 'stub-redesign')).toBe(false);
  });

  it('renders the redesign when the flag is on in the Me lens', async () => {
    flagValue.set(true);

    const fixture = await create();

    expect(has(fixture, 'stub-redesign')).toBe(true);
    expect(has(fixture, 'stub-v1')).toBe(false);
  });

  it('renders the existing dashboard when the flag is on in another lens', async () => {
    flagValue.set(true);
    activeLens.set('project');

    const fixture = await create();

    expect(has(fixture, 'stub-v1')).toBe(true);
    expect(has(fixture, 'stub-redesign')).toBe(false);
  });

  for (const prefix of ['foundation', 'project']) {
    it(`renders the existing dashboard on /${prefix}/groups even in the Me lens`, async () => {
      flagValue.set(true);
      TestBed.overrideProvider(ActivatedRoute, { useValue: { snapshot: { pathFromRoot: [{ url: [{ path: prefix }] }, { url: [{ path: 'groups' }] }] } } });

      const fixture = await create();

      expect(has(fixture, 'stub-v1')).toBe(true);
      expect(has(fixture, 'stub-redesign')).toBe(false);
      expect(getFlagOverride).not.toHaveBeenCalled();
      expect(waitForReady).not.toHaveBeenCalled();
      expect(getBooleanFlag).not.toHaveBeenCalled();
    });
  }

  it('reads the flag once the provider becomes ready', async () => {
    providerReady.set(false);
    flagValue.set(true);

    const fixture = await create();
    expect(has(fixture, 'groups-entry-loading')).toBe(true);

    resolveReady(true);
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(has(fixture, 'stub-redesign')).toBe(true);
    expect(has(fixture, 'stub-v1')).toBe(false);
  });

  it('falls back to the existing dashboard when the redesign chunk fails to load', async () => {
    flagValue.set(true);
    TestBed.configureTestingModule({ deferBlockBehavior: DeferBlockBehavior.Manual });

    const fixture = await create();
    const [deferBlock] = await fixture.getDeferBlocks();
    await deferBlock.render(DeferBlockState.Error);

    expect(has(fixture, 'stub-v1')).toBe(true);
    expect(has(fixture, 'groups-entry-loading')).toBe(false);
  });

  it('shows the loader, then the existing dashboard, when the provider never becomes ready', async () => {
    providerReady.set(false);
    flagValue.set(true);

    const fixture = await create();
    expect(has(fixture, 'groups-entry-loading')).toBe(true);
    expect(waitForReady).toHaveBeenCalledWith(expect.objectContaining({ flag: GROUPS_REDESIGN_FLAG }));

    resolveReady(false);
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(has(fixture, 'groups-entry-loading')).toBe(false);
    expect(has(fixture, 'stub-v1')).toBe(true);
  });

  it('honors a local override of true without waiting for the provider', async () => {
    getFlagOverride.mockReturnValue(true);
    providerReady.set(false);

    const fixture = await create();

    expect(has(fixture, 'stub-redesign')).toBe(true);
    expect(waitForReady).not.toHaveBeenCalled();
  });

  it('honors a local override of false even when the flag is on', async () => {
    getFlagOverride.mockReturnValue(false);
    flagValue.set(true);

    const fixture = await create();

    expect(has(fixture, 'stub-v1')).toBe(true);
    expect(has(fixture, 'stub-redesign')).toBe(false);
  });

  it('only renders the loading state on the server', async () => {
    flagValue.set(true);

    const fixture = await create('server');

    expect(has(fixture, 'groups-entry-loading')).toBe(true);
    expect(has(fixture, 'stub-v1')).toBe(false);
    expect(has(fixture, 'stub-redesign')).toBe(false);
    expect(getFlagOverride).not.toHaveBeenCalled();
  });
});
