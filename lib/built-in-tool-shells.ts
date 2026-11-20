// dev-hush - tool-row presentation adapter. Tool execution and results are untouched.
import * as PiCodingAgent from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { hushHidesTranscriptChrome } from "./visibility.ts";
import { hushChildFailureNotice, failedDevWorkChildren } from "./dev-work-policy.ts";

type ToolRowPresentationState = { toolName: string; result?: { details?: unknown } };
type ToolShellPatch = { hidesShell: () => boolean };
const HUSH_TOOL_SHELL_PATCH = Symbol.for("dev-hush:conversation-tool-shell-layout:child-failures-red-spaced");

export function installHushBuiltInToolShellLayout(): void {
  const registry = globalThis as typeof globalThis & {
    [key: symbol]: ToolShellPatch | undefined;
  };
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
