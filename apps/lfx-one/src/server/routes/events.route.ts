// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { EventsController } from '../controllers/events.controller';

const router = Router();
const eventsController = new EventsController();

router.get('/', (req, res, next) => eventsController.getMyEvents(req, res, next));
router.get('/all', (req, res, next) => eventsController.getEvents(req, res, next));
router.get('/organizations', (req, res, next) => eventsController.getEventOrganizations(req, res, next));
router.get('/countries', (req, res, next) => eventsController.getUpcomingCountries(req, res, next));
router.get('/visa-requests', (req, res, next) => eventsController.getVisaRequests(req, res, next));
router.get('/travel-fund-requests', (req, res, next) => eventsController.getTravelFundRequests(req, res, next));
router.post('/visa-applications', (req, res, next) => eventsController.submitVisaRequestApplication(req, res, next));
router.post('/travel-fund-applications', (req, res, next) => eventsController.submitTravelFundApplication(req, res, next));
router.get('/search-organizations', (req, res, next) => eventsController.searchOrganizations(req, res, next));
router.get('/certificate', (req, res, next) => eventsController.getCertificate(req, res, next));
export default router;
