import { env } from '../config/env.js';
import { EmployeeProfile, ProfileAudit } from '../models/EmployeeProfile.js';
import { LIST_SECTIONS, OPTIONS, SECRET_FIELDS, SECTION_POLICY } from '../models/profileOptions.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { isPrivileged } from '../utils/access.js';
import { cleanFileName, docInfo } from '../utils/docInfo.js';
import { decryptField, encryptField, mask, profileAad as aad } from '../utils/fieldCrypto.js';
import { contentDisposition, createFileStore, streamFile } from '../utils/gridfs.js';
import { asyncHandler, buildMeta, getPagination, isValidId, ok } from '../utils/helpers.js';
import * as v from '../validators/profile.js';

export const profileFiles = createFileStore('profileFiles');
const FILE_KINDS = ['pdf', 'image', 'word'];
const FILE_LABEL = 'PDF, JPG/PNG or Word';
const USER_FIELDS = 'name employeeCode email contact designation department location branch dateOfJoining dateOfBirth status role avatar manager';
const PERSON = 'name employeeCode designation';
const invalid = (errors) => new ApiError(422, 'Validation failed', errors);

/* ---------------- access ---------------- */

/**
 * Resolves `:userId` ("me" or an id). Employees (and managers) may only ever reach their own profile;
 * anyone else's returns 404 so profiles cannot even be probed. HR / Admin may open every profile.
 */
async function target(req) {
  const raw = req.params.userId;
  const id = raw === 'me' ? String(req.user._id) : raw;
  if (!isValidId(id)) throw ApiError.badRequest('Invalid employee id');
  const self = id === String(req.user._id);
  if (!self && !isPrivileged(req.user)) throw ApiError.notFound('Profile not found');
  const user = await User.findById(id).select(USER_FIELDS);
  if (!user) throw ApiError.notFound('Profile not found');
  return { user, self };
}

/**
 * Edit rights for one section of one profile.
 *  - self-service sections: the employee themselves, plus HR/Admin
 *  - HR-managed sections (personal, bank, statutory, documents): HR/Admin only
 * Mirrors Employee Management: only an Admin may change data of HR/Admin accounts, so HR cannot edit their own
 * HR-managed details (e.g. their own bank account) or another HR user's — separation of duties.
 */
function canEdit(req, target, self, section) {
  const actor = req.user;
  const selfService = SECTION_POLICY[section] === 'self';
  if (actor.role === 'admin') return true;
  if (selfService && self) return true;
  if (actor.role !== 'hr') return false;
  return !self && !['hr', 'admin'].includes(target.role);
}

function assertCanEdit(req, target, self, section) {
  if (!canEdit(req, target, self, section)) {
    const hrOwn = req.user.role === 'hr' && (self || ['hr', 'admin'].includes(target.role));
    throw ApiError.forbidden(hrOwn
      ? 'Only an Admin can change HR-managed details of HR or Admin accounts (including your own).'
      : SECTION_POLICY[section] === 'hr'
        ? 'Only HR or Admin can change these details. Please raise a ticket with HR if something needs correcting.'
        : 'You do not have permission to change this profile');
  }
}

async function loadProfile(userId) {
  return (await EmployeeProfile.findOne({ user: userId })) || new EmployeeProfile({ user: userId });
}

function plainSecret(profile, section, field) {
  const stored = profile[section]?.[field];
  if (!stored) return '';
  try {
    return decryptField(stored, aad(profile.user, field));
  } catch {
    console.error(`Profile ${profile._id}: ${section}.${field} failed its integrity check`);
    return '';
  }
}

function touch(profile, section, actor) {
  profile.sectionMeta.set(section, { updatedBy: actor._id, updatedAt: new Date() });
}
const audit = (userId, actor, section, action, fields = []) => ProfileAudit.create({ user: userId, actor: actor._id, section, action, fields });

/* ---------------- presentation ---------------- */

