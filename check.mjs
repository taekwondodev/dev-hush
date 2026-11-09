import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const agentDir = fileURLToPath(new URL("../../", import.meta.url));
const release = readFileSync(join(agentDir, "install/current-version"), "utf8").trim();
const modules = join(agentDir, "install/releases", release, "node_modules");
const { createJiti } = await import(join(modules, "jiti/lib/jiti.mjs"));
const piRoot = join(modules, "@earendil-works/pi-coding-agent");
const jiti = createJiti(import.meta.url, {
  alias: {
    "@earendil-works/pi-coding-agent": `${piRoot}/dist/index.js`,
    "@earendil-works/pi-tui": `${piRoot}/../pi-tui/dist/index.js`,
  },
});
const [pi, visibility, assistantAdapter, toolAdapter, workAdapter] = await Promise.all([
  import(`${piRoot}/dist/index.js`),
  jiti.import("./lib/visibility.ts"),
  jiti.import("./lib/collapsed-thinking.ts"),
  jiti.import("./lib/built-in-tool-shells.ts"),
  jiti.import("./lib/dev-work-messages.ts"),
]);
pi.initTheme("dark", false);
const legacyAssistantPatch = { hidesThinking: () => true };
globalThis[Symbol.for("dev-hush:assistant-layout:pi-0.85.1")] = legacyAssistantPatch;
const finalOnlyPatch = { hidesThinking: () => true };
globalThis[Symbol.for("dev-hush:assistant-layout:pi-0.87.1:final-only")] = finalOnlyPatch;
// Reproduce the old tool-use render hook so reload must make it inert.
const stockRender = pi.AssistantMessageComponent.prototype.render;
pi.AssistantMessageComponent.prototype.render = function (width) {
  return finalOnlyPatch.hidesThinking() && this.lastMessage?.stopReason === "toolUse"
    ? [] : stockRender.call(this, width);
};
const compactFailuresPatch = { hidesShell: () => true };
globalThis[Symbol.for("dev-hush:conversation-tool-shell-layout:pi-0.87.1:compact-failures")] = compactFailuresPatch;
const legacyWorkPatch = { hidesMessage: () => true };
globalThis[Symbol.for("dev-hush:dev-work-messages:pi-0.85.1")] = legacyWorkPatch;
const legacyToolPatch = { hidesShell: () => true };
globalThis[Symbol.for("dev-hush:source-aware-tool-shells:pi-0.85.1")] = legacyToolPatch;
assistantAdapter.installHushCollapsedThinkingLayout();
toolAdapter.installHushBuiltInToolShellLayout();
workAdapter.installHushDevWorkMessageLayout();
assert.equal(legacyAssistantPatch.hidesThinking(), false, "reload deactivates the prior assistant hook");
assert.equal(finalOnlyPatch.hidesThinking(), false, "reload deactivates the final-only hook");
assert.equal(legacyToolPatch.hidesShell(), false, "reload deactivates the prior tool hook");
assert.equal(compactFailuresPatch.hidesShell(), false, "reload deactivates ordinary tool failure notices");
assert.equal(legacyWorkPatch.hidesMessage(), false, "reload deactivates the previous work-outcome filter");
visibility.setHushPresentation(true);

