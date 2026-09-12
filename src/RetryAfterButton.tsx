import { useEffect, useState, type ReactNode } from "react";
import { FiClock } from "react-icons/fi";
import { retryAfterSecondsFromMessage } from "./retry-after";

type RetryAfterButtonProps = {
  message: string;
  onRetry: () => void;
  retrying: boolean;
  idleContent: ReactNode;
  retryingContent: ReactNode;
  className?: string;
  disabled?: boolean;
  testId?: string;
};

export function RetryAfterButton({ message, onRetry, retrying, idleContent, retryingContent, className, disabled = false, testId }: RetryAfterButtonProps) {
  const retryAfterSeconds = retryAfterSecondsFromMessage(message);
  const [remainingSeconds, setRemainingSeconds] = useState(retryAfterSeconds ?? 0);

  useEffect(() => {
    setRemainingSeconds(retryAfterSeconds ?? 0);
    if (!retryAfterSeconds || retryAfterSeconds <= 0) return undefined;
    const timer = window.setInterval(() => {
      setRemainingSeconds((current) => current <= 1 ? 0 : current - 1);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [message, retryAfterSeconds]);

  const waiting = remainingSeconds > 0;
  return <button className={className} data-testid={testId} type="button" onClick={onRetry} disabled={disabled || retrying || waiting} aria-disabled={waiting || undefined} aria-label={waiting ? `${remainingSeconds}초 후 다시 시도할 수 있습니다.` : undefined} title={waiting ? `${remainingSeconds}초 후 다시 시도할 수 있습니다.` : undefined}>{retrying ? retryingContent : waiting ? <><FiClock /> {remainingSeconds}초 후 다시 시도</> : idleContent}</button>;
}
