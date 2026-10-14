import { z } from 'zod';
import { objectId, optionalDate, text } from './common.js';

const description = z.string().trim().max(1000, 'Description is too long');
const caption = z.string().trim().max(300, 'Caption is too long');
const page = z.coerce.number().int().min(1).optional();
const q = z.string().trim().max(100).optional();

export const albumCreate = z.object({
  name: text('Album name', 120, 2),
  description: description.optional().default(''),
  eventDate: optionalDate('Event date'),
});

export const albumUpdate = z
  .object({
    name: text('Album name', 120, 2).optional(),
    description: description.optional(),
    eventDate: optionalDate('Event date'),
    coverPhoto: objectId.nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'Nothing to update', path: ['body'] });

export const albumListQuery = z.object({
  page,
  limit: z.coerce.number().int().min(1).max(60).optional(),
  q,
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  sort: z.enum(['newest', 'oldest', 'name', 'updated']).optional().default('newest'),
});

export const photoListQuery = z.object({
  page,
  limit: z.coerce.number().int().min(1).max(100).optional(),
  album: objectId.optional(),
  q,
  sort: z.enum(['newest', 'oldest']).optional().default('newest'),
});

export const photoCreate = z.object({ caption: caption.optional().default('') });

export const photoUpdate = z
  .object({ caption: caption.optional(), album: objectId.optional() })
  .refine((v) => v.caption !== undefined || v.album !== undefined, { message: 'Nothing to update', path: ['body'] });

export const bulkDelete = z.object({
  ids: z.array(objectId, { required_error: 'Select at least one photo' }).min(1, 'Select at least one photo').max(100, 'You can delete up to 100 photos at a time'),
});

export const fileQuery = z.object({
  v: z.enum(['thumb', 'preview', 'original']),
  exp: z.string().regex(/^\d{1,12}$/),
  sig: z.string().min(1).max(64),
  download: z.enum(['0', '1']).optional(),
});
