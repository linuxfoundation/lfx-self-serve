// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DATE_PIPE_DEFAULT_OPTIONS } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import type { MktgDocumentRunProgress } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';
import { MktgClosedRunMessageComponent } from './mktg-closed-run-message.component';

describe('MktgClosedRunMessageComponent', () => {
  it.each([
    { closedBy: null, closedAt: undefined, replacedBy: undefined, expected: 'This run was discarded.' },
    { closedBy: 'Synthetic writer', closedAt: undefined, replacedBy: undefined, expected: 'This run was discarded by Synthetic writer.' },
    { closedBy: null, closedAt: '2026-10-19T13:00:00Z', replacedBy: undefined, expected: 'This run was discarded at 19 Oct 2026, 13:00.' },
    {
      closedBy: 'Synthetic writer',
      closedAt: '2026-10-19T13:00:00Z',
      replacedBy: 'c'.repeat(64),
      expected: 'This run was discarded by Synthetic writer at 19 Oct 2026, 13:00; a newer run was started.',
    },
  ])('states only recorded closure facts: $expected', async ({ expected, ...closure }) => {
    await TestBed.configureTestingModule({
      imports: [MktgClosedRunMessageComponent],
      providers: [{ provide: DATE_PIPE_DEFAULT_OPTIONS, useValue: { timezone: 'UTC' } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(MktgClosedRunMessageComponent);
    const run: MktgDocumentRunProgress = {
      project: 'synthetic-project',
      agentKey: 'brand-kit',
      documentId: 'living',
      runId: 'b'.repeat(64),
      startedAt: '2026-10-19T12:00:00Z',
      state: 'discarded',
      ...closure,
    };
    fixture.componentRef.setInput('run', run);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent.trim()).toBe(expected);
  });
});
