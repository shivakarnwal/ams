import { TravelExpense } from '../models/TravelExpense.js';
import { todayString } from '../utils/helpers.js';
import { createRequestController } from './requestController.js';

const newExpenseNo = () => `TE-${todayString().replace(/-/g, '')}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

export const travelExpenseCtrl = createRequestController({
  Model: TravelExpense,
  label: 'Travel expense',
  filterFields: ['status', 'mode'],
  dateField: 'travelDate',
  transitions: { pending: ['approved', 'rejected'], approved: ['paid'] },
  hooks: {
    prepareCreate(data) { data.expenseNo = newExpenseNo(); return data; },
  },
});
