import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { authorize, protect } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as auth from '../controllers/authController.js';
import * as emp from '../controllers/employeeController.js';
import * as att from '../controllers/attendanceController.js';
import { candidates, confirmations, manpower } from '../controllers/hrController.js';
import { announcements, holidays } from '../controllers/contentController.js';
import { dashboard } from '../controllers/dashboardController.js';
import * as slips from '../controllers/salarySlipController.js';
import * as gallery from '../controllers/galleryController.js';
import * as policies from '../controllers/policyController.js';
import * as tickets from '../controllers/ticketController.js';
import * as ticketSettings from '../controllers/ticketSettingsController.js';
import { uploadDocs, uploadImage, uploadPdf } from '../middleware/upload.js';
import * as policyV from '../validators/policy.js';
import * as ticketV from '../validators/ticket.js';
import * as profiles from '../controllers/profileController.js';
import * as profileV from '../validators/profile.js';
import * as pal from '../controllers/appraisalLetterController.js';
import * as form16 from '../controllers/form16Controller.js';
import * as docV from '../validators/employeeDocs.js';
import * as galleryV from '../validators/gallery.js';
import * as salary from '../validators/salary.js';
import { reviewSchema } from '../validators/common.js';
import * as core from '../validators/core.js';
import * as hr from '../validators/hr.js';
import { compOffRoutes, leaveRoutes, regularizationRoutes, travelExpenseRoutes, visitorRoutes } from './requests.js';

const router = Router();

router.get('/health', (_req, res) => res.json({ success: true, status: 'ok', uptime: process.uptime() }));

router.get('/ready', (_req, res) => {
  const up = mongoose.connection.readyState === 1;
  res.status(up ? 200 : 503).json({ success: up, status: up ? 'ready' : 'database unavailable' });
});

/* ---- Auth ---- */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: env.isTest ? 10_000 : 30, standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: 'Too many attempts. Please try again in a few minutes.' },
});
router.post('/auth/login', authLimiter, validate(core.loginSchema), auth.login);
router.post('/auth/register', authLimiter, validate(core.registerSchema), auth.register);
router.get('/auth/me', protect, auth.me);
router.put('/auth/profile', protect, validate(core.profileSchema), auth.updateProfile);
router.patch('/auth/profile', protect, validate(core.profileSchema), auth.updateProfile);
router.post('/auth/change-password', protect, validate(core.changePasswordSchema), auth.changePassword);
router.post('/auth/logout', protect, auth.logout);

/* ---- Dashboard ---- */
router.get('/dashboard', protect, dashboard);

/* ---- Employees ---- */
const e = Router();
e.use(protect);
e.get('/', emp.list);
e.get('/filters', emp.filters);
e.get('/team-chart', emp.teamChart);
e.post('/', authorize('hr', 'admin'), validate(core.employeeCreate), emp.create);
e.get('/:id', emp.getOne);
e.put('/:id', authorize('hr', 'admin'), validate(core.employeeUpdate), emp.update);
e.patch('/:id', authorize('hr', 'admin'), validate(core.employeeUpdate), emp.update);
e.patch('/:id/status', authorize('hr', 'admin'), validate(core.employeeStatusSchema), emp.setStatus);
e.patch('/:id/leave-balance', authorize('hr', 'admin'), validate(core.balanceSchema), emp.updateBalance);
e.post('/:id/reset-password', authorize('hr', 'admin'), validate(core.resetPasswordSchema), emp.resetPassword);
e.delete('/:id', authorize('admin'), emp.remove);
router.use('/employees', e);

/* ---- Attendance ---- */
const a = Router();
a.use(protect);
a.get('/', att.list);
a.get('/today', att.today);
a.get('/summary', att.summary);
a.post('/punch-in', att.punchIn);
a.post('/punch-out', att.punchOut);
a.post('/', authorize('hr', 'admin'), validate(hr.attendanceManual), att.createManual);
a.put('/:id', authorize('hr', 'admin'), validate(hr.attendanceManualUpdate), att.updateManual);
a.patch('/:id', authorize('hr', 'admin'), validate(hr.attendanceManualUpdate), att.updateManual);
a.delete('/:id', authorize('admin'), att.remove);
router.use('/attendance', a);

