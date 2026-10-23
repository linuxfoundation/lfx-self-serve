// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MktgRevisionAuthor } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { AuthenticationError } from '../errors';
import { getEffectiveSub, isImpersonating } from '../utils/auth-helper';
import { logger } from './logger.service';
import type { UserService } from './user.service';

/** One attribution policy for revisions and comments; share the instance within a document request flow. */
export class MktgDocumentAuthorService {
  private readonly authors = new WeakMap<Request, Map<string, Promise<MktgRevisionAuthor>>>();
  private userService?: Promise<UserService>;

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
            return { name: null };
          }
          return { name: response.data?.name || null };
        } catch (err) {
          logger.warning(req, operation, message, { err });
          return { name: null };
        }
      })();
      authors.set(userId, author);
    }
    return author;
  }
}
