// Failed agent children come from dev's `details`, never from model-visible content:
// `work` results carry a WorkResult, outcome messages carry their full outcome entries.
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const failedAgents = (items: readonly unknown[]): string[] => [...new Set(items.flatMap((item) =>
  record(item) && item.kind === "agent" && item.status === "failed" &&
    typeof item.id === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(item.id)
    ? [item.id] : [],
))];

export function failedDevWorkChildren(details: unknown): string[] {
  if (!record(details)) return [];
  switch (details.kind) {
    case "attempt":
      return failedAgents([details.attempt]);
    case "inspection":
      return failedAgents([details.inspection]);
    case "snapshot":
      return record(details.snapshot) && Array.isArray(details.snapshot.records) ? failedAgents(details.snapshot.records) : [];
    default:
      return [];
  }
}

export function failedDevWorkOutcomeChildren(details: unknown): string[] {
  return record(details) && Array.isArray(details.outcomes) ? failedAgents(details.outcomes) : [];
}

export function hushChildFailureNotice(ids: readonly string[]): string {
  return ids.map((id) => `\x1b[31mChild failed: ${id}. Use /hush to show details.\x1b[39m`).join("\n");
}
