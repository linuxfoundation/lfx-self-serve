// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AudienceCustomService } from '@services/audience-custom.service';
import { of, Subject, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AudienceComposedList,
  AudienceCustomCreateOutcome,
  AudienceCustomCriteria,
  AudienceCustomInterpretResult,
  AudienceCustomPreview,
} from '@lfx-one/shared/interfaces';

import { AudienceCustomBuilderComponent } from './audience-custom-builder.component';

function criteria(overrides: Partial<AudienceCustomCriteria> = {}): AudienceCustomCriteria {
  return {
    cities: ['Seoul'],
    countries: [],
    contactLocation: true,
    eventRegistered: true,
    educationEnrolled: false,
    registeredFor: [],
    gateEventHistory: false,
    gateListId: '26716',
    propertyFilters: [],
    ambassadors: false,
    educationTopics: [],
    pageViewUrls: [],
    label: 'Synthetic Summit Seoul',
    ...overrides,
  };
}

const interpretation: AudienceCustomInterpretResult = {
  criteria: criteria(),
  brandShort: 'SYN',
  gate: { listId: '26716', name: '26Q2 - Synthetic Foundation - Master-list', hubspotUrl: 'https://app.hubspot.com/x/26716' },
  questions: [{ id: 'mailability', question: 'Gate event history?', options: ['Match the reference pattern', 'Stricter'] }],
  notes: ['A note'],
  similar: [
    {
      list: { listId: '411', name: '25Q3 - Seoul - Mailable Contacts', hubspotUrl: 'https://app.hubspot.com/x/411' },
      recommendation: 'update',
      reason: 'Older quarter',
    },
  ],
};

/** The same draft with every blocking question answered: only a settled draft may be created. */
const settled: AudienceCustomInterpretResult = { ...interpretation, questions: [] };

const preview: AudienceCustomPreview = {
  name: '26Q4 - Seoul - Mailable Contacts - Synthetic Summit Seoul',
  criteria: criteria(),
  branchCount: 3,
  educationTopicCandidates: [],
  upperBound: 120000,
  warnings: [],
};

const created: AudienceComposedList = { listId: '7777', name: preview.name, hubspotUrl: 'https://app.hubspot.com/x/7777' };

