// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import express, { Router } from 'express';

import { CommitteeController } from '../controllers/committee.controller';

const router = Router();

const committeeController = new CommitteeController();

// Committee CRUD routes - using new controller pattern
router.get('/', (req, res, next) => committeeController.getCommittees(req, res, next));
router.get('/count', (req, res, next) => committeeController.getCommitteesCount(req, res, next));
router.get('/my-committees', (req, res, next) => committeeController.getMyCommittees(req, res, next));
router.get('/:id', (req, res, next) => committeeController.getCommitteeById(req, res, next));
router.post('/', (req, res, next) => committeeController.createCommittee(req, res, next));
router.put('/:id', (req, res, next) => committeeController.updateCommittee(req, res, next));
router.delete('/:id', (req, res, next) => committeeController.deleteCommittee(req, res, next));

// Committee member routes - now using committee controller
router.get('/:id/members', (req, res, next) => committeeController.getCommitteeMembers(req, res, next));
router.get('/:id/members/:memberId', (req, res, next) => committeeController.getCommitteeMemberById(req, res, next));
router.post('/:id/members', (req, res, next) => committeeController.createCommitteeMember(req, res, next));
router.put('/:id/members/:memberId', (req, res, next) => committeeController.updateCommitteeMember(req, res, next));
router.delete('/:id/members/:memberId', (req, res, next) => committeeController.deleteCommitteeMember(req, res, next));

// ── Sub-groups route ───────────────────────────────────────────────────────
router.get('/:id/children', (req, res, next) => committeeController.getCommitteeChildren(req, res, next));

// ── Document routes (folders + links + file uploads) ─────────────────────
router.get('/:id/documents', (req, res, next) => committeeController.getCommitteeDocuments(req, res, next));
router.post('/:id/documents', (req, res, next) => committeeController.createCommitteeDocument(req, res, next));
// Upload a file document — receives raw binary, BFF forwards multipart/form-data to upstream
router.post('/:id/documents/upload', express.raw({ type: '*/*', limit: '100mb' }), (req, res, next) =>
  committeeController.uploadCommitteeDocument(req, res, next)
);
// Stream a committee document file binary back to the browser with Content-Disposition.
router.get('/:id/documents/:documentId/download', (req, res, next) => committeeController.downloadCommitteeDocument(req, res, next));
router.delete('/:id/documents/:documentId', (req, res, next) => committeeController.deleteCommitteeDocument(req, res, next));

// ── Join / Leave / Application routes ────────────────────────────────────────
router.post('/:id/join', (req, res, next) => committeeController.joinCommittee(req, res, next));
router.delete('/:id/leave', (req, res, next) => committeeController.leaveCommittee(req, res, next));
router.post('/:id/applications', (req, res, next) => committeeController.submitApplication(req, res, next));

export default router;
