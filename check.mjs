import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

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
assistantAdapter.installHushCollapsedThinkingLayout();
toolAdapter.installHushBuiltInToolShellLayout();
workAdapter.installHushDevWorkMessageLayout();
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
const outcome = (items) => ({ role: "custom", customType: "dev/work-result", display: true,
  content: "Work results: verify against files or test output. Keep user approval steps; report remaining checkouts.\n" + JSON.stringify(items.map(({ id, kind, status, error }) => ({ id, kind, status, error }))),
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
workRow.updateResult({ content: [{ type: "text", text: JSON.stringify(childFailure) }], details: { kind: "run", run: childFailure }, isError: false });
assert.match(workRow.render(100).join("\n"), /\x1b\[31mChild failed:/, "work results show failed children in red even when the tool succeeded");
assert.equal(workRow.render(100)[0], "", "work failure notices add a blank row before the error");
assert.doesNotMatch(workRow.render(100).join("\n"), /raw child error|raw script output/, "work result notices do not expose logs");
workRow.updateResult({ content: [], details: { kind: "runs", runs: { records: [childFailure, { ...childFailure, kind: "process" }] } }, isError: false });
assert.match(workRow.render(100).join("\n"), /Child failed:/, "work list summaries retain failed children");
workRow.updateResult({ content: [], details: { kind: "inspection", inspection: { run: childFailure, logs: [], record: {} } }, isError: false });
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
// Working scene: the backdrop lines Pi places, the actors the terminal holds as frames,
// the loop, the terminal background, freeze/resume, and the widget. Cell size 9x18 renders
// at 2x, so 40 columns is a 720x144 backdrop.
const piTui = await import(`${piRoot}/../pi-tui/dist/index.js`);
const scene = await jiti.import("./lib/working-scene.ts");
const backlit = await jiti.import("./lib/scene/backlit.ts");
const { Canvas } = await jiti.import("./lib/scene/paint.ts");
piTui.setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
piTui.setCellDimensions({ widthPx: 9, heightPx: 18 });
assert.equal(scene.hushWorkingSceneSupported(), true, "Kitty terminals support the scene");
const BG = [35, 33, 54];
const pngOf = (line) => Buffer.from(line.split("\x1b_G").slice(1).map((chunk) => chunk.slice(chunk.indexOf(";") + 1, chunk.indexOf("\x1b\\"))).join(""), "base64");
/** The top-left pixel of an RGB PNG from lib/scene/paint.ts, whose first pixel of each row is stored raw. */
const cornerPixel = (png) => {
  const idat = png.indexOf("IDAT");
  return [...inflateSync(png.subarray(idat + 4, idat + 4 + png.readUInt32BE(idat - 4))).subarray(1, 4)];
};
/** The control strings of the Kitty commands in `data`, without payloads and without continuation chunks. */
const commandsOf = (data) => [...data.matchAll(/\x1b_G([^;\x1b]*)/g)].map((match) => match[1]).filter((controls) => controls.includes("i="));
const key = (controls, name) => Number(new RegExp(`(?:^|,)${name}=(\\d+)`).exec(controls)?.[1]);
const kinds = (data) => commandsOf(data).map((controls) => controls.slice(0, 3));
const LOOP = scene.HUSH_WORKING_SCENE_LOOP_TICKS;

const band = scene.createHushWorkingSceneAnimation();
assert.deepEqual(band.render(40), ["", "", "", ""], "until the terminal reports its background the band holds four empty rows");
assert.equal(band.tick(), undefined, "nothing is shown before the band exists");
assert.equal(band.ticks(), 0, "time stands still while nothing is shown");
assert.equal(band.setBackground(BG), true, "a first background must be rendered");
assert.equal(band.setBackground([...BG]), false, "the same background changes nothing");
assert.equal(band.setBackground(undefined), false, "a later query without an answer keeps the known background");
const bandLines = band.render(40);
assert.equal(bandLines.length, scene.HUSH_WORKING_SCENE_ROWS, "the band is four rows");
assert.match(bandLines[0], /^\x1b_Ga=T,f=100,q=2,C=1,c=40,r=4,i=\d+/, "the backdrop fills the width over four rows without moving the cursor");
assert.deepEqual(bandLines.slice(1), ["", "", ""], "the rows under the image stay empty, as in Pi's own Image component");
assert.deepEqual(piTui.getPngDimensions(pngOf(bandLines[0]).toString("base64")), { widthPx: 720, heightPx: 144 }, "the backdrop is rendered at 2x for small cells");
assert.deepEqual(cornerPixel(pngOf(bandLines[0])), BG, "the scene is painted over the terminal background, so the band has no visible edge");
assert.strictEqual(band.render(40), bandLines, "an unchanged size returns the same lines, so Pi redraws nothing");
// After a redraw of the whole screen Pi places an image it knows by id alone, and Rex has freed it by then.
const { getKittyImagePlacement } = await import(`${piRoot}/../pi-tui/dist/terminal-image.js`);
assert.equal(getKittyImagePlacement(bandLines[0]), undefined, "Pi can place the backdrop only by writing the line that carries it");
const backdropId = key(commandsOf(bandLines[0])[0], "i");

const firstTick = band.tick();
const transmitted = commandsOf(firstTick).filter((controls) => controls.startsWith("a=t,"));
assert.equal(transmitted.length, backlit.BACKLIT_ACTORS.length, "the first tick sends each actor as an image of its own");
assert.ok(transmitted.every((controls) => /^a=t,i=\d+,s=\d+,v=144,f=32,o=z,q=2,m=[01]$/.test(controls)), "an actor is as high as the band, compressed RGBA, and transmitted without a placement");
const actorIds = transmitted.map((controls) => key(controls, "i"));
const spriteWidths = transmitted.map((controls) => key(controls, "s"));
assert.equal(new Set([backdropId, ...actorIds]).size, 3, "the backdrop and the actors are three images");
const placed = commandsOf(firstTick).filter((controls) => controls.startsWith("a=p,"));
assert.deepEqual(placed.map((controls) => key(controls, "i")), actorIds, "each actor is placed in the tick that sends it");
assert.ok(placed.every((controls, layer) => new RegExp(`^a=p,i=\\d+,p=1,P=${backdropId},H=\\d+,X=\\d+,r=4,z=${layer + 1},C=1,q=2$`).test(controls)), "an actor stands relative to the backdrop, over four rows, EVE in front, and no cursor moves");
assert.ok(!kinds(firstTick).includes("a=a"), "a new image shows its first frame unasked");
const heldPose = band.tick();
assert.deepEqual(kinds(heldPose), ["a=p", "a=p"], "while a pose lasts a tick only moves the actors");
assert.ok(heldPose.length < 200, "moving the actors takes a few bytes");
band.tick();
band.tick();
const nextPose = band.tick();
assert.deepEqual(kinds(nextPose), ["a=f", "a=a", "a=p", "a=f", "a=a", "a=p"], "a pose shown for the first time is sent as a frame, named and placed");
assert.ok(nextPose.split("\x1b_G").slice(1).every((chunk) => /^a=[fap],/.test(chunk)), "every continuation chunk of frame data repeats a=f, as the Kitty protocol requires");
commandsOf(nextPose).filter((controls) => controls.startsWith("a=f,")).forEach((controls, actor) => {
  assert.match(controls, /^a=f,i=\d+,x=\d+,y=\d+,s=\d+,v=\d+,f=32,o=z,q=2,m=[01]$/, "a frame is a rectangle laid on a transparent frame");
  assert.ok(key(controls, "s") < spriteWidths[actor], "a frame carries only the pixels the actor covers");
});
assert.deepEqual(commandsOf(nextPose).filter((controls) => controls.startsWith("a=a,")), actorIds.map((id) => `a=a,i=${id},c=2,q=2`), "the new pose is the image's second frame");

// One loop sends every pose once. From then on the terminal holds the scene and a tick only names and places.
while (band.ticks() < LOOP) band.tick();
const heldLoop = [];
for (let tick = 0; tick < LOOP; tick += 1) heldLoop.push(band.tick());
assert.ok(heldLoop.every((commands) => !/a=[tTf],/.test(commands)), "a held loop sends no pixels");
assert.ok(heldLoop.join("").length < LOOP * 200, "a held loop costs a few bytes per tick");
assert.equal(Math.max(...heldLoop.flatMap((commands) => commandsOf(commands).filter((controls) => controls.startsWith("a=a,")).map((controls) => key(controls, "c")))), 240, "an actor holds twelve poses per second of the loop");
assert.deepEqual(commandsOf(heldLoop[4]).filter((controls) => controls.startsWith("a=a,")), actorIds.map((id) => `a=a,i=${id},c=2,q=2`), "the loop names the frames it sent the first time round");
for (const commands of heldLoop) {
  commandsOf(commands).filter((controls) => controls.startsWith("a=p,")).forEach((controls, actor) => {
    // Canvas pixels: a column is 18 wide, and X counts the 9 points of a cell.
    const left = key(controls, "H") * 18 + key(controls, "X") * 2;
    assert.ok(key(controls, "X") < 9 && left + spriteWidths[actor] <= 720, "an actor never leaves the backdrop, and its offset stays inside a cell");
  });
}
const secondHeldLoop = [];
for (let tick = 0; tick < 12; tick += 1) secondHeldLoop.push(band.tick());
assert.deepEqual(secondHeldLoop, heldLoop.slice(0, 12), "the scene repeats exactly after one loop");

band.forgetActors();
assert.deepEqual(kinds(band.tick()), ["a=t", "a=p", "a=t", "a=p"], "actors the terminal freed are sent again on the next tick");
const frozenAt = band.ticks();
assert.deepEqual(commandsOf(band.release()), [backdropId, ...actorIds].map((id) => `a=d,d=I,i=${id},q=2`), "freezing deletes every image of the scene");
assert.equal(band.tick(), undefined, "a frozen scene shows nothing");
assert.equal(band.ticks(), frozenAt, "and keeps its time");
const resumedLines = band.render(40);
assert.notStrictEqual(resumedLines, bandLines, "the next working period sends the band afresh");
assert.deepEqual(resumedLines, bandLines, "with the same backdrop");
assert.deepEqual(kinds(band.tick()), ["a=t", "a=p", "a=t", "a=p"], "and the actors with it");
assert.equal(band.ticks(), frozenAt + 1, "resuming from the tick it froze at");
assert.notStrictEqual(band.render(60), resumedLines, "a resize transmits a new backdrop");
assert.deepEqual(kinds(band.tick()), ["a=t", "a=p", "a=t", "a=p"], "and new actors, since the poses belong to the old size");
band.render(40);
const twin = scene.createHushWorkingSceneAnimation();
twin.setBackground(BG);
twin.render(40);
while (twin.ticks() < band.ticks()) twin.tick();
const anonymous = (commands) => commands.replace(/([iP])=\d+/g, "$1=ID");
assert.deepEqual(anonymous(twin.render(40)[0]), anonymous(band.render(40)[0]), "equal sizes render identical backdrops");
twin.forgetActors();
assert.equal(anonymous(twin.tick()), anonymous(band.tick()), "equal ticks show identical actors");
assert.equal(band.setBackground([250, 244, 237]), true, "a new terminal background must be rendered");
assert.deepEqual(cornerPixel(pngOf(band.render(40)[0])), [250, 244, 237], "a new background repaints the backdrop over it");
band.reset();
assert.equal(band.ticks(), 0, "reset restarts the scene");

// A terminal refuses frames beyond a storage limit, so tall cells hold each pose longer.
piTui.setCellDimensions({ widthPx: 40, heightPx: 120 });
const tall = scene.createHushWorkingSceneAnimation();
tall.setBackground(BG);
tall.render(40);
let tallFrames = "";
for (let tick = 0; tick < 20; tick += 1) tallFrames += tall.tick();
assert.equal(commandsOf(tallFrames).filter((controls) => controls.startsWith("a=f,")).length, 2 * backlit.BACKLIT_ACTORS.length, "sprites too large for twelve poses per second hold six");
piTui.setCellDimensions({ widthPx: 9, heightPx: 18 });

// The scene itself: layers compose to the picture, nothing leaves a sprite, and every motion closes the loop.
for (const actor of backlit.BACKLIT_ACTORS) {
  const width = backlit.backlitSpriteWidth(actor, 144);
  const sprite = new Canvas(width, 144, true);
  const other = new Canvas(width, 144, true);
  for (let pose = 0; pose < 240; pose += 1) {
    sprite.clear();
    backlit.paintBacklitActor(sprite, actor, pose / 12, 720, 144);
    const covered = sprite.coveredRect();
    assert.ok(covered && covered.x > 0 && covered.x + covered.width < width, `${actor} stays inside its sprite at every pose`);
  }
  for (const t of [0, 0.05, 7.3]) {
    sprite.clear();
    other.clear();
    backlit.paintBacklitActor(sprite, actor, t, 720, 144);
    backlit.paintBacklitActor(other, actor, t + backlit.BACKLIT_PERIOD_S, 720, 144);
    assert.ok(Buffer.from(sprite.data).equals(Buffer.from(other.data)), `${actor}'s pose repeats exactly one loop later`);
    assert.ok(Math.abs(backlit.backlitActorX(actor, t, 720, 144) - backlit.backlitActorX(actor, t + backlit.BACKLIT_PERIOD_S, 720, 144)) < 1e-6, `${actor} stands where it stood one loop earlier`);
  }
  // Painting on the terminal background directly, against the sprite laid over it as the terminal does.
  const direct = new Canvas(width, 144);
  direct.vgrad(0, 144, [[0, BG], [1, BG]]);
  backlit.paintBacklitActor(direct, actor, 8.6, 720, 144);
  sprite.clear();
  backlit.paintBacklitActor(sprite, actor, 8.6, 720, 144);
  const rgba = sprite.toRGBA({ x: 0, y: 0, width, height: 144 });
  let worst = 0;
  for (let pixel = 0; pixel < width * 144; pixel += 1) {
    const alpha = rgba[pixel * 4 + 3] / 255;
    for (let channel = 0; channel < 3; channel += 1) {
      worst = Math.max(worst, Math.abs(rgba[pixel * 4 + channel] * alpha + BG[channel] * (1 - alpha) - direct.data[pixel * 3 + channel]));
    }
  }
  assert.ok(worst <= 2, `${actor}'s sprite over the backdrop is the actor painted on the backdrop (off by ${worst})`);
}

piTui.setCapabilities({ images: null, trueColor: true, hyperlinks: true });
assert.equal(scene.hushWorkingSceneSupported(), false, "without Kitty graphics the scene is not offered");
const textOnly = scene.createHushWorkingSceneAnimation();
textOnly.setBackground(BG);
assert.deepEqual(textOnly.render(40), [], "without Kitty graphics nothing is drawn");
piTui.setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
const terminalWrites = [];
let renderRequests = 0;
const fakeTui = (reply) => ({
  fullRedraws: 0,
  requestRender() { renderRequests += 1; },
  queryTerminalColors: async () => reply,
  terminal: { write(data) { terminalWrites.push(data); } },
});
const ticksElapsed = (count) => new Promise((resolve) => setTimeout(resolve, scene.HUSH_WORKING_SCENE_TICK_MS * count));
const widgetAnimation = scene.createHushWorkingSceneAnimation();
const widgetTui = fakeTui({ background: { r: 35, g: 33, b: 54 } });
const widget = scene.createHushWorkingSceneWidget(widgetTui, widgetAnimation);
assert.deepEqual(widget.render(40), ["", "", "", ""], "a first widget waits for the terminal background");
await new Promise((resolve) => setImmediate(resolve));
assert.equal(renderRequests, 1, "the reported background requests one Pi render");
assert.deepEqual(cornerPixel(pngOf(widget.render(40)[0])), BG, "the widget paints over the reported background");
await ticksElapsed(6);
assert.deepEqual(kinds(terminalWrites[0]), ["a=t", "a=p", "a=t", "a=p"], "the first tick writes the actors straight to the terminal");
assert.ok(terminalWrites.length >= 2 && terminalWrites.every((data) => data.startsWith("\x1b_Ga=")), "ticks write only Kitty commands");
assert.equal(renderRequests, 1, "ticks never request a Pi render");
// Pi redraws the whole screen: the display is erased, and in Rex every image with it.
terminalWrites.length = 0;
widgetTui.fullRedraws += 1;
await ticksElapsed(6);
assert.deepEqual(kinds(terminalWrites[0]), ["a=t", "a=p", "a=t", "a=p"], "after Pi redraws the whole screen the next tick sends the actors again");
assert.ok(terminalWrites.slice(1).every((data) => !data.includes("a=t,")), "once");
assert.equal(renderRequests, 1, "the backdrop needs no render of its own: Pi's redraw carried its line");
terminalWrites.length = 0;
widget.dispose();
const shownTicks = widgetAnimation.ticks();
assert.deepEqual(kinds(terminalWrites.join("")), ["a=d", "a=d", "a=d"], "dispose leaves no image in the terminal");
await ticksElapsed(4);
assert.equal(widgetAnimation.ticks(), shownTicks, "dispose stops the clock");
assert.equal(terminalWrites.length, 1, "and the writes");
assert.deepEqual(widget.render(40), [], "a disposed widget renders nothing");
const again = scene.createHushWorkingSceneWidget(fakeTui({ background: { r: 35, g: 33, b: 54 } }), widgetAnimation);
assert.match(again.render(40)[0], /^\x1b_Ga=T,/, "the next working period draws at once with the known background");
await new Promise((resolve) => setImmediate(resolve));
assert.equal(renderRequests, 1, "an unchanged background requests no render");
again.dispose();
const silent = scene.createHushWorkingSceneAnimation();
const silentWidget = scene.createHushWorkingSceneWidget(fakeTui({}), silent);
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(cornerPixel(pngOf(silentWidget.render(40)[0])), [0, 0, 0], "a terminal that never reports its background gets black");
silentWidget.dispose();
// Queries whose answers the test releases by hand, including Pi's late replies after the timeout.
const deferredTui = () => {
  const query = {};
  const tui = {
    fullRedraws: 0,
    requestRender() { renderRequests += 1; },
    queryTerminalColors({ onLateReply }) {
      query.late = onLateReply;
      return new Promise((resolve) => { query.answer = resolve; });
    },
    terminal: { write() {} },
  };
  return { tui, query };
};
const slow = deferredTui();
const slowWidget = scene.createHushWorkingSceneWidget(slow.tui, scene.createHushWorkingSceneAnimation());
renderRequests = 0;
slow.query.answer({});
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(cornerPixel(pngOf(slowWidget.render(40)[0])), [0, 0, 0], "a query that times out paints over black for now");
slow.query.late({ background: { r: 35, g: 33, b: 54 } });
assert.equal(renderRequests, 2, "a late reply after the timeout still requests a render");
assert.deepEqual(cornerPixel(pngOf(slowWidget.render(40)[0])), BG, "a late reply replaces the fallback background");
slow.query.late({ background: { r: 35, g: 33, b: 54 } });
assert.equal(renderRequests, 2, "a repeated late reply requests nothing");
slowWidget.dispose();
for (const resetBetween of [false, true]) {
  const shared = scene.createHushWorkingSceneAnimation();
  shared.setBackground(BG);
  const retired = deferredTui();
  scene.createHushWorkingSceneWidget(retired.tui, shared).dispose();
  if (resetBetween) shared.reset();
  const active = deferredTui();
  const activeWidget = scene.createHushWorkingSceneWidget(active.tui, shared);
  const activeLines = activeWidget.render(40);
  renderRequests = 0;
  retired.query.answer({ background: { r: 0, g: 0, b: 0 } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(activeWidget.render(40), activeLines, "a retired widget's answer leaves the active widget's image alone");
  assert.match(shared.tick(), /^\x1b_Ga=t,/, "the active widget keeps animating after a retired widget's answer");
  active.query.answer({ background: { r: 0, g: 0, b: 0 } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(renderRequests, 1, "the active widget's own answer requests the render for the new background");
  assert.deepEqual(cornerPixel(pngOf(activeWidget.render(40)[0])), [0, 0, 0], "the active widget repaints over the new background");
  activeWidget.dispose();
}

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
