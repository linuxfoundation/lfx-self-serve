// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { FORMATION_ENABLED_FLAG } from '@lfx-one/shared/constants';
import { FeatureFlagService } from '@shared/services/feature-flag.service';
import { ProjectService } from '@shared/services/project.service';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isFormationChecklistProject, resolveFormationFlag } from './formation-checklist-gate.util';

describe('resolveFormationFlag', () => {
  let getFlagOverride: ReturnType<typeof vi.fn>;
  let providerReady: ReturnType<typeof signal<boolean>>;
  let waitForReady: ReturnType<typeof vi.fn>;
  let getBooleanFlag: ReturnType<typeof vi.fn>;
  let featureFlagService: FeatureFlagService;

  beforeEach(() => {
    getFlagOverride = vi.fn().mockReturnValue(undefined);
    providerReady = signal(true);
    waitForReady = vi.fn().mockResolvedValue(true);
    getBooleanFlag = vi.fn().mockReturnValue(signal(true));
    featureFlagService = { getFlagOverride, providerReady: providerReady.asReadonly(), waitForReady, getBooleanFlag } as unknown as FeatureFlagService;
  });

  it('honours a pinned false override without consulting the provider', async () => {
    getFlagOverride.mockReturnValue(false);
    providerReady.set(false);

    await expect(resolveFormationFlag(featureFlagService, 'someGuard')).resolves.toBe(false);

    expect(waitForReady).not.toHaveBeenCalled();
    expect(getBooleanFlag).not.toHaveBeenCalled();
  });

  it('honours a pinned true override without consulting the provider', async () => {
    getFlagOverride.mockReturnValue(true);
    providerReady.set(false);
    getBooleanFlag.mockReturnValue(signal(false));

    await expect(resolveFormationFlag(featureFlagService, 'someGuard')).resolves.toBe(true);

    expect(waitForReady).not.toHaveBeenCalled();
    expect(getBooleanFlag).not.toHaveBeenCalled();
  });

  it('reads the flag straight away when the provider is already ready', async () => {
    await expect(resolveFormationFlag(featureFlagService, 'someGuard')).resolves.toBe(true);

    expect(waitForReady).not.toHaveBeenCalled();
    expect(getBooleanFlag).toHaveBeenCalledWith(FORMATION_ENABLED_FLAG, false);
  });

  it('returns false when the flag evaluates off', async () => {
    getBooleanFlag.mockReturnValue(signal(false));

    await expect(resolveFormationFlag(featureFlagService, 'someGuard')).resolves.toBe(false);
  });

  it('waits for the provider under the calling guard name and reads the flag once ready', async () => {
    providerReady.set(false);

    await expect(resolveFormationFlag(featureFlagService, 'formationOverviewRedirectGuard')).resolves.toBe(true);

    expect(waitForReady).toHaveBeenCalledWith({ guard: 'formationOverviewRedirectGuard', flag: FORMATION_ENABLED_FLAG });
    expect(getBooleanFlag).toHaveBeenCalledWith(FORMATION_ENABLED_FLAG, false);
  });

  it('passes an explicit readiness budget through to waitForReady', async () => {
    providerReady.set(false);

    await expect(resolveFormationFlag(featureFlagService, 'formationOverviewRedirectGuard', 3_000)).resolves.toBe(true);

    expect(waitForReady).toHaveBeenCalledWith({ guard: 'formationOverviewRedirectGuard', flag: FORMATION_ENABLED_FLAG }, 3_000);
  });

  it('resolves false without reading the flag when the provider never becomes ready', async () => {
    providerReady.set(false);
    waitForReady.mockResolvedValue(false);

    await expect(resolveFormationFlag(featureFlagService, 'someGuard')).resolves.toBe(false);

    expect(getBooleanFlag).not.toHaveBeenCalled();
  });
});

describe('isFormationChecklistProject', () => {
  let getProject: ReturnType<typeof vi.fn>;
  let projectService: ProjectService;

  beforeEach(() => {
    getProject = vi.fn().mockReturnValue(of({ stage: 'Formation - Exploratory' }));
    projectService = { getProject } as unknown as ProjectService;
  });

  it('fetches the project by slug without the writer check', async () => {
    await isFormationChecklistProject(projectService, 'my-project');

    expect(getProject).toHaveBeenCalledWith('my-project', false);
  });

  it.each(['Formation - Exploratory', 'Formation - Engaged', 'Formation - On Hold', 'Formation - Confidential'])('is true for a %s project', async (stage) => {
    getProject.mockReturnValue(of({ stage }));

    await expect(isFormationChecklistProject(projectService, 'my-project')).resolves.toBe(true);
  });

  it.each(['Formation - Disengaged', 'Active', 'Archived', 'Prospect', 'Draft'])('is false for a %s project', async (stage) => {
    getProject.mockReturnValue(of({ stage }));

    await expect(isFormationChecklistProject(projectService, 'my-project')).resolves.toBe(false);
  });

  it('is false when the project cannot be resolved', async () => {
    getProject.mockReturnValue(of(null));

    await expect(isFormationChecklistProject(projectService, 'my-project')).resolves.toBe(false);
  });
});
