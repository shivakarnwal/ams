import { z } from 'zod';
import { FOLDER_COLORS } from '../models/Policy.js';
import { objectId, optionalDate, text } from './common.js';

const nonEmpty = (v) => Object.values(v).some((x) => x !== undefined);
const description = (max) => z.string().trim().max(max, 'Description is too long');
const versionLabel = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._ -]{0,19}$/, 'Use up to 20 letters, numbers, dots or dashes (e.g. 2.1)');
const changeNote = z.string().trim().max(500, 'Change note is too long');
/** multipart forms send empty inputs as "" — treat those as "not given" */
const blankToUndef = (schema) => z.preprocess((v) => (v === '' ? undefined : v), schema);

export const categoryCreate = z.object({
  name: text('Folder name', 80, 2),
  description: description(300).optional().default(''),
  color: z.enum(FOLDER_COLORS).optional().default('blue'),
});
export const categoryUpdate = z
  .object({ name: text('Folder name', 80, 2).optional(), description: description(300).optional(), color: z.enum(FOLDER_COLORS).optional() })
  .refine(nonEmpty, { message: 'Nothing to update', path: ['body'] });

export const policyListQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  category: objectId.optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(['updated', 'title', 'effective']).optional().default('updated'),
});

export const policyCreate = z.object({
  title: text('Title', 150, 2),
  category: objectId,
  description: description(1000).optional().default(''),
  effectiveDate: optionalDate('Effective date'),
  version: blankToUndef(versionLabel.optional()),
  changeNote: changeNote.optional().default(''),
});

export const policyUpdate = z
  .object({
    title: text('Title', 150, 2).optional(),
    category: objectId.optional(),
    description: description(1000).optional(),
    effectiveDate: optionalDate('Effective date'),
  })
  .refine(nonEmpty, { message: 'Nothing to update', path: ['body'] });

export const versionCreate = z.object({
  version: blankToUndef(versionLabel.optional()),
  effectiveDate: optionalDate('Effective date'),
  changeNote: changeNote.optional().default(''),
});

export const downloadQuery = z.object({
  version: objectId.optional(),
  inline: z.enum(['true', 'false']).optional(),
});
