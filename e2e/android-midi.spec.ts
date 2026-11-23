import { test, expect } from "@playwright/test";

// Browser simulation of the Capacitor bridge. No Android radio or hardware.
test("Android discovers BLE on a gesture and selects it through the existing MIDI picker", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const callbacks: Record<string, (event: unknown) => void> = {};
    const listenerIds: Record<string, string> = {};
    let nextListener = 0;
    const usb = { id: "4:0", name: "USB piano — Port 1" };
    const ble = { id: "ble:01:02:03:04:05:06", name: "Piano (Bluetooth MIDI)" };
    const state = {
      inputs: [usb],
      selectedId: "",
      connection: 0,
      nativeTimeMs: 0,
      status: "Choose your piano input.",
      phase: "idle",
      pendingId: "",
    };
    let permission: ((allow: boolean) => void) | undefined;
    let connection: (() => void) | undefined;
    const simulation = {
      discoveries: 0,
      permission: (allow: boolean) => permission?.(allow),
      connected: () => connection?.(),
      finishScan: () => {
        state.phase = "idle";
        state.status = "Bluetooth discovery finished. Choose your piano input.";
        callbacks.state?.({ ...state });
      },
      disconnect: () => {
        state.selectedId = "";
        ++state.connection;
        state.phase = "idle";
        callbacks.state?.({
          ...state,
          status: "Bluetooth MIDI disconnected. Discover again to reconnect.",
        });
      },
    };
    Object.assign(window, {
      bleMidiSimulation: simulation,
      CapacitorCustomPlatform: { name: "android" },
      Capacitor: {
        PluginHeaders: [
          {
            name: "NativeMidi",
            methods: [
              ...[
                "clock",
                "start",
                "discoverBluetooth",
                "select",
                "stop",
                "removeListener",
              ].map((name) => ({ name, rtype: "promise" })),
              { name: "addListener", rtype: "callback" },
            ],
          },
          {
            name: "AppTheme",
            methods: [{ name: "setTheme", rtype: "promise" }],
          },
          {
            name: "SystemBars",
            methods: [{ name: "setStyle", rtype: "promise" }],
          },
        ],
        nativeCallback: (
          _plugin: string,
          _method: string,
          options: { eventName: string },
          callback: (event: unknown) => void,
        ) => {
          callbacks[options.eventName] = callback;
          const id = String(++nextListener);
          listenerIds[options.eventName] = id;
          return id;
        },
        nativePromise: async (
          plugin: string,
          method: string,
          options: {
            id?: string;
            eventName?: string;
            callbackId?: string;
          } = {},
        ) => {
          if (plugin !== "NativeMidi") return {};
          if (method === "clock") return { nativeTimeMs: performance.now() };
          if (
            method === "removeListener" &&
            listenerIds[options.eventName!] === options.callbackId
          )
            delete callbacks[options.eventName!];
          if (method === "discoverBluetooth") {
            ++simulation.discoveries;
            state.phase = "permission";
            state.status = "Requesting Bluetooth permission…";
            callbacks.state?.({ ...state });
            await new Promise<void>((resolve, reject) => {
              permission = (allow) => {
                if (allow) resolve();
                else {
                  state.phase = "failed";
                  state.status = "Bluetooth permission denied";
                  callbacks.state?.({ ...state });
                  reject(new Error(state.status));
                }
              };
            });
            state.inputs = [usb, ble];
            state.phase = "scanning";
            state.status = "Discovering Bluetooth MIDI for 10 seconds…";
            callbacks.state?.({ ...state });
          }
          if (method === "select") {
            const selectedId = options.id ?? "";
            ++state.connection;
            if (selectedId.startsWith("ble:")) {
              state.selectedId = "";
              state.pendingId = selectedId;
              state.phase = "connecting";
              state.status = "Connecting Bluetooth MIDI…";
              callbacks.state?.({ ...state });
              await new Promise<void>((resolve) => {
                connection = resolve;
              });
            }
            state.selectedId = selectedId;
            state.pendingId = "";
            state.phase = "connected";
            state.status = "Piano connected";
            callbacks.state?.({ ...state });
          }
          return { ...state };
        },
      },
    });
    localStorage.setItem("sightflow-language", "en");
  });
  await page.goto("/");
  const discoveries = () =>
    page.evaluate(
      () =>
        (window as unknown as { bleMidiSimulation: { discoveries: number } })
          .bleMidiSimulation.discoveries,
    );
  expect(await discoveries()).toBe(0);
  await expect(
    page.getByRole("button", { name: "Connect MIDI", exact: true }),
  ).toHaveCount(0);
  const picker = page.getByRole("combobox", {
    name: "MIDI device",
    exact: true,
  });
  await expect(picker).toHaveValue("4:0");
  expect(await discoveries()).toBe(0);
  const bluetooth = page.getByRole("button", {
    name: "Discover Bluetooth MIDI",
  });
  await bluetooth.click();
  await expect(bluetooth).toBeDisabled();
  await expect(bluetooth).toHaveAttribute("aria-busy", "true");
  await expect(bluetooth.locator(".midi-spinner")).toBeVisible();
  await expect(page.locator(".midi-connection-status")).toHaveText(
    "Requesting Bluetooth permission…",
  );
  await bluetooth.evaluate((button: HTMLButtonElement) => button.click());
  expect(await discoveries()).toBe(1);
  await page.evaluate(() =>
    (
      window as unknown as {
        bleMidiSimulation: { permission: (allow: boolean) => void };
      }
    ).bleMidiSimulation.permission(false),
  );
  await expect(bluetooth).toBeEnabled();
  await expect(page.getByRole("alert")).toContainText("permission denied");
  await bluetooth.click();
  await page.evaluate(() =>
    (
      window as unknown as {
        bleMidiSimulation: { permission: (allow: boolean) => void };
      }
    ).bleMidiSimulation.permission(true),
  );
  await expect(picker.locator("option")).toHaveCount(3);
  await expect(picker).toHaveValue("4:0");
  expect(await discoveries()).toBe(2);
  await expect(bluetooth).toBeDisabled();
  await expect(page.locator(".midi-connection-status")).toContainText(
    "Discovering",
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await bluetooth
      .locator(".midi-spinner")
      .evaluate((icon) => getComputedStyle(icon).animationName),
  ).toBe("none");
  await page.evaluate(() =>
    (
      window as unknown as { bleMidiSimulation: { finishScan: () => void } }
    ).bleMidiSimulation.finishScan(),
  );
  await expect(bluetooth).toBeEnabled();
  await picker.selectOption("ble:01:02:03:04:05:06");
  await expect(bluetooth).toHaveAttribute("aria-busy", "true");
  await expect(picker).toBeDisabled();
  await expect(page.locator(".midi-connection-status")).toHaveText(
    "Connecting Bluetooth MIDI…",
  );
  await page.evaluate(() =>
    (
      window as unknown as { bleMidiSimulation: { connected: () => void } }
    ).bleMidiSimulation.connected(),
  );
  await expect(picker).toHaveValue("ble:01:02:03:04:05:06");
  await expect(bluetooth).toBeEnabled();
  await expect(page.locator(".midi-connection-status")).toHaveText(
    "Piano connected",
  );
  await page
    .getByRole("button", { name: "Start practice", exact: true })
    .click();
  await page.evaluate(() =>
    (
      window as unknown as { bleMidiSimulation: { disconnect: () => void } }
    ).bleMidiSimulation.disconnect(),
  );
  await expect(
    page.getByRole("button", { name: "Start practice", exact: true }),
  ).toBeVisible();
  await expect(picker).toHaveValue("");
  // Phone layout must still fit with both USB and Bluetooth entries available.
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "Discover Bluetooth MIDI" }),
  ).toBeVisible();
});

