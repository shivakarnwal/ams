import { AppraisalLetter } from '../models/AppraisalLetter.js';
import { APPRAISAL_RATINGS, APPRAISAL_TYPES } from '../models/employeeDocOptions.js';
import { ApiError } from '../utils/ApiError.js';
import { asyncHandler, ok } from '../utils/helpers.js';
import { makeEmployeeDocController, safeCode } from './employeeDocController.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const typeLabel = (v) => APPRAISAL_TYPES.find((t) => t.value === v)?.label ?? 'Appraisal';

const ctrl = makeEmployeeDocController({
  Model: AppraisalLetter,
  noun: 'appraisal letter',
  aad: 'appraisal-letter',
  describe: () => 'Appraisal letter',
  sort: { year: -1, month: -1, createdAt: -1 },
  fields: ['title', 'appraisalType', 'year', 'month', 'effectiveDate', 'rating', 'remarks'],
  dateFields: ['effectiveDate'],
  searchFields: ['title'],
  filterFrom: (q) => ({
    ...(q.year ? { year: q.year } : {}),
    ...(q.month ? { month: q.month } : {}),
    ...(q.appraisalType ? { appraisalType: q.appraisalType } : {}),
  }),
  fileName: (d, emp) => `Appraisal_Letter_${safeCode(emp.employeeCode)}_${MONTHS[d.month - 1]}_${d.year}${d.appraisalType && d.appraisalType !== 'annual' ? `_${d.appraisalType}` : ''}.pdf`,
  check: (d) => {
    const maxYear = new Date().getFullYear() + 1; // letters may be issued ahead of an April effective date
    if (d.year > maxYear) throw new ApiError(422, 'Validation failed', { year: `Year cannot be later than ${maxYear}` });
  },
  duplicateMessage: (d, emp) =>
    `${emp.name} already has a ${typeLabel(d.appraisalType)} letter for ${MONTHS[d.month - 1]} ${d.year}. Edit that record instead.`,
  myFacets: async (own) => ({ years: (await AppraisalLetter.distinct('year', own)).sort((a, b) => b - a) }),
});

export const { create, update, remove, list, mine, getOne, download } = ctrl;
export const options = asyncHandler(async (_req, res) => ok(res, { types: APPRAISAL_TYPES, ratings: APPRAISAL_RATINGS }));
