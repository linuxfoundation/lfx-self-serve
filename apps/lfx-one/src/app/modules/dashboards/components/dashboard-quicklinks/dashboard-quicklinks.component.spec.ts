// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { MeetingComposerService } from '@modules/meetings/meeting-composer/meeting-composer.service';
import { MeetingCreateMenuComponent } from '@modules/meetings/meeting-composer/meeting-create-menu.component';
import { PersonaService } from '@services/persona.service';
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
  // `signal<string>('')`, matching `ProjectContextService.activeContextUid`, which is a
  // `Signal<string>` that reports `''` for "no context" rather than `null`. A double typed
  // `string | null` would let this file assert against a shape the real service never produces —
  // the same drift the `FakeValidationError` double in the server specs was fixed for.
  const activeContextUid = signal('');
  const open = vi.fn();

  /** The `data-testid` slug of every link rendered, in order. */
  const renderedSlugs = (): string[] =>
    Array.from(fixture.nativeElement.querySelectorAll('[data-testid^="dashboard-quicklink-"]')).map((element) =>
      (element as HTMLElement).getAttribute('data-testid')!.replace('dashboard-quicklink-', '')
    );

  const link = (slug: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="dashboard-quicklink-${slug}"]`);

  /** The Create Meeting dropdown mounted beside the links. */
  const createMeetingMenu = (): MeetingCreateMenuComponent => fixture.debugElement.query(By.directive(MeetingCreateMenuComponent)).componentInstance;

  beforeEach(async () => {
    canWrite.set(false);
    canWriteMeetings.set(false);
    activeContextUid.set('');
    open.mockClear();

    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ProjectContextService, useValue: { canWrite, canWriteMeetings, activeContextUid } },
        { provide: MeetingComposerService, useValue: { open } },
        { provide: PersonaService, useValue: { currentPersona: () => 'maintainer' } },
      ],
    });
    // The dropdown's own markup is its own spec's business; these tests only care that this
    // component mounts one and points it at the right project. Blanking the template also keeps
    // `toggle` a no-op, so a click here can't reach into PrimeNG's overlay machinery.
    TestBed.overrideComponent(MeetingCreateMenuComponent, { set: { template: '', imports: [] } });

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

  it('renders the meeting link as a button that announces the menu it opens', async () => {
    canWriteMeetings.set(true);
    await fixture.whenStable();

    const trigger = link('create-meeting');

    // A button rather than an anchor, because it opens a dropdown over the current page: an anchor
    // would put a destination in the status bar that this link does not navigate to. `menu`, not
    // `dialog` — the click opens the type picker, and the composer is a choice further in.
    expect(trigger?.tagName).toBe('BUTTON');
    expect(trigger?.getAttribute('aria-haspopup')).toBe('menu');
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

  it('opens the create dropdown against the clicked link rather than the composer', async () => {
    canWriteMeetings.set(true);
    await fixture.whenStable();

    // Read inside the call, not from the recorded event afterwards: `currentTarget` is only set
    // while the event is being dispatched, which is the whole reason the dropdown has to be handed
    // the event rather than look the trigger up later.
    let openedAgainst: EventTarget | null = null;
    const toggle = vi.spyOn(createMeetingMenu(), 'toggle').mockImplementation((event) => {
      openedAgainst = event.currentTarget;
    });
    const trigger = link('create-meeting');
    trigger?.click();

    expect(toggle).toHaveBeenCalledOnce();
    expect(openedAgainst).toBe(trigger);
    // Nothing is created or pre-selected on the organizer's behalf: picking a meeting type or
    // Advanced in the dropdown is what reaches the composer.
    expect(open).not.toHaveBeenCalled();
  });

  it('scopes the dropdown to the active project', async () => {
    canWriteMeetings.set(true);
    activeContextUid.set('project-1');
    await fixture.whenStable();

    expect(createMeetingMenu().projectUid()).toBe('project-1');
  });

  it('centres the dropdown on the link rather than hanging it off one side', async () => {
    canWriteMeetings.set(true);
    await fixture.whenStable();

    // The link is a narrow row inside the sidebar column, so a right-aligned panel would reach far
    // out over the page beside it instead of reading as belonging to the link.
    expect(createMeetingMenu().align()).toBe('center');
  });

  it('leaves the dropdown project unset when there is no active context', async () => {
    canWriteMeetings.set(true);
    await fixture.whenStable();

    // `undefined`, not `null` or `''`: the composer treats an explicit `projectUid` as taking
    // precedence over the ambient context, so passing a falsy one would pin it to nothing.
    expect(createMeetingMenu().projectUid()).toBeUndefined();
  });
});