describe('AudienceCustomBuilderComponent', () => {
  let fixture: ComponentFixture<AudienceCustomBuilderComponent>;
  // The stranded outcome is a signal in the real service; the mock keeps one so a test can land it after mount.
  const outcome = signal<AudienceCustomCreateOutcome | null>(null);
  const inFlight = signal<string | null>(null);
  const service = {
    interpret: vi.fn(),
    preview: vi.fn(),
    create: vi.fn(),
    inFlightCreate: vi.fn(() => inFlight()),
    createOutcome: vi.fn(() => outcome()),
    takeCreateOutcome: vi.fn(() => {
      const taken = outcome();
      outcome.set(null);
      return taken;
    }),
  };

  beforeEach(async () => {
    service.interpret.mockReset().mockReturnValue(of(settled));
    inFlight.set(null);
    outcome.set(null);
    service.preview.mockReset().mockReturnValue(of(preview));
    service.create.mockReset().mockReturnValue(of(created));
    await TestBed.configureTestingModule({
      imports: [AudienceCustomBuilderComponent],
      providers: [{ provide: AudienceCustomService, useValue: service }],
    }).compileComponents();

    fixture = TestBed.createComponent(AudienceCustomBuilderComponent);
    fixture.componentRef.setInput('projectSlug', 'tlf');
    fixture.detectChanges();
  });

  function host(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function el<T extends HTMLElement>(testId: string): T {
    const found = host().querySelector<T>(`[data-testid="${testId}"]`);
    if (found === null) {
      throw new Error(`${testId} is not rendered`);
    }
    return found;
  }

  function type(testId: string, value: string): void {
    const input = el<HTMLInputElement | HTMLTextAreaElement>(testId);
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function click(testId: string): void {
    el<HTMLButtonElement>(testId).click();
    fixture.detectChanges();
  }

  function interpretSeoul(): void {
    type('audience-custom-builder-request', 'Mailable contacts in Seoul for Synthetic Summit Seoul');
    click('audience-custom-builder-interpret');
  }

  it('drafts criteria from a description and fills the form, gate included', () => {
    interpretSeoul();

    expect(service.interpret).toHaveBeenCalledWith('tlf', { request: 'Mailable contacts in Seoul for Synthetic Summit Seoul', answers: [] });
    expect(el<HTMLInputElement>('audience-custom-builder-cities').value).toBe('Seoul');
    expect(el<HTMLInputElement>('audience-custom-builder-gate').value).toBe('26716');
    expect(el('audience-custom-builder-gate-found').textContent).toContain('Synthetic Foundation');
    expect(el('audience-custom-builder-notes').textContent).toContain('A note');
  });

  it('re-interprets with the chosen answer, keeping the original request', () => {
    service.interpret.mockReturnValue(of(interpretation));
    interpretSeoul();
    click('audience-custom-builder-option-mailability-1');

    expect(service.interpret).toHaveBeenLastCalledWith('tlf', {
      request: 'Mailable contacts in Seoul for Synthetic Summit Seoul',
      answers: [{ questionId: 'mailability', question: 'Gate event history?', answer: 'Stricter' }],
    });
  });

  it('falls back to the form when no model is configured', () => {
    service.interpret.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 503, error: { message: 'no model' } })));

    interpretSeoul();

    expect(host().querySelector('[data-testid="audience-custom-builder-criteria"]'), 'the form must open so the operator is not stuck').not.toBeNull();
    expect(host().querySelector('[data-testid="audience-custom-builder-interpret-error"]')).not.toBeNull();
  });

  it('sends the edited criteria to preview, not the draft', () => {
    interpretSeoul();
    type('audience-custom-builder-countries', 'South Korea\n');
    click('audience-custom-builder-filter-add');
    const row = el('audience-custom-builder-filter-0');
    const prop = row.querySelector<HTMLInputElement>('input[formcontrolname="property"]')!;
    prop.value = 'jobtitle';
    prop.dispatchEvent(new Event('input'));
    const values = row.querySelector<HTMLTextAreaElement>('textarea[formcontrolname="values"]')!;
    values.value = 'director\nvp';
    values.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    click('audience-custom-builder-preview');

    const sent = service.preview.mock.calls[0][1];
    expect(sent.criteria.countries).toEqual(['South Korea']);
    expect(sent.criteria.propertyFilters).toEqual([{ property: 'jobtitle', operator: 'contains', values: ['director', 'vp'] }]);
    expect(el('audience-custom-builder-upper-bound').textContent).toContain('120,000');
    expect(el<HTMLInputElement>('audience-custom-builder-name').value).toBe(preview.name);
  });

  it('drops the preview as soon as the criteria change, so create always follows a fresh preview', () => {
    interpretSeoul();
    click('audience-custom-builder-preview');
    expect(host().querySelector('[data-testid="audience-custom-builder-create"]')).not.toBeNull();

    type('audience-custom-builder-cities', 'Busan');

    expect(host().querySelector('[data-testid="audience-custom-builder-preview-result"]')).toBeNull();
  });

  it('creates only after an explicit confirmation, then emits the list', () => {
    const emitted: AudienceComposedList[] = [];
    fixture.componentInstance.created.subscribe((list) => emitted.push(list));
    interpretSeoul();
    click('audience-custom-builder-preview');

    click('audience-custom-builder-create');
    expect(service.create, 'the first click only asks for confirmation').not.toHaveBeenCalled();
    expect(el('audience-custom-builder-confirm').textContent).toContain(preview.name);

    click('audience-custom-builder-confirm-create');

    expect(service.create).toHaveBeenCalledTimes(1);
    expect(emitted).toEqual([created]);
    expect(el('audience-custom-builder-created').textContent).toContain(preview.name);
  });

  it('blocks a retry after an unconfirmed create and names the list to search for', () => {
    service.create.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 502, error: { masterName: 'Seoul (v2)', error: 'x' } })));
    interpretSeoul();
    click('audience-custom-builder-preview');
    click('audience-custom-builder-create');
    click('audience-custom-builder-confirm-create');

    expect(el('audience-custom-builder-unconfirmed').textContent).toContain('Seoul (v2)');
    expect(host().querySelector('[data-testid="audience-custom-builder-create"]'), 'no button may offer a second create').toBeNull();
  });

  // A timeout (408), a lost connection (503, 0) or any 5xx may each mean HubSpot created the list.
  it.each([408, 503, 500, 0])('treats a %s on create as unconfirmed, never as retryable', (status) => {
    service.create.mockReturnValue(throwError(() => new HttpErrorResponse({ status })));
    interpretSeoul();
    click('audience-custom-builder-preview');
    click('audience-custom-builder-create');
    click('audience-custom-builder-confirm-create');

    expect(el('audience-custom-builder-unconfirmed').textContent).toContain(preview.name);
    expect(host().querySelector('[data-testid="audience-custom-builder-create"]'), 'no button may offer a second create').toBeNull();
  });

  it('lets a refused create (400) be corrected and retried', () => {
    service.create.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 400, error: { message: 'bad criteria' } })));
    interpretSeoul();
    click('audience-custom-builder-preview');
    click('audience-custom-builder-create');
    click('audience-custom-builder-confirm-create');

    expect(host().querySelector('[data-testid="audience-custom-builder-unconfirmed"]')).toBeNull();
    expect(host().querySelector('[data-testid="audience-custom-builder-create-error"]')).not.toBeNull();
    expect(host().querySelector('[data-testid="audience-custom-builder-create"]')).not.toBeNull();
  });

  it('ignores a preset while a create is in flight, so its reply is never dropped', () => {
    const reply = new Subject<AudienceComposedList>();
    service.create.mockReturnValue(reply);
    const emitted: AudienceComposedList[] = [];
    const creating: boolean[] = [];
    fixture.componentInstance.created.subscribe((list) => emitted.push(list));
    fixture.componentInstance.creatingChange.subscribe((v) => creating.push(v));
    interpretSeoul();
    click('audience-custom-builder-preview');
    click('audience-custom-builder-create');
    click('audience-custom-builder-confirm-create');

    fixture.componentRef.setInput('preset', { version: 9, criteria: { label: 'Other', registeredFor: ['Other 2026'] } });
    fixture.detectChanges();
    reply.next(created);
    reply.complete();
    fixture.detectChanges();

    expect(emitted).toEqual([created]);
    expect(creating).toEqual([true, false]);
  });

  it('keeps the preview while the list name is edited', () => {
    interpretSeoul();
    click('audience-custom-builder-preview');

    type('audience-custom-builder-name', 'My own name');

    expect(host().querySelector('[data-testid="audience-custom-builder-preview-result"]')).not.toBeNull();
    click('audience-custom-builder-create');
    click('audience-custom-builder-confirm-create');
    expect(service.create).toHaveBeenCalledWith('tlf', expect.objectContaining({ name: 'My own name' }));
  });

  it('caps the list name at 200 characters and holds Create past it', () => {
    interpretSeoul();
    click('audience-custom-builder-preview');

    expect(el<HTMLInputElement>('audience-custom-builder-name').getAttribute('maxlength')).toBe('200');
    type('audience-custom-builder-name', 'n'.repeat(201));

    expect(host().querySelector('[data-testid="audience-custom-builder-name-too-long"]')).not.toBeNull();
    expect(el<HTMLButtonElement>('audience-custom-builder-create').disabled).toBe(true);

    type('audience-custom-builder-name', 'n'.repeat(200));
    expect(el<HTMLButtonElement>('audience-custom-builder-create').disabled).toBe(false);
  });

  it('clears the over-long name state on Start over, which empties the field silently', () => {
    interpretSeoul();
    click('audience-custom-builder-preview');
    type('audience-custom-builder-name', 'n'.repeat(201));
    expect(host().querySelector('[data-testid="audience-custom-builder-name-too-long"]'), 'fixture precondition').not.toBeNull();

    click('audience-custom-builder-reset');
    interpretSeoul();
    click('audience-custom-builder-preview');

    expect(host().querySelector('[data-testid="audience-custom-builder-name-too-long"]'), 'a stale name held Create on an empty field').toBeNull();
    expect(el<HTMLButtonElement>('audience-custom-builder-create').disabled).toBe(false);
  });

  it('previews a draft with open questions but will not create it', () => {
    service.interpret.mockReturnValue(of(interpretation));
    interpretSeoul();
    click('audience-custom-builder-preview');

    expect(host().querySelector('[data-testid="audience-custom-builder-preview-result"]')).not.toBeNull();
    expect(el<HTMLButtonElement>('audience-custom-builder-create').disabled, 'blocking questions are unanswered').toBe(true);
    expect(host().querySelector('[data-testid="audience-custom-builder-questions-open"]')).not.toBeNull();
  });

  it('keeps commas inside a value: one value per line', () => {
    interpretSeoul();
    type('audience-custom-builder-registered-for', 'Summit, Japan 2026\nOther Event');
    click('audience-custom-builder-preview');

    expect(service.preview.mock.calls.at(-1)?.[1].criteria.registeredFor).toEqual(['Summit, Japan 2026', 'Other Event']);
  });

  it('holds Create while a create for this project is still in flight from a builder that has gone', () => {
    inFlight.set('Seoul audience');
    fixture.componentRef.setInput('projectSlug', 'tlf2');
    fixture.detectChanges();
    interpretSeoul();
    click('audience-custom-builder-preview');

    expect(el<HTMLButtonElement>('audience-custom-builder-create').disabled).toBe(true);
    expect(el('audience-custom-builder-in-flight').textContent).toContain('Seoul audience');
  });

  it('starts over on a context reset, keeping a create caught in flight as unconfirmed', () => {
    service.create.mockReturnValue(new Subject<AudienceComposedList>());
    const emitted: AudienceComposedList[] = [];
    fixture.componentInstance.created.subscribe((list) => emitted.push(list));
    interpretSeoul();
    click('audience-custom-builder-preview');
    click('audience-custom-builder-create');
    click('audience-custom-builder-confirm-create');

    fixture.componentRef.setInput('resetKey', 1);
    fixture.detectChanges();

    expect(host().querySelector('[data-testid="audience-custom-builder-criteria"]'), 'the old draft is gone').toBeNull();
    expect(el('audience-custom-builder-unconfirmed').textContent).toContain(preview.name);
    expect(emitted).toEqual([]);
  });

  it('picks up an unconfirmed create left by a builder that was destroyed, and holds Create', () => {
    outcome.set({ kind: 'unconfirmed', name: 'Seoul (left behind)' });
    fixture.detectChanges();

    expect(el('audience-custom-builder-unconfirmed').textContent).toContain('Seoul (left behind)');
    interpretSeoul();
    click('audience-custom-builder-preview');
    expect(host().querySelector('[data-testid="audience-custom-builder-create"]'), 'no button may offer a second create').toBeNull();
  });

  it('says a list was created after the builder was gone, instead of offering it again silently', () => {
    outcome.set({ kind: 'created', list: created });
    fixture.detectChanges();

    expect(el('audience-custom-builder-stranded-created').textContent).toContain(created.name);
  });

  it('lets the operator set the questions aside and finish by hand, keeping the draft', () => {
    service.interpret.mockReturnValue(of(interpretation));
    interpretSeoul();
    click('audience-custom-builder-leave-questions');
    click('audience-custom-builder-preview');

    expect(host().querySelector('[data-testid="audience-custom-builder-questions"]')).toBeNull();
    expect(el<HTMLInputElement | HTMLTextAreaElement>('audience-custom-builder-cities').value, 'the draft is kept').toBe('Seoul');
    expect(el<HTMLButtonElement>('audience-custom-builder-create').disabled).toBe(false);
  });

  it('clears questions a model that became unavailable can no longer answer', () => {
    service.interpret.mockReturnValueOnce(of(interpretation)).mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 503 })));
    interpretSeoul();
    click('audience-custom-builder-option-mailability-1');
    click('audience-custom-builder-preview');

    expect(el<HTMLButtonElement>('audience-custom-builder-create').disabled, 'the hand-filled draft can be created').toBe(false);
  });

  it('sees a stranded outcome that lands after it mounted, and holds Create', () => {
    inFlight.set('Seoul');
    interpretSeoul();
    click('audience-custom-builder-preview');
    expect(el<HTMLButtonElement>('audience-custom-builder-create').disabled, 'held while the other create is in flight').toBe(true);

    // The other builder's create settles unconfirmed after this one mounted.
    inFlight.set(null);
    outcome.set({ kind: 'unconfirmed', name: 'Seoul' });
    fixture.detectChanges();

    expect(el('audience-custom-builder-unconfirmed').textContent).toContain('Seoul');
    expect(host().querySelector('[data-testid="audience-custom-builder-create"]'), 'no button may offer a second create').toBeNull();
  });

  it('settles the reset-time warning when the stranded create is then confirmed', () => {
    service.create.mockReturnValue(new Subject<AudienceComposedList>());
    interpretSeoul();
    click('audience-custom-builder-preview');
    click('audience-custom-builder-create');
    click('audience-custom-builder-confirm-create');
    fixture.componentRef.setInput('resetKey', 1);
    fixture.detectChanges();
    expect(host().querySelector('[data-testid="audience-custom-builder-unconfirmed"]'), 'precondition').not.toBeNull();

    outcome.set({ kind: 'created', list: created });
    fixture.detectChanges();

    expect(host().querySelector('[data-testid="audience-custom-builder-unconfirmed"]'), 'confirmed, so no longer unconfirmed').toBeNull();
    expect(el('audience-custom-builder-stranded-created').textContent).toContain(created.name);
  });

  it('applies a deterministic preset without calling the model', () => {
    fixture.componentRef.setInput('preset', { version: 1, criteria: { label: 'Synthetic Summit', registeredFor: ['Synthetic Summit 2026'] } });
    fixture.detectChanges();

    expect(service.interpret).not.toHaveBeenCalled();
    expect(el<HTMLInputElement>('audience-custom-builder-registered-for').value).toBe('Synthetic Summit 2026');
  });

  it('interprets a request preset', () => {
    fixture.componentRef.setInput('preset', { version: 2, request: 'Contacts opted in to SYN project emails' });
    fixture.detectChanges();

    expect(service.interpret).toHaveBeenCalledWith('tlf', { request: 'Contacts opted in to SYN project emails', answers: [] });
  });

  it('offers similar existing lists and reuses one without creating anything', () => {
    const reused: string[] = [];
    fixture.componentInstance.reuse.subscribe((list) => reused.push(list.listId));
    interpretSeoul();

    expect(el('audience-custom-builder-similar-411').textContent).toContain('consider building a new version');
    click('audience-custom-builder-reuse-411');

    expect(reused).toEqual(['411']);
    expect(service.create).not.toHaveBeenCalled();
    expect(el<HTMLButtonElement>('audience-custom-builder-reuse-411').disabled, 'a list is added once').toBe(true);
  });

  it('sends course topics and page URLs, and shows the property the service matched', () => {
    service.preview.mockReturnValue(of({ ...preview, criteria: criteria({ educationTopics: ['Kubernetes'], educationTopicProperty: 'course_name' }) }));
    interpretSeoul();
    type('audience-custom-builder-topics', 'Kubernetes');
    type('audience-custom-builder-page-urls', 'events.example.org/synthetic-summit');

    click('audience-custom-builder-preview');

    const sent = service.preview.mock.calls[0][1];
    expect(sent.criteria.educationTopics).toEqual(['Kubernetes']);
    expect(sent.criteria.pageViewUrls).toEqual(['events.example.org/synthetic-summit']);
    expect(sent.criteria, 'no property is sent until the operator picks one').not.toHaveProperty('educationTopicProperty');
    expect(el('audience-custom-builder-topic-property').textContent).toContain('course_name');
  });

  it('lets the operator pick another course property and sends it with the next preview', () => {
    service.preview.mockReturnValue(
      of({
        ...preview,
        educationTopicCandidates: ['course_name', 'course_code'],
        criteria: criteria({ educationTopics: ['Kubernetes'], educationTopicProperty: 'course_name' }),
      })
    );
    interpretSeoul();
    type('audience-custom-builder-topics', 'Kubernetes');
    click('audience-custom-builder-preview');

    const select = el<HTMLSelectElement>('audience-custom-builder-topic-property-select');
    select.value = 'course_code';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    click('audience-custom-builder-preview');

    expect(service.preview.mock.calls.at(-1)?.[1].criteria.educationTopicProperty).toBe('course_code');
  });

  it('plans an event preset from its page, and keeps the page for answers', () => {
    service.interpret.mockReturnValue(of(interpretation));
    fixture.componentRef.setInput('preset', { version: 3, eventUrl: 'https://events.example.org/x', request: 'Plan the event audience' });
    fixture.detectChanges();

    expect(service.interpret).toHaveBeenCalledWith('tlf', { request: 'Plan the event audience', answers: [], eventUrl: 'https://events.example.org/x' });

    click('audience-custom-builder-option-mailability-0');

    expect(service.interpret.mock.calls.at(-1)?.[1].eventUrl, 'an answer re-plans from the same page').toBe('https://events.example.org/x');
  });

  it('reports the event an event audience was planned from', () => {
    const events: string[] = [];
    fixture.componentInstance.eventPlanned.subscribe((e) => events.push(e.eventName));
    service.interpret.mockReturnValue(of({ ...interpretation, event: { eventName: 'Synthetic Summit', brandShort: 'SYN', eventDates: ['2026-03-02'] } }));

    interpretSeoul();

    expect(events).toEqual(['Synthetic Summit']);
  });

  it("keeps each question's free-text answer to itself", () => {
    service.interpret.mockReturnValue(
      of({
        ...interpretation,
        questions: [
          { id: 'a', question: 'A?', options: ['x'] },
          { id: 'b', question: 'B?', options: ['y'] },
        ],
      })
    );
    interpretSeoul();

    type('audience-custom-builder-other-a', 'only for A');

    expect(el<HTMLInputElement>('audience-custom-builder-other-b').value, 'one shared box answered every question at once').toBe('');
    click('audience-custom-builder-other-submit-a');
    expect(service.interpret.mock.calls.at(-1)?.[1].answers).toEqual([{ questionId: 'a', question: 'A?', answer: 'only for A' }]);
  });
});