const intermediate = new pi.AssistantMessageComponent({ role: "assistant", content: [
  { type: "text", text: "working through it" },
], stopReason: "stop" });
assert.match(intermediate.render(100).join("\n"), /working through it/, "intermediate prose is visible immediately");
const finalMessage = { role: "assistant", content: [{ type: "text", text: "As reported above, do you agree?" }], stopReason: "stop" };
const final = new pi.AssistantMessageComponent();
final.updateContent(finalMessage, true);
assert.match(final.render(100).join("\n"), /As reported above/, "streaming prose is visible");
final.updateContent(finalMessage, false);
assert.match(final.render(100).join("\n"), /As reported above/, "completed prose stays visible");
const reportMessage = { role: "assistant", content: [
  { type: "thinking", thinking: "private reasoning" },
  { type: "text", text: "Standards: complete. Spec: complete. Adversarial: pending." },
  { type: "toolCall", id: "wait", name: "bash", arguments: { command: "wait-for-review" } },
], stopReason: "toolUse" };
const report = new pi.AssistantMessageComponent(reportMessage);
assert.match(report.render(100).join("\n"), /Standards: complete/, "a report attached to a tool call is visible");
assert.doesNotMatch(report.render(100).join("\n"), /private reasoning|wait-for-review/, "thinking and tool arguments remain hidden");
final.invalidate();
report.invalidate();
assert.match(report.render(100).join("\n"), /Standards: complete/, "continuation does not hide an earlier report");
assert.deepEqual(reportMessage.content.length, 3, "presentation leaves the semantic message intact");
visibility.setHushPresentation(false);
report.invalidate();
assert.match(report.render(100).join("\n"), /private reasoning/, "disabling Hush restores original thinking content");
visibility.setHushPresentation(true);
report.invalidate();
assert.match(report.render(100).join("\n"), /Standards: complete/, "re-enabling Hush preserves the report");
assert.doesNotMatch(report.render(100).join("\n"), /private reasoning|wait-for-review/, "re-enabling Hush hides thinking and tool arguments");
visibility.setHushStockExportRendering(true);
report.invalidate();
assert.match(report.render(100).join("\n"), /Standards: complete/, "export preserves the report");
assert.match(report.render(100).join("\n"), /private reasoning/, "export restores thinking");
visibility.setHushStockExportRendering(false);
report.invalidate();
const historicalToolUse = new pi.AssistantMessageComponent({ role: "assistant", content: [
  { type: "toolCall", id: "call", name: "bash", arguments: { command: "hidden-command" } },
], stopReason: "toolUse" });
assert.deepEqual(historicalToolUse.render(80), [], "tool-call-only assistant messages remain gapless");

const tool = new pi.ToolExecutionComponent("bash", "script-call", {
  command: "python3 intermediate-script.py",
}, {}, undefined, { requestRender() {} }, process.cwd());
assert.deepEqual(tool.render(80), [], "pending script commands are hidden");
tool.updateResult({ content: [{ type: "text", text: "script output" }], isError: false });
assert.deepEqual(tool.render(80), [], "successful customized tool rows are hidden");
visibility.setHushStockExportRendering(true);
assert.notDeepEqual(tool.render(80), [], "export rendering restores successful tool output");
visibility.setHushStockExportRendering(false);
tool.updateResult({ content: [{ type: "text", text: "Traceback in intermediate-script.py" }], isError: true });
const failureLines = tool.render(100).join("\n");
assert.equal(failureLines, "", "ordinary script failures stay completely hidden");
assert.doesNotMatch(failureLines, /python3|intermediate-script|Traceback/, "failed scripts do not leak commands or output");
visibility.setHushStockExportRendering(true);
assert.match(tool.render(100).join("\n"), /intermediate-script/, "export restores the failed script details");
visibility.setHushStockExportRendering(false);
visibility.setHushPresentation(false);
assert.match(tool.render(100).join("\n"), /Traceback/, "disabling Hush restores raw failure output");
visibility.setHushPresentation(true);

for (const renderShell of ["default", "self"]) {
  const custom = new pi.ToolExecutionComponent("codemode", `custom-${renderShell}`, {}, {}, {
    renderShell,
    renderCall: () => ({ render: () => ["intermediate script source"] }),
    renderResult: () => ({ render: () => ["raw script output"] }),
  }, { requestRender() {} }, process.cwd());
  assert.deepEqual(custom.render(80), [], `${renderShell} custom script calls remain hidden`);
  custom.updateResult({ content: [], isError: true });
  assert.deepEqual(custom.render(100), [], `${renderShell} ordinary custom failures stay hidden`);
  assert.doesNotMatch(custom.render(100).join("\n"), /script source|script output/, `${renderShell} custom failures do not expose scripts`);
}

