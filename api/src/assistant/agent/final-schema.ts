import { z } from 'zod';

export const FinalSchema = z.object({
  recommendations: z
    .array(z.object({ propertyId: z.uuid(), reason: z.string().max(400) }))
    .max(5),
  summary: z.string().max(800),
  reply: z.string().max(1500),
  followUpTask: z.object({ title: z.string().max(200), notes: z.string().max(1000).nullable() }).nullable(),
});

export type FinalOutput = z.infer<typeof FinalSchema>;
