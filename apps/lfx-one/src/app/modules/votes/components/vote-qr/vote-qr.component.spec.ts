// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';

import { VoteQrComponent } from './vote-qr.component';

describe('VoteQrComponent', () => {
  it('renders an accessible SVG with modules once the encoder has loaded', async () => {
    const fixture = TestBed.createComponent(VoteQrComponent);
    fixture.componentRef.setInput('value', 'https://example.com/votes/abc');
    fixture.componentRef.setInput('label', 'QR code for https://example.com/votes/abc');
    fixture.detectChanges();
    // The encoder is a dynamic import, so wait for the path rather than a fixed delay.
    for (let attempt = 0; attempt < 100 && !fixture.nativeElement.querySelector('path')?.getAttribute('d'); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      fixture.detectChanges();
    }

    const svg = fixture.nativeElement.querySelector('svg') as SVGElement;
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('QR code for https://example.com/votes/abc');
    expect(svg.querySelector('path')?.getAttribute('d')?.length).toBeGreaterThan(100);
  });

  it('reports pending, then ready, so an exporter can wait for the code', async () => {
    const fixture = TestBed.createComponent(VoteQrComponent);
    fixture.componentRef.setInput('value', 'https://example.com/votes/abc');
    fixture.detectChanges();
    expect(fixture.componentInstance.state()).toBe('pending');
    await vi.waitFor(() => expect(fixture.componentInstance.state()).toBe('ready'));
  });

  it('reports failed when the value cannot be encoded, rather than staying blank and pending', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const fixture = TestBed.createComponent(VoteQrComponent);
    fixture.componentRef.setInput('value', 'x'.repeat(5000));
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.state()).toBe('failed'));
  });
});
