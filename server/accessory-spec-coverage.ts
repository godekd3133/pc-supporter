import type { AccessoryCategory, AccessoryItem, AccessorySpecProfile, AccessorySpecProfileAssessment } from "../shared/types";
import {
  fanHubOutputConnectorTypesFor,
  fanHubPortCountFor,
  fanHubPowerInputFor,
  hasRgbControllerEvidenceFor,
  rgbHubPortCountFor,
  rgbVoltageFor
} from "./accessory-connectivity";

const PROFILE_IDS_BY_CATEGORY: Record<AccessoryCategory, AccessorySpecProfile[]> = {
  storage_accessory: ["m2_pcie_adapter_fit", "m2_sata_adapter_fit", "storage_other_not_assessed"],
  cooling_fan: ["cooling_fan_mount_size"],
  thermal_grease: ["thermal_grease_capacity_conductivity"],
  m2_heatsink: ["m2_heatsink_form_factor"],
  gpu_support: ["fit_not_assessed"],
  gpu_cooler: ["fit_not_assessed"],
  memory_cooler: ["fit_not_assessed"],
  thermal_pad: ["fit_not_assessed"],
  fan_hub: ["fan_hub_fan_connectivity", "fan_hub_rgb_connectivity"],
  ups: ["ups_output_w"]
};

