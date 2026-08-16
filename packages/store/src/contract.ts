import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { MetadataStore, ProjectRecord } from './types.js'

export function describeMetadataStore(name: string, factory: () => Promise<MetadataStore>): void {
  describe(`MetadataStore contract: ${name}`, () => {
    let store: MetadataStore

    const record = (over: Partial<ProjectRecord> = {}): ProjectRecord => ({
      id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      title: 'Parking Lot',
      path: 'parking-lot',
      tags: ['oop', 'java'],
      views: ['lld'],
      lastOpenedAt: null,
      updatedAt: 1_700_000_000_000,
      ...over,
    })

    beforeEach(async () => {
      store = await factory()
      await store.init()
      for (const p of await store.listProjects()) await store.deleteProject(p.id)
    })

    afterAll(async () => {
      await store?.close()
    })

    it('returns an empty list before anything is stored', async () => {
      expect(await store.listProjects()).toEqual([])
    })

    it('round-trips a project including array fields', async () => {
      await store.upsertProject(record())
      const got = await store.getProject('3f2504e0-4f89-41d3-9a0c-0305e82c3301')
      expect(got).toEqual(record())
    })

    it('returns null for an unknown id', async () => {
      expect(await store.getProject('00000000-0000-4000-8000-000000000000')).toBeNull()
    })

    it('upsert overwrites an existing row rather than duplicating it', async () => {
      await store.upsertProject(record())
      await store.upsertProject(record({ title: 'Parking Lot v2', views: ['lld', 'hld'] }))
      const all = await store.listProjects()
      expect(all).toHaveLength(1)
      expect(all[0]?.title).toBe('Parking Lot v2')
      expect(all[0]?.views).toEqual(['lld', 'hld'])
    })

    it('preserves an empty tag list rather than turning it into null', async () => {
      await store.upsertProject(record({ tags: [] }))
      expect((await store.getProject(record().id))?.tags).toEqual([])
    })

    it('stores and returns lastOpenedAt when set', async () => {
      await store.upsertProject(record({ lastOpenedAt: 1_700_000_123_456 }))
      expect((await store.getProject(record().id))?.lastOpenedAt).toBe(1_700_000_123_456)
    })

    it('deletes a project', async () => {
      await store.upsertProject(record())
      await store.deleteProject(record().id)
      expect(await store.listProjects()).toEqual([])
    })

    it('deleting an unknown id is a no-op rather than an error', async () => {
      await expect(store.deleteProject('00000000-0000-4000-8000-000000000000')).resolves.toBeUndefined()
    })

    it('init is idempotent and safe to call twice', async () => {
      await store.init()
      await store.upsertProject(record())
      expect(await store.listProjects()).toHaveLength(1)
    })
  })
}
