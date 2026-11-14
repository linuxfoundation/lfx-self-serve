// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MessageService } from 'primeng/api';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TokenRevealDialogComponent } from './token-reveal-dialog.component';

describe('TokenRevealDialogComponent', () => {
  const token = 'eyJ.live-bearer-token.sig';

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('masks the rendered token in Session Replay, since it is a live bearer credential', () => {
    TestBed.configureTestingModule({
      imports: [TokenRevealDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: MessageService, useValue: { add: vi.fn() } },
        { provide: DynamicDialogRef, useValue: { close: vi.fn() } },
        { provide: DynamicDialogConfig, useValue: { data: { token } } },
      ],
    });
    const fixture = TestBed.createComponent(TokenRevealDialogComponent);
    fixture.detectChanges();

    const value = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="token-reveal-value"]');
    expect(value?.textContent).toContain(token);
    expect(value?.getAttribute('data-dd-privacy')).toBe('mask');
    // RUM click-action names ignore data-dd-privacy and fall back to element text; pin a fixed name.
    expect(value?.getAttribute('data-dd-action-name')).toBeTruthy();
    expect(value?.getAttribute('data-dd-action-name')).not.toContain(token);
  });
});
