import type { TableConfig } from './types'

// Event table allocation (00022). jsonb from the DB is untyped; '{}' (or a
// missing column on a pre-00022 row) means: disabled, numbering from 1, "Table".
export function normalizeTableConfig(raw: unknown): TableConfig {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const start = Number(src.start_number)
  return {
    enabled: src.enabled === true,
    start_number: Number.isInteger(start) && start > 0 ? start : 1,
    label: typeof src.label === 'string' && src.label.trim() !== '' ? src.label.trim() : 'Table',
  }
}

export function formatTable(config: TableConfig, n: number): string {
  return `${config.label} No. ${n}`
}
