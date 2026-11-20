// dev-hush - gapless assistant presentation adapter.
//
// Adapted from the Firstmate project's Calm implementation.
// Source: kunchenguid/firstmate a09090d13ef24ce3cf71d171ade119896d6db301,
// fm-calm-assistant-layout.ts and fm-calm-preservation.ts.
// Copyright (c) 2026 Kun Chen. MIT License - see ../LICENSE.
//
// Pi retains lastMessage for redraws: keep the semantic message there,
// not the filtered presentation copy, so toggles can restore hidden content.
import type { AssistantMessageComponent as PiAssistantMessageComponent } from "@earendil-works/pi-coding-agent";
import * as PiCodingAgent from "@earendil-works/pi-coding-agent";
import { hushHidesTranscriptChrome } from "./visibility.ts";
import { isHushProviderAlert } from "./provider-errors.ts";

type AssistantMessage = Parameters<PiAssistantMessageComponent["updateContent"]>[0];

type AssistantMessagePresentationState = { lastMessage?: AssistantMessage };

type HushCollapsedThinkingPatch = {
  hidesThinking: () => boolean;
};

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

  AssistantMessageComponent.prototype.updateContent = function (message, isStreaming): void {
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

    originalUpdateContent.call(this, presentationMessage, isStreaming);
    if (presentationMessage !== message) (this as unknown as AssistantMessagePresentationState).lastMessage = message;
  };

  registry[HUSH_ASSISTANT_LAYOUT_PATCH] = patch;
}
