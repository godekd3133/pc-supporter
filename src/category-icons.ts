// PC part icons (Phosphor): one consistent set with a glyph per part type.
import type { IconType } from "react-icons";
import { PiCircuitry, PiComputerTower, PiCpu, PiFan, PiGraphicsCard, PiHardDrive, PiHardDrives, PiMemory, PiPlug } from "react-icons/pi";
import type { PartCategory } from "../shared/types";

export const CATEGORY_ICONS: Record<PartCategory, IconType> = {
  cpu: PiCpu,
  cooler: PiFan,
  motherboard: PiCircuitry,
  memory: PiMemory,
  gpu: PiGraphicsCard,
  ssd: PiHardDrive,
  hdd: PiHardDrives,
  case: PiComputerTower,
  psu: PiPlug
};
