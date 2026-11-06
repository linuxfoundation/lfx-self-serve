// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CardComponent } from '@components/card/card.component';
import { FundType } from '@lfx-one/shared/enums';
import { InitiativeDetail } from '@lfx-one/shared/interfaces';
import { describe, expect, it } from 'vitest';

import { InitiativeOverviewComponent } from './initiative-overview.component';

function initiative(description: string): InitiativeDetail {
  return {
    id: 'synthetic-initiative-1',
    slug: 'synthetic-initiative',
    name: 'Synthetic Initiative',
    description,
    status: 'published',
    initiativeType: FundType.GENERAL_FUND,
    color: '',
    createdOn: '2026-01-01T00:00:00Z',
    updatedOn: '2026-01-01T00:00:00Z',
    isOwner: true,
  };
}

describe('InitiativeOverviewComponent', () => {
  // The finance summary and sidebar are out of scope here; only the About card is rendered.
  const render = (description: string): HTMLElement => {
    TestBed.overrideComponent(InitiativeOverviewComponent, { set: { imports: [CardComponent], schemas: [NO_ERRORS_SCHEMA] } });
    const fixture = TestBed.createComponent(InitiativeOverviewComponent);
    fixture.componentRef.setInput('initiative', initiative(description));
    fixture.detectChanges();
    return fixture.nativeElement.querySelector('[data-testid="about-description"]') as HTMLElement;
  };

  it('renders the description as formatted HTML', () => {
    const about = render('<p>Hello <strong>world</strong></p>');
    expect(about.querySelector('strong')?.textContent).toBe('world');
    expect(about.textContent).not.toContain('<p>');
  });

  it('keeps the line breaks of an older plain-text description', () => {
    const about = render('First line\nsecond line\n\nNext paragraph');
    expect(about.querySelectorAll('p')).toHaveLength(2);
    expect(about.querySelectorAll('br')).toHaveLength(1);
  });

  it('strips script, event handlers and javascript: links from owner-authored HTML', () => {
    const about = render('<p>x</p><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">y</a><script>z</script>');
    expect(about.querySelector('script')).toBeNull();
    expect(about.querySelector('[onerror]')).toBeNull();
    expect(about.querySelector('a')?.getAttribute('href') ?? '').not.toMatch(/^javascript:/i);
  });
});
