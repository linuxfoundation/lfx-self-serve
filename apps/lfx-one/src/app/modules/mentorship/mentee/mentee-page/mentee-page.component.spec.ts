// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, computed, OutputEmitterRef, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DefaultUrlSerializer, NavigationEnd, Router, RouterOutlet, UrlTree } from '@angular/router';
import { MentorshipMenteePhase } from '@lfx-one/shared/interfaces';
import { MENTORSHIP_MENTEE_SHELL_TITLE } from '@lfx-one/shared/constants';
import { Subject } from 'rxjs';
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
  let component: MenteePageComponent;
  let router: RouterStub;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const bootstrap = async (initialUrl = '/mentorship/mentee/overview'): Promise<void> => {
    router = {
      url: initialUrl,
      events: new Subject<unknown>(),
      navigate: vi.fn(),
      parseUrl: (url: string) => urlSerializer.parse(url),
    };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [MenteePageComponent],
      providers: [{ provide: Router, useValue: router }],
    });

    await TestBed.overrideComponent(MenteePageComponent, {
      remove: { imports: [RouterOutlet] },
      add: { imports: [StubRouterOutletComponent] },
    }).compileComponents();

    fixture = TestBed.createComponent(MenteePageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  };

  const navigateTo = (url: string): void => {
    router.url = url;
    router.events.next(new NavigationEnd(1, url, url));
    fixture.detectChanges();
  };

  const tabButtons = (): HTMLButtonElement[] => Array.from(element().querySelectorAll('[role="tab"]'));
  const selectedTab = (): HTMLButtonElement | undefined => tabButtons().find((btn) => btn.getAttribute('aria-selected') === 'true');
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

  // ---- Phase-driven tabs ----------------------------------------------------

  it('shows only 2 tabs for the empty phase (default)', async () => {
    await bootstrap();
    expect(tabButtons().length).toBe(2);
    expect(tabButtons().map((b) => b.textContent?.trim())).toEqual(['Overview', 'Mentee Profile']);
  });

  it('shows 3 tabs (with "My Application Tasks") for the applicant phase', async () => {
    await bootstrap();
    component.onPhaseChange('applicant');
    fixture.detectChanges();
    const labels = tabButtons().map((b) => b.textContent?.trim());
    expect(labels.length).toBe(3);
    expect(labels).toContain('My Application Tasks');
  });

  it('shows 3 tabs (with "My Tasks") for the accepted phase', async () => {
    await bootstrap();
    component.onPhaseChange('accepted');
    fixture.detectChanges();
    const labels = tabButtons().map((b) => b.textContent?.trim());
    expect(labels.length).toBe(3);
    expect(labels).toContain('My Tasks');
  });

  // ---- Active tab resolution ------------------------------------------------

  it('resolves the overview tab as active by default', async () => {
    await bootstrap();
    expect(selectedTab()?.textContent?.trim()).toBe('Overview');
  });

  it('resolves the tasks tab when the URL ends in /tasks', async () => {
    await bootstrap('/mentorship/mentee/tasks');
    component.onPhaseChange('applicant');
    fixture.detectChanges();
    expect(selectedTab()?.textContent?.trim()).toContain('Application Tasks');
  });

  it('resolves the profile tab when the URL ends in /profile', async () => {
    await bootstrap('/mentorship/mentee/profile');
    expect(selectedTab()?.textContent?.trim()).toBe('Mentee Profile');
  });

  // ---- Tab click navigation -------------------------------------------------

  it('navigates to the profile route when the profile tab is clicked', async () => {
    await bootstrap();
    tabButtons()
      .find((b) => b.textContent?.trim() === 'Mentee Profile')
      ?.click();
    expect(router.navigate).toHaveBeenCalledWith(['/mentorship/mentee', 'profile']);
  });

  // ---- Task count badge -----------------------------------------------------

  it('does not show a task count badge for the empty phase', async () => {
    await bootstrap();
    const tabs = tabButtons();
    const hasOpenText = tabs.some((btn) => btn.textContent?.includes('open'));
    expect(hasOpenText).toBe(false);
  });

  it('shows the open task count badge on the tasks tab', async () => {
    await bootstrap();
    component.onPhaseChange('applicant');
    component.onOpenTaskCountChange(3);
    fixture.detectChanges();
    const tasksTab = tabButtons().find((btn) => btn.textContent?.includes('Application Tasks'));
    expect(tasksTab?.textContent).toContain('3 open');
  });

  // ---- Find a Program visibility --------------------------------------------

  it('hides "Find a Program" in the empty phase', async () => {
    await bootstrap();
    const links = Array.from(element().querySelectorAll('a'));
    const findProgram = links.find((a) => a.textContent?.includes('Find a Program'));
    expect(findProgram).toBeUndefined();
  });

  it('shows "Find a Program" in the applicant phase', async () => {
    await bootstrap();
    component.onPhaseChange('applicant');
    fixture.detectChanges();
    const links = Array.from(element().querySelectorAll('a'));
    const findProgram = links.find((a) => a.textContent?.includes('Find a Program'));
    expect(findProgram).toBeDefined();
  });

  // ---- Keyboard navigation --------------------------------------------------

  it('navigates with ArrowRight from overview to next tab', async () => {
    await bootstrap();
    const overviewBtn = selectedTab()!;
    const event = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    overviewBtn.dispatchEvent(event);
    fixture.detectChanges();
    expect(event.defaultPrevented).toBe(true);
    expect(router.navigate).toHaveBeenCalledWith(['/mentorship/mentee', 'profile']);
  });

  it('wraps to last tab with ArrowLeft from first', async () => {
    await bootstrap();
    const overviewBtn = selectedTab()!;
    overviewBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    expect(router.navigate).toHaveBeenCalledWith(['/mentorship/mentee', 'profile']);
  });

  it('jumps to last tab with End and first with Home', async () => {
    await bootstrap();
    const overviewBtn = selectedTab()!;
    overviewBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
    expect(router.navigate).toHaveBeenLastCalledWith(['/mentorship/mentee', 'profile']);

    navigateTo('/mentorship/mentee/profile');
    const profileBtn = selectedTab()!;
    profileBtn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
    expect(router.navigate).toHaveBeenLastCalledWith(['/mentorship/mentee', 'overview']);
  });

  // ---- Router-outlet activate wiring ----------------------------------------

  it('updates tabs and task count when onChildActivate receives outputs', async () => {
    await bootstrap();
    expect(tabButtons().length).toBe(2);

    const mockPhaseChange = { subscribe: vi.fn() } as unknown as OutputEmitterRef<MentorshipMenteePhase>;
    const mockTaskCount = { subscribe: vi.fn() } as unknown as OutputEmitterRef<number>;

    // Simulate child activation with outputs
    component.onChildActivate({
      phaseChange: mockPhaseChange,
      openTaskCountChange: mockTaskCount,
    });

    expect(mockPhaseChange.subscribe).toHaveBeenCalled();
    expect(mockTaskCount.subscribe).toHaveBeenCalled();

    // Invoke the subscribed callbacks to simulate output emission
    const phaseCallback = (mockPhaseChange.subscribe as ReturnType<typeof vi.fn>).mock.calls[0][0] as (phase: MentorshipMenteePhase) => void;
    const countCallback = (mockTaskCount.subscribe as ReturnType<typeof vi.fn>).mock.calls[0][0] as (count: number) => void;

    phaseCallback('applicant');
    countCallback(5);
    fixture.detectChanges();

    expect(tabButtons().length).toBe(3);
    const tasksTab = tabButtons().find((btn) => btn.textContent?.includes('Application Tasks'));
    expect(tasksTab?.textContent).toContain('5 open');
  });

  it('handles child activation without outputs gracefully', async () => {
    await bootstrap();
    // Child with no outputs — should not throw
    component.onChildActivate({});
    expect(tabButtons().length).toBe(2);
  });

  it('pushes the resolved phase into a tasks child that exposes a writable phase signal', async () => {
    await bootstrap();
    component.onPhaseChange('applicant');
    const child = { phase: signal<MentorshipMenteePhase>('empty') };
    component.onChildActivate(child);
    expect(child.phase()).toBe('applicant');
  });

  it('does not throw or mutate when the child exposes a read-only computed phase', async () => {
    await bootstrap();
    component.onPhaseChange('applicant');
    const child = { phase: computed<MentorshipMenteePhase>(() => 'empty') };
    expect(() => component.onChildActivate(child)).not.toThrow();
    expect(child.phase()).toBe('empty');
  });
});
