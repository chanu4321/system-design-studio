import { bigint, pgTable, text } from 'drizzle-orm/pg-core'

export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  path: text('path').notNull(),
  tags: text('tags').notNull().default('[]'),
  views: text('views').notNull().default('[]'),
  lastOpenedAt: bigint('last_opened_at', { mode: 'number' }),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
})
