import { z } from 'zod';
import type { RecommendationRequest, SupplierProfile } from '@bnect/shared';

const text = z.string().trim().min(1).max(200);
const values = z
  .array(text)
  .max(100)
  .refine((items) => new Set(items).size === items.length, 'Значения не должны повторяться.');

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
        regionMode: z.enum(['supplier', 'selected', 'all']).default('supplier'),
        selectedRegionIds: values.default([]),
        industryGroups: values.optional(),
        procurementTypes: values.optional(),
        procurementMethods: values.optional(),
        applySupplierIndustryGroups: z.boolean().optional(),
        applySupplierProcurementTypes: z.boolean().optional(),
        onlyOpen: z.boolean().optional(),
      })
      .strict(),
  })
  .strict() satisfies z.ZodType<RecommendationRequest>;

export const listQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    regionId: text.optional(),
    industryGroup: text.optional(),
    procurementType: text.optional(),
    procurementMethod: text.optional(),
    page: z.coerce.number().int().min(1).max(100000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(12),
  })
  .strict();

export type ListQuery = z.infer<typeof listQuerySchema>;
