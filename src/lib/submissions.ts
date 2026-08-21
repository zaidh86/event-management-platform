import type { RegistrationField, SubmissionConfig } from './types'

// jsonb from the DB is untyped; '{}' (or a missing column on a pre-00016 row)
// means: no deadline, no extra fields, results hidden.
export function normalizeSubmissionConfig(raw: unknown): SubmissionConfig {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    deadline: typeof src.deadline === 'string' && src.deadline !== '' ? src.deadline : null,
    instructions: typeof src.instructions === 'string' ? src.instructions : '',
    fields: Array.isArray(src.fields) ? (src.fields as RegistrationField[]) : [],
    results_visibility: src.results_visibility === 'participants' ? 'participants' : 'hidden',
  }
}

export function deadlinePassed(config: SubmissionConfig): boolean {
  return config.deadline !== null && Date.now() > new Date(config.deadline).getTime()
}
