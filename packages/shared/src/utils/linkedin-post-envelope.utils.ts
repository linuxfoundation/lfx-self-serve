// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  LINKEDIN_ABOUT_FIELDS,
  LINKEDIN_CONTRACT_ID,
  LINKEDIN_CONTENT_SOURCES,
  LINKEDIN_PROFILE_MAX_FIELD_CHARS,
  LINKEDIN_SOURCE_MAX_BYTES,
  LINKEDIN_VOICE_FIELDS,
} from '../constants/linkedin-post.constants';
import type { LinkedinEnvelope, LinkedinOption, LinkedinProfile, LinkedinSetup } from '../interfaces/linkedin-post.interface';
import { renderLinkedinProfileMarkdown } from './linkedin-post.utils';

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function profileText(value: unknown): value is string {
  return text(value) && value.length <= LINKEDIN_PROFILE_MAX_FIELD_CHARS;
}
function keys(value: Record<string, unknown>, allowed: string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
export function isLinkedinProfile(value: unknown): value is LinkedinProfile {
  if (!record(value) || !keys(value, ['about', 'voice']) || !record(value['about']) || !record(value['voice'])) return false;
  const about = value['about'];
  const voice = value['voice'];
  return (
    keys(
      about,
      LINKEDIN_ABOUT_FIELDS.map((f) => f.key)
    ) &&
    keys(
      voice,
      LINKEDIN_VOICE_FIELDS.map((f) => f.key)
    ) &&
    LINKEDIN_ABOUT_FIELDS.every((f) => profileText(about[f.key])) &&
    LINKEDIN_VOICE_FIELDS.every((f) => profileText(voice[f.key]))
  );
}
export function isLinkedinSetup(value: unknown): value is LinkedinSetup {
  if (
    !record(value) ||
    !keys(
      value,
      [...LINKEDIN_ABOUT_FIELDS, ...LINKEDIN_VOICE_FIELDS].map((f) => f.key)
    )
  )
    return false;
  return (
    LINKEDIN_ABOUT_FIELDS.filter((field) => field.key !== 'associated_projects').every((field) => text(value[field.key])) &&
    Object.values(value).every((v) => typeof v === 'string' && v.length <= LINKEDIN_PROFILE_MAX_FIELD_CHARS)
  );
}
/** The same option-array gate used by live envelopes and stored option-card sidecars. */
export function isLinkedinOptions(value: unknown): value is LinkedinOption[] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((o: unknown, i) => {
      if (!record(o) || !keys(o, ['number', 'label', 'text', 'word_count', 'hashtags', 'tagging_suggestions'])) return false;
      return (
        o['number'] === i + 1 &&
        text(o['label']) &&
        text(o['text']) &&
        Number.isInteger(o['word_count']) &&
        Number(o['word_count']) >= 1 &&
        Number(o['word_count']) <= 200 &&
        Array.isArray(o['hashtags']) &&
        o['hashtags'].length >= 3 &&
        o['hashtags'].length <= 5 &&
        o['hashtags'].every((h) => typeof h === 'string' && /^#[\p{L}\p{N}_]*\p{L}[\p{L}\p{N}_]*$/u.test(h)) &&
        Array.isArray(o['tagging_suggestions']) &&
        o['tagging_suggestions'].length > 0 &&
        o['tagging_suggestions'].every(text)
      );
    })
  );
}

/** JSON Schema draft 2020-12 shape plus the contract's cross-field rules. Hash recomputation is server-only. */
export function isLinkedinEnvelope(value: unknown): value is LinkedinEnvelope {
  if (
    !record(value) ||
    !keys(value, [
      'contract',
      'kind',
      'version',
      'options',
      'document_markdown',
      'content_sha256',
      'profile_source',
      'profile',
      'profile_markdown',
      'profile_update_note',
      'notes',
      'inputs',
      'generated_at',
      'agent',
    ])
  )
    return false;
  if (value['contract'] !== LINKEDIN_CONTRACT_ID || value['kind'] !== 'linkedin-post' || !Number.isInteger(value['version']) || Number(value['version']) < 1)
    return false;
  if (
    !text(value['document_markdown']) ||
    new TextEncoder().encode(value['document_markdown']).length > LINKEDIN_SOURCE_MAX_BYTES ||
    !text(value['content_sha256']) ||
    !/^[0-9a-f]{64}$/.test(value['content_sha256'])
  )
    return false;
  if (
    typeof value['profile_source'] !== 'string' ||
    !['first_run_setup', 'saved_profile'].includes(value['profile_source']) ||
    !isLinkedinProfile(value['profile']) ||
    value['profile_markdown'] !== renderLinkedinProfileMarkdown(value['profile'])
  )
    return false;
  if (!isLinkedinOptions(value['options'])) return false;
  const inputs = value['inputs'];
  if (
    !record(inputs) ||
    !LINKEDIN_CONTENT_SOURCES.some((source) => source.value === inputs['content_source']) ||
    typeof inputs['feedback_provided'] !== 'boolean'
  )
    return false;
  if (
    (inputs['content_source'] === 'url') !== text(inputs['content_url']) ||
    (inputs['content_url'] !== undefined && !text(inputs['content_url'])) ||
    (inputs['content_file_name'] !== undefined && (inputs['content_source'] !== 'file' || !text(inputs['content_file_name'])))
  )
    return false;
  if (inputs['feedback_provided'] ? Number(value['version']) < 2 : value['version'] !== 1) return false;
  if (value['profile_update_note'] !== undefined && (!inputs['feedback_provided'] || !text(value['profile_update_note']))) return false;
  if (
    value['notes'] !== undefined &&
    (!Array.isArray(value['notes']) ||
      value['notes'].length < 1 ||
      value['notes'].length > 3 ||
      !value['notes'].every((n) => text(n) && Array.from(n).length <= 200))
  )
    return false;
  const agent = value['agent'];
  return (
    text(value['generated_at']) &&
    /^\d{4}-\d{2}-\d{2}T.*Z$/.test(value['generated_at']) &&
    Number.isFinite(Date.parse(value['generated_at'])) &&
    record(agent) &&
    keys(agent, ['identifier', 'agent_version', 'prompt_manifest_sha256']) &&
    agent['identifier'] === 'linux-foundation~linkedin-post' &&
    text(agent['agent_version']) &&
    /^\d+\.\d+\.\d+$/.test(agent['agent_version']) &&
    text(agent['prompt_manifest_sha256']) &&
    /^[0-9a-f]{64}$/.test(agent['prompt_manifest_sha256'])
  );
}
