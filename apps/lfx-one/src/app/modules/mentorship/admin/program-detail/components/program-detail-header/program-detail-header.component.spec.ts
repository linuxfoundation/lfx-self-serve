// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { environment } from '@environments/environment';
import {
  MentorshipProgram,
  MentorshipProgramDetailTab,
  MentorshipProgramMenuItem,
  MentorshipProgramStatus,
  MentorshipProgramVisibilityAction,
} from '@lfx-one/shared/interfaces';
import { buildMentorshipProgramsUrl } from '@lfx-one/shared/utils';
import { ConfirmationService } from 'primeng/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProgramDetailHeaderComponent } from './program-detail-header.component';

describe('ProgramDetailHeaderComponent — tabs', () => {
  const program = (status: MentorshipProgramStatus): MentorshipProgram => ({
    id: 'mp_1',
    slug: 'thanos-fan-out-query-observability',
    name: 'Thanos: Fan-Out Query Observability',
    projectName: 'CNCF',
    term: 'Summer 2026',
    status,
    stats: { mentors: 2, mentees: 0, graduated: 3 },
    createdOn: '2026-03-01T00:00:00.000Z',
    updatedOn: '2026-07-30T00:00:00.000Z',
  });

  let fixture: ComponentFixture<ProgramDetailHeaderComponent>;

  const render = (status: MentorshipProgramStatus, activeTab: MentorshipProgramDetailTab = 'current-mentees'): void => {
    fixture = TestBed.createComponent(ProgramDetailHeaderComponent);
    fixture.componentRef.setInput('program', program(status));
    fixture.componentRef.setInput('tabCounts', { currentMentees: 4, pastMentees: 7, mentors: 2, terms: 3 });
    fixture.componentRef.setInput('activeTab', activeTab);
    fixture.detectChanges();
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ProgramDetailHeaderComponent],
      providers: [provideNoopAnimations()],
    });
  });

  const tabText = (value: string): string =>
    ((fixture.nativeElement as HTMLElement).querySelector(`[data-testid="mentorship-program-detail-tab-${value}"]`)?.textContent ?? '')
      .replace(/\s+/g, ' ')
      .trim();

  it('renders the four tabs in order, each with its own count', () => {
    render('open');

    expect(tabText('current-mentees')).toBe('Current Mentees 4');
    expect(tabText('past-mentees')).toBe('Past Mentees 7');
    expect(tabText('mentors')).toBe('Mentors 2');
    expect(tabText('terms')).toBe('Terms 3');
  });

  it('shows a dash for a count whose read failed', () => {
    render('open');
    fixture.componentRef.setInput('tabCounts', { currentMentees: null, pastMentees: 7, mentors: null, terms: 3 });
    fixture.detectChanges();

    expect(tabText('current-mentees')).toBe('Current Mentees –');
    expect(tabText('past-mentees')).toBe('Past Mentees 7');
    expect(tabText('mentors')).toBe('Mentors –');
  });

  const tabValues = (): (string | null)[] =>
    Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('[role="tab"]')).map(
      (tab) => tab.getAttribute('data-testid')?.replace('mentorship-program-detail-tab-', '') ?? null
    );

  it('shows a pending program the Terms tab only, with its count', () => {
    render('pending-review', 'terms');

    expect(tabValues()).toEqual(['terms']);
    expect(tabText('terms')).toBe('Terms 3');
  });

  it.each(['open', 'completed', 'rejected', 'hidden'] as const)('shows a %s program all four tabs', (status) => {
    render(status);

    expect(tabValues()).toEqual(['current-mentees', 'past-mentees', 'mentors', 'terms']);
  });

  it.each(['ArrowRight', 'ArrowLeft', 'Home', 'End'])('keeps a pending program on Terms on %s', (key) => {
    render('pending-review', 'terms');
    const emitted: MentorshipProgramDetailTab[] = [];
    fixture.componentInstance.tabChange.subscribe((tab) => emitted.push(tab));

    (fixture.nativeElement as HTMLElement)
      .querySelector('[data-testid="mentorship-program-detail-tabs"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

    expect(emitted).toEqual(['terms']);
  });

  it('keeps the same labels once the program is completed', () => {
    render('completed');

    expect(tabText('current-mentees')).toBe('Current Mentees 4');
    expect(tabText('past-mentees')).toBe('Past Mentees 7');
  });
});

