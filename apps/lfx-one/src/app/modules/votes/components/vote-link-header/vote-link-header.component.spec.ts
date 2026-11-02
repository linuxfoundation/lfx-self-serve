// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PublicProjectSummary } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { VoteLinkHeaderComponent } from './vote-link-header.component';

const PROJECT: PublicProjectSummary = { name: 'Synthetic Project', slug: 'synthetic', logo_url: 'https://cdn.example/logo.svg', is_foundation: false };

describe('VoteLinkHeaderComponent (#4692)', () => {
  let fixture: ComponentFixture<VoteLinkHeaderComponent>;

  const byId = (id: string) => fixture.nativeElement.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

  function render(inputs: { project?: PublicProjectSummary | null; endTime?: string | null; statusLabel?: string }): void {
    fixture = TestBed.createComponent(VoteLinkHeaderComponent);
    fixture.componentRef.setInput('title', 'Synthetic vote');
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    fixture.detectChanges();
  }

  beforeEach(() => TestBed.configureTestingModule({ imports: [VoteLinkHeaderComponent] }));

  it('shows the project logo and name above the vote title', () => {
    render({ project: PROJECT });

    expect(byId('vote-link-project-logo')?.getAttribute('src')).toBe(PROJECT.logo_url);
    expect(byId('vote-link-project-name')?.textContent).toContain('Synthetic Project');
    expect(byId('vote-link-title')?.textContent).toContain('Synthetic vote');
    expect(byId('vote-link-lfx-mark')).not.toBeNull();
  });

  it('links the LFX mark to a plain / with no query or fragment', () => {
    render({ project: PROJECT });

    expect(byId('vote-link-lfx-mark-link')?.getAttribute('href')).toBe('/');
  });

  it('shows only the LFX mark and the title when there is no project', () => {
    render({ project: null });

    expect(fixture.nativeElement.querySelectorAll('[data-testid="vote-link-lfx-mark"]').length).toBe(1);
    expect(byId('vote-link-project-name')).toBeNull();
  });

  it('drops a logo that fails to load and keeps the single LFX mark', () => {
    render({ project: PROJECT });
    byId('vote-link-project-logo')!.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(byId('vote-link-project-logo')).toBeNull();
    expect(fixture.nativeElement.querySelectorAll('[data-testid="vote-link-lfx-mark"]').length).toBe(1);
    expect(byId('vote-link-project-name')?.textContent).toContain('Synthetic Project');
  });

  it('omits the status chip and deadline when not given', () => {
    render({ project: null });

    expect(byId('vote-link-status')).toBeNull();
    expect(byId('vote-link-deadline')).toBeNull();
  });
});
