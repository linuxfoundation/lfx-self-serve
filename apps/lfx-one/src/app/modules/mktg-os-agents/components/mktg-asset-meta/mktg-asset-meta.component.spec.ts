// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { MktgAssetHeaderMetadata } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';
import { MktgAssetMetaComponent } from './mktg-asset-meta.component';

describe('MktgAssetMetaComponent', () => {
  it('omits the date comma when the creation date is unknown', async () => {
    const fixture = TestBed.createComponent(MktgAssetMetaComponent);
    fixture.componentRef.setInput('metadata', { version: 3, agentName: 'FAQ Agent', createdAt: null, approval: null, otherApprovedCurrent: null });
    fixture.componentRef.setInput('prefix', 'unknown');
    await fixture.whenStable();
    const text = (fixture.nativeElement as HTMLElement).querySelector('[data-testid="unknown-meta"]')?.textContent ?? '';
    expect(text).toContain('FAQ Agent');
    expect(text).not.toContain(',');
  });
  it.each([null, { name: 'Project reviewer' }])('shows one version and the other approved current with %j attribution', async (approvedBy) => {
    const fixture = TestBed.createComponent(MktgAssetMetaComponent);
    const metadata: MktgAssetHeaderMetadata = {
      version: 3,
      agentName: 'Example Agent',
      createdAt: '2026-10-19T10:00:00Z',
      approval: null,
      otherApprovedCurrent: { number: 2, approvedBy },
    };
    fixture.componentRef.setInput('metadata', metadata);
    fixture.componentRef.setInput('prefix', 'example');
    await fixture.whenStable();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector('[data-testid="example-approval-state"]')?.textContent?.trim()).toBe('Draft');
    const text = element.querySelector('[data-testid="example-meta"]')?.textContent ?? '';
    expect(text.match(/v3/g)).toHaveLength(1);
    expect(text).toContain('Example Agent, 19 Oct');
    expect(text).toContain(`the kit still shows v2, approved by ${approvedBy?.name ?? 'a project writer'}`);
    fixture.componentRef.setInput('metadata', { ...metadata, approval: { approvedAt: '2026-10-19T11:00:00Z', approvedBy }, otherApprovedCurrent: null });
    await fixture.whenStable();
    expect(element.querySelector('[data-testid="example-approval-state"]')?.textContent?.trim()).toBe('Approved');
    expect(element.textContent).not.toContain('kit still shows');
  });
});