describe('ProgramDetailHeaderComponent — actions', () => {
  const program = (status: MentorshipProgramStatus): MentorshipProgram => ({
    id: 'mp_1',
    slug: 'thanos-fan-out-query-observability',
    name: 'Thanos: Fan-Out Query Observability',
    projectName: 'CNCF',
    term: 'Summer 2026',
    status,
    stats: { mentors: 2, mentees: 0, graduated: 3 },
    createdOn: '2026-03-01T00:00:00.000Z',
    updatedOn: '2026-07-30T00:00:00.000Z',
  });

  let fixture: ComponentFixture<ProgramDetailHeaderComponent>;

  const render = (status: MentorshipProgramStatus): void => {
    fixture = TestBed.createComponent(ProgramDetailHeaderComponent);
    fixture.componentRef.setInput('program', program(status));
    fixture.componentRef.setInput('tabCounts', { currentMentees: 4, pastMentees: 7, mentors: 2, terms: 3 });
    fixture.componentRef.setInput('activeTab', status === 'pending-review' ? 'terms' : 'current-mentees');
    fixture.detectChanges();
  };

  /** The `…` menu rows, read from the component since the popup only renders once opened. */
  const menuItems = (): MentorshipProgramMenuItem[] =>
    (fixture.componentInstance as unknown as { moreMenuItems: () => MentorshipProgramMenuItem[] }).moreMenuItems();

  const query = (testId: string): HTMLElement | null => (fixture.nativeElement as HTMLElement).querySelector(`[data-testid="${testId}"]`);

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [ProgramDetailHeaderComponent],
      providers: [provideNoopAnimations()],
    });
  });

  it('links View Public Page to the program on the public mentorship site, in a new tab', () => {
    render('open');

    const link = query('mentorship-program-detail-view-public');
    expect(link?.getAttribute('href')).toBe(buildMentorshipProgramsUrl(environment.urls.mentorship, 'mp_1'));
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it.each(['open', 'completed'] as const)('offers Hide on a %s program', (status) => {
    render(status);

    expect(menuItems().map((item) => item.action)).toEqual(['hide']);
    expect(query('mentorship-program-detail-more')).not.toBeNull();
  });

  it('offers Unhide on a hidden program', () => {
    render('hidden');

    expect(menuItems().map((item) => item.action)).toEqual(['unhide']);
  });

  it.each(['pending-review', 'rejected'] as const)('shows no menu on a %s program', (status) => {
    render(status);

    expect(menuItems()).toEqual([]);
    expect(query('mentorship-program-detail-more')).toBeNull();
  });

  it.each([
    ['open', 'hide'],
    ['hidden', 'unhide'],
  ] as const)('on a %s program, emits %s only once the admin confirms', (status, action) => {
    render(status);
    const confirmationService = fixture.debugElement.injector.get(ConfirmationService);
    const confirm = vi.spyOn(confirmationService, 'confirm');
    const emitted: MentorshipProgramVisibilityAction[] = [];
    fixture.componentInstance.visibilityChange.subscribe((value) => emitted.push(value));

    menuItems()[0].command();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(emitted).toEqual([]);

    confirm.mock.calls[0][0].accept?.();
    expect(emitted).toEqual([action]);
  });

  it('opens the confirm once when the menu activates a row the way its Enter key does', async () => {
    render('open');
    const confirm = vi.spyOn(fixture.debugElement.injector.get(ConfirmationService), 'confirm');
    const trigger = query('mentorship-program-detail-more')?.querySelector('button') as HTMLButtonElement;

    trigger.click();
    fixture.detectChanges();
    await fixture.whenStable();
    // The menu reports `onShow` once its overlay has rendered, so read the trigger after one more pass.
    fixture.detectChanges();
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    // PrimeNG's Enter and Space click the focused row's `a` or `button`, falling back to the `li` itself.
    const row = document.body.querySelector('li[data-pc-section="menuitem"]');
    const target = row?.querySelector<HTMLElement>('a,button');
    expect(target?.getAttribute('data-testid')).toBe('mentorship-program-detail-menu-hide');
    target?.click();

    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('disables the menu button while a visibility change is saving', () => {
    render('open');
    fixture.componentRef.setInput('visibilityBusy', true);
    fixture.detectChanges();

    expect(query('mentorship-program-detail-more')?.querySelector('button')?.disabled).toBe(true);
  });
});
