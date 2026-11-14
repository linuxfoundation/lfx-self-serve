// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import type { LinkedinOption } from '../interfaces/linkedin-post.interface';
import {
  normalizeLinkedinShareAnswers,
  normalizeLinkedinShareLink,
  presentLinkedinOption,
  readLinkedinDocumentContent,
} from './linkedin-post-presentation.utils';

function option(number = 1): LinkedinOption {
  return {
    number,
    label: `Angle ${number}`,
    text: 'Read [LINK]. More at [LINK].',
    word_count: 6,
    hashtags: ['#Code', '#Release', '#Community'],
    tagging_suggestions: ['Example project'],
  };
}
describe('LinkedIn LFX-side link presentation', () => {
  it('replaces every literal placeholder only in presentation and copy', () => {
    const raw = option();
    const before = JSON.stringify(raw);
    const shown = presentLinkedinOption(raw, 'https://public.example/release');
    expect(shown.parts.map((part) => part.text).join('')).toBe('Read https://public.example/release. More at https://public.example/release.');
    expect(shown.copyText).toBe('Read https://public.example/release. More at https://public.example/release.\n\n#Code #Release #Community');
    expect(shown.missingLink).toBe(false);
    expect(JSON.stringify(raw)).toBe(before);
  });
  it('deduplicates whole Unicode hashtag tokens, not prefixes, with case-insensitive matching', () => {
    const raw = { ...option(), text: 'Use #AIOps, #Café and #AI_2.', hashtags: ['#AI', '#aiops', '#CAFÉ', '#ai_2'] };
    expect(presentLinkedinOption(raw).copyText).toBe('Use #AIOps, #Café and #AI_2.\n\n#AI');
  });

  it('marks missing links as chips but keeps the original placeholder in copy', () => {
    const shown = presentLinkedinOption(option());
    expect(shown.parts.filter((part) => part.needsLink)).toEqual([
      { text: 'add your link', needsLink: true },
      { text: 'add your link', needsLink: true },
    ]);
    expect(shown.copyText).toContain('[LINK]');
    expect(shown.missingLink).toBe(true);
  });
  it('accepts optional HTTPS share URLs without fetching, rejects unsafe or malformed values', () => {
    expect(normalizeLinkedinShareLink(undefined)).toBe('');
    expect(normalizeLinkedinShareLink('  https://public.example/path  ')).toBe('https://public.example/path');
    expect(normalizeLinkedinShareLink('http://public.example/path')).toBeNull();
    for (const value of [
      'javascript:alert(1)',
      'data:text/plain,hello',
      '/relative',
      'https://user:secret@public.example/',
      'https://public.example/a b',
      'x'.repeat(2049),
      42,
    ])
      expect(normalizeLinkedinShareLink(value)).toBeNull();
    expect(normalizeLinkedinShareAnswers({ share_link: 'https://public.example/' })).toEqual({ share_link: 'https://public.example/' });
    expect(normalizeLinkedinShareAnswers({ share_link: '', profile: 'not LFX link metadata' })).toBeNull();
  });
  it('reads structured cards and link answers without trusting arbitrary sidecar options', () => {
    const options = [option(1), option(2), option(3)];
    const sidecar = { options, notes: ['Verify handles.'], answers: { share_link: 'https://public.example/' } };
    expect(readLinkedinDocumentContent(sidecar)).toEqual(sidecar);
    const resolved = { ...sidecar, author: { name: null }, isAuthor: false };
    expect(readLinkedinDocumentContent(resolved)).not.toHaveProperty('author');
    expect(readLinkedinDocumentContent(resolved)).not.toHaveProperty('isAuthor');
    expect(readLinkedinDocumentContent(resolved, true)).toMatchObject({ author: { name: null }, isAuthor: false });
    expect(readLinkedinDocumentContent({ options: [option()] })).toBeNull();
    expect(readLinkedinDocumentContent(undefined)).toBeNull();
    expect(readLinkedinDocumentContent({ options, answers: { share_link: 'javascript:bad' } })?.answers).toEqual({ share_link: '' });
  });
});
