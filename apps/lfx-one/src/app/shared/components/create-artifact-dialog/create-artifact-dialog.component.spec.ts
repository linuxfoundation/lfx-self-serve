// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { CreatePickerCommitteeNode, CreatePickerNode, CreatePickerProjectNode } from '@lfx-one/shared/interfaces';
import { MeetingComposerService } from '@app/modules/meetings/meeting-composer/meeting-composer.service';
import { LensService } from '@services/lens.service';
import { ProjectContextService } from '@services/project-context.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CreateArtifactDialogComponent } from './create-artifact-dialog.component';

const PROJECT: CreatePickerProjectNode = { kind: 'project', uid: 'project-1', name: 'Acme', slug: 'acme', isFoundation: false };
const COMMITTEE: CreatePickerCommitteeNode = {
  kind: 'committee',
  uid: 'committee-1',
  name: 'TSC',
  projectUid: 'project-1',
  projectSlug: 'acme',
  projectName: 'Acme',
  isFoundation: false,
};

/**
 * Covers which create surface the rail's picker hands a confirmed target to.
 *
 * A meeting pick opens the composer over the page the rail was on; every other artifact type
 * navigates to its create route. Everything around that branch — the lens alignment, the context
 * write, closing the dialog — has to happen either way, so the cases below assert the surface *and*
 * that the rest of the flow is untouched.
 */
describe('CreateArtifactDialogComponent — create surface', () => {
  let navigate: ReturnType<typeof vi.fn>;
  let composerOpen: ReturnType<typeof vi.fn>;
  let close: ReturnType<typeof vi.fn>;
  let setContextLens: ReturnType<typeof vi.fn>;
  let setProject: ReturnType<typeof vi.fn>;
  let setFoundation: ReturnType<typeof vi.fn>;

  /** Mounts the dialog for one artifact type with an empty template — these cases drive `onContinue` directly. */
  async function mount(type: string): Promise<CreateArtifactDialogComponent> {
    TestBed.configureTestingModule({
      providers: [
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data: { type } } },
        { provide: Router, useValue: { navigate } },
        { provide: ProjectContextService, useValue: { setProject, setFoundation } },
        { provide: LensService, useValue: { setContextLens } },
        { provide: MeetingComposerService, useValue: { open: composerOpen } },
      ],
    });
    // Empty template: the picker it hosts fetches its own tree and has its own spec. These cases
    // hand the component a target the way a confirmed picker selection would.
    TestBed.overrideComponent(CreateArtifactDialogComponent, { set: { template: '', imports: [], providers: [] } });
    await TestBed.compileComponents();

    const fixture = TestBed.createComponent(CreateArtifactDialogComponent);
    await fixture.whenStable();
    return fixture.componentInstance;
  }

  /** Selects a target and confirms, which is the only path into the create branch. */
  const confirm = (component: CreateArtifactDialogComponent, target: CreatePickerNode): void => {
    component.onTargetSelected(target);
    component.onContinue();
  };

  beforeEach(() => {
    navigate = vi.fn();
    composerOpen = vi.fn();
    close = vi.fn();
    setContextLens = vi.fn();
    setProject = vi.fn();
    setFoundation = vi.fn();
  });

  it('opens the composer in place for a project-scoped meeting pick', async () => {
    const component = await mount('meeting');

    confirm(component, PROJECT);

    expect(navigate).not.toHaveBeenCalled();
    expect(composerOpen).toHaveBeenCalledWith({ mode: 'create', projectUid: 'project-1', committeeUid: undefined });
    expect(close).toHaveBeenCalledWith(true);
  });

  it("opens the composer against the picked group, scoped to the group's own project", async () => {
    const component = await mount('meeting');

    confirm(component, COMMITTEE);

    // `projectUid` comes from the committee's `projectUid`, not its own `uid` — the composer scopes
    // its project-level reads by it, and passing the committee uid there would scope them to nothing.
    expect(composerOpen).toHaveBeenCalledWith({ mode: 'create', projectUid: 'project-1', committeeUid: 'committee-1' });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('aligns the lens and writes the context before opening the composer', async () => {
    const component = await mount('meeting');
    confirm(component, PROJECT);

    // The picked target is the context from here on, and `syncUrl: false` stays false so opening
    // the composer over a page doesn't rewrite that page's history entry.
    expect(setContextLens).toHaveBeenCalledWith('project');
    expect(setProject).toHaveBeenCalledWith({ uid: 'project-1', name: 'Acme', slug: 'acme' }, false);
  });

  it('routes a foundation-scoped pick through setFoundation', async () => {
    const component = await mount('meeting');

    confirm(component, { ...PROJECT, isFoundation: true });

    expect(setContextLens).toHaveBeenCalledWith('foundation');
    expect(setFoundation).toHaveBeenCalledWith({ uid: 'project-1', name: 'Acme', slug: 'acme' }, false);
    expect(setProject).not.toHaveBeenCalled();
  });

  it('leaves every other artifact type navigating to its create route', async () => {
    const component = await mount('vote');

    confirm(component, PROJECT);

    // Only meetings have an in-place composer: a vote pick must still reach `/votes/create`.
    expect(composerOpen).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/votes/create'], { queryParams: { project: 'acme' } });
  });
});