function isPositiveFinite(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

function profileAssessment(
  profile: AccessorySpecProfile,
  applicable: boolean,
  missingFields: string[] = []
): AccessorySpecProfileAssessment {
  if (!applicable) return { profile, status: "not_assessed" };
  if (missingFields.length > 0) return { profile, status: "partial", missingFields };
  return { profile, status: "complete" };
}

function isM2FormFactor(value: string | undefined) {
  return typeof value === "string" && /(?:^|[^A-Za-z0-9])M(?:\.?\s*)2(?:$|[^A-Za-z0-9])/i.test(value.trim());
}

function hasM2Spec(item: AccessoryItem) {
  return isM2FormFactor(item.specs.formFactor)
    || (item.specs.supportedFormFactors ?? []).some(isM2FormFactor);
}

function hasM2Text(item: AccessoryItem) {
  return /(?:^|[^A-Za-z0-9])M(?:\.?\s*)2(?:$|[^A-Za-z0-9])/i.test(`${item.name} ${item.model ?? ""} ${item.rawSpecText ?? ""}`);
}

function storageAdapterProfileFor(item: AccessoryItem): AccessorySpecProfile {
  const hasM2 = hasM2Spec(item) || hasM2Text(item);
  if (!hasM2) return "storage_other_not_assessed";

  const text = `${item.name} ${item.model ?? ""} ${item.rawSpecText ?? ""}`;
  if (item.specs.interface === "SATA") return "m2_sata_adapter_fit";
  if (item.specs.interface === "NVMe") return "m2_pcie_adapter_fit";
  if (/SATA/i.test(text) && !/PCI\s*[- ]?E|PCI\s+Express/i.test(text)) return "m2_sata_adapter_fit";
  const hasPcieAdapterEvidence = item.specs.adapterPcieSlotWidth !== undefined || /PCI\s*[- ]?E|PCI\s+Express/i.test(text);
  if (hasPcieAdapterEvidence) return "m2_pcie_adapter_fit";
  return "storage_other_not_assessed";
}

function storageAdapterAssessment(item: AccessoryItem): AccessorySpecProfileAssessment {
  const profile = storageAdapterProfileFor(item);
  if (profile === "storage_other_not_assessed") return profileAssessment(profile, false);

  const hasM2SpecFormat = hasM2Spec(item);
  if (profile === "m2_sata_adapter_fit") {
    return profileAssessment(profile, true, [
      ...(!hasM2SpecFormat ? ["supportedFormFactors"] : []),
      ...(item.specs.interface !== "SATA" ? ["interface"] : [])
    ]);
  }

  const pcieWidth = item.specs.adapterPcieSlotWidth;
  const hasPcieWidth = pcieWidth === 1 || pcieWidth === 4 || pcieWidth === 8 || pcieWidth === 16;
  return profileAssessment(profile, true, [
    ...(!hasM2SpecFormat ? ["supportedFormFactors"] : []),
    ...(item.specs.interface !== "NVMe" ? ["interface"] : []),
    ...(!hasPcieWidth ? ["adapterPcieSlotWidth"] : [])
  ]);
}

function fanHubAssessments(item: AccessoryItem): AccessorySpecProfileAssessment[] {
  const fanPorts = fanHubPortCountFor(item);
  const fanConnectors = fanHubOutputConnectorTypesFor(item);
  const fanPowerInput = fanHubPowerInputFor(item);
  const fanText = `${item.name} ${item.rawSpecText ?? ""}`;
  const hasFanProfileEvidence = isPositiveFinite(fanPorts)
    || fanConnectors.length > 0
    || fanPowerInput !== undefined
    || /(?:팬\s*(?:허브|컨트롤러|분배)|fan\s*(?:hub|controller))/i.test(fanText);

  const rgbPorts = rgbHubPortCountFor(item);
  const rgbVoltage = rgbVoltageFor(item);
  const rgbPowerInput = fanHubPowerInputFor(item);
  const hasRgbProfileEvidence = isPositiveFinite(rgbPorts)
    || rgbVoltage !== undefined
    || hasRgbControllerEvidenceFor(item);

  return [
    profileAssessment("fan_hub_fan_connectivity", hasFanProfileEvidence, [
      ...(!isPositiveFinite(fanPorts) ? ["fanPortCount"] : []),
      ...(fanConnectors.length === 0 ? ["fanOutputConnector"] : []),
      ...(fanPowerInput === undefined ? ["fanPowerInput"] : [])
    ]),
    profileAssessment("fan_hub_rgb_connectivity", hasRgbProfileEvidence, [
      ...(!isPositiveFinite(rgbPorts) ? ["rgbPortCount"] : []),
      ...(rgbVoltage === undefined ? ["rgbDeviceVoltage"] : []),
      ...(rgbPowerInput === undefined ? ["rgbPowerInput"] : [])
    ])
  ];
}

/**
 * Assesses only the explicitly approved accessory profiles. It reads normalized
 * spec fields for completion, except fan-hub fields for which existing text
 * helpers already extract named port, connector, voltage, and input evidence.
 * Crawl quality and stored missingFields are neither read nor changed.
 */
export function assessAccessorySpecProfile(item: AccessoryItem): AccessorySpecProfileAssessment[] {
  switch (item.category) {
    case "storage_accessory":
      return [storageAdapterAssessment(item)];
    case "cooling_fan": {
      const missingFields = [
        ...(!isPositiveFinite(item.specs.lengthMm) ? ["lengthMm"] : []),
        ...(!isPositiveFinite(item.specs.widthMm) ? ["widthMm"] : [])
      ];
      return [profileAssessment("cooling_fan_mount_size", true, missingFields)];
    }
    case "m2_heatsink": {
      const hasSupportedM2FormFactor = hasM2Spec(item);
      return [profileAssessment("m2_heatsink_form_factor", true, hasSupportedM2FormFactor ? [] : ["supportedFormFactors"])];
    }
    case "fan_hub":
      return fanHubAssessments(item);
    case "ups":
      return [profileAssessment("ups_output_w", true, isPositiveFinite(item.specs.outputW) ? [] : ["outputW"])];
    case "thermal_grease":
      return [profileAssessment("thermal_grease_capacity_conductivity", true, [
        ...(!isPositiveFinite(item.specs.capacityG) ? ["capacityG"] : []),
        ...(!isPositiveFinite(item.specs.thermalConductivityWmK) ? ["thermalConductivityWmK"] : [])
      ])];
    case "gpu_support":
    case "gpu_cooler":
    case "memory_cooler":
    case "thermal_pad":
      return [profileAssessment("fit_not_assessed", false)];
  }
}

export function accessorySpecProfileIdsFor(category: AccessoryCategory) {
  return PROFILE_IDS_BY_CATEGORY[category];
}
