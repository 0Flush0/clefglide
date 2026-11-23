import { Capacitor } from "@capacitor/core";

/** Configure the native viewport before React mounts; regular browsers are unchanged. */
export function configureAndroidLayout() {
  if (Capacitor.getPlatform() !== "android") return;
  document.documentElement.dataset.platform = "android";
  const viewport = document.querySelector<HTMLMetaElement>(
    'meta[name="viewport"]',
  );
  if (viewport) {
    viewport.content = /\bviewport-fit\s*=/.test(viewport.content)
      ? viewport.content.replace(
          /\bviewport-fit\s*=\s*[^,]+/,
          "viewport-fit=cover",
        )
      : `${viewport.content},viewport-fit=cover`;
  }
}
