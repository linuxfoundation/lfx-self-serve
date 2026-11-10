// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { NewsletterPublicationsController } from '../controllers/newsletter-publications.controller';
import { blockDuringImpersonation } from '../middleware/impersonation-readonly.middleware';

// `mergeParams: true` so the controller sees `:projectUid` from the server.ts mount path.
const router = Router({ mergeParams: true });
const controller = new NewsletterPublicationsController();

// Authorization is enforced by lfx-v2-newsletter-service via Heimdall + OpenFGA (writer_guard on
// writes, auditor_guard on reads, against `project:{project_uid}`). Every write is blocked while
// impersonating, the same as the newsletter routes (#4358 F3).
router.get('/', (req, res, next) => controller.listPublications(req, res, next));
router.post('/', blockDuringImpersonation, (req, res, next) => controller.createPublication(req, res, next));

router.get('/:publicationUid', (req, res, next) => controller.getPublication(req, res, next));
router.put('/:publicationUid', blockDuringImpersonation, (req, res, next) => controller.updatePublication(req, res, next));

router.get('/:publicationUid/editions', (req, res, next) => controller.listEditions(req, res, next));
router.post('/:publicationUid/editions', blockDuringImpersonation, (req, res, next) => controller.createEdition(req, res, next));

export default router;
