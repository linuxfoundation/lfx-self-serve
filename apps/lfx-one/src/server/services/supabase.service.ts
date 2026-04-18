// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { SupabaseUser, SupabaseUserEmail } from '@lfx-one/shared/interfaces';
import { logger } from './logger.service';

// TODO: Replace this stub with a real Supabase integration once the service is implemented.
/** Temporary Supabase service stub — returns null/empty so callers fall back to OIDC email. */
export class SupabaseService {
  /**
   * Look up a Supabase user by username.
   * @param username - The LFX username to look up.
   * @returns The user record, or null if not found. Stub always returns null.
   */
  public async getUser(username: string): Promise<SupabaseUser | null> {
    logger.debug(undefined, 'supabase_get_user', 'SupabaseService is a stub — returning null', { username });
    return null;
  }

  /**
   * Fetch all email addresses associated with a Supabase user ID.
   * @param userId - The Supabase user ID.
   * @returns List of email records. Stub always returns an empty list.
   */
  public async getUserEmails(userId: string): Promise<SupabaseUserEmail[]> {
    logger.debug(undefined, 'supabase_get_user_emails', 'SupabaseService is a stub — returning empty list', { userId });
    return [];
  }
}
