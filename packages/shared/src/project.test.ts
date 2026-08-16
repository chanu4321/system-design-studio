import { describe, expect, it } from 'vitest'
import { projectManifestSchema } from './project.js'

const validId = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'

describe('projectManifestSchema', () => {
  it('parses a manifest with an lld view', () => {
    const parsed = projectManifestSchema.parse({
      id: validId,
      title: 'Parking Lot',
      tags: ['oop'],
      views: { lld: { language: 'java' } },
    })
    expect(parsed.views.lld?.language).toBe('java')
    expect(parsed.tags).toEqual(['oop'])
  })

  it('defaults tags and views when absent', () => {
    const parsed = projectManifestSchema.parse({ id: validId, title: 'Empty' })
    expect(parsed.tags).toEqual([])
    expect(parsed.views).toEqual({})
  })

  it('allows an hld view with no language', () => {
    const parsed = projectManifestSchema.parse({
      id: validId,
      title: 'URL Shortener',
      views: { hld: {} },
    })
    expect(parsed.views.hld).toEqual({})
    expect(parsed.views.lld).toBeUndefined()
  })

  it('rejects a non-uuid id', () => {
    expect(() => projectManifestSchema.parse({ id: 'not-a-uuid', title: 'X' })).toThrow()
  })

  it('rejects an empty title', () => {
    expect(() => projectManifestSchema.parse({ id: validId, title: '' })).toThrow()
  })

  it('rejects an unknown language', () => {
    expect(() =>
      projectManifestSchema.parse({
        id: validId,
        title: 'X',
        views: { lld: { language: 'rust' } },
      }),
    ).toThrow()
  })
})
