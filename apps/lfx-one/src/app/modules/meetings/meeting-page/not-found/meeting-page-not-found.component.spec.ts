// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CUSTOM_ELEMENTS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { LensService } from '@services/lens.service';
import { UserService } from '@services/user.service';
import { OpenIntercomDirective } from '@shared/directives/open-intercom.directive';
import { UiButtonComponent } from '@shared/uikit/button/button.component';
import { UiEmptyStateComponent } from '@shared/uikit/empty-state/empty-state.component';
import { describe, expect, it, vi } from 'vitest';

import { MeetingPageNotFoundComponent } from './meeting-page-not-found.component';

describe('MeetingPageNotFoundComponent', () => {
  const render = (): HTMLElement => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: LensService, useValue: { setLens: vi.fn() } },
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    });
    TestBed.overrideComponent(MeetingPageNotFoundComponent, {
      set: { imports: [UiButtonComponent, UiEmptyStateComponent], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
    });
    TestBed.overrideDirective(OpenIntercomDirective, { set: { selector: '[lfxOpenIntercomStub]' } });
    const fixture = TestBed.createComponent(MeetingPageNotFoundComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  };

  it('keeps the legacy copy and reasons under an h1', () => {
    const el = render();

    expect(el.querySelector('[role="heading"][aria-level="1"]')?.textContent?.trim()).toBe('Meeting Not Found');
    expect(el.textContent).toContain("We couldn't find the meeting you're looking for. This might happen for several reasons.");
    expect(Array.from(el.querySelectorAll('[data-testid="meeting-page-not-found-reasons"] li')).map((li) => li.textContent?.trim())).toEqual([
      'The meeting link has expired or is no longer valid',
      'The meeting has been deleted or cancelled',
      'You may need the correct password to access this meeting',
      'The meeting URL may contain a typo',
    ]);
  });

  it('opens Home > Meetings on the Me lens from Go to my meetings', () => {
    const el = render();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);

    (el.querySelector('[data-testid="meeting-page-not-found-my-meetings"] button') as HTMLButtonElement).click();

    expect(TestBed.inject(LensService).setLens).toHaveBeenCalledWith('me');
    expect(navigate).toHaveBeenCalledWith(['/meetings']);
  });
});
