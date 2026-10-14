import { z } from 'zod';
import { PRIORITY_COLORS, TICKET_STATUSES } from '../models/Ticket.js';
import { dayString, objectId, text } from './common.js';

/** multipart forms send empty inputs as "" — treat those as "not given" */
const blank = (schema) => z.preprocess((v) => (v === '' ? undefined : v), schema);
const bool = z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean());

export const ticketCreate = z.object({
  category: objectId,
  subCategory: text('Sub category', 80),
  issueType: blank(z.string().trim().max(80).optional()),
  priority: blank(objectId.optional()),
  relatedAsset: z.string().trim().max(100, 'Asset reference is too long').optional().default(''),
  subject: text('Subject', 200, 5),
  description: text('Description', 5000, 10),
});

export const ticketListQuery = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  scope: z.enum(['me', 'all']).optional().default('me'),
  status: blank(z.enum([...TICKET_STATUSES, 'active']).optional()),
  priority: blank(objectId.optional()),
  category: blank(objectId.optional()),
  employee: blank(objectId.optional()),
  assignee: blank(z.union([objectId, z.enum(['me', 'unassigned'])]).optional()),
  from: blank(dayString.optional()),
  to: blank(dayString.optional()),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(['newest', 'oldest', 'updated', 'priority']).optional().default('newest'),
});

export const statsQuery = z.object({ scope: z.enum(['me', 'all']).optional().default('me') });

export const commentCreate = z.object({
  body: z.string().trim().max(5000, 'Message is too long').optional().default(''),
  internal: bool.optional().default(false),
});

export const assignBody = z.object({ assignee: objectId.nullable() });
export const statusBody = z.object({
  status: z.enum(TICKET_STATUSES, { errorMap: () => ({ message: `Status must be one of: ${TICKET_STATUSES.join(', ')}` }) }),
  note: z.string().trim().max(2000, 'Note is too long').optional().default(''),
});
export const priorityBody = z.object({ priority: objectId });
export const cancelBody = z.object({ reason: z.string().trim().max(500).optional().default('') });
export const attachmentQuery = z.object({ inline: z.enum(['true', 'false']).optional() });

/* ---- settings (HR / Admin) ---- */

const subCategory = z.object({
  name: text('Sub category', 80),
  active: z.boolean().optional().default(true),
  issueTypes: z.array(text('Issue type', 80)).max(40, 'At most 40 issue types').optional().default([]),
});
const uniqueNames = (list) => new Set(list.map((s) => s.name.toLowerCase())).size === list.length;

export const categoryCreate = z.object({
  name: text('Category name', 60, 2),
  description: z.string().trim().max(300).optional().default(''),
  active: z.boolean().optional().default(true),
  order: z.number().int().min(0).max(999).optional(),
  subCategories: z
    .array(subCategory)
    .min(1, 'Add at least one sub category')
    .max(100)
    .refine(uniqueNames, 'Sub category names must be unique'),
});
export const categoryUpdate = z
  .object({
    name: text('Category name', 60, 2).optional(),
    description: z.string().trim().max(300).optional(),
    active: z.boolean().optional(),
    order: z.number().int().min(0).max(999).optional(),
    subCategories: z.array(subCategory).min(1, 'Add at least one sub category').max(100).refine(uniqueNames, 'Sub category names must be unique').optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to update', path: ['body'] });

export const priorityCreate = z.object({
  name: text('Priority name', 30, 2),
  level: z.number({ invalid_type_error: 'Level must be a number' }).int().min(1, 'Level 1-10').max(10, 'Level 1-10'),
  color: z.enum(PRIORITY_COLORS).optional().default('blue'),
  isDefault: z.boolean().optional().default(false),
  active: z.boolean().optional().default(true),
});
export const priorityUpdate = z
  .object({
    name: text('Priority name', 30, 2).optional(),
    level: z.number().int().min(1).max(10).optional(),
    color: z.enum(PRIORITY_COLORS).optional(),
    isDefault: z.boolean().optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to update', path: ['body'] });
