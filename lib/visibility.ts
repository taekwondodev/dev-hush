// dev-hush - shared presentation state for the standalone Hush extension.
//
// Adapted from the Firstmate project's Calm implementation.
// Copyright (c) 2026 Kun Chen. MIT License - see the LICENSE file in this directory.
//
// This module owns only the in-memory presentation flags. Presentation filtering
// must never delete or alter semantic, session, or export data, so the export
// path forces stock rendering for the duration of an /export or /share command.

let active = false;
let stockExportRendering = false;
/** True while Hush presentation filtering is enabled. */
export function hushPresentationIsActive(): boolean {
  return active;
}

export function setHushPresentation(next: boolean): void {
  active = next;
}

/** True while an /export or /share render is in flight and stock output is required. */
export function hushStockExportRenderingIsActive(): boolean {
  return stockExportRendering;
}

export function setHushStockExportRendering(next: boolean): void {
  stockExportRendering = next;
}

/**
 * Stock export rendering bypasses both assistant-note filtering and transcript
 * chrome hiding, so the complete conversation remains available outside the TUI.
 */
export function hushHidesTranscriptChrome(): boolean {
  return active && !stockExportRendering;
}
