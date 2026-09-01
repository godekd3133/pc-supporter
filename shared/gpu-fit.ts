import type { BuildMetrics, Finding, Part, PhysicalEvidenceSource, PciePowerConnectorKind, PciePowerRequirement } from "./types";
import { classifyDataFreshness } from "./data-freshness";
import { physicalSourceCheckNeedsReview } from "./physical-source-check";

export type GpuFitStatus = "compatible" | "incompatible" | "needs_review" | "not_applicable";

export interface GpuDimensionFit {
  status: GpuFitStatus;
  actualMm?: number;
  limitMm?: number;
  clearanceMm?: number;
}

export interface GpuThicknessFit extends GpuDimensionFit {
  warningThresholdMm: number;
}

export interface GpuPowerFit {
  status: GpuFitStatus;
  gpuPowerW?: number;
  recommendedPsuW?: number;
  psuWattageW?: number;
  headroomW?: number;
}

export interface GpuPhysicalFit {
  status: GpuFitStatus;
  gpuSlotOccupancy?: number;
  gpuCableBendClearanceMm?: number;
  caseSidePanelClearanceMm?: number;
  cableClearanceMm?: number;
  evidenceSources?: PhysicalEvidenceSource[];
}

export type PciePowerOptionFitStatus = "compatible" | "blocker" | "unknown";

export interface PciePowerOptionFit {
  status: PciePowerOptionFitStatus;
  missing: PciePowerRequirement[];
  unknown: PciePowerRequirement[];
}

export interface PciePowerMatchResult {
  status: PciePowerOptionFitStatus;
  matchedOptionIndex?: number;
  optionFits: PciePowerOptionFit[];
}

export interface GpuConnectorFit {
  status: GpuFitStatus;
  options: PciePowerRequirement[][];
  requirementsKnown: boolean;
  adapterOptionIndices: number[];
  connectors?: Partial<Record<PciePowerConnectorKind, number>>;
  psuCableType?: Part["specs"]["psuCableType"];
  psuRailType?: Part["specs"]["psuRailType"];
  psuIndependentPcieCableRuns?: number;
  psuPcieCableTopology?: Part["specs"]["psuPcieCableTopology"];
  cableEvidenceSources?: PhysicalEvidenceSource[];
  psuCableTopologyStatus: GpuFitStatus;
  matchedOptionIndex?: number;
  optionFits: PciePowerOptionFit[];
}

export interface GpuFitSummary {
  status: GpuFitStatus;
  length: GpuDimensionFit;
  thickness: GpuThicknessFit;
  power: GpuPowerFit;
  physical: GpuPhysicalFit;
  connector: GpuConnectorFit;
}

export interface GpuPurchaseEvidence {
  status: GpuFitStatus;
  physical: GpuFitStatus;
  pcieCableTopology: GpuFitStatus;
  physicalEvidenceExpected: boolean;
  pcieCableTopologyExpected: boolean;
  sources?: PhysicalEvidenceSource[];
}

export const GPU_THICKNESS_WARNING_MM = 55;

function findingStatusFor(findings: Finding[], ruleId: string): GpuFitStatus | undefined {
  const finding = findings.find((item) => item.ruleId === ruleId && item.severity !== "info");
  if (!finding) return undefined;
  return finding.severity === "blocker" ? "incompatible" : "needs_review";
}

export function pciePowerMatchFor(
  options: PciePowerRequirement[][],
  connectors: Partial<Record<PciePowerConnectorKind, number>> | undefined
): PciePowerMatchResult {
  if (options.length === 0) return { status: "compatible", optionFits: [] };
  const optionFits = options.map((option) => {
    const missing: PciePowerRequirement[] = [];
    const unknown: PciePowerRequirement[] = [];
    for (const requirement of option) {
      const available = connectors?.[requirement.kind];
      if (available === undefined) unknown.push(requirement);
      else if (available < requirement.count) missing.push(requirement);
    }
    return {
      status: unknown.length > 0 ? "unknown" : missing.length > 0 ? "blocker" : "compatible",
      missing,
      unknown
    } satisfies PciePowerOptionFit;
  });
  const matchedOptionIndex = optionFits.findIndex((option) => option.status === "compatible");
  if (matchedOptionIndex >= 0) return { status: "compatible", matchedOptionIndex, optionFits };
  return {
    status: optionFits.some((option) => option.status === "unknown") ? "unknown" : "blocker",
    optionFits
  };
}