const fileOut = (f) => (f ? { id: String(f._id), fileName: f.fileName, mimeType: f.mimeType, kind: f.kind, size: f.size, uploadedAt: f.uploadedAt } : null);
const rows = (list = []) => list.map((r) => {
  const { _id, attachment, ...rest } = r;
  return { id: String(_id), ...rest, ...(attachment !== undefined ? { attachment: fileOut(attachment) } : {}) };
});

function months(from, to) {
  if (!from) return 0;
  const a = new Date(from);
  const b = to ? new Date(to) : new Date();
  return Math.max(0, (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()));
}

async function present(req, user, self) {
  const profile = await EmployeeProfile.findOne({ user: user._id })
    .populate('employment.hod employment.adminManager', PERSON)
    .populate({ path: 'sectionMeta.$*.updatedBy', select: 'name' });
  const p = profile ?? new EmployeeProfile({ user: user._id });
  await user.populate('manager', PERSON);

  const o = p.toObject({ flattenMaps: true });
  const secretView = (section) => {
    const out = { ...(o[section] ?? {}) };
    const set = [];
    for (const f of SECRET_FIELDS[section]) {
      const plain = plainSecret(p, section, f);
      out[f] = plain ? mask(plain) : '';
      if (plain) set.push(f);
    }
    return { ...out, revealable: set };
  };

  const meta = {};
  for (const [k, m] of Object.entries(o.sectionMeta ?? {})) meta[k] = { updatedAt: m.updatedAt, updatedBy: m.updatedBy?.name ? { id: String(m.updatedBy._id), name: m.updatedBy.name } : null };

  const prevMonths = (p.experience ?? []).reduce((a, e) => a + months(e.fromDate, e.toDate), 0);
  const currentMonths = months(user.dateOfJoining);
  const emp = o.employment ?? {};
  const person = (x) => (x && x.name ? { id: String(x._id), name: x.name, employeeCode: x.employeeCode, designation: x.designation } : null);

  return {
    user: user.toJSON(),
    general: o.general ?? {},
    employment: { ...emp, hod: person(emp.hod), adminManager: person(emp.adminManager) },
    contact: o.contact ?? {},
    bank: secretView('bank'),
    statutory: secretView('statutory'),
    documents: (p.documents ?? []).map((d) => ({ type: d.type, file: fileOut(d.file) })),
    experience: rows(o.experience),
    education: rows(o.education),
    family: rows(o.family),
    languages: rows(o.languages),
    hobbies: rows(o.hobbies),
    summary: {
      currentTenureMonths: currentMonths,
      previousExperienceMonths: prevMonths,
      totalExperienceMonths: prevMonths + currentMonths,
      previousCompanies: (p.experience ?? []).length,
    },
    sectionMeta: meta,
    isSelf: self,
    permissions: Object.fromEntries(Object.keys(SECTION_POLICY).map((s) => [s, canEdit(req, user, self, s) ? 'edit' : 'view'])),
    updatedAt: p.updatedAt ?? null,
  };
}

/* ---------------- read ---------------- */

export const options = asyncHandler(async (req, res) => {
  const data = { ...OPTIONS, policy: SECTION_POLICY };
  if (isPrivileged(req.user)) data.people = await User.find({ status: 'active' }).select(PERSON).sort({ name: 1 });
  ok(res, data);
});

export const getProfile = asyncHandler(async (req, res) => {
  const { user, self } = await target(req);
  ok(res, await present(req, user, self));
});

export const history = asyncHandler(async (req, res) => {
  const { user } = await target(req);
  const { page, limit, skip } = getPagination(req.query, { defaultLimit: 20, maxLimit: 50 });
  const [items, total] = await Promise.all([
    ProfileAudit.find({ user: user._id }).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('actor', 'name role'),
    ProfileAudit.countDocuments({ user: user._id }),
  ]);
  ok(res, items, { meta: buildMeta(page, limit, total) });
});

