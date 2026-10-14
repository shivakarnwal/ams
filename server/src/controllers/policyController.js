import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { Policy, PolicyCategory, PolicyVersion } from '../models/Policy.js';
import { ApiError } from '../utils/ApiError.js';
import { POLICY_KINDS, POLICY_TYPES_LABEL, cleanFileName, docInfo } from '../utils/docInfo.js';
import { contentDisposition, policyFiles, streamFile } from '../utils/gridfs.js';
import { asyncHandler, buildMeta, escapeRegex, getPagination, isValidId, ok, todayString } from '../utils/helpers.js';

const invalid = (errors) => new ApiError(422, 'Validation failed', errors);
const today = () => new Date(todayString());
const POLICY_POP = [
  { path: 'category', select: 'name color' },
  { path: 'createdBy updatedBy', select: 'name' },
  { path: 'currentVersion', select: '-fileId', populate: { path: 'uploadedBy', select: 'name' } },
];

async function loadCategory(id) {
  if (!isValidId(id)) throw ApiError.badRequest('Invalid folder id');
  const c = await PolicyCategory.findById(id);
  if (!c) throw ApiError.notFound('Folder not found');
  return c;
}
async function loadPolicy(id) {
  if (!isValidId(id)) throw ApiError.badRequest('Invalid policy id');
  const p = await Policy.findById(id);
  if (!p) throw ApiError.notFound('Policy not found');
  return p;
}
const present = (id) => Policy.findById(id).populate(POLICY_POP);

/** Turns duplicate-key errors into messages people understand. */
function friendlyDuplicate(err, message) {
  if (err?.code === 11000) return ApiError.conflict(message);
  return err;
}

/* ---------------- folders (categories) ---------------- */

export const listCategories = asyncHandler(async (_req, res) => {
  const [cats, policies] = await Promise.all([
    PolicyCategory.find().sort({ name: 1 }).collation({ locale: 'en', strength: 2 }),
    Policy.find().select('category updatedAt currentVersion').populate('currentVersion', 'size').lean(),
  ]);
  const agg = new Map();
  for (const p of policies) {
    const k = String(p.category);
    const a = agg.get(k) || { policyCount: 0, totalSize: 0, lastUpdated: null };
    a.policyCount += 1;
    a.totalSize += p.currentVersion?.size || 0;
    if (!a.lastUpdated || p.updatedAt > a.lastUpdated) a.lastUpdated = p.updatedAt;
    agg.set(k, a);
  }
  ok(res, cats.map((c) => ({ ...c.toJSON(), ...(agg.get(String(c._id)) || { policyCount: 0, totalSize: 0, lastUpdated: null }) })));
});

export const createCategory = asyncHandler(async (req, res) => {
  try {
    const c = await PolicyCategory.create({ ...req.body, createdBy: req.user._id, updatedBy: req.user._id });
    ok(res, { ...c.toJSON(), policyCount: 0, totalSize: 0, lastUpdated: null }, { message: 'Folder created' }, 201);
  } catch (err) {
    throw friendlyDuplicate(err, `A folder named "${req.body.name}" already exists`);
  }
});

export const updateCategory = asyncHandler(async (req, res) => {
  const c = await loadCategory(req.params.id);
  c.set({ ...req.body, updatedBy: req.user._id });
  try {
    await c.save();
  } catch (err) {
    throw friendlyDuplicate(err, `A folder named "${req.body.name}" already exists`);
  }
  ok(res, c, { message: 'Folder updated' });
});

export const removeCategory = asyncHandler(async (req, res) => {
  const c = await loadCategory(req.params.id);
  const count = await Policy.countDocuments({ category: c._id });
  if (count) throw ApiError.conflict(`Move or delete the ${count} polic${count === 1 ? 'y' : 'ies'} in "${c.name}" before deleting the folder`);
  await c.deleteOne();
  ok(res, null, { message: 'Folder deleted' });
});

/* ---------------- stats ---------------- */

