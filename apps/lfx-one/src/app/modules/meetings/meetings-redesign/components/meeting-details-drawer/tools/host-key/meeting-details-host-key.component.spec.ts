// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Clipboard } from '@angular/cdk/clipboard';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingDetailsHostKeyComponent } from './meeting-details-host-key.component';

describe('MeetingDetailsHostKeyComponent', () => {
  let fixture: ComponentFixture<MeetingDetailsHostKeyComponent>;
  let copy: ReturnType<typeof vi.fn>;
  let show: ReturnType<typeof vi.fn>;

  const button = (testId: string): HTMLButtonElement =>
    fixture.nativeElement.querySelector(`[data-testid="${testId}"]`)?.querySelector('button') as HTMLButtonElement;
  const click = async (testId: string): Promise<void> => {
    button(testId).click();
    await fixture.whenStable();
  };

  beforeEach(async () => {
    copy = vi.fn().mockReturnValue(false);
    show = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: Clipboard, useValue: { copy } },
        { provide: UiToastService, useValue: { show } },
      ],
    });
    fixture = TestBed.createComponent(MeetingDetailsHostKeyComponent);
    fixture.componentRef.setInput('hostKey', '482193');
    await fixture.whenStable();
  });

  it('tells the viewer to copy by hand when the copy fails', async () => {
    await click('meeting-details-host-key-toggle');
    await click('meeting-details-host-key-copy');

    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'error', message: 'Copy Failed', description: 'Unable to copy the host key. Please copy it manually.' })
    );
  });

  it('masks the key again when another one arrives', async () => {
    await click('meeting-details-host-key-toggle');
    expect(button('meeting-details-host-key-toggle').getAttribute('aria-pressed')).toBe('true');
    expect(fixture.nativeElement.querySelector('[data-testid="meeting-details-host-key-announce"]').textContent).toContain('482193');

    fixture.componentRef.setInput('hostKey', '551208');
    await fixture.whenStable();

    expect(button('meeting-details-host-key-toggle').getAttribute('aria-pressed')).toBe('false');
    expect(button('meeting-details-host-key-toggle').textContent).not.toContain('551208');
  });
});