/** Full value of one masked field, for the eye icon. Owner or HR/Admin; every reveal is audited. */
export const reveal = asyncHandler(async (req, res) => {
  const { user } = await target(req);
  const { field } = req.body;
  const section = Object.keys(SECRET_FIELDS).find((s) => SECRET_FIELDS[s].includes(field));
  const profile = await EmployeeProfile.findOne({ user: user._id });
  const value = profile ? plainSecret(profile, section, field) : '';
  if (!value) throw ApiError.notFound('No value saved');
  await audit(user._id, req.user, section, 'reveal', [field]);
  res.set('Cache-Control', 'no-store');
  ok(res, { field, value });
});

/* ---------------- object sections ---------------- */

/** Comparable form of a stored or submitted value (dates, ObjectIds, populated refs, nested objects). */
function norm(x) {
  if (x === undefined || x === null || x === '') return null;
  if (x instanceof Date) return x.toISOString();
  if (typeof x === 'object' && typeof x.toHexString === 'function') return x.toHexString();
  if (typeof x === 'object' && x._id) return String(x._id);
  if (Array.isArray(x)) return x.map(norm);
  if (typeof x === 'object') return Object.fromEntries(Object.entries(x).filter(([k]) => k !== '_id').map(([k, y]) => [k, norm(y)]));
  return x;
}
const same = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));
const changedKeys = (before, after) => Object.keys(after).filter((k) => !same(before?.[k], after[k]));
/** Plain copy of one section (nested Mongoose paths have no toObject of their own). */
const sectionOf = (profile, section) => profile.toObject({ depopulate: true })[section] ?? {};

const SECTION_SCHEMA = { general: v.general, contact: v.contact, bank: v.bank, statutory: v.statutory };
const USER_MAP = { mobile: 'contact', designation: 'designation', department: 'department', location: 'location', branch: 'branch', dateOfJoining: 'dateOfJoining', dateOfBirth: 'dateOfBirth', manager: 'manager' };
const EMPLOYMENT_KEYS = ['businessUnit', 'company', 'plant', 'headquarters', 'subDepartment', 'division', 'function', 'grade', 'personType', 'employmentCategory', 'costCenter', 'position', 'groupDateOfJoining', 'shiftStart', 'shiftEnd', 'hod', 'adminManager'];

export const updateSection = asyncHandler(async (req, res) => {
  const { section } = req.params;
  const schema = SECTION_SCHEMA[section];
  if (!schema) throw ApiError.notFound('Unknown profile section');
  const { user, self } = await target(req);
  assertCanEdit(req, user, self, section);
  const body = schema.parse(req.body ?? {});
  const profile = await loadProfile(user._id);
  let fields = [];

  if (section === 'general') {
    // people references must exist
    for (const k of ['manager', 'hod', 'adminManager']) {
      if (body[k]) {
        if (body[k] === String(user._id)) throw invalid({ [k]: 'An employee cannot report to themselves' });
        if (!(await User.exists({ _id: body[k] }))) throw invalid({ [k]: 'Employee not found' });
      }
    }
    const personal = {};
    const employment = {};
    const userPatch = {};
    for (const [k, val] of Object.entries(body)) {
      if (USER_MAP[k]) userPatch[USER_MAP[k]] = val;
      else if (EMPLOYMENT_KEYS.includes(k)) employment[k] = val;
      else personal[k] = val;
    }
    const curGeneral = sectionOf(profile, 'general');
    const curEmployment = sectionOf(profile, 'employment');
    fields = [...changedKeys(curGeneral, personal), ...changedKeys(curEmployment, employment)];
    profile.set('general', { ...curGeneral, ...personal });
    profile.set('employment', { ...curEmployment, ...employment });
    // the display name follows first / middle / last name
    const g = profile.general;
    const fullName = [g.firstName, g.middleName, g.lastName].map((x) => (x || '').trim()).filter(Boolean).join(' ');
    if (fullName && fullName !== user.name) userPatch.name = fullName;
    const userChanged = changedKeys(user.toObject({ depopulate: true }), userPatch);
    if (userChanged.length) {
      user.set(userPatch);
      await user.save();
      fields.push(...userChanged.map((k) => (k === 'contact' ? 'mobile' : k)));
    }
  } else {
    const current = sectionOf(profile, section);
    const next = { ...current };
    for (const [k, val] of Object.entries(body)) {
      if ((SECRET_FIELDS[section] ?? []).includes(k)) {
        const before = plainSecret(profile, section, k);
        if (val === before) continue;
        next[k] = val ? encryptField(val, aad(user._id, k)) : '';
        fields.push(k);
      } else {
        if (!same(current[k], val)) fields.push(k);
        next[k] = val;
      }
    }
    if (section === 'contact' && next.sameAsPermanent) next.correspondenceAddress = { ...(next.permanentAddress ?? {}) };
    profile.set(section, next);
  }

  if (fields.length) {
    touch(profile, section, req.user);
    await profile.save();
    await audit(user._id, req.user, section, 'update', [...new Set(fields)]);
  }
  ok(res, await present(req, user, self), { message: fields.length ? 'Profile updated successfully' : 'No changes to save' });
});