export const stats = asyncHandler(async (_req, res) => {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [folders, files, versions, updatedRecently] = await Promise.all([
    PolicyCategory.countDocuments(),
    Policy.countDocuments(),
    PolicyVersion.countDocuments(),
    Policy.countDocuments({ updatedAt: { $gte: since } }),
  ]);
  ok(res, { folders, files, versions, updatedRecently });
});

/* ---------------- policies ---------------- */

const SORT = { updated: { updatedAt: -1 }, title: { title: 1 }, effective: { effectiveDate: -1, updatedAt: -1 } };

export const listPolicies = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query, { defaultLimit: 20, maxLimit: 100 });
  const { category, q, sort } = req.query;
  const filter = {};
  if (category) filter.category = category;
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ title: rx }, { description: rx }];
  }
  const [items, total] = await Promise.all([
    Policy.find(filter).sort(SORT[sort] || SORT.updated).collation({ locale: 'en', strength: 2 }).skip(skip).limit(limit).populate(POLICY_POP),
    Policy.countDocuments(filter),
  ]);
  ok(res, items, { meta: buildMeta(page, limit, total) });
});

export const getPolicy = asyncHandler(async (req, res) => {
  const p = await loadPolicy(req.params.id);
  const [policy, versions] = await Promise.all([
    present(p._id),
    PolicyVersion.find({ policy: p._id }).sort({ createdAt: -1 }).populate('uploadedBy', 'name'),
  ]);
  ok(res, { ...policy.toJSON(), versions });
});

/** Validates the uploaded document by its bytes + extension. */
function requireDocument(req) {
  const file = req.files?.[0];
  if (!file) throw invalid({ file: 'Choose a document to upload' });
  const info = docInfo(file.buffer, file.originalname);
  if (!info || !POLICY_KINDS.includes(info.kind)) throw invalid({ file: `Only ${POLICY_TYPES_LABEL} files are allowed (max ${env.policyMaxMb} MB)` });
  return { file, info };
}

/** Next free label: 1.0, 2.0, ... */
async function nextVersionLabel(policyId, count) {
  for (let n = count + 1; n < count + 50; n += 1) {
    const label = `${n}.0`;
    // eslint-disable-next-line no-await-in-loop
    if (!(await PolicyVersion.exists({ policy: policyId, version: label }).collation({ locale: 'en', strength: 2 }))) return label;
  }
  return `${count + 1}.${Date.now() % 1000}`;
}

/** Stores the bytes and creates the version record; removes the stored file again if anything fails. */
async function storeVersion(policy, { file, info }, { version, effectiveDate, changeNote }, user) {
  const fileId = await policyFiles.put(file.buffer, { filename: cleanFileName(file.originalname), contentType: info.mime, metadata: { policy: policy._id } });
  try {
    return await PolicyVersion.create({
      policy: policy._id,
      version: version || (await nextVersionLabel(policy._id, policy.versionCount || 0)),
      effectiveDate: effectiveDate || today(),
      changeNote,
      fileId,
      fileName: cleanFileName(file.originalname),
      mimeType: info.mime,
      kind: info.kind,
      size: file.size,
      checksum: crypto.createHash('sha256').update(file.buffer).digest('hex'),
      uploadedBy: user._id,
    });
  } catch (err) {
    await policyFiles.remove([fileId]);
    throw friendlyDuplicate(err, `Version "${version}" already exists for this policy — use a new version number`);
  }
}

export const createPolicy = asyncHandler(async (req, res) => {
  const doc = requireDocument(req);
  const { title, category, description, effectiveDate, version, changeNote } = req.body;
  if (!(await PolicyCategory.exists({ _id: category }))) throw invalid({ category: 'Folder not found' });

  let policy;
  try {
    policy = await Policy.create({ title, category, description, effectiveDate: effectiveDate || today(), createdBy: req.user._id, updatedBy: req.user._id });
  } catch (err) {
    throw friendlyDuplicate(err, `A policy titled "${title}" already exists in this folder`);
  }
  try {
    const v = await storeVersion(policy, doc, { version: version || '1.0', effectiveDate: policy.effectiveDate, changeNote: changeNote || 'Initial version' }, req.user);
    policy.currentVersion = v._id;
    policy.versionCount = 1;
    await policy.save();
  } catch (err) {
    await policy.deleteOne();
    throw err;
  }
  ok(res, await present(policy._id), { message: 'Policy uploaded' }, 201);
});

