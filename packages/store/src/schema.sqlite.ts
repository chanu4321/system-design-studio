import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  path: text('path').notNull(),
  tags: text('tags').notNull().default('[]'),
  views: text('views').notNull().default('[]'),
  lastOpenedAt: integer('last_opened_at'),
  updatedAt: integer('updated_at').notNull(),
})
