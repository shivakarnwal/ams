import { z } from 'zod';

export const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
export const dayString = z.string({ required_error: 'Date is required' }).regex(/^\d{4}-\d{2}-\d{2}$/, 'Use format YYYY-MM-DD');
export const timeString = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use format HH:mm');
const toDate = (v) => {
  if (v === '' || v === null || v === undefined) return undefined;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? 'invalid' : d;
};
export const dateInput = (label = 'Date') =>
  z.preprocess(toDate, z.date({ required_error: `${label} is required`, invalid_type_error: `${label} is invalid` }));
export const optionalDate = (label = 'Date') =>
  z.preprocess(toDate, z.date({ invalid_type_error: `${label} is invalid` }).optional());
export const phone = z
  .string()
  .trim()
  .refine((v) => v === '' || /^[0-9+\-\s()]{7,15}$/.test(v), 'Enter a valid contact number');
export const text = (label, max = 500, min = 1) =>
  z.string({ required_error: `${label} is required` }).trim().min(min, `${label} is required`).max(max, `${label} is too long`);

export const reviewSchema = (statuses = ['approved', 'rejected']) =>
  z
    .object({
      status: z.enum(statuses, { errorMap: () => ({ message: `Status must be one of: ${statuses.join(', ')}` }) }),
      remarks: z.string().trim().max(500).optional().default(''),
    })
    .refine((v) => v.status !== 'rejected' || v.remarks.length >= 3, {
      path: ['remarks'],
      message: 'Please give a reason for rejecting (min 3 characters)',
    });
