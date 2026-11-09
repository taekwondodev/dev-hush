import type { CustomMessageComponent as PiCustomMessageComponent } from "@earendil-works/pi-coding-agent";
import * as PiCodingAgent from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { hushChildFailureNotice, failedDevWorkOutcomeChildren } from "./dev-work-policy.ts";
import { hushHidesTranscriptChrome } from "./visibility.ts";

type MessageState = {
  message?: ConstructorParameters<typeof PiCustomMessageComponent>[0];
};
type MessagePatch = { hidesMessage: (message: MessageState["message"]) => boolean };
const HUSH_WORK_MESSAGES_PATCH = Symbol.for("dev-hush:dev-work-messages:child-failures-red-spaced");
const PREVIOUS_WORK_MESSAGES_PATCHES = [
  Symbol.for("dev-hush:dev-work-messages:pi-0.85.1"),
  Symbol.for("dev-hush:dev-work-messages:child-failures-only"),
];

export function installHushDevWorkMessageLayout(): void {
  const registry = globalThis as typeof globalThis & { [key: symbol]: MessagePatch | undefined };
  for (const key of PREVIOUS_WORK_MESSAGES_PATCHES) {
    const previous = registry[key];
    if (previous) previous.hidesMessage = () => false;
  }
  const hidesMessage: MessagePatch["hidesMessage"] = (message) =>
    hushHidesTranscriptChrome() && message?.role === "custom" &&
    message.display === true && message.customType === "dev/work-outcome";
  const installed = registry[HUSH_WORK_MESSAGES_PATCH];
  if (installed) {
    installed.hidesMessage = hidesMessage;
    return;
  }
  const CustomMessageComponent = PiCodingAgent.CustomMessageComponent;
  if (typeof CustomMessageComponent !== "function" || typeof CustomMessageComponent.prototype.render !== "function") {
    throw new Error("dev-hush requires Pi CustomMessageComponent.render");
  }
  const originalRender = CustomMessageComponent.prototype.render;
  const patch: MessagePatch = { hidesMessage };
  CustomMessageComponent.prototype.render = function (width: number): string[] {
    const state = this as unknown as MessageState;
    if (!patch.hidesMessage(state.message)) return originalRender.call(this, width);
    const failures = failedDevWorkOutcomeChildren(state.message?.details);
    return failures.length > 0
      ? ["", ...new Text(hushChildFailureNotice(failures), 1, 0).render(width)]
      : [];
  };
  registry[HUSH_WORK_MESSAGES_PATCH] = patch;
}
