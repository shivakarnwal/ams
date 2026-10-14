import { z } from 'zod';
import { APPRAISAL_RATINGS, APPRAISAL_TYPES, FORM16_PARTS, values } from '../models/employeeDocOptions.js';
import { objectId } from './common.js';

/* Multipart bodies arrive as strings; an empty optional field means "not provided". */
const blank = (v) => (v === '' || v === null ? undefined : v);
const opt = (schema) => z.preprocess(blank, schema.optional());
const withDefault = (schema, value) => z.preprocess(blank, schema.default(value));
/** Optional on update, but an explicit '' clears the value. */
const clearable = (schema) => z.union([z.literal(''), schema]).optional();

const year = z.coerce.number({ invalid_type_error: 'Year must be a number' }).int('Year must be a whole number').min(2000, 'Year must be 2000 or later').max(2100, 'Invalid year');
const month = z.coerce.number({ invalid_type_error: 'Month must be a number' }).int().min(1, 'Month must be 1-12').max(12, 'Month must be 1-12');
const title = z.string({ required_error: 'Title is required' }).trim().min(3, 'Title must be at least 3 characters').max(150, 'Title is too long (max 150)');
const remarks = z.string().trim().max(500, 'Remarks are too long (max 500)');
const appraisalType = z.enum(values(APPRAISAL_TYPES), { errorMap: () => ({ message: 'Select a valid appraisal type' }) });
const rating = z.enum(values(APPRAISAL_RATINGS), { errorMap: () => ({ message: 'Select a valid rating' }) });
const isoDate = (label) =>
  z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be YYYY-MM-DD`).refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), `${label} is invalid`);
const part = z.enum(values(FORM16_PARTS), { errorMap: () => ({ message: 'Part must be A or B' }) });
const fyStart = z.coerce.number({ invalid_type_error: 'Financial year is required' }).int().min(2000, 'Financial year must be 2000-01 or later').max(2100, 'Invalid financial year');
const certificateNo = z.string().trim().max(40, 'Certificate number is too long').regex(/^[A-Za-z0-9/-]*$/, 'Certificate number may contain only letters, digits, "/" and "-"');
const employerTan = z.string().trim().regex(/^[A-Za-z]{4}\d{5}[A-Za-z]$/, 'TAN must look like ABCD12345E');

const paging = { page: z.any().optional(), limit: z.any().optional() };
const empId = opt(z.string().regex(/^[a-f\d]{24}$/i, 'Invalid employee id'));
const search = opt(z.string().trim().max(100));
export const downloadQuery = z.object({ inline: z.enum(['true', 'false']).optional() });

/* ---------------- Performance Appraisal Letters ---------------- */

export const palCreate = z.object({
  employee: objectId,
  title,
  appraisalType: withDefault(appraisalType, 'annual'),
  year,
  month,
  effectiveDate: opt(isoDate('Effective date')),
  rating: opt(rating),
  remarks: withDefault(remarks, ''),
});

export const palUpdate = z.object({
  employee: opt(objectId),
  title: opt(title),
  appraisalType: opt(appraisalType),
  year: opt(year),
  month: opt(month),
  effectiveDate: clearable(isoDate('Effective date')),
  rating: clearable(rating),
  remarks: remarks.optional(),
});

export const palListQuery = z.object({
  ...paging,
  employee: empId,
  q: search,
  year: opt(year),
  month: opt(month),
  appraisalType: opt(appraisalType),
});
export const palMyQuery = z.object({ ...paging, year: opt(year), month: opt(month) });

/* ---------------- Form 16 (Part A / Part B) ---------------- */

export const form16Create = z.object({
  employee: objectId,
  part,
  fyStart,
  certificateNo: withDefault(certificateNo, ''),
  employerTan: opt(employerTan),
  issueDate: opt(isoDate('Issue date')),
  remarks: withDefault(remarks, ''),
});

export const form16Update = z.object({
  employee: opt(objectId),
  part: opt(part),
  fyStart: opt(fyStart),
  certificateNo: clearable(certificateNo),
  employerTan: clearable(employerTan),
  issueDate: clearable(isoDate('Issue date')),
  remarks: remarks.optional(),
});

export const form16ListQuery = z.object({ ...paging, employee: empId, q: search, part: opt(part), fyStart: opt(fyStart) });
export const form16MyQuery = z.object({ ...paging, part: opt(part), fyStart: opt(fyStart) });
