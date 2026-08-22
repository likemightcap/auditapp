import type { EntityType, ToolId } from "../types";

export interface ToolDefinition {
  id: ToolId;
  label: string;
  group: "TOOLS" | "BUILDING" | "UTILITIES";
  icon: string;
  entityType?: EntityType;
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  { id: "select", label: "Select", group: "TOOLS", icon: "↖" },
  { id: "text", label: "Text", group: "TOOLS", icon: "T", entityType: "text" },
  { id: "rectangle", label: "Rectangle", group: "TOOLS", icon: "▭", entityType: "rectangle" },
  { id: "bumpout", label: "Bump Out", group: "TOOLS", icon: "7" },
  { id: "line", label: "Line", group: "TOOLS", icon: "／", entityType: "line" },
  { id: "wall", label: "Wall", group: "TOOLS", icon: "┃" },

  { id: "door", label: "Door", group: "BUILDING", icon: "◖", entityType: "door" },
  { id: "window", label: "Window", group: "BUILDING", icon: "▭", entityType: "window" },
  { id: "skylight", label: "Skylight", group: "BUILDING", icon: "⬒", entityType: "skylight" },

  { id: "condenser", label: "Condenser", group: "UTILITIES", icon: "C", entityType: "condenser" },
  { id: "heater", label: "Heater", group: "UTILITIES", icon: "H", entityType: "heater" },
  { id: "dhw", label: "DHW", group: "UTILITIES", icon: "W", entityType: "dhw" },
  { id: "gas", label: "Gas", group: "UTILITIES", icon: "G", entityType: "gas" },
  { id: "electric", label: "Electric", group: "UTILITIES", icon: "E", entityType: "electric" },
  { id: "other", label: "Other", group: "UTILITIES", icon: "●", entityType: "other" },
];

export function getToolDefinition(toolId: ToolId): ToolDefinition | undefined {
  return TOOL_DEFINITIONS.find((tool) => tool.id === toolId);
}
