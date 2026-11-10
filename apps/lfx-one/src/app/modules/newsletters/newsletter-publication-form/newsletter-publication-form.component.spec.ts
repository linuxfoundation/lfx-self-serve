// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpErrorResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { NewsletterPublication } from '@lfx-one/shared/interfaces';
import { NewsletterManifestService } from '@services/newsletter-manifest.service';
import { NewsletterService } from '@services/newsletter.service';
import { ProjectContextService } from '@services/project-context.service';
import { ProjectService } from '@services/project.service';
import { MessageService } from 'primeng/api';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { NewsletterPublicationFormComponent } from './newsletter-publication-form.component';

const PUBLICATION: NewsletterPublication = {
  id: 'pub-1',
  project_uid: 'p-1',
  name: 'Weekly update',
  template_key: 'set-a',
  from_name: 'Editorial Team',
  reply_to_email: 'editor@example.com',
  committee_uids: ['c-1'],
  implicit: false,
  created_by: 'tester',
  version: 5,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
};

describe('NewsletterPublicationFormComponent', () => {
  let fixture: ComponentFixture<NewsletterPublicationFormComponent>;
  let service: { createPublication: ReturnType<typeof vi.fn>; updatePublication: ReturnType<typeof vi.fn>; getPublication: ReturnType<typeof vi.fn> };

  const setup = async (publicationUid: string | null, loaded: NewsletterPublication = PUBLICATION, query: Record<string, string> = {}): Promise<void> => {
    service = {
      createPublication: vi.fn(() => of(PUBLICATION)),
      updatePublication: vi.fn(() => of(PUBLICATION)),
      getPublication: vi.fn(() => of(loaded)),
    };
    await TestBed.configureTestingModule({
      imports: [NewsletterPublicationFormComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        MessageService,
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ projectUid: 'p-1', ...(publicationUid ? { publicationUid } : {}) })),
            snapshot: {
              paramMap: convertToParamMap({ projectUid: 'p-1', ...(publicationUid ? { publicationUid } : {}) }),
              queryParamMap: convertToParamMap(query),
            },
            parent: {},
          },
        },
        { provide: NewsletterService, useValue: service },
        { provide: NewsletterManifestService, useValue: { templates: signal([{ key: 'set-a', label: 'Set A' }]), loadTemplates: () => of([]) } },
        { provide: ProjectService, useValue: { getProjectStrict: () => of(null) } },
        { provide: ProjectContextService, useValue: { activeContext: signal(null), setActiveContext: vi.fn() } },
      ],
    }).compileComponents();
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(NewsletterPublicationFormComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };

  const submit = () => (fixture.componentInstance as unknown as { onSubmit: () => void }).onSubmit();
  const form = () => fixture.componentInstance.form;
  const errorText = () => (fixture.nativeElement as HTMLElement).querySelector('[data-testid="newsletter-publication-form-error"]')?.textContent ?? '';

  it('creates with trimmed values and omits blank optionals', async () => {
    await setup(null);
    form().patchValue({ name: '  Weekly update  ', fromName: '   ', replyToEmail: '' });
    submit();
    expect(service.createPublication).toHaveBeenCalledWith('p-1', {
      name: 'Weekly update',
      template_key: undefined,
      from_name: undefined,
      reply_to_email: undefined,
      committee_uids: [],
    });
  });

  it('blocks a blank name and a bad reply-to before calling the service', async () => {
    await setup(null);
    form().patchValue({ name: '   ' });
    submit();
    form().patchValue({ name: 'Weekly', replyToEmail: 'not-an-email' });
    submit();
    expect(service.createPublication).not.toHaveBeenCalled();
  });

  it('keeps the loaded default audience on the full-replace update', async () => {
    await setup('pub-1');
    expect(form().controls.fromName.value).toBe('Editorial Team');
    form().patchValue({ name: 'Renamed' });
    submit();
    expect(service.updatePublication).toHaveBeenCalledWith('p-1', 'pub-1', 5, {
      name: 'Renamed',
      template_key: 'set-a',
      from_name: 'Editorial Team',
      reply_to_email: 'editor@example.com',
      committee_uids: ['c-1'],
    });
  });

  it('returns to the edition it was opened from after saving', async () => {
    await setup('pub-1', PUBLICATION, { returnTo: 'n-1' });
    const navigate = TestBed.inject(Router).navigate as unknown as ReturnType<typeof vi.fn>;
    submit();
    expect(navigate.mock.calls.at(-1)?.[0]).toEqual(['p-1', 'n-1', 'edit']);
  });

  it('returns to create with the publication picked after saving a new one', async () => {
    await setup(null);
    const navigate = TestBed.inject(Router).navigate as unknown as ReturnType<typeof vi.fn>;
    form().patchValue({ name: 'Weekly update' });
    submit();
    expect(navigate.mock.calls.at(-1)?.[0]).toEqual(['create']);
    expect(navigate.mock.calls.at(-1)?.[1]).toMatchObject({ queryParams: { publication: 'pub-1' } });
  });

  it('shows a clear message for a disallowed reply-to domain', async () => {
    await setup(null);
    service.createPublication.mockReturnValue(
      throwError(
        () => new HttpErrorResponse({ status: 400, error: { error: 'invalid_request: reply_to_email domain "x.example" is not an allowed reply-to domain' } })
      )
    );
    form().patchValue({ name: 'Weekly', replyToEmail: 'editor@x.example' });
    submit();
    fixture.detectChanges();
    expect(errorText()).toContain('approved domain');
  });

  it('shows a clear message for a stale version', async () => {
    await setup('pub-1');
    service.updatePublication.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 412 })));
    submit();
    fixture.detectChanges();
    expect(errorText()).toContain('Someone else changed this publication');
  });

  it('refuses to edit an implicit publication', async () => {
    await setup('pub-1', { ...PUBLICATION, implicit: true });
    expect(form().disabled).toBe(true);
    submit();
    expect(service.updatePublication).not.toHaveBeenCalled();
    expect(errorText()).toContain('created automatically');
  });

  it('does not save when the publication could not be loaded', async () => {
    await setup('pub-1');
    fixture.destroy();
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [NewsletterPublicationFormComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        MessageService,
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ projectUid: 'p-1', publicationUid: 'pub-1' })),
            snapshot: { paramMap: convertToParamMap({ projectUid: 'p-1', publicationUid: 'pub-1' }), queryParamMap: convertToParamMap({}) },
            parent: {},
          },
        },
        { provide: NewsletterService, useValue: { ...service, getPublication: () => throwError(() => new HttpErrorResponse({ status: 500 })) } },
        { provide: NewsletterManifestService, useValue: { templates: signal([]), loadTemplates: () => of([]) } },
        { provide: ProjectService, useValue: { getProjectStrict: () => of(null) } },
        { provide: ProjectContextService, useValue: { activeContext: signal(null), setActiveContext: vi.fn() } },
      ],
    }).compileComponents();
    const failed = TestBed.createComponent(NewsletterPublicationFormComponent);
    failed.detectChanges();
    await failed.whenStable();
    expect(failed.componentInstance.form.disabled).toBe(true);
    (failed.componentInstance as unknown as { onSubmit: () => void }).onSubmit();
    expect(service.createPublication).not.toHaveBeenCalled();
  });
});
