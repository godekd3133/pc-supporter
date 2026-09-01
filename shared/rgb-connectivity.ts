import type { AccessoryItem } from "./types";

function accessoryText(item: AccessoryItem) {
  return `${item.name} ${item.rawSpecText ?? ""}`;
}

export function rgbFanVoltageFor(item: AccessoryItem): "5V" | "12V" | "mixed" | undefined {
  if (item.category !== "cooling_fan") return undefined;
  if (item.specs.rgbDeviceVoltage) return item.specs.rgbDeviceVoltage;
  const text = accessoryText(item);
  const operationText = text.match(/작동전압\s*[:：]?\s*([^/]+)/i)?.[1] ?? "";
  const has5v = /(?:LED|ARGB|addressable)[^/]{0,20}5\s*V/i.test(operationText)
    || /ARGB\s*3\s*(?:핀|pin)|5\s*V\s*ARGB/i.test(text);
  const has12v = /(?:LED|RGB)[^/]{0,20}12\s*V/i.test(operationText)
    || /RGB\s*4\s*(?:핀|pin)|12\s*V\s*RGB/i.test(text);
  if (has5v && has12v) return "mixed";
  if (has5v) return "5V";
  if (has12v) return "12V";
  return undefined;
}

export function rgbFanDeviceCountFor(item: AccessoryItem) {
  if (item.category !== "cooling_fan") return undefined;
  const text = accessoryText(item);
  if (/(?:non[-\s]?LED|non[-\s]?RGB|비?RGB\s*아님)/i.test(text)) return 0;
  if (!/(?:ARGB|RGB|LED\s*(?:라이트|팬|조명)|(?:LED|ARGB)\s*[512]\s*V)/i.test(text)) return 0;
  const parsed = item.specs.fanCount
    ?? Number(text.match(/팬\s*개수\s*[:：]?\s*(\d+)\s*개/i)?.[1] ?? NaN);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}
