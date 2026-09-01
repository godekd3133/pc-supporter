import type { M2SlotConnectionType, M2SlotOverride, M2SlotProfile, Part } from "../shared/types";
import { M2_SLOT_OVERRIDES_PATH, readJson, writeJson } from "./storage";

export type M2SlotOverrideMap = Record<string, M2SlotOverride>;

let overrideWriteQueue: Promise<void> = Promise.resolve();

const ALLOWED_INTERFACES = new Set(["NVMe", "SATA"]);
const ALLOWED_CONNECTIONS = new Set<M2SlotConnectionType>(["cpu", "chipset", "unknown"]);

export async function readM2SlotOverrides(): Promise<M2SlotOverrideMap> {
  return readJson<M2SlotOverrideMap>(M2_SLOT_OVERRIDES_PATH, {});
}

function normalizedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function normalizeM2SlotId(value: unknown) {
  const raw = normalizedString(value).toUpperCase().replace(/[ -]/g, "_");
  const match = raw.match(/^M\.?2_?([1-8])$/);
  return match ? `M2_${match[1]}` : undefined;
}

function stringList(value: unknown) {
  if (Array.isArray(value)) {
    if (!value.every((item) => typeof item === "string")) return undefined;
    return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
  }
  if (typeof value === "string") return [...new Set(value.split(/[,/]/).map((item) => item.trim()).filter(Boolean))];
  return value === undefined || value === null ? undefined : null;
}

function optionalGeneration(value: unknown) {
  if (value === undefined || value === null || value === "") return { value: undefined as number | undefined };
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 2 || parsed > 6) return { error: "PCIe 세대는 2부터 6 사이의 숫자여야 합니다." };
  return { value: parsed };
}

export function validateM2SlotOverride(partId: string, input: unknown): { value?: M2SlotOverride; errors: string[] } {
  const errors: string[] = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { errors: ["override 본문은 객체여야 합니다."] };
  }
  const body = input as Record<string, unknown>;
  if (!Array.isArray(body.slots) || body.slots.length < 1 || body.slots.length > 8) {
    errors.push("slots는 1개부터 8개 사이여야 합니다.");
  }

  const slots: M2SlotProfile[] = [];
  const seenSlots = new Set<string>();
  if (Array.isArray(body.slots)) {
    body.slots.forEach((rawSlot, index) => {
      if (!rawSlot || typeof rawSlot !== "object" || Array.isArray(rawSlot)) {
        errors.push(`slots[${index}]는 객체여야 합니다.`);
        return;
      }
      const slot = rawSlot as Record<string, unknown>;
      const slotId = normalizeM2SlotId(slot.slotId);
      if (!slotId) {
        errors.push(`slots[${index}].slotId는 M2_1부터 M2_8 형식이어야 합니다.`);
        return;
      }
      if (seenSlots.has(slotId)) {
        errors.push(`${slotId} 슬롯이 중복되었습니다.`);
        return;
      }
      seenSlots.add(slotId);

      const parsedInterfaces = stringList(slot.interfaces);
      if (parsedInterfaces === null || parsedInterfaces?.some((value) => !ALLOWED_INTERFACES.has(value))) {
        errors.push(`${slotId}의 interfaces는 NVMe 또는 SATA만 사용할 수 있습니다.`);
      }
      const interfaces = parsedInterfaces?.filter((value): value is "NVMe" | "SATA" => ALLOWED_INTERFACES.has(value as "NVMe" | "SATA"));
      const generation = optionalGeneration(slot.pcieGeneration);
      if (generation.error) errors.push(`${slotId}: ${generation.error}`);
      const rawConnection = slot.connection === undefined || slot.connection === null || slot.connection === ""
        ? undefined
        : normalizedString(slot.connection) as M2SlotConnectionType;
      if (rawConnection !== undefined && !ALLOWED_CONNECTIONS.has(rawConnection)) {
        errors.push(`${slotId}의 connection은 cpu, chipset, unknown 중 하나여야 합니다.`);
      }
      const sharedWith = stringList(slot.sharedWith);
      if (sharedWith === null) errors.push(`${slotId}의 sharedWith는 문자열 배열 또는 쉼표 구분 문자열이어야 합니다.`);
      if (sharedWith && sharedWith.length > 12) errors.push(`${slotId}의 sharedWith는 12개 이하로 입력해야 합니다.`);
      const hasSharedWith = Object.prototype.hasOwnProperty.call(slot, "sharedWith");
      slots.push({
        slotId,
        ...(interfaces && interfaces.length > 0 ? { interfaces } : {}),
        ...(generation.value !== undefined ? { pcieGeneration: generation.value } : {}),
        ...(rawConnection !== undefined && ALLOWED_CONNECTIONS.has(rawConnection) ? { connection: rawConnection } : {}),
        ...(sharedWith && (sharedWith.length > 0 || hasSharedWith) ? { sharedWith } : {})
      });
    });
  }

  const sourceNote = body.sourceNote === undefined || body.sourceNote === null ? undefined : normalizedString(body.sourceNote);
  if (sourceNote && sourceNote.length > 500) errors.push("sourceNote는 500자 이하로 입력해야 합니다.");
  const sourceUrl = body.sourceUrl === undefined || body.sourceUrl === null ? undefined : normalizedString(body.sourceUrl);
  if (sourceUrl) {
    try {
      const url = new URL(sourceUrl);
      if (url.protocol !== "https:") errors.push("sourceUrl은 HTTPS 주소만 사용할 수 있습니다.");
    } catch {
      errors.push("sourceUrl 형식이 올바르지 않습니다.");
    }
    if (sourceUrl.length > 1000) errors.push("sourceUrl은 1,000자 이하로 입력해야 합니다.");
  }

  if (errors.length > 0) return { errors };
  return {
    value: {
      partId,
      slots,
      ...(sourceNote ? { sourceNote } : {}),
      ...(sourceUrl ? { sourceUrl } : {}),
      updatedAt: new Date().toISOString()
    },
    errors
  };
}

