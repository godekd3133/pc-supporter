import { resolve } from "node:path";

export function requiredDirectoryArgument(args: string[], name: string) {
  const index = args.indexOf(name);
  if (index === -1) throw new Error(`${name} 경로를 명시해야 합니다. 기본 data 경로는 자동으로 읽지 않습니다.`);
  const value = args[index + 1]?.trim();
  if (!value || value.startsWith("--")) throw new Error(`${name} 값이 필요합니다.`);
  return resolve(value);
}
