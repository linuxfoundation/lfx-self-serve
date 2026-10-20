// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LINKEDIN_ABOUT_FIELDS, LINKEDIN_VOICE_FIELDS, LINKEDIN_PROFILE_GAP_LABELS, LINKEDIN_MAX_QUESTIONS } from '../constants/linkedin-post.constants';
import type { LinkedinForm, LinkedinProfile, LinkedinSetup } from '../interfaces/linkedin-post.interface';

/** Collapse line terminators and trim a single profile field. */
export function singleLine(text: string): string {
  return text
    .split('\u0085')
    .map((part) =>
      part
        .split(/[\n\r\v\f\u2028\u2029]/)
        .map((line) => line.trim())
        .filter(Boolean)
        .join(' ')
    )
    .join(' ')
    .trim();
}
export function linkedinProfileFromSetup(setup: LinkedinSetup): LinkedinProfile {
  return {
    about: {
      name: singleLine(setup.name),
      role: singleLine(setup.role),
      focus_areas: singleLine(setup.focus_areas),
      associated_projects: singleLine(setup.associated_projects ?? '') || 'None',
      primary_audience: singleLine(setup.primary_audience),
    },
    voice: Object.fromEntries(LINKEDIN_VOICE_FIELDS.map((f) => [f.key, singleLine(setup[f.key]?.trim() || f.default)])) as LinkedinProfile['voice'],
  };
}
/** Profile file mirrors the live agent's format. */
export function renderLinkedinProfileMarkdown(profile: LinkedinProfile): string {
  const lines = ['# LinkedIn Post Agent Profile', '', '## About'];
  for (const f of LINKEDIN_ABOUT_FIELDS) lines.push(`- ${f.label}: ${singleLine(profile.about[f.key])}`);
  lines.push('', '## Voice');
  for (const f of LINKEDIN_VOICE_FIELDS) lines.push(`- ${f.label}: ${singleLine(profile.voice[f.key])}`);
  return lines.join('\n') + '\n';
}
function resolveLinkedinProfile(form: LinkedinForm) {
  if (form.saved_profile) return { profile: form.saved_profile, source: 'saved_profile', defaulted: [] as string[] };
  const setup = form.setup;
  if (!setup) throw new Error('The form carries no profile');
  return {
    profile: linkedinProfileFromSetup(setup),
    source: 'first_run_setup',
    defaulted: LINKEDIN_VOICE_FIELDS.filter((f) => !setup[f.key]?.trim()).map((f) => f.key) as string[],
  };
}
/** Same first-draft gap selection as agent2.0; identity/project-list fields are not interview gaps. */
export function linkedinProfileGapIds(form: LinkedinForm): string[] {
  const { profile, defaulted } = resolveLinkedinProfile(form);
  const missing = LINKEDIN_ABOUT_FIELDS.filter((field) => /^(?:unknown|not provided|unspecified|tbd)$/i.test(profile.about[field.key].trim())).map(
    (field) => field.key
  );
  const candidates = new Set([...missing, ...(form.setup ? defaulted : [])].map((key) => key.replace(/_/g, '-')));
  return Object.keys(LINKEDIN_PROFILE_GAP_LABELS)
    .filter((id) => candidates.has(id))
    .slice(0, LINKEDIN_MAX_QUESTIONS);
}

/** Render only selected catalog IDs, never user-supplied metadata. */
export function renderLinkedinProfileGaps(form: LinkedinForm): string {
  return `PROFILE GAPS: ${JSON.stringify(JSON.stringify(linkedinProfileGapIds(form)))}`;
}

const LINE_TERMINATORS = /\r\n|[\r\v\f\u0085\u2028\u2029]/g;
export function neutralizeDelimiters(value: string): string {
  return value
    .replace(LINE_TERMINATORS, '\n')
    .split('\n')
    .map((line) => (/^\s*={3,}|={3,}\s*$/.test(line) && /\b(?:BEGIN|END)\b/i.test(line) ? line.replace(/={3,}/g, (run) => '-'.repeat(run.length)) : line))
    .join('\n');
}