for (const [stopReason, errorMessage, visible] of [
  ["error", "You have hit your ChatGPT usage limit. Try again in 20 min.", true],
  ["error", "insufficient_quota", true],
  ["error", "Connection error: ECONNREFUSED", true],
  ["error", "503 Service unavailable", true],
  ["error", "fetch failed", true],
  ["error", "Invalid API key", false],
  ["error", "Invalid request: unsupported model", false],
  ["aborted", "Request was aborted", false],
  ["length", "", false],
]) {
  const message = { role: "assistant", content: [], stopReason, errorMessage };
  const failed = new pi.AssistantMessageComponent(message);
  assert.equal(failed.render(100).length > 0, visible, `${stopReason}: ${errorMessage} diagnostic visibility`);
  visibility.setHushStockExportRendering(true);
  failed.invalidate();
  assert.notDeepEqual(failed.render(100), [], "export restores suppressed diagnostics");
  visibility.setHushStockExportRendering(false);
}

for (const name of ["edit", "write"]) {
  const row = new pi.ToolExecutionComponent(name, name, {}, {}, undefined, { requestRender() {} }, process.cwd());
  row.updateResult({ content: [{ type: "text", text: "permission denied" }], isError: true });
  assert.deepEqual(row.render(100), [], `${name} failures remain hidden`);
}

const childId = "12345678-1234-1234-1234-123456789abc";
const childFailure = { id: childId, kind: "agent", status: "failed", error: "raw child error", logs: ["raw script output"] };
const outcome = (items) => ({ role: "custom", customType: "dev/work-outcome", display: true,
  content: "Work outcomes: producer observations, not verification. Read a result from offset 0 when it is not included. Honor dev-cycle checkpoints; report worktrees.\n" + JSON.stringify(items.map(({ id, kind, status, error }) => ({ id, kind, status, error }))),
  details: { attempts: items.map((item) => item.id), children: items.map(({ id, kind }) => ({ id, kind, startedAt: 0 })), outcomes: items }, timestamp: Date.now() });
