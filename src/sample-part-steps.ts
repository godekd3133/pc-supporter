// 견본견적이 적용된 동안 부품별 ±(업/다운그레이드)는 견본견적들에 들어 있는 부품
// 안에서만 오르내린다. 현재 견적과 소켓/메모리 규격이 맞지 않는 후보는 제외한다.
import type { BuildSelection, Part, PartCategory } from "../shared/types";
import { isKnownPrice } from "../shared/types";
import type { SampleBuildsPayload } from "../shared/sample-builds";
import { buildPerformanceReportFor } from "../shared/relative-performance-index";

export type SampleStep = { target?: Part; reason?: string };

function selectedPart(build: BuildSelection, category: PartCategory, partMap: ReadonlyMap<string, Part>): Part | undefined {
  const selection = category === "memory" ? build.memory[0] : category === "ssd" ? build.ssd[0] : category === "hdd" ? build.hdd[0] : build[category];
  return selection ? partMap.get(selection.partId) : undefined;
}

export function samplePartsByCategory(payload: SampleBuildsPayload): Map<PartCategory, Part[]> {
  const partsById = new Map(payload.parts.map((part) => [part.id, part]));
  const byCategory = new Map<PartCategory, Part[]>();
  for (const sample of payload.samples) {
    for (const line of sample.lines) {
      const part = line.partId ? partsById.get(line.partId) : undefined;
      if (!part) continue;
      const list = byCategory.get(line.category) ?? [];
      if (!list.some((candidate) => candidate.id === part.id)) list.push(part);
      byCategory.set(line.category, list);
    }
  }
  return byCategory;
}

function compatibleWithBuild(candidate: Part, build: BuildSelection, partMap: ReadonlyMap<string, Part>): boolean {
  const cpu = selectedPart(build, "cpu", partMap);
  const motherboard = selectedPart(build, "motherboard", partMap);
  const memory = selectedPart(build, "memory", partMap);
  const same = (a?: string, b?: string) => !a || !b || a.toUpperCase() === b.toUpperCase();
  switch (candidate.category) {
    case "cpu": return same(candidate.specs.socket, motherboard?.specs.socket);
    case "motherboard": return same(candidate.specs.socket, cpu?.specs.socket) && same(candidate.specs.memoryType, memory?.specs.memoryType);
    case "memory": return same(candidate.specs.memoryType, motherboard?.specs.memoryType);
    default: return true;
  }
}

export function sampleStepFor(payload: SampleBuildsPayload, build: BuildSelection, partMap: ReadonlyMap<string, Part>, category: PartCategory, direction: "up" | "down", byCategory = samplePartsByCategory(payload)): SampleStep {
  const current = selectedPart(build, category, partMap);
  if (!current || !isKnownPrice(current.priceWon)) return { reason: "가격 정보가 없어 단계를 바꿀 수 없어요" };
  const candidates = (byCategory.get(category) ?? [])
    .filter((part) => part.id !== current.id && isKnownPrice(part.priceWon) && compatibleWithBuild(part, build, partMap))
    .sort((a, b) => a.priceWon! - b.priceWon!);
  const target = direction === "up"
    ? candidates.find((part) => part.priceWon! > current.priceWon!)
    : [...candidates].reverse().find((part) => part.priceWon! < current.priceWon!);
  return target ? { target } : { reason: direction === "up" ? "견본 견적 안에 더 높은 단계 부품이 없어요" : "견본 견적 안에 더 낮은 단계 부품이 없어요" };
}

/** 견적의 게임 성능 지수 — 외장 GPU가 없으면 CPU 내장 그래픽 기준. */
export function gamingIndexFor(parts: { cpu?: Part; gpu?: Part }): number | undefined {
  return buildPerformanceReportFor({ cpu: parts.cpu, gpu: parts.gpu }).gamingIndex;
}

export function buildGamingIndex(build: BuildSelection, partMap: ReadonlyMap<string, Part>): number | undefined {
  return gamingIndexFor({ cpu: selectedPart(build, "cpu", partMap), gpu: build.useIntegratedGraphics ? undefined : selectedPart(build, "gpu", partMap) });
}

export function buildTotalWon(build: BuildSelection, partMap: ReadonlyMap<string, Part>): number {
  const selections = [build.cpu, build.cooler, build.motherboard, build.gpu, build.case, build.psu, ...build.memory, ...build.ssd, ...build.hdd];
  return selections.reduce((total, selection) => {
    const price = selection ? partMap.get(selection.partId)?.priceWon : undefined;
    return selection && isKnownPrice(price) ? total + price * selection.quantity : total;
  }, 0);
}

/** "+15%", "-8%", 두 배가 넘으면 "약 3.2배". */
export function formatPerformanceDelta(from: number | undefined, to: number | undefined): string | undefined {
  if (from === undefined || to === undefined || from <= 0) return undefined;
  const ratio = to / from;
  if (ratio >= 2) return `약 ${ratio.toFixed(1)}배`;
  const percent = Math.round((ratio - 1) * 100);
  if (percent === 0) return "비슷함";
  return `${percent > 0 ? "+" : ""}${percent}%`;
}
