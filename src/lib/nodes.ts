import type { NodePaletteItem } from '@/types';
import { CONTROL_PALETTE, DATA_PALETTE, INTEGRATION_PALETTE } from '@/types';

/** Nodes the engine actually executes. Everything else is a canvas stub. */
export const LIVE_NODE_TYPES = new Set([
  'start', 'end', 'condition', 'switch', 'router', 'loop', 'parallel', 'merge',
  'wait', 'approval', 'input', 'output', 'transform', 'filter', 'map', 'json-parser',
  'http-request', 'api-request', 'rest-api', 'playwright-mcp',
  'azure-devops', 'azure-devops-mcp',
]);

export const STUB_NODE_TYPES = new Set([
  'retry', 'error-handler', 'file-reader', 'db-query',
  'github', 'sharepoint', 'email', 'teams', 'slack', 'powerbi',
]);

export function isStubNodeType(nodeType: string | undefined): boolean {
  return !!nodeType && STUB_NODE_TYPES.has(nodeType);
}

export function isLiveNodeType(nodeType: string | undefined): boolean {
  return !!nodeType && LIVE_NODE_TYPES.has(nodeType);
}

export function livePaletteItems(items: NodePaletteItem[]): NodePaletteItem[] {
  return items.filter((item) => !isStubNodeType(item.type));
}

export function stubPaletteItems(items: NodePaletteItem[]): NodePaletteItem[] {
  return items.filter((item) => isStubNodeType(item.type));
}

export const LIVE_CONTROL_PALETTE = livePaletteItems(CONTROL_PALETTE);
export const LIVE_DATA_PALETTE = livePaletteItems(DATA_PALETTE);
export const LIVE_INTEGRATION_PALETTE = livePaletteItems(INTEGRATION_PALETTE);
export const STUB_CONTROL_PALETTE = stubPaletteItems(CONTROL_PALETTE);
export const STUB_DATA_PALETTE = stubPaletteItems(DATA_PALETTE);
export const STUB_INTEGRATION_PALETTE = stubPaletteItems(INTEGRATION_PALETTE);

export const LIVE_TRIGGERS = ['manual', 'scheduled', 'api', 'webhook', 'azure-devops-workitem', 'github-pr'] as const;
