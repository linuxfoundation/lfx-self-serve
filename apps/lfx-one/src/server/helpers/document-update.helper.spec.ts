// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { ProjectDocumentType, UpdateDocumentRequest, UpstreamDocumentRecord } from '@lfx-one/shared/interfaces';
import { describe, expect, it, vi } from 'vitest';

// The `@lfx-one/shared/*` alias isn't wired into this app's vitest config, so the one runtime import is stubbed with the real function.
vi.mock('@lfx-one/shared/utils', async () => {
  const strings = await vi.importActual<typeof import('../../../../../packages/shared/src/utils/string.utils')>(
    '../../../../../packages/shared/src/utils/string.utils'
  );
  return { isUuid: strings.isUuid };
});

import { buildDocumentUpdateBody, parseDocumentUpdateRequest } from './document-update.helper';

const FOLDER_UID = '3f2a8c1e-5b7d-4e69-9a0f-1c2d3e4f5a6b';

describe('parseDocumentUpdateRequest', () => {
  const valid: [string, unknown, ProjectDocumentType, UpdateDocumentRequest][] = [
    ['a rename', { name: 'Minutes 2026' }, 'file', { name: 'Minutes 2026' }],
    ['a name with surrounding space, trimmed', { name: '  Minutes  ' }, 'link', { name: 'Minutes' }],
    ['a move into a folder', { parent_uid: FOLDER_UID }, 'file', { parent_uid: FOLDER_UID }],
    ['a move to the root', { parent_uid: null }, 'link', { parent_uid: null }],
    ['a rename and a move together', { name: 'Charter', parent_uid: FOLDER_UID }, 'link', { name: 'Charter', parent_uid: FOLDER_UID }],
    ['a folder rename', { name: 'Reports' }, 'folder', { name: 'Reports' }],
    ['a name of exactly the longest length', { name: 'x'.repeat(200) }, 'folder', { name: 'x'.repeat(200) }],
  ];

  it.each(valid)('accepts %s', (_label, body, type, expected) => {
    const { request, fieldErrors } = parseDocumentUpdateRequest(body, type, 200);

    expect(fieldErrors).toEqual({});
    expect(request).toEqual(expected);
  });

  const invalid: [string, unknown, ProjectDocumentType, Record<string, string>][] = [
    ['no body', undefined, 'file', { body: 'Request body must be a JSON object' }],
    ['a null body', null, 'file', { body: 'Request body must be a JSON object' }],
    ['an array body', [], 'file', { body: 'Request body must be a JSON object' }],
    ['an empty object', {}, 'file', { body: 'Provide a name, a parent_uid, or both' }],
    ['a blank name', { name: '   ' }, 'file', { name: 'Name is required' }],
    ['a name that is not a string', { name: 7 }, 'file', { name: 'Name is required' }],
    ['a null name', { name: null }, 'file', { name: 'Name is required' }],
    ['a name over the limit', { name: 'x'.repeat(201) }, 'folder', { name: 'Name must be 200 characters or fewer' }],
    ['a folder id that is not a UUID', { parent_uid: 'not-a-uuid' }, 'file', { parent_uid: 'Folder ID must be a valid UUID, or null for the root' }],
    ['a folder id that is not a string', { parent_uid: 5 }, 'link', { parent_uid: 'Folder ID must be a valid UUID, or null for the root' }],
    ['an empty folder id', { parent_uid: '' }, 'file', { parent_uid: 'Folder ID must be a valid UUID, or null for the root' }],
    ['a move of a folder', { parent_uid: FOLDER_UID }, 'folder', { parent_uid: 'A folder cannot be moved' }],
    ['a field that cannot be edited', { name: 'Ok', url: 'https://example.com' }, 'link', { url: 'This field cannot be edited' }],
    ['only a field that cannot be edited', { description: 'x' }, 'file', { description: 'This field cannot be edited' }],
  ];

  it.each(invalid)('refuses %s', (_label, body, type, expectedErrors) => {
    const { fieldErrors } = parseDocumentUpdateRequest(body, type, 200);

    expect(fieldErrors).toEqual(expectedErrors);
  });

  it('keeps what was valid next to what was not, so the caller can report every problem', () => {
    const { request, fieldErrors } = parseDocumentUpdateRequest({ name: 'Ok', parent_uid: 'nope' }, 'file', 200);

    expect(request).toEqual({ name: 'Ok' });
    expect(Object.keys(fieldErrors)).toEqual(['parent_uid']);
  });
});

describe('buildDocumentUpdateBody', () => {
  const link: UpstreamDocumentRecord = { name: 'Old', url: 'https://example.com', description: 'A link', folder_uid: FOLDER_UID };
  const file: UpstreamDocumentRecord = { name: 'Old', description: 'A file', folder_uid: FOLDER_UID };
  const OTHER_FOLDER = '9d8c7b6a-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

  it('carries the folder and description over on a link rename', () => {
    expect(buildDocumentUpdateBody('link', link, { name: 'New' })).toEqual({
      name: 'New',
      url: 'https://example.com',
      description: 'A link',
      folder_uid: FOLDER_UID,
    });
  });

  it('carries the name and description over on a link move', () => {
    expect(buildDocumentUpdateBody('link', link, { parent_uid: OTHER_FOLDER })).toEqual({
      name: 'Old',
      url: 'https://example.com',
      description: 'A link',
      folder_uid: OTHER_FOLDER,
    });
  });

  it('leaves the folder out to move a link to the root, as the upstream services spell it', () => {
    const body = buildDocumentUpdateBody('link', link, { parent_uid: null });

    expect(body['folder_uid']).toBeUndefined();
    expect(JSON.parse(JSON.stringify(body))).toEqual({ name: 'Old', url: 'https://example.com', description: 'A link' });
  });

  it('sends a file only its editable fields, with no url', () => {
    expect(buildDocumentUpdateBody('file', file, { name: 'New' })).toEqual({ name: 'New', description: 'A file', folder_uid: FOLDER_UID });
    expect(Object.keys(buildDocumentUpdateBody('file', file, { name: 'New' }))).not.toContain('url');
  });

  it('moves a file to the root and into a folder', () => {
    expect(JSON.parse(JSON.stringify(buildDocumentUpdateBody('file', file, { parent_uid: null })))).toEqual({ name: 'Old', description: 'A file' });
    expect(buildDocumentUpdateBody('file', { name: 'Old' }, { parent_uid: OTHER_FOLDER })).toMatchObject({ folder_uid: OTHER_FOLDER });
  });

  it('sends a folder only its name', () => {
    expect(buildDocumentUpdateBody('folder', { name: 'Old' }, { name: 'New' })).toEqual({ name: 'New' });
  });

  it('applies a rename and a move together', () => {
    expect(buildDocumentUpdateBody('file', file, { name: 'New', parent_uid: OTHER_FOLDER })).toEqual({
      name: 'New',
      description: 'A file',
      folder_uid: OTHER_FOLDER,
    });
  });
});
