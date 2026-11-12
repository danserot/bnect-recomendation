import { z } from 'zod';
import type { DeadlineFilters, RecommendationRequest, SupplierProfile } from '@bnect/shared';

const text = z.string().trim().min(1).max(200);
const values = z
  .array(text)
  .max(100)
  .refine((items) => new Set(items).size === items.length, 'Значения не должны повторяться.');
const deadlineFields = {
  deadlineFrom: z.iso.date().optional(),
  deadlineTo: z.iso.date().optional(),
};
function validateDeadlineRange(filters: DeadlineFilters, context: z.RefinementCtx) {
  if (filters.deadlineFrom && filters.deadlineTo && filters.deadlineFrom > filters.deadlineTo) {
    context.addIssue({
      code: 'custom',
      path: ['deadlineTo'],
      message: 'Дата «по» должна быть не раньше даты «с».',
    });
  }
}

export const supplierSchema = z
  .object({
    id: text,
    name: text,
    specializationDescription: z
      .string()
      .trim()
      .min(10, 'Опишите специализацию минимум в 10 символах.')
      .max(5000),
    industryGroups: values,
    activities: values,
    serviceRegionIds: values,
    procurementTypes: values,
  })
  .strict() satisfies z.ZodType<SupplierProfile>;

export const recommendationSchema = z
  .object({
    profile: supplierSchema,
    filters: z
      .object({
        ...deadlineFields,
        regionMode: z.enum(['supplier', 'selected', 'all']).default('supplier'),
        selectedRegionIds: values.default([]),
        industryGroups: values.optional(),
        activities: values.optional(),
        procurementTypes: values.optional(),
        procurementMethods: values.optional(),
        applySupplierIndustryGroups: z.boolean().optional(),
        applySupplierProcurementTypes: z.boolean().optional(),
      })
      .strict()
      .superRefine(validateDeadlineRange),
  })
  .strict() satisfies z.ZodType<RecommendationRequest>;

export const listQuerySchema = z
  .object({
    ...deadlineFields,
    q: z.string().trim().max(200).optional(),
    regionId: text.optional(),
    industryGroup: text.optional(),
    activity: text.optional(),
    procurementType: text.optional(),
    procurementMethod: text.optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(12),
  })
  .strict()
  .superRefine(validateDeadlineRange);

export type ListQuery = z.infer<typeof listQuerySchema>;

export const similarFiltersSchema = z
  .object({
    ...deadlineFields,
    regionIds: values.optional(),
    industryGroups: values.optional(),
    activities: values.optional(),
    procurementTypes: values.optional(),
    procurementMethods: values.optional(),
    onlyOpen: z.boolean().optional(),
  })
  .strict()
  .superRefine(validateDeadlineRange);
