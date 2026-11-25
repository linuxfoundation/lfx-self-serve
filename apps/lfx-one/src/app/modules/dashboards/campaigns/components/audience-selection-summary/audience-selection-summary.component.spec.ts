// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AudienceListDescription, AudienceSelectionSummaryItem } from '@lfx-one/shared/interfaces';
import { beforeEach, describe, expect, it } from 'vitest';

import { AudienceSelectionSummaryComponent } from './audience-selection-summary.component';

const described = (listId: string, overrides: Partial<AudienceListDescription> = {}): AudienceListDescription => ({
  listId,
  name: `List ${listId}`,
  size: 1200,
  processingType: 'DYNAMIC',
  hubspotUrl: 'https://app.hubspot.example/lists/' + listId,
  status: 'described',
  summary: 'Contacts matching one rule: registered for an event where event name is “Synthetic Summit 2026”.',
  match: 'any',
  groups: [{ conditions: ['Registered for an event where event name is “Synthetic Summit 2026”'] }],
  complete: true,
  ...overrides,
});

const item = (listId: string, description: AudienceListDescription | null, name = `List ${listId}`): AudienceSelectionSummaryItem => ({
  listId,
  name,
  size: description?.size,
  hubspotUrl: description?.hubspotUrl ?? '',
  description,
});

describe('AudienceSelectionSummaryComponent', () => {
  let fixture: ComponentFixture<AudienceSelectionSummaryComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [AudienceSelectionSummaryComponent] }).compileComponents();
  });

  function render(inputs: {
    includes: AudienceSelectionSummaryItem[];
    standardExcludes?: AudienceSelectionSummaryItem[];
    otherExcludes?: AudienceSelectionSummaryItem[];
    pendingRegistrantsEdition?: string;
    loading?: boolean;
    error?: string | null;
  }): HTMLElement {
    fixture = TestBed.createComponent(AudienceSelectionSummaryComponent);
    fixture.componentRef.setInput('includes', inputs.includes);
    fixture.componentRef.setInput('standardExcludes', inputs.standardExcludes ?? []);
    fixture.componentRef.setInput('otherExcludes', inputs.otherExcludes ?? []);
    fixture.componentRef.setInput('pendingRegistrantsEdition', inputs.pendingRegistrantsEdition ?? '');
    fixture.componentRef.setInput('loading', inputs.loading ?? false);
    fixture.componentRef.setInput('error', inputs.error ?? null);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const text = (host: HTMLElement, testId: string): string => host.querySelector(`[data-testid="${testId}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';

  it('says who the email goes to and who is kept off, counting a registrants list attach will create', () => {
    const host = render({
      includes: [item('1', described('1')), item('2', described('2'))],
      standardExcludes: [item('90', described('90')), item('91', described('91'))],
      otherExcludes: [item('95', described('95'))],
      pendingRegistrantsEdition: 'Synthetic Summit 2026',
    });

    expect(text(host, 'campaigns-audience-meaning-headline')).toBe(
      'This email goes to anyone in at least one of the 2 included lists, except anyone in any of the 4 excluded lists.'
    );
    expect(text(host, 'campaigns-audience-meaning-registrants-pending')).toContain('Contacts who registered for an event named “Synthetic Summit 2026”');
  });

  it('shows each list with its summary, size, kind and link', () => {
    const host = render({ includes: [item('1', described('1'))] });

    expect(text(host, 'campaigns-audience-meaning-headline')).toBe('This email goes to everyone in the included list.');
    const row = text(host, 'campaigns-audience-meaning-list-1');
    expect(row).toContain('List 1');
    expect(row).toContain('1,200 contacts');
    expect(row).toContain('Active list');
    expect(text(host, 'campaigns-audience-meaning-summary-1')).toContain('registered for an event');
    expect(host.querySelector('[data-testid="campaigns-audience-meaning-list-1"] a')?.getAttribute('href')).toBe('https://app.hubspot.example/lists/1');
  });

  it('offers the full rules only when there is more than the summary already says', () => {
    const many = described('3', {
      groups: [
        { conditions: ['Is a member of the list “Synthetic Master”', 'Is not a member of the list “Synthetic Opt-Outs”'] },
        { conditions: ['Viewed a page'] },
      ],
      summary: 'Contacts matching any of 2 groups of rules, based on list membership and page views.',
    });
    const host = render({ includes: [item('1', described('1')), item('3', many)] });

    expect(host.querySelector('[data-testid="campaigns-audience-meaning-rules-1"]')).toBeNull();
    const rules = text(host, 'campaigns-audience-meaning-rules-3');
    expect(rules).toContain('Is a member of the list “Synthetic Master” and Is not a member of the list “Synthetic Opt-Outs”');
    expect(rules).toContain('Or: Viewed a page');
    // Each numbered line is one group, so "3 rules" alone would sit over 2 lines.
    expect(host.querySelector('[data-testid="campaigns-audience-meaning-list-3"] summary')?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Show all 3 rules in 2 groups'
    );
  });

  it('keeps a list on screen while its description loads, and says when it could not be read', () => {
    let host = render({ includes: [item('7', null, 'Pending list')], loading: true });
    expect(text(host, 'campaigns-audience-meaning-list-7')).toContain('Reading its rules');
    expect(text(host, 'campaigns-audience-meaning-loading')).toContain('Reading the selected lists');

    host = render({ includes: [item('7', null, 'Pending list')], loading: false });
    expect(text(host, 'campaigns-audience-meaning-list-7')).toContain('could not be read');
  });

  it('reads a list the describe call did not answer for as unreadable, not as a partial description', () => {
    const unanswered: AudienceListDescription = {
      listId: '8',
      name: '',
      hubspotUrl: '',
      status: 'unreadable',
      summary: '',
      match: 'any',
      groups: [],
      complete: false,
    };
    const host = render({ includes: [item('8', unanswered, 'Unanswered list')] });

    expect(text(host, 'campaigns-audience-meaning-list-8')).toContain('Its rules could not be read');
    expect(host.textContent).not.toContain('names but does not spell out');
  });

  it('groups the standard suppressions into one disclosure', () => {
    const host = render({ includes: [item('1', described('1'))], standardExcludes: [item('90', described('90')), item('91', described('91'))] });

    expect(text(host, 'campaigns-audience-meaning-standard')).toContain('Standard suppressions');
    expect(text(host, 'campaigns-audience-meaning-standard')).toContain('2 lists');
  });

  it('flags a partial description once, and retries on request', () => {
    const host = render({ includes: [item('1', described('1', { complete: false }))], error: 'Could not read what the selected lists contain' });
    let retried = 0;
    fixture.componentInstance.retry.subscribe(() => retried++);

    expect(host.querySelector('[data-testid="campaigns-audience-meaning-partial"]')).not.toBeNull();
    expect(text(host, 'campaigns-audience-meaning-error')).toContain('Could not read');
    host.querySelector<HTMLButtonElement>('[data-testid="campaigns-audience-meaning-retry"]')?.click();
    expect(retried).toBe(1);
  });
});
