// Amount input that shows thousands separators while the parent keeps a plain digit string.
import type { InputHTMLAttributes } from "react";

type WonInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  value: string;
  onValueChange: (digits: string) => void;
};

export function formatWonDigits(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits ? Number(digits).toLocaleString("ko-KR") : "";
}

export function WonInput({ value, onValueChange, ...rest }: WonInputProps) {
  return <input {...rest} type="text" inputMode="numeric" autoComplete="off" value={formatWonDigits(value)} onChange={(event) => onValueChange(event.target.value.replace(/\D/g, "").slice(0, 12))} />;
}
