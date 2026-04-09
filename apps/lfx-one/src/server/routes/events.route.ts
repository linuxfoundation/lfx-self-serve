// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { EventsController } from '../controllers/events.controller';

const router = Router();
const eventsController = new EventsController();

router.get('/', (req, res, next) => eventsController.getMyEvents(req, res, next));
router.get('/all', (req, res, next) => eventsController.getEvents(req, res, next));
router.get('/organizations', (req, res, next) => eventsController.getEventOrganizations(req, res, next));
router.get('/certificate', (req, res, next) => eventsController.getCertificate(req, res, next));
export default router;
