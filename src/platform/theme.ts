import {
  Capacitor,
  registerPlugin,
  SystemBars,
  SystemBarsStyle,
} from "@capacitor/core";

const AppTheme = registerPlugin<{
  setTheme(options: { dark: boolean }): Promise<void>;
}>("AppTheme");

export async function syncAndroidTheme(dark: boolean) {
  if (Capacitor.getPlatform() !== "android") return;
  // Set the native theme first: Capacitor's SystemBars also reads windowBackground
  // when applying icon colors and reapplying them after configuration changes.
  await AppTheme.setTheme({ dark });
  await SystemBars.setStyle({
    style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light,
  });
}
