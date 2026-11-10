// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { EMAIL_LINKED_SUPPORT_HANDLE_PATTERN, EMAIL_REGEX, VALKEY_CACHE } from '@lfx-one/shared/constants';
import { LinkedEmailSupportContext } from '@lfx-one/shared/interfaces';
import { randomBytes } from 'crypto';

import { buildLinkedEmailSupportCacheKey, valkeyService } from './valkey.service';

/** Presentation-only, single-use support context. No session fallback that could replay a consumed record. */
export class LinkedEmailSupportService {
  public async issue(sub: string, email: string): Promise<string | undefined> {
    if (!sub || !EMAIL_REGEX.test(email) || !valkeyService.isEnabled()) return undefined;
    const handle = randomBytes(32).toString('hex');
    const context: LinkedEmailSupportContext = { email, expiresAt: Date.now() + VALKEY_CACHE.EMAIL_LINKED_SUPPORT_TTL_SECONDS * 1000 };
    const stored = await valkeyService.setJson(
      buildLinkedEmailSupportCacheKey(sub, handle),
      context,
      VALKEY_CACHE.EMAIL_LINKED_SUPPORT_TTL_SECONDS,
      VALKEY_CACHE.AUTH_STATE_OP_TIMEOUT_MS
    );
    return stored ? handle : undefined;
  }

  public async consume(sub: string, handle: unknown): Promise<string | undefined> {
    if (!sub || typeof handle !== 'string' || !EMAIL_LINKED_SUPPORT_HANDLE_PATTERN.test(handle) || !valkeyService.isEnabled()) return undefined;
    const result = await valkeyService.getdelJson<LinkedEmailSupportContext>(
      buildLinkedEmailSupportCacheKey(sub, handle),
      LinkedEmailSupportService.isContext,
      VALKEY_CACHE.AUTH_STATE_OP_TIMEOUT_MS
    );
    if (result.status !== 'hit' || !LinkedEmailSupportService.isContext(result.value)) return undefined;
    const { email, expiresAt } = result.value;
    return expiresAt > Date.now() && expiresAt <= Date.now() + VALKEY_CACHE.EMAIL_LINKED_SUPPORT_TTL_SECONDS * 1000 ? email : undefined;
  }

  private static isContext(value: unknown): value is LinkedEmailSupportContext {
    if (!value || typeof value !== 'object') return false;
    const context = value as Partial<LinkedEmailSupportContext>;
    return typeof context.email === 'string' && EMAIL_REGEX.test(context.email) && typeof context.expiresAt === 'number' && Number.isFinite(context.expiresAt);
  }
}

export const linkedEmailSupportService = new LinkedEmailSupportService();
