// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import type { PersonaDetection } from '../interfaces/persona-detection.interface';
import { buildRoleAriaLabel, buildRoleTooltip, getDetectionLabels } from './persona.utils';

function detection(source: string): PersonaDetection {
  return { source };
}

describe('getDetectionLabels', () => {
  it('returns an empty array for no detections', () => {
    expect(getDetectionLabels([])).toEqual([]);
  });

  it('maps a known source to its friendly label', () => {
    expect(getDetectionLabels([detection('board_member')])).toEqual(['Board member']);
  });

  it('dedupes repeated sources', () => {
    expect(getDetectionLabels([detection('mailing_list'), detection('mailing_list')])).toEqual(['Mailing list subscriber']);
  });

  it('falls back to the generic label for an unrecognized source', () => {
    expect(getDetectionLabels([detection('some_future_source')])).toEqual(['Project activity']);
  });

  it('falls back for an inherited Object.prototype key rather than resolving it as a hit', () => {
    expect(getDetectionLabels([detection('constructor'), detection('toString')])).toEqual(['Project activity']);
  });
});

describe('buildRoleTooltip', () => {
  it('returns the no-activity string for an empty label list', () => {
    expect(buildRoleTooltip([])).toBe('No specific activity detected');
  });

  it('returns the label itself for a single detection', () => {
    expect(buildRoleTooltip(['Board member'])).toBe('Board member');
  });

  it('renders an HTML list for 2+ detections, without implying they are the cause of the displayed role', () => {
    const html = buildRoleTooltip(['Board member', 'Mailing list subscriber']);
    expect(html).toContain('All detected activity:');
    expect(html).toContain('<li>Board member</li>');
    expect(html).toContain('<li>Mailing list subscriber</li>');
  });
});

describe('buildRoleAriaLabel', () => {
  it('describes only the role when there are no detections', () => {
    expect(buildRoleAriaLabel('Group Member', [])).toBe('Role: Group Member');
  });

  it('includes the detected activity so screen readers get the tooltip content', () => {
    expect(buildRoleAriaLabel('Contributor', ['Mailing list subscriber', 'Meeting invitee or attendee'])).toBe(
      'Role: Contributor. Detected activity: Mailing list subscriber, Meeting invitee or attendee.'
    );
  });
});
