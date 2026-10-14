import { Form16 } from '../models/Form16.js';
import { currentFyStart, fyLabel, FORM16_PARTS } from '../models/employeeDocOptions.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler, ok } from '../utils/helpers.js';
import { makeEmployeeDocController, safeCode } from './employeeDocController.js';

const ctrl = makeEmployeeDocController({
  Model: Form16,
  noun: 'Form 16',
  aad: 'form16',
  describe: (d) => `Form 16 Part ${d.part}`,
  sort: { fyStart: -1, part: 1, createdAt: -1 },
  fields: ['part', 'fyStart', 'certificateNo', 'employerTan', 'issueDate', 'remarks'],
  dateFields: ['issueDate'],
  searchFields: ['certificateNo'],
  filterFrom: (q) => ({ ...(q.part ? { part: q.part } : {}), ...(q.fyStart ? { fyStart: q.fyStart } : {}) }),
  fileName: (d, emp) => `Form16_Part${d.part}_${safeCode(emp.employeeCode)}_FY${fyLabel(d.fyStart)}.pdf`,
  check: (d) => {
    const errors = {};
    const latest = currentFyStart();
    if (d.fyStart > latest) errors.fyStart = `Financial year cannot be later than ${fyLabel(latest)}`;
    if (d.issueDate && d.issueDate > new Date()) errors.issueDate = 'Issue date cannot be in the future';
    if (Object.keys(errors).length) throw new ApiError(422, 'Validation failed', errors);
  },
  duplicateMessage: (d, emp) => `Form 16 Part ${d.part} for ${emp.name} (FY ${fyLabel(d.fyStart)}) already exists. Edit that record instead.`,
  myFacets: async (own) => {
    const [years, counts] = await Promise.all([
      Form16.distinct('fyStart', own),
      Form16.aggregate([{ $match: own }, { $group: { _id: '$part', n: { $sum: 1 } } }]),
    ]);
    return {
      financialYears: years.sort((a, b) => b - a).map((y) => ({ value: y, label: fyLabel(y) })),
      partCounts: Object.fromEntries(FORM16_PARTS.map((p) => [p.value, counts.find((c) => c._id === p.value)?.n ?? 0])),
    };
  },
});

export const { create, update, remove, list, mine, getOne, download } = ctrl;

/** Parts + the selectable financial years (latest first) for forms and filters. */
export const options = asyncHandler(async (_req, res) => {
  const latest = currentFyStart();
  const financialYears = Array.from({ length: 10 }, (_, i) => latest - i).map((y) => ({ value: y, label: fyLabel(y), assessmentYear: fyLabel(y + 1) }));
  ok(res, { parts: FORM16_PARTS, financialYears });
});
