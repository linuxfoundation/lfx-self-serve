// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_DOCUMENT_AUTHOR_CACHE_LIMIT } from '@lfx-one/shared/constants';
import type { MktgRevisionAuthor } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { AuthenticationError } from '../errors';
import { getEffectiveSub, isImpersonating } from '../utils/auth-helper';
import { logger } from './logger.service';
import type { UserService } from './user.service';

/**
 * The last display name the directory returned for each subject, shared by every
 * instance in this process. A lookup that fails serves it instead of no name
 * (stale-if-error, RFC 5861 §4), so successive responses never disagree about an
 * author once a name was known. Only successful lookups write it.
 */
const lastKnownNames = new Map<string, string>();

/** One attribution policy for revisions and comments; share the instance within a document request flow. */
export class MktgDocumentAuthorService {
  private readonly authors = new WeakMap<Request, Map<string, Promise<MktgRevisionAuthor>>>();
  private userService?: Promise<UserService>;

  public constructor(private readonly lastKnown: Map<string, string> = lastKnownNames) {}

  /** #3773: store only the effective opaque subject; no operator/name/username fallback. */
  public captureAuthorId(req: Request): string | null {
    const userId = getEffectiveSub(req);
    if (!userId && !isImpersonating(req)) throw new AuthenticationError('A signed-in writer subject is required when not impersonating.');
    return userId;
  }

  /** Moved from the revision store without changing its default lookup/log/error semantics. */
  public async resolveAuthor(
    req: Request,
    userId: string | null | undefined,
    operation = 'mktg_document_store_author',
    message = 'Author lookup failed — showing no name'
  ): Promise<MktgRevisionAuthor | null> {
    if (!userId) return null;
    let authors = this.authors.get(req);
    if (!authors) {
      authors = new Map();
      this.authors.set(req, authors);
    }
    let author = authors.get(userId);
    if (!author) {
      author = (async () => {
        try {
          this.userService ??= import('./user.service')
            .then(({ UserService }) => new UserService())
            .catch((error: unknown) => {
              this.userService = undefined;
              throw error;
            });
          const response = await (await this.userService).getUserInfo(req, userId);
          if (!response.success) {
            logger.warning(req, operation, message);
            return this.lastKnownAuthor(userId);
          }
          return this.remember(userId, response.data?.name || null);
        } catch (err) {
          logger.warning(req, operation, message, { err });
          return this.lastKnownAuthor(userId);
        }
      })();
      authors.set(userId, author);
    }
    return author;
  }

  /** A successful lookup is the truth: it refreshes the subject's entry, or removes it when the directory now has no name. */
  private remember(userId: string, name: string | null): MktgRevisionAuthor {
    this.lastKnown.delete(userId);
    if (name) {
      this.lastKnown.set(userId, name);
      // Insertion order is recency: the entry refreshed least recently goes first.
      while (this.lastKnown.size > MKTG_DOCUMENT_AUTHOR_CACHE_LIMIT) {
        const oldest = this.lastKnown.keys().next().value;
        if (oldest === undefined) break;
        this.lastKnown.delete(oldest);
      }
    }
    return { name };
  }

  /** A failed lookup serves the last name the directory gave for this subject, if any; a failure is never remembered. */
  private lastKnownAuthor(userId: string): MktgRevisionAuthor {
    return { name: this.lastKnown.get(userId) ?? null };
  }
}
