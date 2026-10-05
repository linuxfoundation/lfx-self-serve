// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NgClass, NgTemplateOutlet } from '@angular/common';
import { Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ButtonComponent } from '@components/button/button.component';
import { Meeting, MeetingDetailsLoadStatus, PublicMeetingProject } from '@lfx-one/shared/interfaces';
import { UserService } from '@services/user.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingDetailsPageComponent } from './meeting-details-page.component';
import { MeetingDetailsStateService } from './meeting-details-state.service';

// The app chrome is covered by its own specs; stubbing it keeps this spec on the page's branches.
@Component({ selector: 'lfx-header', template: '' })
class HeaderStubComponent {}

@Component({ selector: 'lfx-impersonation-banner', template: '' })
class ImpersonationBannerStubComponent {}

describe('MeetingDetailsPageComponent', () => {
  let fixture: ComponentFixture<MeetingDetailsPageComponent>;
  let status: WritableSignal<MeetingDetailsLoadStatus>;
  let refresh: ReturnType<typeof vi.fn>;

  const meeting = { id: 'meeting-1', title: 'Weekly Sync', project: {} as PublicMeetingProject } as unknown as Meeting & { project: PublicMeetingProject };

  beforeEach(async () => {
    status = signal<MeetingDetailsLoadStatus>('loading');
    refresh = vi.fn();

    await TestBed.configureTestingModule({
      imports: [MeetingDetailsPageComponent],
      providers: [{ provide: UserService, useValue: { impersonating: signal(false) } }],
    })
      .overrideComponent(MeetingDetailsPageComponent, {
        set: {
          imports: [NgClass, NgTemplateOutlet, ButtonComponent, HeaderStubComponent, ImpersonationBannerStubComponent],
          providers: [{ provide: MeetingDetailsStateService, useValue: { status, meeting: signal(meeting), refresh } }],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(MeetingDetailsPageComponent);
    fixture.detectChanges();
  });

  const query = (testId: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);

  function show(next: MeetingDetailsLoadStatus): void {
    status.set(next);
    fixture.detectChanges();
  }

  it('renders the skeleton as a polite status region while loading', () => {
    const skeleton = query('meeting-skeleton');

    expect(skeleton?.getAttribute('role')).toBe('status');
    expect(skeleton?.getAttribute('aria-live')).toBe('polite');
    expect(query('meeting-content-column')).not.toBeNull();
    expect(query('meeting-header-section')).toBeNull();
  });

  it('renders the shell with the meeting title once ready', () => {
    show('ready');

    expect(query('meeting-skeleton')).toBeNull();
    expect(query('meeting-header-section')?.querySelector('h1')?.textContent?.trim()).toBe('Weekly Sync');
    expect(query('meeting-content-column')).not.toBeNull();
    expect(query('meeting-rail')?.getAttribute('aria-label')).toBe('Meeting actions');
  });

  it('keeps the section placeholders out of the accessibility tree', () => {
    show('ready');

    const placeholders = fixture.nativeElement.querySelectorAll('[data-testid^="meeting-section-placeholder-"]');
    expect(placeholders.length).toBe(5);
    placeholders.forEach((el: Element) => expect(el.getAttribute('aria-hidden')).toBe('true'));
  });

  it('renders the error state as an alert, with a retry that re-runs the lookup', () => {
    show('error');

    const error = query('meeting-error-state');
    expect(error?.getAttribute('role')).toBe('alert');
    expect(query('meeting-content-column')).toBeNull();

    error?.querySelector('button')?.click();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('keeps the page shell in every branch, for the gate e2e to find', () => {
    for (const next of ['loading', 'ready', 'error'] as const) {
      show(next);
      expect(query('meeting-page-shell')).not.toBeNull();
    }
  });

  it('scopes the V2 design tokens to a wrapper inside the page', () => {
    expect(fixture.nativeElement.querySelector('.meeting-details-v2')).not.toBeNull();
  });
});
