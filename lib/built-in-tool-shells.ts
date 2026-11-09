// dev-hush - tool-row presentation adapter. Tool execution and results are untouched.
import * as PiCodingAgent from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { hushHidesTranscriptChrome } from "./visibility.ts";
import { hushChildFailureNotice, failedDevWorkChildren } from "./dev-work-policy.ts";

type ToolRowPresentationState = { toolName: string; result?: { details?: unknown } };
type ToolShellPatch = { hidesShell: () => boolean };
const HUSH_TOOL_SHELL_PATCH = Symbol.for("dev-hush:conversation-tool-shell-layout:child-failures-red-spaced");
const LEGACY_TOOL_SHELL_PATCHES = [
  Symbol.for("dev-hush:conversation-tool-shell-layout:child-failures-only"),
  Symbol.for("dev-hush:conversation-tool-shell-layout:pi-0.87.1:compact-failures"),
  Symbol.for("dev-hush:conversation-tool-shell-layout:pi-0.87.1"),
  Symbol.for("dev-hush:source-aware-tool-shells:pi-0.85.1"),
  Symbol.for("dev-hush:tool-shell-layout:pi-0.85.1"),
  Symbol.for("dev-hush:built-in-tool-shell-layout:pi-0.82.0"),
] as const;

export function installHushBuiltInToolShellLayout(): void {
  const registry = globalThis as typeof globalThis & {
    [key: symbol]: ToolShellPatch | undefined;
  };
  for (const key of LEGACY_TOOL_SHELL_PATCHES) {
    const legacy = registry[key];
    if (legacy) legacy.hidesShell = () => false;
  }
  const hidesShell = (): boolean => hushHidesTranscriptChrome();
  const installed = registry[HUSH_TOOL_SHELL_PATCH];
  if (installed) {
    installed.hidesShell = hidesShell;
    return;
  }

  const ToolExecutionComponent = PiCodingAgent.ToolExecutionComponent;
  if (typeof ToolExecutionComponent !== "function" ||
      typeof ToolExecutionComponent.prototype.render !== "function") {
    throw new Error("dev-hush requires Pi ToolExecutionComponent.render");
  }
  const originalRender = ToolExecutionComponent.prototype.render;
  const patch: ToolShellPatch = { hidesShell };
  ToolExecutionComponent.prototype.render = function (width: number): string[] {
    const state = this as unknown as ToolRowPresentationState;
    if (!patch.hidesShell()) return originalRender.call(this, width);
    const failures = state.toolName === "work" ? failedDevWorkChildren(state.result?.details) : [];
    return failures.length > 0
      ? ["", ...new Text(hushChildFailureNotice(failures), 1, 0).render(width)]
      : [];
  };
  registry[HUSH_TOOL_SHELL_PATCH] = patch;
}
