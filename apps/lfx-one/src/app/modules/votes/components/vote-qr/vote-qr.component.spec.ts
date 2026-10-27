// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';

import { VoteQrComponent } from './vote-qr.component';

describe('VoteQrComponent', () => {
  it('renders an accessible SVG with modules once the encoder has loaded', async () => {
    const fixture = TestBed.createComponent(VoteQrComponent);
    fixture.componentRef.setInput('value', 'https://example.com/votes/abc');
    fixture.componentRef.setInput('label', 'QR code for https://example.com/votes/abc');
    fixture.detectChanges();
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 50));
    fixture.detectChanges();

    const svg = fixture.nativeElement.querySelector('svg') as SVGElement;
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('QR code for https://example.com/votes/abc');
    expect(svg.querySelector('path')?.getAttribute('d')?.length).toBeGreaterThan(100);
  });
});
