import type { Tool } from '@/types';

export type LiveToolKind = 'http' | 'ado' | 'playwright';

const HTTP_NAMES = /http|rest api|web search|api/i;
const ADO_NAMES = /azure devops|ado/i;
const PW_NAMES = /playwright/i;

export function classifyLiveTool(name: string): LiveToolKind | null {
  if (ADO_NAMES.test(name)) return 'ado';
  if (PW_NAMES.test(name)) return 'playwright';
  if (HTTP_NAMES.test(name)) return 'http';
  return null;
}

export function liveToolsOf(tools: Tool[]): Array<Tool & { kind: LiveToolKind }> {
  return tools
    .filter((tool) => tool.enabled)
    .map((tool) => {
      const kind = classifyLiveTool(tool.name);
      return kind ? { ...tool, kind } : null;
    })
    .filter((tool): tool is Tool & { kind: LiveToolKind } => !!tool);
}

export function parseToolRequest(result: unknown): { name: string; args: Record<string, unknown> } | null {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const rec = result as Record<string, unknown>;
  if (typeof rec.tool === 'string') {
    const args = rec.arguments && typeof rec.arguments === 'object' && !Array.isArray(rec.arguments)
      ? rec.arguments as Record<string, unknown>
      : rec;
    return { name: rec.tool, args };
  }
  const call = rec.toolCall;
  if (call && typeof call === 'object' && !Array.isArray(call)) {
    const inner = call as Record<string, unknown>;
    if (typeof inner.name === 'string') {
      const args = inner.arguments && typeof inner.arguments === 'object' && !Array.isArray(inner.arguments)
        ? inner.arguments as Record<string, unknown>
        : {};
      return { name: inner.name, args };
    }
  }
  return null;
}

export const LIVE_TOOL_HELP = 'Live tools: HTTP / REST API, Azure DevOps, and Playwright. Other catalog tools are labels only.';