/* ---------------- list sections (experience, education, family, languages, hobbies) ---------------- */

async function storeAttachment(req, userId) {
  const f = req.files?.[0];
  if (!f) return null;
  const info = docInfo(f.buffer, f.originalname);
  if (!info || !FILE_KINDS.includes(info.kind)) throw invalid({ attachment: `Attach a ${FILE_LABEL} file (max ${env.ticketAttachmentMaxMb} MB)` });
  const fileName = cleanFileName(f.originalname);
  const fileId = await profileFiles.put(f.buffer, { filename: fileName, contentType: info.mime, metadata: { user: userId } });
  return { fileId, fileName, mimeType: info.mime, kind: info.kind, size: f.size, uploadedBy: req.user._id };
}

function listSection(req) {
  const { section } = req.params;
  if (!LIST_SECTIONS.includes(section)) throw ApiError.notFound('Unknown profile section');
  return section;
}

export const addItem = asyncHandler(async (req, res) => {
  const section = listSection(req);
  const { user, self } = await target(req);
  assertCanEdit(req, user, self, section);
  const { removeAttachment, ...data } = v.listItems[section].parse(req.body ?? {}); // eslint-disable-line no-unused-vars
  if (req.files?.length && !['experience', 'education'].includes(section)) throw invalid({ attachment: 'This section does not take attachments' });
  const profile = await loadProfile(user._id);
  if ((profile[section] ?? []).length >= 50) throw invalid({ [section]: 'You can add at most 50 entries' });
  const attachment = await storeAttachment(req, user._id);
  try {
    profile[section].push({ ...data, ...(attachment ? { attachment } : {}) });
    touch(profile, section, req.user);
    await profile.save();
  } catch (err) {
    if (attachment) await profileFiles.remove([attachment.fileId]);
    throw err;
  }
  await audit(user._id, req.user, section, 'add', Object.keys(data));
  ok(res, await present(req, user, self), { message: 'Added successfully' }, 201);
});

async function loadItem(req, section) {
  const { user, self } = await target(req);
  assertCanEdit(req, user, self, section);
  if (!isValidId(req.params.itemId)) throw ApiError.badRequest('Invalid entry id');
  const profile = await EmployeeProfile.findOne({ user: user._id });
  const item = profile?.[section].id(req.params.itemId);
  if (!item) throw ApiError.notFound('Entry not found');
  return { user, self, profile, item };
}