/* ---- Request style resources ---- */
router.use('/leaves', leaveRoutes);
router.use('/comp-offs', compOffRoutes);
router.use('/regularizations', regularizationRoutes);
router.use('/visitors', visitorRoutes);
router.use('/travel-expenses', travelExpenseRoutes);

/* ---- Manpower ---- */
const m = Router();
m.use(protect);
m.get('/', manpower.list);
m.post('/', validate(hr.manpowerCreate), manpower.create);
m.get('/:id', manpower.getOne);
m.put('/:id', validate(hr.manpowerUpdate), manpower.update);
m.patch('/:id', validate(hr.manpowerUpdate), manpower.update);
m.patch('/:id/status', validate(reviewSchema(['approved', 'rejected', 'closed'])), manpower.review);
m.delete('/:id', manpower.remove);
router.use('/manpower-requisitions', m);

const c = Router();
c.use(protect);
c.get('/', candidates.list);
c.post('/', validate(hr.candidateCreate), candidates.create);
c.put('/:id', validate(hr.candidateUpdate), candidates.update);
c.patch('/:id', validate(hr.candidateUpdate), candidates.update);
c.patch('/:id/decision', validate(hr.candidateDecision), candidates.decide);
c.patch('/:id/evaluate', validate(hr.candidateEvaluate), candidates.evaluate);
c.delete('/:id', candidates.remove);
router.use('/candidates', c);

/* ---- Confirmations ---- */
const cf = Router();
cf.use(protect);
cf.get('/', confirmations.list);
cf.post('/', validate(hr.confirmationCreate), confirmations.create);
cf.get('/:id', confirmations.getOne);
cf.put('/:id', validate(hr.confirmationUpdate), confirmations.update);
cf.patch('/:id', validate(hr.confirmationUpdate), confirmations.update);
cf.patch('/:id/status', validate(hr.confirmationReview), confirmations.review);
cf.delete('/:id', confirmations.remove);
router.use('/confirmations', cf);

/* ---- Salary slips ----
   /my and :id/download are available to the owner; management routes are HR/Admin only.
   Authorization runs BEFORE the upload parser so unauthorised callers can never push a file. */
const sl = Router();
sl.use(protect);
sl.get('/my', validate(salary.salaryMyQuery, 'query'), slips.mine);
sl.get('/', authorize('hr', 'admin'), validate(salary.salaryListQuery, 'query'), slips.list);
sl.post('/', authorize('hr', 'admin'), uploadPdf, validate(salary.salaryCreate), slips.create);
sl.get('/:id', slips.getOne);
sl.get('/:id/download', validate(salary.downloadQuery, 'query'), slips.download);
sl.put('/:id', authorize('hr', 'admin'), uploadPdf, validate(salary.salaryReplace), slips.replace);
sl.delete('/:id', authorize('hr', 'admin'), slips.remove);
router.use('/salary-slips', sl);

/* ---- Holidays & announcements ---- */
const h = Router();
h.use(protect);
h.get('/', holidays.list);
h.post('/', authorize('hr', 'admin'), validate(hr.holidayCreate), holidays.create);
h.put('/:id', authorize('hr', 'admin'), validate(hr.holidayUpdate), holidays.update);
h.delete('/:id', authorize('hr', 'admin'), holidays.remove);
router.use('/holidays', h);

const an = Router();
an.use(protect);
an.get('/', announcements.list);
an.post('/', authorize('hr', 'admin'), validate(hr.announcementCreate), announcements.create);
an.put('/:id', authorize('hr', 'admin'), validate(hr.announcementUpdate), announcements.update);
an.delete('/:id', authorize('hr', 'admin'), announcements.remove);
router.use('/announcements', an);

/* ---- Photo gallery ----
   Everyone signed in can view and download; only HR and Admin can create, edit or delete.
   Image bytes are served from a signed, expiring URL (an <img> tag cannot send the bearer token),
   so that one route sits outside `protect` and is authorised by its signature instead. */
router.get('/gallery/photos/:id/file', validate(galleryV.fileQuery, 'query'), gallery.file);

