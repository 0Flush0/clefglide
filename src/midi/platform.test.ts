import { afterEach, expect, it, vi } from "vitest";
import { Capacitor } from "@capacitor/core";
import { createMidiAdapter, midiUnavailableReason } from "./platform";
import { HardwareMidi, MidiBus } from "./adapter";
import { AndroidMidi } from "./android";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("retains WEBMIDI.js and secure-context checks in the browser", () => {
  vi.spyOn(Capacitor, "getPlatform").mockReturnValue("web");
  vi.stubGlobal("isSecureContext", false);
  expect(midiUnavailableReason()).toContain("HTTPS or localhost");
  const adapter = createMidiAdapter(new MidiBus(), vi.fn(), vi.fn(), vi.fn());
  expect(adapter).toBeInstanceOf(HardwareMidi);
  adapter.dispose();
});

it("uses the local Android plugin without requiring browser Web MIDI", async () => {
  vi.spyOn(Capacitor, "getPlatform").mockReturnValue("android");
  vi.stubGlobal("navigator", {});
  expect(midiUnavailableReason()).toBeNull();
  const adapter = createMidiAdapter(new MidiBus(), vi.fn(), vi.fn(), vi.fn());
  expect(adapter).toBeInstanceOf(AndroidMidi);
  await adapter.dispose();
});
