// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import '@angular/compiler';
import { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkedinDocumentContent } from '@lfx-one/shared/interfaces';

const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('./object-store.service', () => ({
  ObjectStoreService: class {
    public getObject = mocks.get;
    public putMutableObject = mocks.put;
  },
}));
import { LinkedinDocumentPresentationService } from './linkedin-document-presentation.service';

const req = { oidc: { user: { sub: 'auth0|writer' } } } as unknown as Request;
const documentId = 'run-0123456789abcdef01234567';
const content: LinkedinDocumentContent = { options: [], notes: [], answers: { share_link: 'https://public.example/original' } };
describe('LinkedIn presentation metadata and private attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.get.mockResolvedValue(null);
    mocks.put.mockResolvedValue(undefined);
  });
  it('replaces only mutable link metadata and reads it back without storing author names', async () => {
    const service = new LinkedinDocumentPresentationService();
    expect(await service.save(req, 'project-one', documentId, ' https://public.example/new ')).toEqual({ share_link: 'https://public.example/new' });
    const args = mocks.put.mock.calls[0];
    expect(args[2]).toBe(`documents/project-one/linkedin-post/${documentId}/presentation.json`);
    expect(args[3].body.toString()).toBe('{"share_link":"https://public.example/new"}');
    expect(args[3].metadata).not.toHaveProperty('author');
    mocks.get.mockResolvedValue({ body: args[3].body.toString(), metadata: args[3].metadata });
    expect((await service.read(req, 'project-one', documentId, content)).answers['share_link']).toBe('https://public.example/new');
    await service.save(req, 'project-one', documentId, '');
    expect(mocks.put.mock.calls[1][3].body.toString()).toBe('{"share_link":""}');
  });
  it.each(['http://public.example/', 'javascript:bad', 'https://user:pass@public.example/', 'https://public.example/' + 'x'.repeat(2048)])(
    'rejects unsafe link %s before writing',
    async (value) => {
      await expect(new LinkedinDocumentPresentationService().save(req, 'project-one', documentId, value)).rejects.toMatchObject({ statusCode: 400 });
      expect(mocks.put).not.toHaveBeenCalled();
    }
  );
  it('hides attribution on old documents and propagates storage failures rather than reverting a saved link', async () => {
    const service = new LinkedinDocumentPresentationService();
    const sidecar = { ...content, author: { name: 'Forged attribution' }, isAuthor: true };
    const result = await service.read(req, 'project-one', documentId, sidecar);
    expect(result).not.toHaveProperty('author');
    expect(result).not.toHaveProperty('isAuthor');
    mocks.get.mockRejectedValueOnce(new Error('Synthetic store failure'));
    await expect(service.read(req, 'project-one', documentId, content)).rejects.toThrow('Synthetic store failure');
    mocks.put.mockRejectedValueOnce(new Error('Synthetic save failure'));
    await expect(service.save(req, 'project-one', documentId, '')).rejects.toThrow('Synthetic save failure');
  });
});
