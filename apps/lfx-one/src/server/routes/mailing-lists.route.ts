// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { Router } from 'express';

import { MailingListController } from '../controllers/mailing-list.controller';

const router = Router();

const mailingListController = new MailingListController();

// Groups.io Service routes
router.get('/services', (req, res, next) => mailingListController.getServices(req, res, next));
router.get('/services/count', (req, res, next) => mailingListController.getServicesCount(req, res, next));
router.get('/services/:id', (req, res, next) => mailingListController.getServiceById(req, res, next));
router.post('/services', (req, res, next) => mailingListController.createService(req, res, next));
router.put('/services/:id', (req, res, next) => mailingListController.updateService(req, res, next));
router.delete('/services/:id', (req, res, next) => mailingListController.deleteService(req, res, next));

// Mailing List routes
router.get('/', (req, res, next) => mailingListController.getMailingLists(req, res, next));
router.get('/count', (req, res, next) => mailingListController.getMailingListsCount(req, res, next));
router.get('/:id', (req, res, next) => mailingListController.getMailingListById(req, res, next));
router.post('/', (req, res, next) => mailingListController.createMailingList(req, res, next));
router.put('/:id', (req, res, next) => mailingListController.updateMailingList(req, res, next));
router.delete('/:id', (req, res, next) => mailingListController.deleteMailingList(req, res, next));

// Mailing List Member routes
router.get('/:id/members', (req, res, next) => mailingListController.getMembers(req, res, next));
router.get('/:id/members/count', (req, res, next) => mailingListController.getMembersCount(req, res, next));
router.get('/:id/members/:memberId', (req, res, next) => mailingListController.getMemberById(req, res, next));
router.post('/:id/members', (req, res, next) => mailingListController.createMember(req, res, next));
router.put('/:id/members/:memberId', (req, res, next) => mailingListController.updateMember(req, res, next));
router.delete('/:id/members/:memberId', (req, res, next) => mailingListController.deleteMember(req, res, next));

export default router;
