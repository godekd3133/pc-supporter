const RETRY_AFTER_MESSAGE_PATTERN = /(?:^|\D)(\d{1,5})\s*초\s*후/;
const MAX_RETRY_AFTER_SECONDS = 24 * 60 * 60;

export function retryAfterSecondsFromMessage(message: string) {
  const match = message.match(RETRY_AFTER_MESSAGE_PATTERN);
  if (!match) return undefined;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) ? Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(0, seconds)) : undefined;
}
