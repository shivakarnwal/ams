import mongoose from 'mongoose';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { cleanFileName, docInfo } from '../utils/docInfo.js';
import { decryptBuffer, encryptBuffer, sha256 } from '../utils/fileCrypto.js';
import { contentDisposition } from '../utils/gridfs.js';
import { asyncHandler, buildMeta, escapeRegex, getPagination, isValidId, ok } from '../utils/helpers.js';
import { isPrivileged } from '../utils/access.js';

/**
 * Shared engine for per-employee confidential PDF documents (Performance Appraisal Letters, Form 16 Part A/B).
 *
 * Security model
 *  - Every route requires a valid JWT (router level).
 *  - Management routes (list all / create / update / delete) are HR & Admin only (router level, before the upload parser).
 *  - Read routes (get one / download) load the record and then check: HR/Admin, or record.employee === caller.
 *    Anyone else receives 404, so changing an id in the URL reveals nothing — not even that the record exists.
 *  - "My" listings are always filtered by the caller's own id; there is no parameter that can widen them.
 *  - Files must be real PDFs (extension + magic bytes), are encrypted at rest with AES-256-GCM, and the ciphertext is
 *    bound to its record id (AAD), so a blob copied onto another record cannot be decrypted.
 */

const EMP_POP = { path: 'employee', select: 'name employeeCode designation department email' };
const USER_POP = { path: 'uploadedBy updatedBy', select: 'name' };
const FILE_FIELDS = '+data +iv +authTag';

const invalid = (errors) => new ApiError(422, 'Validation failed', errors);
export const safeCode = (c) => String(c ?? '').replace(/[^A-Za-z0-9_-]/g, '') || 'EMP';

function readPdf(req, { required }) {
  const f = req.file;
  if (!f) {
    if (required) throw invalid({ file: 'PDF file is required' });
    return null;
  }
  if (!f.size) throw invalid({ file: 'The selected file is empty' });
  const info = docInfo(f.buffer, f.originalname || '');
  if (!info || info.kind !== 'pdf') throw invalid({ file: 'Only valid PDF files are allowed' });
  return f;
}

/** Turns an ISO day ("2025-04-01") or '' into a Date / null. */
const toDay = (v) => (v === '' ? null : v === undefined ? undefined : new Date(`${v}T00:00:00Z`));

/**
 * @param {object} cfg
 * @param {import('mongoose').Model} cfg.Model
 * @param {string} cfg.noun            Human name used in messages ("appraisal letter")
 * @param {string} cfg.aad             AAD prefix for the encryption binding
 * @param {object} cfg.sort            Default sort
 * @param {string[]} cfg.fields        Editable body fields (besides employee)
 * @param {string[]} [cfg.dateFields]  Body fields that are ISO days
 * @param {string[]} [cfg.searchFields] Record fields matched by ?q= (in addition to employee name / code)
 * @param {(q: object) => object} cfg.filterFrom   Query → Mongo filter (period / part filters)
 * @param {(doc: object, emp: object) => string} cfg.fileName
 * @param {(doc: object) => void} [cfg.check]      Throws 422 on business-rule violations
 * @param {(doc: object, emp: object) => string} cfg.duplicateMessage
 * @param {(filter: object) => Promise<object>} [cfg.myFacets] Extra meta for the "my" listing (e.g. years available)
 * @param {(doc: object) => string} [cfg.describe] Name used in success messages (e.g. "Form 16 Part A")
 */
