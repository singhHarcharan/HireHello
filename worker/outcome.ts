export type GmailFailureAction = 'reconnect' | 'pause_limit' | 'retry' | 'fail';

export function classifyGmailFailure(status: number, reason: string | undefined, attempts: number): GmailFailureAction {
  if (status === 401 || reason === 'insufficientPermissions' || reason === 'authError') return 'reconnect';
  if (reason === 'dailyLimitExceeded' || reason === 'userRateLimitExceeded' || reason === 'rateLimitExceeded') return 'pause_limit';
  if (status === 403) return 'pause_limit';
  if ((status === 429 || status >= 500) && attempts < 3) return 'retry';
  return 'fail';
}
