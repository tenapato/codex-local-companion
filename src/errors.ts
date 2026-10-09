export class Failure extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
export function failureCode(error: any): string {
  const info = error?.codexErrorInfo ?? error?.data?.codexErrorInfo;
  const kind = typeof info === 'string' ? info : Object.keys(info ?? {})[0];
  const text = typeof error?.message === 'string' ? error.message : '';
  const status=typeof info==='object'&&info ? info[kind]?.httpStatusCode : undefined;
  if (['usageLimitExceeded','rateLimitExceeded','sessionBudgetExceeded'].includes(kind) || status===429 || /usage limit|rate limit/i.test(text)) return 'usage_limited';
  if (kind === 'unauthorized' || status===401 || /unauthorized|not authenticated|sign in/i.test(text)) return 'login_required';
  if (['responseStreamDisconnected','responseTooManyFailedAttempts'].includes(kind)) return 'incomplete_response';
  if (/reasoning|effort|unsupported setting/i.test(text)) return 'unsupported_settings';
  if (/schema/i.test(text)) return 'invalid_output_schema';
  if (/model.*(?:unsupported|not supported|not found|access|unavailable)/i.test(text)) return 'model_unavailable';
  if (kind === 'contextWindowExceeded') return 'context_limit';
  return 'protocol_error';
}
