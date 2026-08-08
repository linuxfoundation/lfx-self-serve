// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { NewsletterPublicationsController } from '../controllers/newsletter-publications.controller';

// `mergeParams: true` so the controller sees `:projectUid` even though the
// sub-router is mounted under `/api/projects/:projectUid/newsletter-publications` in
// server.ts.
const router = Router({ mergeParams: true });
const controller = new NewsletterPublicationsController();

// Authorization is enforced by the downstream lfx-v2-newsletter-service via
// Heimdall + OpenFGA (gates by `project:{project_uid}` from the path) and by
// the corresponding frontend route guards. We don't gate on persona here —
// newsletter publications are accessible to Executive Directors AND project writers.

// Publication list + create.
router.get('/', (req, res, next) => controller.listPublications(req, res, next));
router.post('/', (req, res, next) => controller.createPublication(req, res, next));

// Per-publication CRUD + editions list.
router.get('/:publicationUid', (req, res, next) => controller.getPublication(req, res, next));
router.put('/:publicationUid', (req, res, next) => controller.updatePublication(req, res, next));
router.get('/:publicationUid/editions', (req, res, next) => controller.listPublicationEditions(req, res, next));

export default router;
