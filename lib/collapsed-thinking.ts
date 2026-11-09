// dev-hush - gapless assistant presentation adapter.
//
// Adapted from the Firstmate project's Calm implementation.
// Source: kunchenguid/firstmate a09090d13ef24ce3cf71d171ade119896d6db301,
// fm-calm-assistant-layout.ts and fm-calm-preservation.ts.
// Copyright (c) 2026 Kun Chen. MIT License - see ../LICENSE.
//
// Pi 0.85.1 retains lastMessage for redraws: keep the semantic message there,
// not the filtered presentation copy, so toggles can restore hidden content.
import type { AssistantMessageComponent as PiAssistantMessageComponent } from "@earendil-works/pi-coding-agent";
import * as PiCodingAgent from "@earendil-works/pi-coding-agent";
import { hushHidesTranscriptChrome } from "./visibility.ts";
import { isHushProviderAlert } from "./provider-errors.ts";

type AssistantMessage = Parameters<PiAssistantMessageComponent["updateContent"]>[0];

type AssistantMessagePresentationState = {
  hiddenThinkingLabel: string;
  hideThinkingBlock: boolean;
  isStreaming: boolean;
  lastMessage?: AssistantMessage;
};

type HushCollapsedThinkingPatch = {
  hidesThinking: () => boolean;
};

const PREVIOUS_COLLAPSED_THINKING_PATCH = Symbol.for(
  "dev-hush:collapsed-thinking-layout:pi-0.82.0",
);
const PREVIOUS_ASSISTANT_LAYOUT_PATCH = Symbol.for("dev-hush:assistant-layout:pi-0.85.1");
const PREVIOUS_RUN_LAYOUT_PATCH = Symbol.for("dev-hush:assistant-layout:pi-0.87.1");
const PREVIOUS_PROSE_LAYOUT_PATCH = Symbol.for("dev-hush:assistant-layout:pi-0.87.1:preserve-prose");
const PREVIOUS_FINAL_ONLY_PATCH = Symbol.for("dev-hush:assistant-layout:pi-0.87.1:final-only");
const PREVIOUS_CONVERSATION_PATCH = Symbol.for("dev-hush:assistant-layout:conversation-prose");
const HUSH_ASSISTANT_LAYOUT_PATCH = Symbol.for("dev-hush:assistant-layout:provider-alerts-only");

export function installHushCollapsedThinkingLayout(): void {
  const registry = globalThis as typeof globalThis & {
    [key: symbol]: HushCollapsedThinkingPatch | undefined;
  };
  const hidesThinking = (): boolean => hushHidesTranscriptChrome();
  const installed = registry[HUSH_ASSISTANT_LAYOUT_PATCH];
  if (installed) {
    installed.hidesThinking = hidesThinking;
    return;
  }

  const patch: HushCollapsedThinkingPatch = { hidesThinking };
  const AssistantMessageComponent = PiCodingAgent.AssistantMessageComponent;
  if (typeof AssistantMessageComponent !== "function") {
    throw new Error("dev-hush requires Pi AssistantMessageComponent");
  }
  const originalUpdateContent = AssistantMessageComponent.prototype.updateContent;
  if (typeof originalUpdateContent !== "function") {
    throw new Error("dev-hush requires Pi AssistantMessageComponent.updateContent");
  }

  // An already-loaded older adapter cannot be unwrapped, but can be made inert.
  // A distinct registry key installs this upgrade once without stacking on reload.
  const previous = registry[PREVIOUS_COLLAPSED_THINKING_PATCH];
  if (previous) previous.hidesThinking = () => false;
  const previousAssistantLayout = registry[PREVIOUS_ASSISTANT_LAYOUT_PATCH];
  if (previousAssistantLayout) previousAssistantLayout.hidesThinking = () => false;
  const previousRunLayout = registry[PREVIOUS_RUN_LAYOUT_PATCH];
  if (previousRunLayout) previousRunLayout.hidesThinking = () => false;
  const previousProseLayout = registry[PREVIOUS_PROSE_LAYOUT_PATCH];
  if (previousProseLayout) previousProseLayout.hidesThinking = () => false;
  const previousFinalOnly = registry[PREVIOUS_FINAL_ONLY_PATCH];
  if (previousFinalOnly) previousFinalOnly.hidesThinking = () => false;
  const previousConversation = registry[PREVIOUS_CONVERSATION_PATCH];
  if (previousConversation) previousConversation.hidesThinking = () => false;

  AssistantMessageComponent.prototype.updateContent = function (
    ...args: Parameters<PiAssistantMessageComponent["updateContent"]>
  ): void {
    const state = this as unknown as AssistantMessagePresentationState;
    const [message, isStreaming = state.isStreaming] = args;
    const hideChrome = patch.hidesThinking();
    const hideThinking = hideChrome && message.content.some((block) => block.type === "thinking");
    const hideDiagnostic = hideChrome && (
      message.stopReason === "aborted" || message.stopReason === "length" ||
      (message.stopReason === "error" && !isHushProviderAlert(message.errorMessage))
    );
    const presentationMessage = hideThinking || hideDiagnostic
      ? {
          ...message,
          content: hideThinking ? message.content.filter((block) => block.type !== "thinking") : message.content,
          stopReason: hideDiagnostic ? "stop" as const : message.stopReason,
        }
      : message;

    // The pre-upgrade wrapper drops the streaming argument; Pi's default reads
    // this state, so forwarding remains correct through that inert wrapper too.
    state.isStreaming = isStreaming;
    originalUpdateContent.call(this, presentationMessage, isStreaming);
    if (presentationMessage !== message) state.lastMessage = message;
  };

  registry[HUSH_ASSISTANT_LAYOUT_PATCH] = patch;
}
