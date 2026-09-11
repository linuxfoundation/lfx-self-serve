// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router, UrlSegment } from '@angular/router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingComposerRouteComponent } from './meeting-composer-route.component';
import { MeetingComposerService } from './meeting-composer.service';

/**
 * These two URLs are what the full-page editor left behind, so their whole job is to be arrived at
 * cold — from a bookmark, a calendar invite, an email — with no menu in front of them to state an
 * intent. That makes the surface they open, and the list they fall back to, the only two things
 * this component decides, and neither is observable from anywhere else.
 */
describe('MeetingComposerRouteComponent', () => {
  let composer: MeetingComposerService;
  let navigate: ReturnType<typeof vi.fn>;

  /** `pathFromRoot` is the whole matched URL, one entry per route in the chain. */
  const activatedRouteFor = (
    segments: string[],
    params: Record<string, string>,
    queryParams: Record<string, string>
  ): Pick<ActivatedRoute, 'snapshot' | 'pathFromRoot'> =>
    ({
      snapshot: {
        paramMap: convertToParamMap(params),
        queryParamMap: convertToParamMap(queryParams),
        queryParams,
      },
      pathFromRoot: segments.map((segment) => ({ snapshot: { url: [new UrlSegment(segment, {})] } })),
    }) as unknown as Pick<ActivatedRoute, 'snapshot' | 'pathFromRoot'>;

  const mount = (segments: string[], params: Record<string, string> = {}, queryParams: Record<string, string> = {}): void => {
    TestBed.configureTestingModule({
      imports: [MeetingComposerRouteComponent],
      providers: [
        MeetingComposerService,
        { provide: ActivatedRoute, useValue: activatedRouteFor(segments, params, queryParams) },
        { provide: Router, useValue: { navigate } },
      ],
    });

    composer = TestBed.inject(MeetingComposerService);
    TestBed.createComponent(MeetingComposerRouteComponent);
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    navigate = vi.fn();
  });

  it('opens the drawer for a create deep link, not the quick dialog', () => {
    mount(['meetings', 'create']);

    // A link cannot say it wanted a smaller form. Quick create drops Platform & Features, Guests and
    // Agenda & Resources, so answering this URL with the dialog would quietly hand a bookmark that
    // used to reach the full editor a subset of it.
    expect(composer.isQuickCreate()).toBe(false);
    expect(composer.context()).toMatchObject({ mode: 'create', meetingUid: undefined });
  });

  it('opens the drawer in edit mode for an edit deep link', () => {
    mount(['meetings', 'meeting-7', 'edit'], { id: 'meeting-7' });

    expect(composer.isQuickCreate()).toBe(false);
    expect(composer.context()).toMatchObject({ mode: 'edit', meetingUid: 'meeting-7' });
  });

  it('carries a group-scoped create link through to the composer', () => {
    mount(['meetings', 'create'], {}, { committee_uid: 'committee-3', project: 'acme' });

    expect(composer.context()).toMatchObject({ committeeUid: 'committee-3' });
  });

  it('falls back to the list the link sat under, keeping its query params', () => {
    mount(['project', 'meetings', 'create'], {}, { project: 'acme' });

    expect(navigate).toHaveBeenCalledWith(['/', 'project', 'meetings'], { queryParams: { project: 'acme' }, replaceUrl: true });
  });

  it('drops both segments of an edit link when falling back', () => {
    mount(['project', 'meetings', 'meeting-7', 'edit'], { id: 'meeting-7' }, { project: 'acme' });

    expect(navigate).toHaveBeenCalledWith(['/', 'project', 'meetings'], { queryParams: { project: 'acme' }, replaceUrl: true });
  });
});
