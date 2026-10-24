// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MktgAccessPerson, MktgAccessResponse, UserInfo } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { MicroserviceError } from '../errors';
import { logger } from './logger.service';
import { ProjectService } from './project.service';

export class MktgAccessService {
  private readonly projects = new ProjectService();

  public async read(req: Request, project: string): Promise<MktgAccessResponse> {
    logger.debug(req, 'mktg_access_settings', 'Reading project access settings', { project });
    try {
      const settings = await this.projects.getProjectSettings(req, project);
      if (!Array.isArray(settings.writers)) throw new MicroserviceError('Invalid access settings.', 502, 'MKTG_ACCESS_UNAVAILABLE');
      const director = settings.executive_director ?? null;
      return {
        writers: settings.writers.map((person) => this.display(person, !!director && this.samePerson(person, director))),
        executiveDirector: director ? this.display(director, true) : null,
        warnings: [],
      };
    } catch {
      // Do not retain upstream settings payloads or messages: those may include private email fields.
      throw new MicroserviceError('Project access could not be loaded. Try again.', 502, 'MKTG_ACCESS_UNAVAILABLE');
    }
  }

  /** Filled by the sibling mktg-project-roles.service.ts resolver, not a second committee lookup. */
  public resolveTocChair(): MktgAccessPerson | null {
    return null;
  }

  private display(person: UserInfo, isExecutiveDirector: boolean): MktgAccessPerson {
    if (!person || typeof person.name !== 'string') throw new MicroserviceError('Invalid access person.', 502, 'MKTG_ACCESS_UNAVAILABLE');
    return {
      name: person.name,
      ...(typeof person.avatar === 'string' && person.avatar ? { avatar: person.avatar } : {}),
      ...(typeof person.username === 'string' && person.username ? { username: person.username } : {}),
      isExecutiveDirector,
    };
  }

  private samePerson(a: UserInfo, b: UserInfo): boolean {
    const username = a.username?.trim().toLowerCase();
    if (username && username === b.username?.trim().toLowerCase()) return true;
    const email = a.email?.trim().toLowerCase();
    return !!email && email === b.email?.trim().toLowerCase();
  }
}
