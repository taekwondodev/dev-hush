// dev-hush - a standalone conversation-presentation toggle for Pi.
//
// Adapted from the Firstmate project's Calm implementation.
// Copyright (c) 2026 Kun Chen. MIT License - see the LICENSE file in this directory.
//
// Presentation adapters target Pi's assistant/tool-row components. Lifecycle
// hooks track agent_start and agent_settled events.
// ./lib/working-ship.ts owns the animated working presentation this file
// installs. ./lib/preference.ts owns the local state file. Presentation adapters
// probe the exact Pi API seams they patch and degrade independently with one
// clear diagnostic if a future Pi removes them.
//
// Hush changes presentation only. It never intercepts, transforms, reroutes,
// removes, or reorders semantic input, tool execution, model context, session
// storage, or export data; /export and /share render the complete stock
// transcript.
import { type ExtensionAPI, type ExtensionContext, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { getKeybindings } from "@earendil-works/pi-tui";
import { installHushBuiltInToolShellLayout } from "./lib/built-in-tool-shells.ts";
import { installHushCollapsedThinkingLayout } from "./lib/collapsed-thinking.ts";
import { installHushDevWorkMessageLayout } from "./lib/dev-work-messages.ts";
import { loadHushPreference, persistHushPreference } from "./lib/preference.ts";
import {
  hushPresentationIsActive,
  setHushPresentation,
  setHushStockExportRendering,
} from "./lib/visibility.ts";
import {
  HUSH_WORKING_SHIP_WIDGET_KEY,
  createHushWorkingShipAnimation,
  createHushWorkingShipWidget,
} from "./lib/working-ship.ts";

// Each presentation adapter probes the exact Pi API it patches. If a future Pi
// removes that API, only the affected adapter degrades; the rest of Hush keeps
// working.
function installHushPresentationAdapter(name: string, install: () => void): void {
  try {
    install();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`dev-hush: ${name} presentation adapter unavailable, skipping. ${reason}`);
  }
}

export default function (pi: ExtensionAPI) {
  installHushPresentationAdapter("collapsed-thinking", installHushCollapsedThinkingLayout);
  installHushPresentationAdapter("built-in-tool-shells", installHushBuiltInToolShellLayout);
  installHushPresentationAdapter("dev-work-messages", installHushDevWorkMessageLayout);

  let removeTerminalInputHandler: (() => void) | undefined;
  // One logical agent run, tracked from agent_start through agent_settled rather
  // than from turns or tool calls, so the boat never flickers between tool calls,
  // automatic continuations, retries, or compaction that stay inside the same run.
  let agentRunActive = false;
  let workingShipShown = false;
  // One animation instance per extension lifetime. Hiding the working widget
  // freezes this state; the next working period resumes it. session_start resets
  // it so a fresh Pi session starts at the normal initial position. Never
  // module-global.
  const workingShipAnimation = createHushWorkingShipAnimation();

  // Single owner of Hush's working-row presentation choice. The widget is only
  // created or removed on a real transition, so repeated starts cannot duplicate
  // its timer.
  const applyWorkingPresentation = (
    ui: ExtensionUIContext,
    forceStockVisibility = false,
  ): void => {
    const showShip = agentRunActive && hushPresentationIsActive();
    if (showShip !== workingShipShown) {
      workingShipShown = showShip;
      ui.setWidget(
        HUSH_WORKING_SHIP_WIDGET_KEY,
        showShip
          ? (tui) => createHushWorkingShipWidget(tui, workingShipAnimation)
          : undefined,
      );
      ui.setWorkingVisible(!showShip);
    } else if (forceStockVisibility && !showShip) {
      ui.setWorkingVisible(true);
    }
  };

  pi.on("session_start", (_event, ctx) => {
    setHushPresentation(loadHushPreference());
    setHushStockExportRendering(false);
    agentRunActive = false;
    workingShipShown = false;
    // A genuine new session lifetime starts the boat at the normal initial position.
    workingShipAnimation.reset();
    applyWorkingPresentation(ctx.ui, true);
    ctx.ui.setHiddenThinkingLabel(hushPresentationIsActive() ? "" : undefined);
    removeTerminalInputHandler?.();
    removeTerminalInputHandler = ctx.ui.onTerminalInput((data) => {
      if (!getKeybindings().matches(data, "tui.input.submit")) return;

      const input = ctx.ui.getEditorText().trim();
      if (
        input !== "/share" &&
        input !== "/export" &&
        !input.startsWith("/export ")
      ) {
        return;
      }

      // /export and /share render through the same tool renderers the transcript
      // uses, so force stock output for the duration of the command. Session and
      // export data are never filtered; this only concerns the visual components.
      setHushStockExportRendering(true);
      setTimeout(() => {
        setHushStockExportRendering(false);
        const expanded = ctx.ui.getToolsExpanded();
        ctx.ui.setToolsExpanded(!expanded);
        ctx.ui.setToolsExpanded(expanded);
      }, 0);
    });
  });

  pi.on("agent_start", (_event, ctx) => {
    agentRunActive = true;
    applyWorkingPresentation(ctx.ui);
  });

  // agent_settled is emitted from a finally block, so it also covers abort and failure.
  pi.on("agent_settled", (_event, ctx) => {
    agentRunActive = false;
    applyWorkingPresentation(ctx.ui);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    // Prototype hooks outlive extension unloading. Make their captured flags
    // inert before reload can omit or fail to load Hush. A restart removes hooks.
    setHushPresentation(false);
    setHushStockExportRendering(false);
    removeTerminalInputHandler?.();
    removeTerminalInputHandler = undefined;
    agentRunActive = false;
    applyWorkingPresentation(ctx.ui);
  });

  const toggleHush = (ctx: ExtensionContext): void => {
    const active = !hushPresentationIsActive();
    // Persist first: if the state file cannot be written, the toggle fails
    // with a clear error instead of silently reverting on the next restart.
    persistHushPreference(active);
    setHushPresentation(active);
    applyWorkingPresentation(ctx.ui, true);
    ctx.ui.setHiddenThinkingLabel(active ? "" : undefined);

    // Flip expansion twice to force a transcript redraw while preserving the
    // user's exact Ctrl+O tools-expanded state.
    const expanded = ctx.ui.getToolsExpanded();
    ctx.ui.setToolsExpanded(!expanded);
    ctx.ui.setToolsExpanded(expanded);
  };

  pi.registerCommand("hush", {
    description: "Toggle Hush presentation; show all assistant replies while hiding thinking and tool activity.",
    handler: async (_args, ctx) => toggleHush(ctx),
  });

  pi.registerShortcut("ctrl+alt+c", {
    description: "Toggle Hush presentation",
    handler: toggleHush,
  });
}
