// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DefaultUrlSerializer, NavigationEnd, Router, RouterOutlet, UrlTree } from '@angular/router';
import { MENTORSHIP_MENTEE_SHELL_TITLE } from '@lfx-one/shared/constants';
import { MentorshipMenteeApplication } from '@lfx-one/shared/interfaces';
import { MentorshipMenteeService } from '@services/mentorship-mentee.service';
import { menteeServiceTestDouble, menteeTestApplication, menteeTestTask } from '@shared/testing/mentorship-mentee-test-data';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MenteePageComponent } from './mentee-page.component';

@Component({
  // eslint-disable-next-line @angular-eslint/component-selector -- test-only stub
  selector: 'router-outlet',
  template: '',
})
class StubRouterOutletComponent {}

interface RouterStub {
  url: string;
  events: Subject<unknown>;
  navigate: ReturnType<typeof vi.fn>;
  parseUrl: (url: string) => UrlTree;
}

const urlSerializer = new DefaultUrlSerializer();

describe('MenteePageComponent', () => {
  let fixture: ComponentFixture<MenteePageComponent>;
  let router: RouterStub;
  let menteeService: ReturnType<typeof menteeServiceTestDouble>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const bootstrap = async (options: { url?: string; applications?: MentorshipMenteeApplication[]; fail?: boolean } = {}): Promise<void> => {
    router = {
      url: options.url ?? '/mentorship/mentee/overview',
      events: new Subject<unknown>(),
      navigate: vi.fn(),
      parseUrl: (url: string) => urlSerializer.parse(url),
    };
    menteeService = menteeServiceTestDouble(options.applications ?? []);
    if (options.fail) {
      menteeService.getMenteeApplications.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503 })));
    }

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MenteePageComponent],
      providers: [
        { provide: Router, useValue: router },
        { provide: MentorshipMenteeService, useValue: menteeService },
      ],
    });

    await TestBed.overrideComponent(MenteePageComponent, {
      remove: { imports: [RouterOutlet] },
      add: { imports: [StubRouterOutletComponent] },
    }).compileComponents();

    fixture = TestBed.createComponent(MenteePageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const navigateTo = (url: string): void => {
    router.url = url;
    router.events.next(new NavigationEnd(1, url, url));
    fixture.detectChanges();
  };

  const tabButtons = (): HTMLButtonElement[] => Array.from(element().querySelectorAll('[role="tab"]'));
  const tabLabels = (): string[] => tabButtons().map((btn) => btn.textContent?.trim() ?? '');
  const selectedTab = (): HTMLButtonElement | undefined => tabButtons().find((btn) => btn.getAttribute('aria-selected') === 'true');
  const tasksTab = (): HTMLButtonElement | null => element().querySelector('[data-testid="mentee-page-tab-tasks"]');
  const findProgram = (): Element | null => element().querySelector('[data-testid="mentee-page-find-program"]');
  const h1Text = (): string => element().querySelector('h1')?.textContent?.trim() ?? '';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- Fixed title ----------------------------------------------------------

  it('renders the fixed "My Mentorship" H1', async () => {
    await bootstrap();
    expect(h1Text()).toBe(MENTORSHIP_MENTEE_SHELL_TITLE);
  });

  it('keeps the same H1 when navigating between tabs', async () => {
    await bootstrap();
    navigateTo('/mentorship/mentee/tasks');
    expect(h1Text()).toBe(MENTORSHIP_MENTEE_SHELL_TITLE);
  });

  // ---- Tabs -----------------------------------------------------------------

  it('always shows Overview, My Tasks and Mentee Profile, even with no applications', async () => {
    await bootstrap();
    expect(tabLabels()).toEqual(['Overview', 'My Tasks', 'Mentee Profile']);
  });

  it('resolves the overview tab as active by default', async () => {
    await bootstrap();
    expect(selectedTab()?.getAttribute('data-testid')).toBe('mentee-page-tab-overview');
  });

  it('resolves the tasks tab when the URL ends in /tasks', async () => {
    await bootstrap({ url: '/mentorship/mentee/tasks' });
    expect(selectedTab()?.getAttribute('data-testid')).toBe('mentee-page-tab-tasks');
  });

  it('resolves the profile tab when the URL ends in /profile', async () => {
    await bootstrap({ url: '/mentorship/mentee/profile' });
    expect(selectedTab()?.getAttribute('data-testid')).toBe('mentee-page-tab-profile');
  });

  it('navigates to the tab route when a tab is clicked', async () => {
    await bootstrap();
    tasksTab()?.click();
    expect(router.navigate).toHaveBeenCalledWith(['/mentorship/mentee', 'tasks']);
  });

  // ---- Open task badge ------------------------------------------------------

  it('does not show a task count badge when there are no applications', async () => {
    await bootstrap();
    expect(tabButtons().some((btn) => btn.textContent?.includes('open'))).toBe(false);
  });

  it('shows the open task count across application cards on the My Tasks tab', async () => {
    await bootstrap({
      applications: [
        menteeTestApplication({ tasks: [menteeTestTask({ status: 'incomplete' }), menteeTestTask({ id: 'task-2', status: 'submitted' })] }),
        menteeTestApplication({
          id: 'app-2',
          upstreamStatus: 'accepted',
          tasks: [
            menteeTestTask({ id: 'task-3', category: 'non_prerequisite', status: 'in_progress' }),
            menteeTestTask({ id: 'task-4', category: 'non_prerequisite' }),
          ],
        }),
      ],
    });
    expect(tasksTab()?.textContent).toContain('3 open');
  });

  it('hides the badge once every tracked task is submitted', async () => {
    await bootstrap({ applications: [menteeTestApplication({ tasks: [menteeTestTask({ status: 'complete' })] })] });
    expect(tasksTab()?.textContent).not.toContain('open');
  });

  // ---- Find a Program visibility --------------------------------------------

  it('hides "Find a Program" when there are no applications', async () => {
    await bootstrap();
    expect(findProgram()).toBeNull();
  });

  it('shows "Find a Program" once the mentee has an application', async () => {
    await bootstrap({ applications: [menteeTestApplication()] });
    expect(findProgram()).toBeTruthy();
  });

  it('hides "Find a Program" and the badge when the applications read fails', async () => {
    await bootstrap({ fail: true });
    expect(findProgram()).toBeNull();
    expect(tabLabels()).toEqual(['Overview', 'My Tasks', 'Mentee Profile']);
  });

  it('re-reads the applications when the cache is cleared', async () => {
    await bootstrap({ fail: true });
    menteeService.getMenteeApplications.mockReturnValue(of({ data: [menteeTestApplication({ tasks: [menteeTestTask()] })], total: 1 }));
    menteeService.clearMenteeCaches();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(findProgram()).toBeTruthy();
    expect(tasksTab()?.textContent).toContain('1 open');
  });

  // ---- Keyboard navigation --------------------------------------------------

  it('navigates with ArrowRight from overview to My Tasks', async () => {
    await bootstrap();
    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    selectedTab()!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(router.navigate).toHaveBeenCalledWith(['/mentorship/mentee', 'tasks']);
  });

  it('wraps to the last tab with ArrowLeft from the first', async () => {
    await bootstrap();
    selectedTab()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    expect(router.navigate).toHaveBeenCalledWith(['/mentorship/mentee', 'profile']);
  });

  it('jumps to the last tab with End and the first with Home', async () => {
    await bootstrap();
    selectedTab()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
    expect(router.navigate).toHaveBeenLastCalledWith(['/mentorship/mentee', 'profile']);

    navigateTo('/mentorship/mentee/profile');
    selectedTab()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
    expect(router.navigate).toHaveBeenLastCalledWith(['/mentorship/mentee', 'overview']);
  });

  it('ignores other keys', async () => {
    await bootstrap();
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    selectedTab()!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(router.navigate).not.toHaveBeenCalled();
  });
});