function overallStatusFor(statuses: GpuFitStatus[]): GpuFitStatus {
  if (statuses.some((status) => status === "incompatible")) return "incompatible";
  if (statuses.some((status) => status === "needs_review")) return "needs_review";
  return statuses.some((status) => status === "compatible") ? "compatible" : "not_applicable";
}

function requirementKey(requirements: PciePowerRequirement[]) {
  return requirements
    .map((requirement) => `${requirement.kind}:${requirement.count}`)
    .sort()
    .join("|");
}

function pcieEightPinRequirementCount(requirements: PciePowerRequirement[]) {
  return requirements
    .filter((requirement) => requirement.kind === "pcie_8pin_6plus2")
    .reduce((total, requirement) => total + requirement.count, 0);
}

function evidenceSourceFor(part: Part | undefined, category: PhysicalEvidenceSource["category"]): PhysicalEvidenceSource | undefined {
  if (!part || part.category !== category) return undefined;
  const note = part.specs.physicalEvidenceSourceNote?.trim();
  const manufacturerModel = part.specs.physicalEvidenceManufacturerModel?.trim();
  if (!note || !manufacturerModel) return undefined;
  const manufacturerRevision = part.specs.physicalEvidenceManufacturerRevision?.trim();
  const updatedAt = part.specs.physicalEvidenceUpdatedAt?.trim();
  const url = part.specs.physicalEvidenceSourceUrl?.trim();
  const sourceCheck = part.specs.physicalEvidenceSourceCheck;
  return { category, note, manufacturerModel, ...(manufacturerRevision ? { manufacturerRevision } : {}), ...(updatedAt ? { updatedAt } : {}), ...(sourceCheck ? { sourceCheck } : {}), ...(url ? { url } : {}) };
}

