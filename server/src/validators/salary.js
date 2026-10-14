import { z } from 'zod';
import { objectId } from './common.js';

const month = z.coerce.number({ invalid_type_error: 'Month must be a number' }).int().min(1, 'Month must be 1-12').max(12, 'Month must be 1-12');
const year = z.coerce.number({ invalid_type_error: 'Year must be a number' }).int().min(2000, 'Year must be 2000 or later').max(2100, 'Invalid year');
const note = z.string().trim().max(300, 'Note is too long').optional().default('');

export const salaryCreate = z.object({ employee: objectId, month, year, note });
export const salaryReplace = z.object({ note: z.string().trim().max(300).optional() });

export const salaryListQuery = z.object({
  page: z.any().optional(),
  limit: z.any().optional(),
  employee: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid employee id').optional(),
  q: z.string().trim().max(100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});
export const salaryMyQuery = z.object({ year: z.coerce.number().int().min(2000).max(2100).optional() });
export const downloadQuery = z.object({ inline: z.enum(['true', 'false']).optional() });