const g = Router();
g.use(protect);
const galleryAdmin = authorize('hr', 'admin');
g.get('/stats', gallery.stats);
g.get('/albums', validate(galleryV.albumListQuery, 'query'), gallery.listAlbums);
g.post('/albums', galleryAdmin, validate(galleryV.albumCreate), gallery.createAlbum);
g.get('/albums/:id', gallery.getAlbum);
g.put('/albums/:id', galleryAdmin, validate(galleryV.albumUpdate), gallery.updateAlbum);
g.patch('/albums/:id', galleryAdmin, validate(galleryV.albumUpdate), gallery.updateAlbum);
g.delete('/albums/:id', galleryAdmin, gallery.removeAlbum);
// authorise BEFORE parsing the upload so unauthorised callers can never push bytes into memory
g.post('/albums/:id/photos', galleryAdmin, uploadImage, validate(galleryV.photoCreate), gallery.uploadPhoto);
g.get('/photos', validate(galleryV.photoListQuery, 'query'), gallery.listPhotos);
g.post('/photos/bulk-delete', galleryAdmin, validate(galleryV.bulkDelete), gallery.bulkRemovePhotos);
g.get('/photos/:id', gallery.getPhoto);
g.put('/photos/:id', galleryAdmin, validate(galleryV.photoUpdate), gallery.updatePhoto);
g.patch('/photos/:id', galleryAdmin, validate(galleryV.photoUpdate), gallery.updatePhoto);
g.delete('/photos/:id', galleryAdmin, gallery.removePhoto);
router.use('/gallery', g);

/* ---- HR policies ----
   Everyone signed in can browse, preview and download. Only HR and Admin can create folders, upload,
   edit, add versions or delete (checked before any upload is parsed). */
const hrOnly = authorize('hr', 'admin');
const policyUpload = uploadDocs({ field: 'file', maxCount: 1, maxMb: env.policyMaxMb });
const pol = Router();
pol.use(protect);
pol.get('/stats', policies.stats);
pol.get('/categories', policies.listCategories);
pol.post('/categories', hrOnly, validate(policyV.categoryCreate), policies.createCategory);
pol.put('/categories/:id', hrOnly, validate(policyV.categoryUpdate), policies.updateCategory);
pol.patch('/categories/:id', hrOnly, validate(policyV.categoryUpdate), policies.updateCategory);
pol.delete('/categories/:id', hrOnly, policies.removeCategory);
pol.get('/', validate(policyV.policyListQuery, 'query'), policies.listPolicies);
pol.post('/', hrOnly, policyUpload, validate(policyV.policyCreate), policies.createPolicy);
pol.get('/:id', policies.getPolicy);
pol.put('/:id', hrOnly, validate(policyV.policyUpdate), policies.updatePolicy);
pol.patch('/:id', hrOnly, validate(policyV.policyUpdate), policies.updatePolicy);
pol.delete('/:id', hrOnly, policies.removePolicy);
pol.post('/:id/versions', hrOnly, policyUpload, validate(policyV.versionCreate), policies.addVersion);
pol.delete('/:id/versions/:versionId', hrOnly, policies.removeVersion);
pol.get('/:id/download', validate(policyV.downloadQuery, 'query'), policies.download);
router.use('/policies', pol);

/* ---- Support tickets ----
   Everyone can raise tickets, see their own, reply and attach files. HR and Admin see all tickets, assign,
   change status / priority, add internal notes and manage categories and priorities. */
