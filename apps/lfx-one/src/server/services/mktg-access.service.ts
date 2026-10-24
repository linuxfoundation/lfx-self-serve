// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MktgAccessPerson, MktgAccessResponse, UserInfo } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { isBaseApiError, MicroserviceError, ResourceNotFoundError } from '../errors';
import { logger } from './logger.service';
import { ProjectService } from './project.service';

export class MktgAccessService {
  public constructor(private readonly projects = new ProjectService()) {}

  public async read(req: Request, project: string): Promise<MktgAccessResponse> {
    logger.debug(req, 'mktg_access_settings', 'Reading project access settings', { project });
    try {
      const settings = await this.projects.getProjectSettings(req, project);
      if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw this.unavailable();
      const writers = settings.writers === undefined ? [] : settings.writers;
      if (!Array.isArray(writers)) throw this.unavailable();
      const director = settings.executive_director ?? null;
      const executiveDirector = director === null ? null : this.display(director, true);
      return {
        writers: writers.map((person) => this.display(person, director !== null && this.samePerson(person, director))),
        executiveDirector,
        tocChair: this.resolveTocChair(),
        warnings: [],
      };
    } catch (error) {
      const upstream = isBaseApiError(error) ? error : undefined;
      // Never log upstream messages, bodies or causes: settings errors may contain private email fields.
      logger.warning(req, 'mktg_access_settings', 'Project access settings read failed', {
        project,
        upstream_status: upstream?.statusCode,
        upstream_code: upstream?.code,
      });
      if (error instanceof ResourceNotFoundError) throw error;
      if (upstream && [401, 403, 404].includes(upstream.statusCode)) {
        throw new MicroserviceError('Project access settings are not accessible.', upstream.statusCode, upstream.code, {
          operation: 'mktg_access_settings',
          service: 'mktg_access_service',
          path: '/projects/:uid/settings',
        });
      }
      throw this.unavailable();
    }
  }

  /** Filled by the sibling mktg-project-roles.service.ts resolver, not a second committee lookup. */
  public resolveTocChair(): MktgAccessPerson | null {
    return null;
  }

  private display(person: UserInfo, isExecutiveDirector: boolean): MktgAccessPerson {
    if (!person || typeof person !== 'object' || Array.isArray(person)) throw this.unavailable();
    const name = typeof person.name === 'string' ? person.name.trim() : '';
    const username = typeof person.username === 'string' ? person.username.trim() : '';
    return {
      name: name || username,
      ...(typeof person.avatar === 'string' && person.avatar ? { avatar: person.avatar } : {}),
      ...(typeof person.username === 'string' && person.username ? { username: person.username } : {}),
      isExecutiveDirector,
    };
  }

  private samePerson(a: UserInfo, b: UserInfo): boolean {
    const username = typeof a?.username === 'string' ? a.username.trim().toLowerCase() : '';
    const directorUsername = typeof b.username === 'string' ? b.username.trim().toLowerCase() : '';
    if (username && username === directorUsername) return true;
    const email = typeof a?.email === 'string' ? a.email.trim().toLowerCase() : '';
    const directorEmail = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
    return !!email && email === directorEmail;
  }

  private unavailable(): MicroserviceError {
    return new MicroserviceError('Project access could not be loaded. Try again.', 502, 'MKTG_ACCESS_UNAVAILABLE', {
      operation: 'mktg_access_settings',
      service: 'mktg_access_service',
      path: '/projects/:uid/settings',
    });
  }
}