export const updateItem = asyncHandler(async (req, res) => {
  const section = listSection(req);
  const { user, self, profile, item } = await loadItem(req, section);
  const { removeAttachment, ...data } = v.listItems[section].parse(req.body ?? {});
  const attachment = await storeAttachment(req, user._id);
  const old = item.attachment?.fileId;
  try {
    item.set(data);
    if (attachment) item.attachment = attachment;
    else if (removeAttachment) item.attachment = null;
    touch(profile, section, req.user);
    await profile.save();
  } catch (err) {
    if (attachment) await profileFiles.remove([attachment.fileId]);
    throw err;
  }
  if (old && (attachment || removeAttachment)) await profileFiles.remove([old]);
  await audit(user._id, req.user, section, 'edit', Object.keys(data));
  ok(res, await present(req, user, self), { message: 'Updated successfully' });
});

export const removeItem = asyncHandler(async (req, res) => {
  const section = listSection(req);
  const { user, self, profile, item } = await loadItem(req, section);
  const fileId = item.attachment?.fileId;
  item.deleteOne();
  touch(profile, section, req.user);
  await profile.save();
  if (fileId) await profileFiles.remove([fileId]);
  await audit(user._id, req.user, section, 'remove');
  ok(res, await present(req, user, self), { message: 'Removed' });
});

/* ---------------- identity documents (HR / Admin) ---------------- */

export const uploadDocument = asyncHandler(async (req, res) => {
  const { user, self } = await target(req);
  assertCanEdit(req, user, self, 'documents');
  const { type } = req.params;
  if (!OPTIONS.documentTypes.some((d) => d.value === type)) throw ApiError.notFound('Unknown document type');
  if (!req.files?.length) throw invalid({ file: 'Choose a file to upload' });
  const profile = await loadProfile(user._id);
  const file = await storeAttachment(req, user._id);
  const existing = profile.documents.find((d) => d.type === type);
  const old = existing?.file?.fileId;
  if (existing) existing.file = file;
  else profile.documents.push({ type, file });
  touch(profile, 'documents', req.user);
  try {
    await profile.save();
  } catch (err) {
    await profileFiles.remove([file.fileId]);
    throw err;
  }
  if (old) await profileFiles.remove([old]);
  await audit(user._id, req.user, 'documents', 'upload', [type]);
  ok(res, await present(req, user, self), { message: 'Document uploaded' });
});

export const removeDocument = asyncHandler(async (req, res) => {
  const { user, self } = await target(req);
  assertCanEdit(req, user, self, 'documents');
  const profile = await EmployeeProfile.findOne({ user: user._id });
  const doc = profile?.documents.find((d) => d.type === req.params.type);
  if (!doc) throw ApiError.notFound('Document not found');
  const fileId = doc.file?.fileId;
  doc.deleteOne();
  touch(profile, 'documents', req.user);
  await profile.save();
  if (fileId) await profileFiles.remove([fileId]);
  await audit(user._id, req.user, 'documents', 'delete', [req.params.type]);
  ok(res, await present(req, user, self), { message: 'Document removed' });
});

/** Download any file on the profile (attachments, ID documents). Owner or HR/Admin. */
export const file = asyncHandler(async (req, res, next) => {
  const { user } = await target(req);
  if (!isValidId(req.params.fileId)) throw ApiError.badRequest('Invalid file id');
  const profile = await EmployeeProfile.findOne({ user: user._id });
  const id = req.params.fileId;
  const found = [
    ...(profile?.documents ?? []).map((d) => d.file),
    ...(profile?.experience ?? []).map((e) => e.attachment),
    ...(profile?.education ?? []).map((e) => e.attachment),
  ].find((f) => f && String(f._id) === id);
  if (!found) throw ApiError.notFound('File not found');
  const inline = req.query.inline === 'true' && (found.kind === 'pdf' || found.kind === 'image');
  res.status(200).set({
    'Content-Type': found.mimeType,
    'Content-Length': String(found.size),
    'Content-Disposition': contentDisposition(found.fileName, inline ? 'inline' : 'attachment'),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  });
  streamFile(profileFiles, found.fileId, res, next, ApiError.notFound('File not found'));
});