const ticketUpload = uploadDocs({ field: 'attachments', maxCount: env.ticketMaxFiles, maxMb: env.ticketAttachmentMaxMb });
const tk = Router();
tk.use(protect);
tk.get('/meta', tickets.meta);
tk.get('/stats', validate(ticketV.statsQuery, 'query'), tickets.stats);
tk.get('/settings/categories', hrOnly, ticketSettings.listCategories);
tk.post('/settings/categories', hrOnly, validate(ticketV.categoryCreate), ticketSettings.createCategory);
tk.patch('/settings/categories/:id', hrOnly, validate(ticketV.categoryUpdate), ticketSettings.updateCategory);
tk.delete('/settings/categories/:id', hrOnly, ticketSettings.removeCategory);
tk.get('/settings/priorities', hrOnly, ticketSettings.listPriorities);
tk.post('/settings/priorities', hrOnly, validate(ticketV.priorityCreate), ticketSettings.createPriority);
tk.patch('/settings/priorities/:id', hrOnly, validate(ticketV.priorityUpdate), ticketSettings.updatePriority);
tk.delete('/settings/priorities/:id', hrOnly, ticketSettings.removePriority);
tk.get('/', validate(ticketV.ticketListQuery, 'query'), tickets.list);
tk.post('/', ticketUpload, validate(ticketV.ticketCreate), tickets.create);
tk.get('/:id', tickets.getOne);
tk.post('/:id/comments', ticketUpload, validate(ticketV.commentCreate), tickets.addComment);
tk.patch('/:id/assign', hrOnly, validate(ticketV.assignBody), tickets.assign);
tk.patch('/:id/status', hrOnly, validate(ticketV.statusBody), tickets.changeStatus);
tk.patch('/:id/priority', hrOnly, validate(ticketV.priorityBody), tickets.changePriority);
tk.patch('/:id/cancel', validate(ticketV.cancelBody), tickets.cancel);
tk.get('/:id/attachments/:attachmentId', validate(ticketV.attachmentQuery, 'query'), tickets.attachment);
router.use('/tickets', tk);

/* ---- Employee profiles (My Profile) ----
   :userId is "me" or an employee id. Employees only ever reach their own profile (others 404).
   Per-section edit rights come from SECTION_POLICY: general, bank, statutory and documents are HR/Admin only;
   contact, experience, education, family, languages and hobbies are self-service. */
const profileUpload = uploadDocs({ field: 'attachment', maxCount: 1, maxMb: env.ticketAttachmentMaxMb });
const documentUpload = uploadDocs({ field: 'file', maxCount: 1, maxMb: env.ticketAttachmentMaxMb });
const pr = Router();
pr.use(protect);
pr.get('/options', profiles.options);
pr.get('/:userId', profiles.getProfile);
pr.get('/:userId/history', validate(profileV.historyQuery, 'query'), profiles.history);
pr.post('/:userId/reveal', validate(profileV.revealBody), profiles.reveal);
pr.get('/:userId/files/:fileId', profiles.file);
pr.put('/:userId/documents/:type', hrOnly, documentUpload, profiles.uploadDocument);
pr.delete('/:userId/documents/:type', hrOnly, profiles.removeDocument);
pr.put('/:userId/:section(general|contact|bank|statutory)', profiles.updateSection);
pr.post('/:userId/:section(experience|education|family|languages|hobbies)', profileUpload, profiles.addItem);
pr.put('/:userId/:section(experience|education|family|languages|hobbies)/:itemId', profileUpload, profiles.updateItem);
pr.delete('/:userId/:section(experience|education|family|languages|hobbies)/:itemId', profiles.removeItem);
router.use('/profiles', pr);

/* ---- Performance Appraisal Letters (PAL) & Form 16 Part A / Part B ----
   Employees: /my (always filtered to the caller), /:id and /:id/download for their OWN records — any other id is a 404.
   HR & Admin: list/search all records, add, edit (metadata and/or replace the PDF) and delete.
   Authorization runs BEFORE the upload parser so unauthorised callers can never push a file. */
for (const [path, c, v] of [
  ['/appraisal-letters', pal, { my: docV.palMyQuery, list: docV.palListQuery, create: docV.palCreate, update: docV.palUpdate }],
  ['/form16', form16, { my: docV.form16MyQuery, list: docV.form16ListQuery, create: docV.form16Create, update: docV.form16Update }],
]) {
  const r = Router();
  r.use(protect);
  r.get('/options', c.options);
  r.get('/my', validate(v.my, 'query'), c.mine);
  r.get('/', hrOnly, validate(v.list, 'query'), c.list);
  r.post('/', hrOnly, uploadPdf, validate(v.create), c.create);
  r.get('/:id', c.getOne);
  r.get('/:id/download', validate(docV.downloadQuery, 'query'), c.download);
  r.put('/:id', hrOnly, uploadPdf, validate(v.update), c.update);
  r.delete('/:id', hrOnly, c.remove);
  router.use(path, r);
}

export default router;
