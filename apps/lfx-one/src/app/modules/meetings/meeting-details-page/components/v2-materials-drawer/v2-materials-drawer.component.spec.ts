// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MeetingService } from '@services/meeting.service';
import { MessageService } from 'primeng/api';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingV2MaterialsDrawerComponent } from './v2-materials-drawer.component';

/** drawer-pattern.md § Dialog semantics (#3260): a named modal dialog, focus moved in on open and handed back on every close. */
describe('MeetingV2MaterialsDrawerComponent dialog semantics', () => {
  let fixture: ComponentFixture<MeetingV2MaterialsDrawerComponent>;
  let component: MeetingV2MaterialsDrawerComponent;
  let trigger: HTMLButtonElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MeetingV2MaterialsDrawerComponent],
      providers: [
        provideNoopAnimations(),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: MeetingService,
          useValue: { getMeetingAttachments: vi.fn(() => of([])), getPastMeetingAttachments: vi.fn(() => of([])) },
        },
        { provide: MessageService, useValue: { add: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MeetingV2MaterialsDrawerComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('meetingId', 'meeting-1');
    fixture.detectChanges();

    trigger = document.createElement('button');
    document.body.appendChild(trigger);
  });

  afterEach(() => {
    trigger.remove();
  });

  const open = async (): Promise<void> => {
    trigger.focus();
    component.visible.set(true);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const close = async (how: () => void): Promise<void> => {
    how();
    fixture.detectChanges();
    await fixture.whenStable();
  };

  it('opens as a modal dialog named by its title, and moves focus onto that title', async () => {
    await open();

    // The role lands on PrimeNG's root panel, not on the `p-drawer` host that carries the testid.
    const dialog = document.body.querySelector('[role="dialog"][aria-modal="true"]');
    expect(dialog?.getAttribute('aria-labelledby')).toBe(component.titleId);
    expect(document.getElementById(component.titleId)?.textContent?.trim()).toBe('Manage Materials');
    expect(document.activeElement?.id).toBe(component.titleId);
  });

  it('hands focus back to the opener when its close button closes it', async () => {
    await open();

    await close(() => (document.body.querySelector('[data-testid="materials-drawer-close"]') as HTMLButtonElement).click());

    expect(component.visible()).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('hands focus back on a programmatic close (a save sets visible itself; p-drawer emits no onHide)', async () => {
    await open();

    await close(() => component.visible.set(false));

    expect(document.activeElement).toBe(trigger);
  });

  it('leaves focus alone when the opener has left the page', async () => {
    await open();
    trigger.remove();

    await close(() => component.visible.set(false));

    expect(document.activeElement).not.toBe(trigger);
  });

  it('gives each instance its own title id', () => {
    const other = TestBed.createComponent(MeetingV2MaterialsDrawerComponent).componentInstance;
    expect(other.titleId).not.toBe(component.titleId);
  });
});
