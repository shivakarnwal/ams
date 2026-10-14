import { SalarySlip } from '../models/SalarySlip.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { decryptBuffer, encryptBuffer, sha256 } from '../utils/fileCrypto.js';
import { asyncHandler, buildMeta, escapeRegex, getPagination, isValidId, ok, todayString } from '../utils/helpers.js';
import { isPrivileged } from '../utils/access.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const EMP_POP = { path: 'employee', select: 'name employeeCode designation department' };
const USER_POP = { path: 'uploadedBy updatedBy', select: 'name' };

const aadFor = (employeeId, year, month) => `salary-slip:${employeeId}:${year}-${month}`;
const safeCode = (c) => String(c).replace(/[^A-Za-z0-9_-]/g, '');
const buildName = (emp, month, year) => `Salary_Slip_${safeCode(emp.employeeCode)}_${MONTHS[month - 1]}_${year}.pdf`;

function assertPeriodNotFuture(month, year) {
  const [cy, cm] = todayString().split('-').map(Number);
  if (year > cy || (year === cy && month > cm)) {
    throw new ApiError(422, 'Validation failed', { month: 'Salary slip cannot be uploaded for a future month' });
  }
}

/** Validates the uploaded file really is a PDF (extension + magic bytes), regardless of the declared mime type. */
function requirePdf(req) {
  const f = req.file;
  if (!f) throw new ApiError(422, 'Validation failed', { file: 'PDF file is required' });
  const header = f.buffer.subarray(0, 5).toString('latin1');
  if (!/\.pdf$/i.test(f.originalname || '') || header !== '%PDF-') {
    throw new ApiError(422, 'Validation failed', { file: 'Only valid PDF files are allowed' });
  }
  return f;
}

/** Owner or HR/Admin. Anyone else gets 404 so the existence of other people's slips is not revealed. */
const canAccess = (user, slip) => isPrivileged(user) || String(slip.employee?._id || slip.employee) === String(user._id);

async function loadForUser(req, { withFile = false } = {}) {
  if (!isValidId(req.params.id)) throw ApiError.badRequest('Invalid id');
  const q = SalarySlip.findById(req.params.id);
  if (withFile) q.select('+data +iv +authTag');
  const slip = await q;
  if (!slip || !canAccess(req.user, slip)) throw ApiError.notFound('Salary slip not found');
  return slip;
}

const present = async (id) => SalarySlip.findById(id).populate([EMP_POP, USER_POP]);

/* ---------------- HR / Admin ---------------- */

export const create = asyncHandler(async (req, res) => {
  const file = requirePdf(req);
  const { employee, month, year, note } = req.body;

  const emp = await User.findById(employee).select('name employeeCode');
  if (!emp) throw new ApiError(422, 'Validation failed', { employee: 'Employee not found' });
  assertPeriodNotFuture(month, year);

  const encrypted = encryptBuffer(file.buffer, aadFor(emp._id, year, month));
  try {
    const slip = await SalarySlip.create({
      employee: emp._id, month, year, note,
      fileName: buildName(emp, month, year), size: file.size, checksum: sha256(file.buffer),
      ...encrypted, uploadedBy: req.user._id,
    });
    ok(res, await present(slip._id), { message: 'Salary slip uploaded successfully' }, 201);
  } catch (err) {
    if (err.code === 11000) throw ApiError.conflict(`A salary slip for ${emp.name} (${MONTHS[month - 1]} ${year}) already exists. Use replace instead.`);
    throw err;
  }
});

export const replace = asyncHandler(async (req, res) => {
  const file = requirePdf(req);
  const slip = await loadForUser(req);
  const emp = await User.findById(slip.employee).select('employeeCode');
  const encrypted = encryptBuffer(file.buffer, aadFor(slip.employee, slip.year, slip.month));

  Object.assign(slip, {
    fileName: buildName(emp, slip.month, slip.year), size: file.size, checksum: sha256(file.buffer), ...encrypted,
    updatedBy: req.user._id, replacedAt: new Date(),
    ...(req.body.note !== undefined ? { note: req.body.note } : {}),
  });
  await slip.save();
  ok(res, await present(slip._id), { message: 'Salary slip replaced successfully' });
});

export const list = asyncHandler(async (req, res) => {
  const { page, limit, skip } = getPagination(req.query);
  const { employee, q, month, year } = req.query;
  const filter = {};
  if (employee) filter.employee = employee;
  if (month) filter.month = month;
  if (year) filter.year = year;
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    const ids = await User.find({ $or: [{ name: rx }, { employeeCode: rx }] }).limit(200).distinct('_id');
    filter.employee = employee ? { $in: ids.filter((i) => String(i) === employee) } : { $in: ids };
  }
  const [items, total] = await Promise.all([
    SalarySlip.find(filter).sort({ year: -1, month: -1, createdAt: -1 }).skip(skip).limit(limit).populate([EMP_POP, USER_POP]),
    SalarySlip.countDocuments(filter),
  ]);
  ok(res, items, { meta: buildMeta(page, limit, total) });
});

export const remove = asyncHandler(async (req, res) => {
  if (!isValidId(req.params.id)) throw ApiError.badRequest('Invalid id');
  const { deletedCount } = await SalarySlip.deleteOne({ _id: req.params.id });
  if (!deletedCount) throw ApiError.notFound('Salary slip not found');
  ok(res, null, { message: 'Salary slip deleted' });
});

/* ---------------- Everyone (own slips only, HR/Admin: any) ---------------- */

export const mine = asyncHandler(async (req, res) => {
  const filter = { employee: req.user._id };
  const years = (await SalarySlip.distinct('year', filter)).sort((a, b) => b - a);
  if (req.query.year) filter.year = req.query.year;
  const items = await SalarySlip.find(filter).sort({ year: -1, month: -1 });
  ok(res, items, { meta: { years } });
});

export const getOne = asyncHandler(async (req, res) => {
  const slip = await loadForUser(req);
  ok(res, await present(slip._id));
});

export const download = asyncHandler(async (req, res) => {
  const slip = await loadForUser(req, { withFile: true });

  let pdf;
  try {
    pdf = decryptBuffer(slip, aadFor(slip.employee, slip.year, slip.month));
  } catch {
    console.error(`Salary slip ${slip._id} failed its integrity check`);
    throw new ApiError(500, 'The stored file could not be verified. Please contact support.');
  }

  SalarySlip.updateOne({ _id: slip._id }, { $inc: { downloadCount: 1 }, lastDownloadedAt: new Date() }).catch(() => {});

  const disposition = req.query.inline === 'true' ? 'inline' : 'attachment';
  res.status(200).set({
    'Content-Type': 'application/pdf',
    'Content-Length': String(pdf.length),
    'Content-Disposition': `${disposition}; filename="${slip.fileName}"`,
    'Cache-Control': 'private, no-store, max-age=0',
    Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  }).end(pdf);
});
