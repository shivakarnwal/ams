import { Visitor } from '../models/Visitor.js';
import { ApiError } from '../utils/ApiError.js';
import { todayString } from '../utils/helpers.js';
import { createRequestController } from './requestController.js';

const assertNotPast = (date) => {
  if (date < new Date(todayString())) throw ApiError.badRequest('Visit date cannot be in the past');
};

export const visitorCtrl = createRequestController({
  Model: Visitor,
  label: 'Visitor request',
  dateField: 'visitDate',
  hooks: {
    prepareCreate(data) { assertNotPast(data.visitDate); return data; },
    prepareUpdate(_doc, data) { if (data.visitDate) assertNotPast(data.visitDate); return data; },
  },
});
