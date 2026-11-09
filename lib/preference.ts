// dev-hush - persisted on/off preference.
//
// Copyright (c) 2026 Kun Chen. MIT License - see the LICENSE file in this directory.
//
// The preference lives in a plain local state file named "dev-hush" directly under
// Pi's agent directory (~/.pi/agent by default, PI_CODING_AGENT_DIR when set).
// That directory is Pi runtime territory: this repository never tracks the
// state file and Home Manager never manages it. The file contains exactly
// "on\n" or "off\n"; anything else, including a missing or unreadable file,
// means off.

import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import * as PiCodingAgent from "@earendil-works/pi-coding-agent";

export const HUSH_PREFERENCE_FILE_NAME = "dev-hush";

/**
 * Resolve Pi's agent directory through Pi's exported getAgentDir(), which
 * honors PI_CODING_AGENT_DIR and tilde expansion. If a future Pi stops
 * exporting it, fall back to the documented environment variable and default
 * path instead of failing.
 */
export function hushAgentDir(): string {
  if (typeof PiCodingAgent.getAgentDir === "function") return PiCodingAgent.getAgentDir();
  const envDir = process.env.PI_CODING_AGENT_DIR?.trim();
  if (envDir) return envDir;
  return join(homedir(), ".pi", "agent");
}

export function hushPreferencePath(): string {
  return join(hushAgentDir(), HUSH_PREFERENCE_FILE_NAME);
}

/** Load the persisted preference. Hush is off by default and on any read error. */
export function loadHushPreference(): boolean {
  try {
    return readFileSync(hushPreferencePath(), "utf8").trim() === "on";
  } catch {
    return false;
  }
}

/**
 * Persist the preference atomically (unique temp file plus rename) so a
 * crashed write never leaves a truncated state file. A failure throws a clear
 * error naming the path so /hush can surface it instead of silently applying
 * a toggle that would not survive a restart.
 */
export function persistHushPreference(active: boolean): void {
  const path = hushPreferencePath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporaryPath, active ? "on\n" : "off\n", {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      renameSync(temporaryPath, path);
    } finally {
      rmSync(temporaryPath, { force: true });
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`dev-hush could not persist its preference to ${path}: ${reason}`);
  }
}
