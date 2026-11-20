// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard } from '@angular/cdk/clipboard';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { environment } from '@environments/environment';
import { ProjectContext } from '@lfx-one/shared/interfaces';
import { ProjectContextService } from '@services/project-context.service';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingsSubscribeDialogComponent } from '../meetings-subscribe-dialog/meetings-subscribe-dialog.component';
import { MeetingsCalendarActionsComponent } from './meetings-calendar-actions.component';

describe('MeetingsCalendarActionsComponent', () => {
  let context: ReturnType<typeof signal<ProjectContext | null>>;
  let copy: ReturnType<typeof vi.fn<(text: string) => boolean>>;
  let show: ReturnType<typeof vi.fn>;
  let open: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    context = signal<ProjectContext | null>({ uid: 'project-1', name: 'Synthetic Foundation', slug: 'synthetic' });
    copy = vi.fn<(text: string) => boolean>(() => true);
    show = vi.fn();
    open = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: ProjectContextService, useValue: { activeContext: context, activeContextUid: () => context()?.uid ?? '' } },
        { provide: Clipboard, useValue: { copy } },
        { provide: UiToastService, useValue: { show } },
        { provide: UiModalService, useValue: { open } },
      ],
    });
  });

  const render = async (): Promise<ComponentFixture<MeetingsCalendarActionsComponent>> => {
    const fixture = TestBed.createComponent(MeetingsCalendarActionsComponent);
    await fixture.whenStable();
    return fixture;
  };
  const query = (fixture: ComponentFixture<MeetingsCalendarActionsComponent>, testId: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  it('opens the subscribe dialog with the project feed', async () => {
    const fixture = await render();

    expect(query(fixture, 'meetings-calendar-actions-subscribe')?.textContent?.trim()).toBe('Subscribe');
    query(fixture, 'meetings-calendar-actions-subscribe')?.querySelector('button')?.click();

    expect(open).toHaveBeenCalledWith(MeetingsSubscribeDialogComponent, {
      data: { feedUrl: `${environment.urls.home}/public/api/projects/project-1/calendar.ics`, name: 'Synthetic Foundation' },
      describedBy: true,
    });
  });

  it('opens the public calendar in a new tab and describes it', async () => {
    const fixture = await render();
    const link = query(fixture, 'meetings-calendar-actions-public-calendar')?.querySelector('a');

    expect(link?.textContent?.trim()).toBe('Public Calendar');
    expect(link?.getAttribute('href')).toBe('/projects/synthetic/calendar');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(query(fixture, 'meetings-calendar-actions-description')?.textContent).toContain(
      "A shareable page where anyone can see this project's public meetings, no sign-in needed."
    );
  });

  it('copies the public calendar link with a toast', async () => {
    const fixture = await render();

    query(fixture, 'meetings-calendar-actions-share')?.click();

    expect(copy).toHaveBeenCalledWith(`${environment.urls.home}/projects/synthetic/calendar`);
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Public calendar link copied', description: "Share it with anyone to show this project's public meetings." })
    );
  });

  it('names the calendar "Calendar" when the project has no name', async () => {
    context.set({ uid: 'project-1', name: '', slug: 'synthetic' });
    const fixture = await render();

    query(fixture, 'meetings-calendar-actions-subscribe')?.querySelector('button')?.click();

    expect(open).toHaveBeenCalledWith(MeetingsSubscribeDialogComponent, expect.objectContaining({ data: expect.objectContaining({ name: 'Calendar' }) }));
  });

  it('shows nothing until the project resolves', async () => {
    context.set(null);
    const fixture = await render();

    expect(query(fixture, 'meetings-calendar-actions-subscribe')).toBeNull();
    expect(query(fixture, 'meetings-calendar-actions-public-calendar')).toBeNull();
  });
});
