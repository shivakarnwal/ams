/** Shared option lists for the Performance Appraisal Letter and Form 16 modules (also served to the UI). */

export const APPRAISAL_TYPES = [
  { value: 'annual', label: 'Annual Appraisal' },
  { value: 'mid_year', label: 'Mid-Year Review' },
  { value: 'quarterly', label: 'Quarterly Review' },
  { value: 'probation', label: 'Probation Review' },
  { value: 'promotion', label: 'Promotion' },
  { value: 'special', label: 'Special Increment' },
];

export const APPRAISAL_RATINGS = [
  { value: 'outstanding', label: 'Outstanding' },
  { value: 'exceeds', label: 'Exceeds Expectations' },
  { value: 'meets', label: 'Meets Expectations' },
  { value: 'needs_improvement', label: 'Needs Improvement' },
  { value: 'unsatisfactory', label: 'Unsatisfactory' },
];

export const FORM16_PARTS = [
  { value: 'A', label: 'Part A', description: 'TDS certificate issued by the employer through TRACES (TAN, PAN, quarterly TDS deducted and deposited).' },
  { value: 'B', label: 'Part B', description: 'Annexure with the salary break-up, exemptions, deductions under Chapter VI-A and the tax computation.' },
];

export const values = (list) => list.map((o) => o.value);

/** Indian financial year that `date` falls in, as the starting calendar year (Apr 2025 – Mar 2026 → 2025). */
export function currentFyStart(date = new Date()) {
  return date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
}

/** 2025 → "2025-26" */
export const fyLabel = (start) => `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
