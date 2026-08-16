import { z } from 'zod'

export const languageSchema = z.enum(['java', 'cpp'])
export type Language = z.infer<typeof languageSchema>

export const viewKindSchema = z.enum(['lld', 'hld'])
export type ViewKind = z.infer<typeof viewKindSchema>

export const viewMetaSchema = z.object({
  language: languageSchema.optional(),
  entryPoint: z.string().optional(),
})
export type ViewMeta = z.infer<typeof viewMetaSchema>

/**
 * Declared as an explicit object rather than z.record so that each view is
 * genuinely optional in the resulting type. A project may hold an lld view,
 * an hld view, both, or neither.
 */
export const viewsSchema = z.object({
  lld: viewMetaSchema.optional(),
  hld: viewMetaSchema.optional(),
})
export type Views = z.infer<typeof viewsSchema>

export const projectManifestSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1),
  tags: z.array(z.string()).default([]),
  views: viewsSchema.default({}),
})
export type ProjectManifest = z.infer<typeof projectManifestSchema>

export const VIEW_KINDS: readonly ViewKind[] = ['lld', 'hld']
