import { describe, it } from 'vitest'
import { describeMetadataStore } from './contract.js'
import { createPostgresStore } from './postgres.js'

const url = process.env.TEST_DATABASE_URL

if (url && url === process.env.DATABASE_URL) {
  describe('MetadataStore contract: postgres', () => {
    it.skip('refusing to run: TEST_DATABASE_URL is the same database as DATABASE_URL', () => {})
  })
} else if (url) {
  describeMetadataStore('postgres', async () => createPostgresStore(url))
} else {
  describe('MetadataStore contract: postgres', () => {
    it.skip('skipped: set TEST_DATABASE_URL to run the Postgres contract suite', () => {})
  })
}
