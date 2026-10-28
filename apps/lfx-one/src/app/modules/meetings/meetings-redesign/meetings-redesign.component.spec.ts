// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { WriterGrantsService } from '@services/writer-grants.service';
import { beforeEach, describe, expect, it } from 'vitest';

import { MeetingsRedesignComponent } from './meetings-redesign.component';

describe('MeetingsRedesignComponent', () => {
  let hasWriterProject: ReturnType<typeof signal<boolean>>;

  const render = (): HTMLElement => {
    const fixture = TestBed.createComponent(MeetingsRedesignComponent);
    fixture.detectChanges();
    return fixture.nativeElement;
  };

  beforeEach(() => {
    hasWriterProject = signal(false);
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: WriterGrantsService, useValue: { hasWriterFoundation: signal(false), hasWriterProject } }],
    });
  });

  it('renders the header, tabs bar, list area and right column blocks', () => {
    const el = render();

    expect(el.querySelector('[data-testid="meetings-redesign-title"]')?.textContent).toContain('Meetings');
    expect(el.querySelector('[data-testid="ui-tab-upcoming"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="ui-tab-past"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="meetings-redesign-search"]')).toBeTruthy();
    expect(el.querySelector('[data-testid="meetings-redesign-list"]')).toBeTruthy();
    for (const block of ['next-meeting', 'last-meeting', 'pending-rsvps']) {
      expect(el.querySelector(`[data-testid="meetings-redesign-rail-${block}"]`)).toBeTruthy();
    }
  });

  it('hides Create meeting without a writer grant and shows it with one', () => {
    expect(render().querySelector('[data-testid="meetings-redesign-create-button"]')).toBeNull();

    hasWriterProject.set(true);

    expect(render().querySelector('[data-testid="meetings-redesign-create-button"]')).toBeTruthy();
  });
});
