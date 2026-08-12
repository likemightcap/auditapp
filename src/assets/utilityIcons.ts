import condenserIcon from "../../assets/equipment-icons/condenser.png";
import heaterIcon from "../../assets/equipment-icons/heater.png";
import dhwIcon from "../../assets/equipment-icons/dhw.png";
import gasMeterIcon from "../../assets/equipment-icons/gas-meter.png";
import electricPanelIcon from "../../assets/equipment-icons/elec-panel.png";
import otherIcon from "../../assets/equipment-icons/other.png";

import type { EntityType, ToolId } from "../types";

export type UtilityToolId = Extract<ToolId, "condenser" | "heater" | "dhw" | "gas" | "electric" | "other">;
export type UtilityEntityType = Extract<EntityType, UtilityToolId>;

const UTILITY_TOOL_IDS: UtilityToolId[] = ["condenser", "heater", "dhw", "gas", "electric", "other"];

const UTILITY_ICONS: Record<UtilityToolId, string> = {
  condenser: condenserIcon,
  heater: heaterIcon,
  dhw: dhwIcon,
  gas: gasMeterIcon,
  electric: electricPanelIcon,
  other: otherIcon,
};

export function isUtilityToolId(id: ToolId): id is UtilityToolId {
  return UTILITY_TOOL_IDS.includes(id as UtilityToolId);
}

export function isUtilityEntityType(type: EntityType): type is UtilityEntityType {
  return UTILITY_TOOL_IDS.includes(type as UtilityToolId);
}

export function getUtilityIconByToolId(id: UtilityToolId): string {
  return UTILITY_ICONS[id];
}

export function getUtilityIconByEntityType(type: UtilityEntityType): string {
  return UTILITY_ICONS[type];
}
