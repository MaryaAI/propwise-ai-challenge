import { z } from 'zod';

export const EvidenceSchema = z.object({ sourceId: z.string(), quote: z.string().max(200) });

function Field<T extends z.ZodTypeAny>(value: T) {
  return z.object({
    value: value.nullable(),
    evidence: EvidenceSchema.nullable(),
    status: z.enum(['stated', 'missing', 'ambiguous']),
  });
}

export const ExtractionSchema = z.object({
  intent: z.enum(['requirements', 'property_question', 'change_follow_up', 'other']),
  closed: z.boolean(),
  locations: Field(z.array(z.string())),
  bedrooms: Field(z.object({ min: z.number().int().min(0).max(20), max: z.number().int().min(0).max(20) })),
  budget: Field(
    z.object({
      minAed: z.number().int().positive().nullable(),
      maxAed: z.number().int().positive().nullable(),
      qualifier: z.enum(['around', 'under', 'up_to', 'exact', 'from', 'between']),
    }),
  ),
  propertyType: Field(z.enum(['apartment', 'villa', 'townhouse', 'penthouse'])),
  transaction: Field(z.enum(['buy', 'rent'])),
  preferences: z.array(z.object({ text: z.string().max(100), evidence: EvidenceSchema })).max(5),
  followUp: Field(
    z.object({
      kind: z.enum(['tomorrow', 'today', 'after_weekend', 'weekday', 'in_days', 'unclear']),
      weekday: z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']).nullable(),
      days: z.number().int().min(1).max(60).nullable(),
      time: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
    }),
  ),
  propertyRefs: z.array(z.string()).max(5),
});

export type Extraction = z.infer<typeof ExtractionSchema>;
