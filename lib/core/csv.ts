import { parse } from 'csv-parse/sync';
import { ApiError, stringField } from './http';
import { normalizeEmail, noHeaderInjection } from './validation';

export type ContactCsvRow = { row: number; emailNormalized: string; recruiterName: string; companyName: string };
export function parseContactCsv(csv: string): { rows: ContactCsvRow[]; errors: { row: number; message: string }[] } {
  let raw: Record<string, unknown>[];
  try { raw = parse(csv, { columns: (headers: string[]) => {
    if (!['email', 'recruiterName', 'companyName'].every(name => headers.includes(name)) || new Set(headers).size !== headers.length) {
      throw new ApiError(400, 'INVALID_CSV_HEADERS', 'CSV headers must include email,recruiterName,companyName without duplicates');
    }
    return headers;
  }, bom: true, skip_empty_lines: true, trim: true, relax_column_count: false }); }
  catch (error) { if (error instanceof ApiError) throw error; throw new ApiError(400, 'INVALID_CSV', 'Could not parse CSV'); }
  if (!raw.length) throw new ApiError(400, 'EMPTY_CSV', 'CSV has no contact rows');
  if (raw.length > 500) throw new ApiError(429, 'LIMIT_REACHED', 'Import at most 500 rows');
  const rows: ContactCsvRow[] = [];
  const errors: { row: number; message: string }[] = [];
  for (let index = 0; index < raw.length; index++) {
    try {
      const emailNormalized = normalizeEmail(raw[index].email);
      const recruiterName = stringField(raw[index].recruiterName, 'recruiterName', 120);
      const companyName = stringField(raw[index].companyName, 'companyName', 120);
      if (!noHeaderInjection(recruiterName) || !noHeaderInjection(companyName)) throw new Error('Names must be one line');
      rows.push({ row: index + 2, emailNormalized, recruiterName, companyName });
    } catch (error) { errors.push({ row: index + 2, message: error instanceof Error ? error.message : 'Invalid row' }); }
  }
  return { rows, errors };
}
