import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "org.clefglide.app",
  appName: "ClefGlide",
  webDir: "dist",
  android: { backgroundColor: "#f6f7f4" },
  plugins: {
    SystemBars: {
      insetsHandling: "native",
      initialViewportFitValueHint: "cover",
      style: "LIGHT",
      hidden: false,
    },
  },
};

export default config;
