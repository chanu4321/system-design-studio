import { describe, it } from 'vitest'
import { describeMetadataStore } from './contract.js'
import { createPostgresStore } from './postgres.js'

const url = process.env.TEST_DATABASE_URL

if (url) {
  describeMetadataStore('postgres', async () => createPostgresStore(url))
} else {
  describe('MetadataStore contract: postgres', () => {
    it.skip('skipped: set TEST_DATABASE_URL to run the Postgres contract suite', () => {})
  })
}
