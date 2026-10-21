// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { LINKEDIN_PROFILE_INITIALIZATIONS } from '@lfx-one/shared/constants';
import { LinkedinProfileInput, LinkedinStoredProfile, ObjectStorePutInput } from '@lfx-one/shared/interfaces';
import { isLinkedinProfile, linkedinProfileFromSetup, renderLinkedinProfileMarkdown } from '@lfx-one/shared/utils';
import { Request } from 'express';
import { createHash, createHmac } from 'node:crypto';

import { MicroserviceError } from '../errors';
import { ObjectStoreService } from './object-store.service';

/** One current profile per effective subject; deletion follows the backend retention policy. */
export class LinkedinProfileService {
  private readonly store = new ObjectStoreService();

  public async read(req: Request, user: string): Promise<LinkedinStoredProfile | null> {
    const key = `${this.prefix(user)}current.json`;
    try {
      const object = await this.store.getPrivateObject(req, 'marketing-os-artifacts', key);
      if (!object) return null; // Only a confirmed absent stable key means first run.
      const sha = createHash('sha256').update(object.body).digest('hex');
      if (object.metadata['content-sha256'] !== sha) throw this.failure('LINKEDIN_PROFILE_HASH_MISMATCH', 'Saved profile integrity check failed.');
      const saved: unknown = JSON.parse(object.body);
      if (!saved || typeof saved !== 'object' || !('profile' in saved) || !isLinkedinProfile(saved.profile)) {
        throw this.failure('LINKEDIN_PROFILE_INVALID', 'Saved profile is invalid.');
      }
      return { profile: saved.profile, profile_markdown: renderLinkedinProfileMarkdown(saved.profile) };
    } catch (error) {
      if (error instanceof MicroserviceError) throw error;
      throw this.failure('LINKEDIN_PROFILE_READ_FAILED', 'The saved profile could not be read.');
    }
  }

  /** Converts validated HTTP input in the business layer, not the controller. */
  public async saveFromInput(req: Request, user: string, input: LinkedinProfileInput): Promise<LinkedinStoredProfile> {
    const profile = input.setup ? linkedinProfileFromSetup(input.setup) : input.profile;
    const saved = { profile, profile_markdown: renderLinkedinProfileMarkdown(profile) };
    await this.save(req, user, saved);
    return saved;
  }

  public async save(req: Request, user: string, profile: LinkedinStoredProfile): Promise<void> {
    await this.store.putMutableObject(req, 'marketing-os-artifacts', `${this.prefix(user)}current.json`, this.input(profile));
  }

  /** Consume automatic setup once, durably, before attempting its create-only profile write. */
  public async initializeOnce(req: Request, user: string, sessionId: string, profile: LinkedinStoredProfile): Promise<boolean> {
    const prefix = this.prefix(user);
    const run = createHash('sha256').update(sessionId).digest('hex');
    const claimed = await this.store.putPrivateObjectIfAbsent(req, 'marketing-os-artifacts', `${prefix}${LINKEDIN_PROFILE_INITIALIZATIONS}${run}.json`, {
      body: Buffer.from('{}'),
      contentType: 'application/json',
      cacheControl: 'private, no-store',
    });
    if (!claimed) return (await this.read(req, user)) !== null;
    const created = await this.store.putPrivateObjectIfAbsent(req, 'marketing-os-artifacts', `${prefix}current.json`, this.input(profile));
    return created || (await this.read(req, user)) !== null;
  }

  public async delete(req: Request, user: string): Promise<void> {
    await this.store.deletePrivateObject(req, 'marketing-os-artifacts', `${this.prefix(user)}current.json`);
  }

  private input(profile: LinkedinStoredProfile): ObjectStorePutInput {
    const body = Buffer.from(JSON.stringify(profile), 'utf8');
    return {
      body,
      contentType: 'application/json; charset=utf-8',
      cacheControl: 'private, no-store',
      metadata: { 'content-sha256': createHash('sha256').update(body).digest('hex') },
    };
  }

  // Deliberate stable-sub key per product-owner ruling; see the Identity and
  // persistence decision in docs/architecture/backend/mktg-linkedin-post.md.
  private prefix(user: string): string {
    const secret = process.env['PCC_AUTH0_SECRET'];
    if (!secret) throw this.failure('LINKEDIN_PROFILE_KEY_UNAVAILABLE', 'Profile storage requires the server session secret.');
    const id = createHmac('sha256', secret).update(`linkedin-profile:${user}`).digest('hex');
    return `user-profiles/linkedin-post/${id}/`;
  }

  private failure(code: string, message: string): MicroserviceError {
    return new MicroserviceError(message, 503, code, { service: 'object_store', operation: 'linkedin_profile_storage' });
  }
}
