// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MessageService } from 'primeng/api';
import { describe, expect, it, vi } from 'vitest';

import { ChunkLoadRecoveryService } from '../../services/chunk-load-recovery.service';
import { IntercomService } from '../../services/intercom.service';
import { ChunkLoadRecoveryComponent } from './chunk-load-recovery.component';

@Component({
  selector: 'lfx-recovery-test-host',
  imports: [ChunkLoadRecoveryComponent],
  templateUrl: './chunk-load-recovery.test-host.html',
})
class RecoveryTestHostComponent {}

describe('ChunkLoadRecoveryComponent', () => {
  it.each(['input', 'textarea', 'select', 'richtext', 'action'] as const)('announces recovery without stealing %s focus or replacing drafts', async (kind) => {
    const needsReload = signal(false);
    const reload = vi.fn();
    TestBed.configureTestingModule({
      imports: [RecoveryTestHostComponent],
      providers: [
        provideRouter([]),
        MessageService,
        { provide: IntercomService, useValue: { openMessenger: vi.fn() } },
        { provide: ChunkLoadRecoveryService, useValue: { needsReload, reloading: signal(false), reload } },
      ],
    });
    const fixture = TestBed.createComponent(RecoveryTestHostComponent);
    fixture.detectChanges();
    const draft = fixture.nativeElement.querySelector('[data-testid="unsaved-form"]') as HTMLInputElement;
    draft.value = 'Unsaved draft';
    const targets = { input: 'unsaved-form', textarea: 'unsaved-textarea', select: 'unsaved-select', richtext: 'unsaved-richtext', action: 'existing-action' };
    const active = fixture.nativeElement.querySelector(`[data-testid="${targets[kind]}"]`) as HTMLElement;
    active.focus();
    expect(fixture.nativeElement.querySelector('[data-testid="chunk-load-recovery"]')).toBeNull();

    needsReload.set(true);
    await fixture.whenStable();
    const alert = fixture.nativeElement.querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toContain("Part of this page couldn't load.");
    expect(alert.textContent).toContain('unsaved changes');
    expect(alert.getAttribute('aria-labelledby')).toBe('chunk-load-recovery-heading');
    expect(alert.querySelector('[data-testid="chunk-load-recovery-support"]')?.textContent).toContain('Contact support');
    const reloadButton = alert.querySelector('[data-testid="chunk-load-recovery-reload"] button') as HTMLButtonElement;
    expect(document.activeElement).toBe(active);
    active.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    active.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
    active.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(reload).not.toHaveBeenCalled();
    reloadButton.click();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="unsaved-form"]')).toBe(draft);
    expect(draft.value).toBe('Unsaved draft');
  });

  it.each(['lost', 'inert'])('recovers %s focus to the banner, never directly to Reload page', async (reason) => {
    const needsReload = signal(false);
    const reload = vi.fn();
    TestBed.configureTestingModule({
      imports: [RecoveryTestHostComponent],
      providers: [
        provideRouter([]),
        MessageService,
        { provide: IntercomService, useValue: { openMessenger: vi.fn() } },
        { provide: ChunkLoadRecoveryService, useValue: { needsReload, reloading: signal(false), reload } },
      ],
    });
    const fixture = TestBed.createComponent(RecoveryTestHostComponent);
    fixture.detectChanges();
    const region = document.createElement('div');
    const field = document.createElement('input');
    region.append(field);
    document.body.append(region);
    field.focus();
    if (reason === 'inert') region.setAttribute('inert', '');
    else region.remove();
    try {
      needsReload.set(true);
      await fixture.whenStable();
      const panel = fixture.nativeElement.querySelector('[role="alert"]') as HTMLElement;
      expect(document.activeElement).toBe(panel);
      expect(panel.getAttribute('tabindex')).toBe('-1');
      panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      panel.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
      expect(reload).not.toHaveBeenCalled();
    } finally {
      region.remove();
    }
  });
});
