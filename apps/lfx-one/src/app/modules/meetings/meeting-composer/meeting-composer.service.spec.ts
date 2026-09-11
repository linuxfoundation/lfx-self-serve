// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { MeetingComposerService } from './meeting-composer.service';

/**
 * Covers which surface is showing and how the switch out of quick create behaves.
 *
 * The surface is held in its own signal rather than read off the open context, and that separation is
 * the whole reason "Switch to advanced mode" can keep what the organizer already typed:
 * `MeetingComposerHostComponent` calls `MeetingComposerFormService.initialize()` on every write to
 * `context`, which replaces the FormGroup. So these tests assert the switch leaves `context`
 * untouched — that identity, not just the field values, is what the form's survival depends on.
 */
describe('MeetingComposerService', () => {
  let service: MeetingComposerService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [MeetingComposerService] });
    service = TestBed.inject(MeetingComposerService);
  });

  it('opens on the drawer unless the entry point asks for the dialog', () => {
    service.open({ mode: 'create' });

    expect(service.isOpen()).toBe(true);
    expect(service.isQuickCreate()).toBe(false);
  });

  it('opens the quick dialog when the entry point asks for it', () => {
    service.open({ mode: 'create', variant: 'quick' });

    expect(service.isQuickCreate()).toBe(true);
  });

  it('moves an open quick create to the drawer without rewriting the context', () => {
    service.open({ mode: 'create', variant: 'quick', projectUid: 'project-1' });
    const context = service.context();

    service.switchToAdvanced();

    expect(service.isQuickCreate()).toBe(false);
    expect(service.isOpen()).toBe(true);
    // Identity, not equality: the host re-initializes the form — replacing the FormGroup — on every
    // write to `context`, so a switch that wrote an equal-but-new object would still discard
    // everything the dialog was opened to collect.
    expect(service.context()).toBe(context);
  });

  it('leaves the section where the open put it, so the drawer resumes the walk', () => {
    service.open({ mode: 'create', variant: 'quick' });

    service.switchToAdvanced();

    expect(service.activeSection()).toBe('details-access');
  });

  // The preview hides `startDate` until Date & Schedule is visited, because that control opens
  // pre-filled with a default and showing it unvisited would present a date nobody chose. After the
  // handoff the organizer *has* chosen one — in the dialog — so leaving the section unvisited blanked
  // the date they were looking at a second earlier.
  it('marks the dialog own sections visited, so the drawer does not blank what it showed', () => {
    service.open({ mode: 'create', variant: 'quick' });

    service.switchToAdvanced();

    expect(service.visitedSections()).toEqual(new Set(['details-access', 'date-schedule', 'guests', 'agenda-resources']));
  });

  // The one section the dialog has no column for. The preview gates its feature rows on this, so
  // marking it visited would list defaults the organizer has never been shown.
  it('leaves platform & features unvisited, since the dialog never puts it on screen', () => {
    service.open({ mode: 'create', variant: 'quick' });

    service.switchToAdvanced();

    expect(service.visitedSections().has('platform-features')).toBe(false);
  });

  it('clears the carried-over sections on close, so the next open starts fresh', () => {
    service.open({ mode: 'create', variant: 'quick' });
    service.switchToAdvanced();

    service.close();

    expect(service.visitedSections()).toEqual(new Set(['details-access']));
  });

  it('reverts to the drawer on close, so the next open is not stuck on the dialog', () => {
    service.open({ mode: 'create', variant: 'quick' });

    service.close();

    // `isQuickCreate` is the host's only surface switch and it outlives every open, so a retained
    // `'quick'` would render the dialog for an edit opened from a meeting card.
    expect(service.isOpen()).toBe(false);
    expect(service.isQuickCreate()).toBe(false);
  });

  it('reseeds the surface on every open rather than keeping the last one', () => {
    service.open({ mode: 'create', variant: 'quick' });
    service.switchToAdvanced();

    service.open({ mode: 'create', variant: 'quick' });

    expect(service.isQuickCreate()).toBe(true);
  });
});