test("the browser does not expose native Bluetooth discovery", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Discover Bluetooth MIDI" }),
  ).toHaveCount(0);
});

test("web MIDI asks on click, blocks duplicates and restores loading controls after denial or timeout", async ({
  page,
}) => {
  await page.addInitScript(() => {
    let rejectAccess: (reason: Error) => void;
    const simulation = {
      requests: 0,
      fail: (message: string) => rejectAccess(new Error(message)),
    };
    Object.defineProperty(navigator, "requestMIDIAccess", {
      configurable: true,
      value: () => {
        ++simulation.requests;
        return new Promise((_resolve, reject) => {
          rejectAccess = reject;
        });
      },
    });
    Object.assign(window, { webMidiSimulation: simulation });
    localStorage.setItem("sightflow-language", "en");
  });
  await page.goto("/");
  const connect = page.getByRole("button", {
    name: "Connect MIDI",
    exact: true,
  });
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { webMidiSimulation: { requests: number } })
          .webMidiSimulation.requests,
    ),
  ).toBe(0);
  for (const message of ["Permission denied", "MIDI request timed out"]) {
    await connect.click();
    await expect(connect).toBeDisabled();
    await expect(connect).toHaveAttribute("aria-busy", "true");
    await expect(connect.locator(".midi-spinner")).toBeVisible();
    await expect(page.locator(".midi-connection-status")).toHaveText(
      "Requesting MIDI permission…",
    );
    await connect.evaluate((button: HTMLButtonElement) => button.click());
    await page.evaluate(
      (message) =>
        (
          window as unknown as {
            webMidiSimulation: { fail: (message: string) => void };
          }
        ).webMidiSimulation.fail(message),
      message,
    );
    await expect(connect).toBeEnabled();
    await expect(connect).toHaveAttribute("aria-busy", "false");
    await expect(page.getByRole("alert")).toContainText(message);
  }
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { webMidiSimulation: { requests: number } })
          .webMidiSimulation.requests,
    ),
  ).toBe(2);
});