export const updatePolicy = asyncHandler(async (req, res) => {
  const policy = await loadPolicy(req.params.id);
  const { category, effectiveDate, ...rest } = req.body;
  if (category && !(await PolicyCategory.exists({ _id: category }))) throw invalid({ category: 'Folder not found' });
  policy.set({ ...rest, ...(category ? { category } : {}), ...(effectiveDate ? { effectiveDate } : {}), updatedBy: req.user._id });
  try {
    await policy.save();
  } catch (err) {
    throw friendlyDuplicate(err, 'A policy with this title already exists in that folder');
  }
  // the effective date shown for the policy is the current version's
  if (effectiveDate && policy.currentVersion) await PolicyVersion.updateOne({ _id: policy.currentVersion }, { effectiveDate });
  ok(res, await present(policy._id), { message: 'Policy updated' });
});

/** "Replace" = upload a new version; earlier versions stay downloadable. */
export const addVersion = asyncHandler(async (req, res) => {
  const policy = await loadPolicy(req.params.id);
  const doc = requireDocument(req);
  const v = await storeVersion(policy, doc, req.body, req.user);
  policy.set({ currentVersion: v._id, versionCount: (policy.versionCount || 0) + 1, effectiveDate: v.effectiveDate, updatedBy: req.user._id });
  await policy.save();
  ok(res, await present(policy._id), { message: `Version ${v.version} uploaded` }, 201);
});

export const removeVersion = asyncHandler(async (req, res) => {
  const policy = await loadPolicy(req.params.id);
  if (!isValidId(req.params.versionId)) throw ApiError.badRequest('Invalid version id');
  const v = await PolicyVersion.findOne({ _id: req.params.versionId, policy: policy._id });
  if (!v) throw ApiError.notFound('Version not found');
  if (String(policy.currentVersion) === String(v._id)) {
    throw ApiError.conflict('The current version cannot be deleted. Upload a newer version first, or delete the whole policy.');
  }
  await v.deleteOne();
  await policyFiles.remove([v.fileId]);
  policy.set({ versionCount: Math.max((policy.versionCount || 1) - 1, 1), updatedBy: req.user._id });
  await policy.save();
  ok(res, null, { message: `Version ${v.version} deleted` });
});

export const removePolicy = asyncHandler(async (req, res) => {
  const policy = await loadPolicy(req.params.id);
  const versions = await PolicyVersion.find({ policy: policy._id }).select('fileId');
  await PolicyVersion.deleteMany({ policy: policy._id });
  await policy.deleteOne();
  await policyFiles.remove(versions.map((v) => v.fileId));
  ok(res, null, { message: 'Policy deleted' });
});

/** Everyone signed in may view/download. ?version=<id> for an older version, ?inline=true to preview. */
export const download = asyncHandler(async (req, res, next) => {
  const policy = await loadPolicy(req.params.id);
  const versionId = req.query.version || policy.currentVersion;
  const v = versionId && (await PolicyVersion.findOne({ _id: versionId, policy: policy._id }));
  if (!v) throw ApiError.notFound('Document not found');

  // only formats a browser can render safely are shown inline; everything else downloads
  const inline = req.query.inline === 'true' && (v.kind === 'pdf' || v.kind === 'image');
  if (!inline) PolicyVersion.updateOne({ _id: v._id }, { $inc: { downloadCount: 1 } }).catch(() => {});
  const ext = v.fileName.match(/\.[^.]+$/)?.[0] || '';
  const niceName = `${policy.title.replace(/[\\/:*?"<>|]+/g, ' ').trim()} v${v.version}${ext}`;

  res.status(200).set({
    'Content-Type': v.mimeType,
    'Content-Length': String(v.size),
    'Content-Disposition': contentDisposition(niceName, inline ? 'inline' : 'attachment'),
    'Cache-Control': 'private, max-age=0, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  });
  streamFile(policyFiles, v.fileId, res, next, ApiError.notFound('Document file not found'));
});