const childRow = new pi.CustomMessageComponent(outcome([childFailure]));
assert.match(childRow.render(100).join("\n"), /\x1b\[31mChild failed:/, "failed children are red");
assert.equal(childRow.render(100)[0], "", "child notices add a blank row before the error");
assert.match(childRow.render(100).join("\n"), /12345678/, "child failure identifies the attempt");
assert.match(childRow.render(100).join("\n"), /Use \/hush to show details/, "child failures point to the renamed command");
assert.doesNotMatch(childRow.render(100).join("\n"), /raw child error|raw script output/, "child notices do not expose logs");
for (const item of [
  { ...childFailure, kind: "process" },
  { ...childFailure, status: "completed" },
  { ...childFailure, status: "cancelled" },
]) {
  assert.deepEqual(new pi.CustomMessageComponent(outcome([item])).render(100), [], "non-child-failure outcomes stay hidden");
}
visibility.setHushPresentation(false);
assert.match(childRow.render(200).join("\n"), /12345678/, "disabling Hush restores the outcome message");
const contentOnly = { ...outcome([childFailure]), details: { attempts: [childId] } };
visibility.setHushPresentation(true);
assert.deepEqual(new pi.CustomMessageComponent(contentOnly).render(100), [], "failures come from details, not model-visible content");
visibility.setHushPresentation(false);
visibility.setHushPresentation(true);
const workRow = new pi.ToolExecutionComponent("work", "inspect-child", {}, {}, undefined, { requestRender() {} }, process.cwd());
workRow.updateResult({ content: [{ type: "text", text: JSON.stringify(childFailure) }], details: { kind: "attempt", attempt: childFailure }, isError: false });
assert.match(workRow.render(100).join("\n"), /\x1b\[31mChild failed:/, "work results show failed children in red even when the tool succeeded");
assert.equal(workRow.render(100)[0], "", "work failure notices add a blank row before the error");
assert.doesNotMatch(workRow.render(100).join("\n"), /raw child error|raw script output/, "work result notices do not expose logs");
workRow.updateResult({ content: [], details: { kind: "snapshot", snapshot: { records: [childFailure, { ...childFailure, kind: "process" }] } }, isError: false });
assert.match(workRow.render(100).join("\n"), /Child failed:/, "work list summaries retain failed children");
workRow.updateResult({ content: [], details: { kind: "inspection", inspection: childFailure }, isError: false });
assert.match(workRow.render(100).join("\n"), /Child failed:/, "an inspection of a failed child is flagged");
workRow.updateResult({ content: [{ type: "text", text: JSON.stringify(childFailure) }], details: { kind: "log", log: { stream: "result", available: true, text: "" } }, isError: false });
assert.deepEqual(workRow.render(100), [], "stream pages are not failures, whatever their text");
visibility.setHushStockExportRendering(true);
assert.match(childRow.render(200).join("\n"), /raw child error/, "export restores full child outcome details");
visibility.setHushStockExportRendering(false);
assert.match(intermediate.render(100).join("\n"), /working through it/, "earlier assistant replies stay visible");
tool.result = { isError: false };
visibility.setHushPresentation(false);
assert.notDeepEqual(tool.render(80), [], "disabling Hush restores successful tool output");
// Exercise the installed Pi loader and renamed command against disposable state.
const scratch = mkdtempSync(join(tmpdir(), "dev-hush-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
try {
  process.env.PI_CODING_AGENT_DIR = scratch;
  const { loadExtensions } = await import(`${piRoot}/dist/core/extensions/loader.js`);
  const loaded = await loadExtensions([fileURLToPath(new URL("./index.ts", import.meta.url))], scratch);
  assert.deepEqual(loaded.errors, [], "the renamed entry point loads through Pi");
  assert.deepEqual(loaded.warnings ?? [], [], "the renamed entry point has no loader warnings");
  assert.equal(loaded.extensions.length, 1);
  const extension = loaded.extensions[0];
  assert.deepEqual([...extension.commands.keys()], ["hush"], "only /hush is registered");
  assert.ok(extension.shortcuts.has("ctrl+alt+c"), "the existing shortcut is retained");
  let hiddenThinkingLabel;
  const ctx = { ui: {
    setWidget() {}, setWorkingVisible() {},
    setHiddenThinkingLabel(value) { hiddenThinkingLabel = value; },
    onTerminalInput() { return () => {}; },
    getToolsExpanded() { return false; }, setToolsExpanded() {},
  } };
  for (const handler of extension.handlers.get("session_start")) await handler({}, ctx);
  assert.equal(hiddenThinkingLabel, undefined, "a missing preference defaults to off");
  await extension.commands.get("hush").handler("", ctx);
  assert.equal(readFileSync(join(scratch, "dev-hush"), "utf8"), "on\n", "the new command persists the namespaced preference");
  assert.equal(hiddenThinkingLabel, "", "the new command enables the presentation filter");
  for (const handler of extension.handlers.get("session_start")) await handler({}, ctx);
  assert.equal(hiddenThinkingLabel, "", "a fresh session restores the persisted on state");
  await extension.commands.get("hush").handler("", ctx);
  assert.equal(readFileSync(join(scratch, "dev-hush"), "utf8"), "off\n", "the new command can disable the filter");
  for (const handler of extension.handlers.get("session_shutdown")) await handler({}, ctx);
} finally {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  rmSync(scratch, { recursive: true, force: true });
}
console.log("dev-hush installed-Pi renderer, loader and preference checks passed");