export function makeEmployeeDocController(cfg) {
  const { Model, noun } = cfg;
  const Noun = noun.charAt(0).toUpperCase() + noun.slice(1);
  const name = (doc) => cfg.describe?.(doc) ?? Noun;
  const aadFor = (id) => `${cfg.aad}:${id}`;
  const present = (id) => Model.findById(id).populate([EMP_POP, USER_POP]);

  const canAccess = (user, doc) => isPrivileged(user) || String(doc.employee?._id || doc.employee) === String(user._id);

  async function loadForUser(req, { withFile = false } = {}) {
    if (!isValidId(req.params.id)) throw ApiError.notFound(`${Noun} not found`);
    const q = Model.findById(req.params.id);
    if (withFile) q.select(FILE_FIELDS);
    const doc = await q;
    if (!doc || !canAccess(req.user, doc)) throw ApiError.notFound(`${Noun} not found`);
    return doc;
  }

  async function findEmployee(id) {
    const emp = await User.findById(id).select('name employeeCode');
    if (!emp) throw invalid({ employee: 'Employee not found' });
    return emp;
  }

  const pickFields = (body) => {
    const out = {};
    for (const k of cfg.fields) {
      if (body[k] === undefined) continue;
      out[k] = (cfg.dateFields ?? []).includes(k) ? toDay(body[k]) : body[k];
    }
    return out;
  };

  const duplicate = async (err, doc, emp) => {
    if (err?.code === 11000) throw ApiError.conflict(cfg.duplicateMessage(doc, emp));
    throw err;
  };

  /* ---------------- HR / Admin ---------------- */

  const create = asyncHandler(async (req, res) => {
    const file = readPdf(req, { required: true });
    const emp = await findEmployee(req.body.employee);
    const fields = pickFields(req.body);
    cfg.check?.(fields);

    const _id = new mongoose.Types.ObjectId();
    const draft = { ...fields, employee: emp._id };
    try {
      await Model.create({
        _id, ...draft,
        fileName: cfg.fileName(draft, emp), originalName: cleanFileName(file.originalname),
        size: file.size, checksum: sha256(file.buffer), ...encryptBuffer(file.buffer, aadFor(_id)),
        uploadedBy: req.user._id, updatedBy: req.user._id,
      });
    } catch (err) {
      await duplicate(err, draft, emp);
    }
    ok(res, await present(_id), { message: `${name(draft)} added successfully` }, 201);
  });

  const update = asyncHandler(async (req, res) => {
    const file = readPdf(req, { required: false });
    const doc = await loadForUser(req);
    const fields = pickFields(req.body);
    const employeeChanged = req.body.employee && String(req.body.employee) !== String(doc.employee);
    if (!file && !employeeChanged && Object.keys(fields).every((k) => String(fields[k] ?? '') === String(doc[k] ?? ''))) {
      // nothing to do — still a success, but say so
      return ok(res, await present(doc._id), { message: 'No changes to save' });
    }

    const emp = await findEmployee(employeeChanged ? req.body.employee : doc.employee);
    for (const [k, v] of Object.entries(fields)) doc.set(k, v === null ? undefined : v);
    if (employeeChanged) doc.employee = emp._id;
    cfg.check?.(doc);

    doc.fileName = cfg.fileName(doc, emp);
    if (file) {
      Object.assign(doc, {
        originalName: cleanFileName(file.originalname), size: file.size, checksum: sha256(file.buffer),
        ...encryptBuffer(file.buffer, aadFor(doc._id)), fileReplacedAt: new Date(),
      });
    }
    doc.updatedBy = req.user._id;
    try {
      await doc.save();
    } catch (err) {
      await duplicate(err, doc, emp);
    }
    ok(res, await present(doc._id), { message: file ? `${name(doc)} and document updated successfully` : `${name(doc)} updated successfully` });
  });

  const remove = asyncHandler(async (req, res) => {
    if (!isValidId(req.params.id)) throw ApiError.notFound(`${Noun} not found`);
    const doc = await Model.findById(req.params.id);
    if (!doc) throw ApiError.notFound(`${Noun} not found`);
    await Model.deleteOne({ _id: doc._id });
    ok(res, null, { message: `${name(doc)} deleted successfully` });
  });

  const list = asyncHandler(async (req, res) => {
    const { page, limit, skip } = getPagination(req.query, { defaultLimit: 10, maxLimit: 100 });
    const filter = cfg.filterFrom(req.query);
    if (req.query.employee) filter.employee = new mongoose.Types.ObjectId(req.query.employee);
    if (req.query.q) {
      const rx = new RegExp(escapeRegex(req.query.q), 'i');
      const ids = await User.find({ $or: [{ name: rx }, { employeeCode: rx }, { email: rx }] }).limit(500).distinct('_id');
      filter.$or = [{ employee: { $in: ids } }, ...(cfg.searchFields ?? []).map((f) => ({ [f]: rx }))];
    }
    const [items, total] = await Promise.all([
      Model.find(filter).sort(cfg.sort).skip(skip).limit(limit).populate([EMP_POP, USER_POP]),
      Model.countDocuments(filter),
    ]);
    ok(res, items, { meta: buildMeta(page, limit, total) });
  });

  /* ---------------- Everyone (own records only; HR/Admin: any) ---------------- */

  const mine = asyncHandler(async (req, res) => {
    const { page, limit, skip } = getPagination(req.query, { defaultLimit: 12, maxLimit: 100 });
    const own = { employee: req.user._id };
    const filter = { ...cfg.filterFrom(req.query), ...own }; // own last: nothing in the query can widen it
    const [items, total, facets] = await Promise.all([
      Model.find(filter).sort(cfg.sort).skip(skip).limit(limit).populate([USER_POP]),
      Model.countDocuments(filter),
      cfg.myFacets ? cfg.myFacets(own) : {},
    ]);
    ok(res, items, { meta: { ...buildMeta(page, limit, total), ...facets } });
  });

  const getOne = asyncHandler(async (req, res) => {
    const doc = await loadForUser(req);
    ok(res, await present(doc._id));
  });

  const download = asyncHandler(async (req, res) => {
    const doc = await loadForUser(req, { withFile: true });
    let pdf;
    try {
      pdf = decryptBuffer(doc, aadFor(doc._id));
    } catch {
      console.error(`${Noun} ${doc._id} failed its integrity check`);
      throw new ApiError(500, 'The stored file could not be verified. Please contact HR.');
    }
    // download stats must not bump updatedAt (that stamp means "record edited")
    Model.updateOne({ _id: doc._id }, { $inc: { downloadCount: 1 }, $set: { lastDownloadedAt: new Date() } }, { timestamps: false }).catch(() => {});

    res.status(200).set({
      'Content-Type': 'application/pdf',
      'Content-Length': String(pdf.length),
      'Content-Disposition': contentDisposition(doc.fileName, req.query.inline === 'true' ? 'inline' : 'attachment'),
      'Cache-Control': 'private, no-store, max-age=0',
      Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    }).end(pdf);
  });

  return { create, update, remove, list, mine, getOne, download };
}
