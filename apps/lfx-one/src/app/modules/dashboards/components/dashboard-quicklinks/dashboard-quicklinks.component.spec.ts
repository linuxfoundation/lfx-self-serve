// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MeetingComposerService } from '@modules/meetings/meeting-composer/meeting-composer.service';
import { ProjectContextService } from '@services/project-context.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardQuicklinksComponent } from './dashboard-quicklinks.component';

/**
 * Covers which quick links a given set of permissions actually renders, and as what element.
 *
 * The two permissions are deliberately driven apart in these tests. They used to be one `canWrite()`
 * gate over the whole row, and the bug that split them — a meeting coordinator who is not a project
 * writer seeing no quick links at all — only reproduces when they disagree, so every case here sets
 * them independently.
 */
describe('DashboardQuicklinksComponent', () => {
  let fixture: ComponentFixture<DashboardQuicklinksComponent>;
  const canWrite = signal(false);
  const canWriteMeetings = signal(false);
  const activeContextUid = signal<string | null>(null);
  const open = vi.fn();

  /** The `data-testid` slug of every link rendered, in order. */
  const renderedSlugs = (): string[] =>
    Array.from(fixture.nativeElement.querySelectorAll('[data-testid^="dashboard-quicklink-"]')).map((element) =>
      (element as HTMLElement).getAttribute('data-testid')!.replace('dashboard-quicklink-', '')
    );

  const link = (slug: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="dashboard-quicklink-${slug}"]`);

  beforeEach(async () => {
    canWrite.set(false);
    canWriteMeetings.set(false);
    activeContextUid.set(null);
    open.mockClear();

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ProjectContextService, useValue: { canWrite, canWriteMeetings, activeContextUid } },
        { provide: MeetingComposerService, useValue: { open } },
      ],
    });

    fixture = TestBed.createComponent(DashboardQuicklinksComponent);
    await fixture.whenStable();
  });

  it('renders nothing at all when the user can use none of the links', async () => {
    await fixture.whenStable();

    expect(renderedSlugs()).toEqual([]);
    // Not just the links: the heading has to go too, and the component has to leave the host element
    // with no rendered children — the sidebar carries `empty:hidden` on it so the surrounding `gap-8`
    // doesn't leave a hole, and that only fires while the host is `:empty`.
    expect(fixture.nativeElement.querySelector('[data-testid="dashboard-quicklinks-sidebar"]')).toBeNull();
    expect(fixture.nativeElement.children.length).toBe(0);
  });

  it('shows only the meeting link to someone who can author meetings but cannot write to the project', async () => {
    canWriteMeetings.set(true);
    await fixture.whenStable();

    expect(renderedSlugs()).toEqual(['create-meeting']);
  });

  it('shows only the project links to a writer who cannot author meetings', async () => {
    canWrite.set(true);
    await fixture.whenStable();

    expect(renderedSlugs()).toEqual(['create-group', 'create-mailing-list']);
  });

  it('renders the meeting link as a button that announces the dialog it opens', async () => {
    canWriteMeetings.set(true);
    await fixture.whenStable();

    const trigger = link('create-meeting');

    // A button rather than an anchor, because it opens the composer over the current page: an anchor
    // would put a destination in the status bar that this link does not navigate to.
    expect(trigger?.tagName).toBe('BUTTON');
    expect(trigger?.getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('renders a navigating link as an anchor with an href and no popup announcement', async () => {
    canWrite.set(true);
    await fixture.whenStable();

    const trigger = link('create-group');

    expect(trigger?.tagName).toBe('A');
    expect(trigger?.getAttribute('href')).toBe('/groups/create');
    // The attribute is bound to the link's own `hasPopup`, so a link that opens nothing announces
    // nothing — the template hard-coded `dialog` on every non-anchor branch before.
    expect(trigger?.getAttribute('aria-haspopup')).toBeNull();
  });

  it('opens the quick composer against the active project when the meeting link is clicked', async () => {
    canWriteMeetings.set(true);
    activeContextUid.set('project-1');
    await fixture.whenStable();

    link('create-meeting')?.click();

    expect(open).toHaveBeenCalledWith({ mode: 'create', variant: 'quick', projectUid: 'project-1' });
  });

  it('leaves the project unset when there is no active context', async () => {
    canWriteMeetings.set(true);
    await fixture.whenStable();

    link('create-meeting')?.click();

    // `undefined`, not `null` or `''`: the composer treats an explicit `projectUid` as taking
    // precedence over the ambient context, so passing a falsy one would pin it to nothing.
    expect(open).toHaveBeenCalledWith({ mode: 'create', variant: 'quick', projectUid: undefined });
  });
});