export function m2SlotOverrideCompleteness(part: Part, override: M2SlotOverride | undefined) {
  const errors: string[] = [];
  if (!override) return { complete: false, errors: ["M.2 슬롯 매핑이 등록되지 않았습니다."] };
  const expectedSlotCount = part.specs.m2Slots;
  if (expectedSlotCount === undefined) errors.push("메인보드의 M.2 슬롯 수가 확인되지 않았습니다.");
  if (!Array.isArray(override.slots) || override.slots.length === 0) {
    errors.push("등록된 M.2 슬롯이 없습니다.");
    return { complete: false, errors };
  }
  if (expectedSlotCount !== undefined && override.slots.length !== expectedSlotCount) {
    errors.push(`등록한 슬롯 수가 메인보드의 M.2 슬롯 수(${expectedSlotCount}개)와 다릅니다.`);
  }
  const expectedSlotIds = new Set(Array.from({ length: expectedSlotCount ?? override.slots.length }, (_value, index) => `M2_${index + 1}`));
  const actualSlotIds = new Set(override.slots.map((slot) => slot.slotId));
  if (actualSlotIds.size !== override.slots.length || override.slots.some((slot) => !expectedSlotIds.has(slot.slotId)) || actualSlotIds.size !== expectedSlotIds.size) {
    errors.push(`M2_1부터 M2_${expectedSlotCount ?? override.slots.length}까지 슬롯을 빠짐없이 등록해 주세요.`);
  }
  if (override.slots.some((slot) => !slot.interfaces || slot.interfaces.length === 0)) errors.push("모든 슬롯의 지원 인터페이스를 확인해야 합니다.");
  if (override.slots.some((slot) => slot.pcieGeneration === undefined)) errors.push("모든 슬롯의 PCIe 세대를 확인해야 합니다.");
  if (override.slots.some((slot) => slot.connection === undefined || slot.connection === "unknown")) errors.push("모든 슬롯의 연결 주체를 확인해야 합니다.");
  if (override.slots.some((slot) => slot.sharedWith === undefined)) errors.push("모든 슬롯의 공유 대상을 확인해야 합니다.");
  return { complete: errors.length === 0, errors };
}

export function applyM2SlotOverrides(parts: Part[], overrides: M2SlotOverrideMap) {
  return parts.map((part) => {
    const override = part.category === "motherboard" ? overrides[part.id] : undefined;
    if (!override || override.slots.length === 0) return part;
    return {
      ...part,
      specs: {
        ...part.specs,
        m2SlotProfiles: override.slots
      }
    };
  });
}

export function stripM2SlotOverride(part: Part): Part {
  if (!part.specs.m2SlotProfiles) return part;
  const specs = { ...part.specs };
  delete specs.m2SlotProfiles;
  return { ...part, specs };
}

async function withOverrideWriteLock<T>(mutate: (overrides: M2SlotOverrideMap) => { value: T; changed: boolean } | Promise<{ value: T; changed: boolean }>) {
  const operation = overrideWriteQueue.then(async () => {
    const overrides = await readM2SlotOverrides();
    const result = await mutate(overrides);
    if (result.changed) await writeJson(M2_SLOT_OVERRIDES_PATH, overrides);
    return result.value;
  });
  overrideWriteQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function saveM2SlotOverride(value: M2SlotOverride) {
  return withOverrideWriteLock((overrides) => {
    overrides[value.partId] = value;
    return { value, changed: true };
  });
}

export async function saveM2SlotOverrides(values: M2SlotOverride[]) {
  return withOverrideWriteLock((overrides) => {
    for (const value of values) overrides[value.partId] = value;
    return { value: values, changed: values.length > 0 };
  });
}

export async function deleteM2SlotOverride(partId: string) {
  return withOverrideWriteLock((overrides) => {
    if (!overrides[partId]) return { value: false, changed: false };
    delete overrides[partId];
    return { value: true, changed: true };
  });
}