function uniqueEvidenceSources(sources: Array<PhysicalEvidenceSource | undefined>) {
  const seen = new Set<string>();
  return sources.filter((source): source is PhysicalEvidenceSource => {
    if (!source) return false;
    const key = `${source.category}:${source.manufacturerModel ?? ""}:${source.manufacturerRevision ?? ""}:${source.updatedAt ?? ""}:${source.sourceCheck?.checkedAt ?? ""}:${source.sourceCheck?.status ?? ""}:${source.note}:${source.url ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hasEvidenceSource(sources: PhysicalEvidenceSource[] | undefined, category: PhysicalEvidenceSource["category"]) {
  return sources?.some((source) => source.category === category) ?? false;
}

function evidenceNeedsRefresh(sources: PhysicalEvidenceSource[] | undefined) {
  return sources?.some((source) => (source.updatedAt !== undefined && ["stale", "unknown"].includes(classifyDataFreshness(source.updatedAt))) || physicalSourceCheckNeedsReview(source.sourceCheck, Boolean(source.url))) ?? false;
}

export function pcieCableTopologyStatusFor(
  options: PciePowerRequirement[][] | undefined,
  match: PciePowerMatchResult | undefined,
  independentRuns: number | undefined,
  topology: Part["specs"]["psuPcieCableTopology"]
): GpuFitStatus {
  if (independentRuns === undefined && topology === undefined) return "not_applicable";
  if (!options || !match || match.status !== "compatible" || match.matchedOptionIndex === undefined) return "needs_review";
  const requiredEightPinCount = pcieEightPinRequirementCount(options[match.matchedOptionIndex] ?? []);
  if (requiredEightPinCount === 0) return "compatible";
  if (topology === "shared" && requiredEightPinCount > 1) return "needs_review";
  return independentRuns !== undefined && independentRuns >= requiredEightPinCount ? "compatible" : "needs_review";
}

export function gpuPurchaseEvidenceFor(fit: GpuFitSummary): GpuPurchaseEvidence {
  const physicalEvidenceExpected = fit.length.status !== "not_applicable" || fit.thickness.status !== "not_applicable" || fit.physical.status !== "not_applicable";
  const physicalBaseStatus = fit.physical.status === "not_applicable" && physicalEvidenceExpected ? "needs_review" : fit.physical.status;
  const physicalSourceComplete = hasEvidenceSource(fit.physical.evidenceSources, "gpu") && hasEvidenceSource(fit.physical.evidenceSources, "case");
  const physical = physicalBaseStatus === "compatible" && !physicalSourceComplete ? "needs_review" : physicalBaseStatus;
  const matchedOption = fit.connector.matchedOptionIndex === undefined ? undefined : fit.connector.options[fit.connector.matchedOptionIndex];
  const pcieCableTopologyExpected = fit.connector.status !== "not_applicable" && matchedOption !== undefined && pcieEightPinRequirementCount(matchedOption) > 1;
  const pcieCableBaseStatus = fit.connector.psuCableTopologyStatus === "not_applicable" && pcieCableTopologyExpected
    ? "needs_review"
    : fit.connector.psuCableTopologyStatus;
  const pcieCableSourceComplete = hasEvidenceSource(fit.connector.cableEvidenceSources, "psu");
  const pcieCableEvidenceNeedsRefresh = evidenceNeedsRefresh(fit.connector.cableEvidenceSources);
  const pcieCableTopology = pcieCableBaseStatus === "compatible" && pcieCableTopologyExpected && (!pcieCableSourceComplete || pcieCableEvidenceNeedsRefresh) ? "needs_review" : pcieCableBaseStatus;
  return {
    status: overallStatusFor([physical, pcieCableTopology]),
    physical,
    pcieCableTopology,
    physicalEvidenceExpected,
    pcieCableTopologyExpected,
    sources: uniqueEvidenceSources([...(fit.physical.evidenceSources ?? []), ...(fit.connector.cableEvidenceSources ?? [])])
  };
}

export function gpuFitSummaryFor(
  metrics: BuildMetrics,
  gpu: Part | undefined,
  computerCase: Part | undefined,
  psu: Part | undefined,
  findings: Finding[] = []
): GpuFitSummary {
  const lengthFindingStatus = findingStatusFor(findings, "gpu-case-length");
  const length: GpuDimensionFit = !gpu
    ? { status: "not_applicable" }
    : metrics.gpuLengthMm !== undefined && metrics.maxGpuLengthMm !== undefined
      ? {
          status: lengthFindingStatus ?? (metrics.gpuClearanceMm !== undefined && metrics.gpuClearanceMm < 0 ? "incompatible" : "compatible"),
          actualMm: metrics.gpuLengthMm,
          limitMm: metrics.maxGpuLengthMm,
          clearanceMm: metrics.gpuClearanceMm
        }
      : { status: lengthFindingStatus ?? "needs_review", actualMm: metrics.gpuLengthMm, limitMm: metrics.maxGpuLengthMm, clearanceMm: metrics.gpuClearanceMm };

  const thicknessFindingStatus = findingStatusFor(findings, "gpu-thickness");
  const thickness: GpuThicknessFit = !gpu
    ? { status: "not_applicable", warningThresholdMm: GPU_THICKNESS_WARNING_MM }
    : {
        status: thicknessFindingStatus ?? (metrics.gpuThicknessMm === undefined ? "needs_review" : metrics.gpuThicknessMm >= GPU_THICKNESS_WARNING_MM ? "needs_review" : "compatible"),
        actualMm: metrics.gpuThicknessMm,
        warningThresholdMm: GPU_THICKNESS_WARNING_MM
      };

  const gpuPowerW = metrics.gpuPowerW;
  const recommendedPsuW = metrics.recommendedPsuW ?? (gpuPowerW === undefined ? undefined : gpuPowerW + (metrics.cpuPowerW ?? 0) + 150);
  const powerFindingStatus = findingStatusFor(findings, "gpu-psu-power");
  const power: GpuPowerFit = !gpu
    ? { status: "not_applicable" }
    : !psu
      ? { status: "needs_review", gpuPowerW, recommendedPsuW }
      : {
          status: powerFindingStatus ?? (gpuPowerW === undefined || recommendedPsuW === undefined || metrics.psuWattageW === undefined
            ? "needs_review"
            : metrics.psuWattageW < recommendedPsuW ? "incompatible" : "compatible"),
          gpuPowerW,
          recommendedPsuW,
          psuWattageW: metrics.psuWattageW,
          headroomW: metrics.powerHeadroomW ?? (metrics.psuWattageW !== undefined && recommendedPsuW !== undefined ? metrics.psuWattageW - recommendedPsuW : undefined)
        };

  const gpuSlotOccupancy = gpu?.specs.gpuSlotOccupancy;
  const gpuCableBendClearanceMm = gpu?.specs.gpuCableBendClearanceMm;
  const caseSidePanelClearanceMm = computerCase?.specs.caseSidePanelClearanceMm;
  const physicalEvidenceSources = uniqueEvidenceSources([evidenceSourceFor(gpu, "gpu"), evidenceSourceFor(computerCase, "case")]);
  const physicalFindingStatus = findingStatusFor(findings, "gpu-cable-clearance");
  const physicalEvidenceNeedsRefresh = evidenceNeedsRefresh(physicalEvidenceSources)
    || physicalSourceCheckNeedsReview(gpu?.specs.physicalEvidenceSourceCheck, Boolean(gpu?.specs.physicalEvidenceSourceUrl))
    || physicalSourceCheckNeedsReview(computerCase?.specs.physicalEvidenceSourceCheck, Boolean(computerCase?.specs.physicalEvidenceSourceUrl));
  const hasPhysicalEvidence = gpuSlotOccupancy !== undefined || gpuCableBendClearanceMm !== undefined || caseSidePanelClearanceMm !== undefined;
  const physical: GpuPhysicalFit = !gpu || !hasPhysicalEvidence
    ? { status: "not_applicable", gpuSlotOccupancy, gpuCableBendClearanceMm, caseSidePanelClearanceMm, evidenceSources: physicalEvidenceSources }
    : {
        status: physicalFindingStatus ?? (physicalEvidenceNeedsRefresh
          ? "needs_review"
          : gpuCableBendClearanceMm === undefined || caseSidePanelClearanceMm === undefined
          ? "needs_review"
          : caseSidePanelClearanceMm < gpuCableBendClearanceMm ? "incompatible" : "compatible"),
        gpuSlotOccupancy,
        gpuCableBendClearanceMm,
        caseSidePanelClearanceMm,
        evidenceSources: physicalEvidenceSources,
        cableClearanceMm: gpuCableBendClearanceMm !== undefined && caseSidePanelClearanceMm !== undefined
          ? caseSidePanelClearanceMm - gpuCableBendClearanceMm
          : undefined
      };

  const options = gpu?.specs.pciePowerOptions;
  const adapterOptions = gpu?.specs.pciePowerAdapterOptions ?? [];
  const adapterOptionKeys = new Set(adapterOptions.map(requirementKey));
  const adapterOptionIndices = (options ?? []).flatMap((option, index) => adapterOptionKeys.has(requirementKey(option)) ? [index] : []);
  const connectors = psu?.specs.pciePowerConnectors;
  const connectorMatch = gpu && psu && options !== undefined ? pciePowerMatchFor(options, connectors) : undefined;
  const psuIndependentPcieCableRuns = psu?.specs.psuIndependentPcieCableRuns;
  const psuPcieCableTopology = psu?.specs.psuPcieCableTopology;
  const cableEvidenceSources = uniqueEvidenceSources([evidenceSourceFor(psu, "psu")]);
  const psuCableTopologyStatus = gpu && psu
    ? pcieCableTopologyStatusFor(options, connectorMatch, psuIndependentPcieCableRuns, psuPcieCableTopology)
    : "not_applicable";
  const connector: GpuConnectorFit = !gpu
    ? { status: "not_applicable", options: [], requirementsKnown: false, adapterOptionIndices: [], psuCableTopologyStatus: "not_applicable", optionFits: [] }
    : !psu
      ? { status: "needs_review", options: options ?? [], requirementsKnown: options !== undefined, adapterOptionIndices, connectors, cableEvidenceSources, psuCableTopologyStatus: "not_applicable", optionFits: (options ?? []).map(() => ({ status: "unknown", missing: [], unknown: [] })) }
      : options === undefined
        ? { status: "needs_review", options: [], requirementsKnown: false, adapterOptionIndices: [], connectors, cableEvidenceSources, psuCableType: psu.specs.psuCableType, psuRailType: psu.specs.psuRailType, psuIndependentPcieCableRuns, psuPcieCableTopology, psuCableTopologyStatus, optionFits: [] }
        : {
          status: connectorMatch?.status === "blocker" ? "incompatible" : connectorMatch?.status === "unknown" ? "needs_review" : "compatible",
          options,
          requirementsKnown: true,
          adapterOptionIndices,
          connectors,
          cableEvidenceSources,
          psuCableType: psu.specs.psuCableType,
          psuRailType: psu.specs.psuRailType,
          psuIndependentPcieCableRuns,
          psuPcieCableTopology,
          psuCableTopologyStatus,
          matchedOptionIndex: connectorMatch?.matchedOptionIndex,
          optionFits: connectorMatch?.optionFits ?? []
        };

  return {
    status: overallStatusFor([length.status, thickness.status, power.status, physical.status, connector.status, connector.psuCableTopologyStatus]),
    length,
    thickness,
    power,
    physical,
    connector
  };
}
