export type ExportFailureCode = 'INPUT_LIMIT_EXCEEDED' | 'OUTPUT_LIMIT_EXCEEDED' | 'ACCESS_REVOKED'
  | 'STORAGE_UNAVAILABLE' | 'GENERATION_FAILED';

export class ExportJobError extends Error {
  constructor(readonly code: ExportFailureCode | 'LEASE_LOST', message: string = code) {
    super(message);
  }
}
