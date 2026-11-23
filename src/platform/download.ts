import { Capacitor, registerPlugin } from "@capacitor/core";
import { download as browserDownload } from "../progress/store";

const ProgressFiles = registerPlugin<{
  save(options: { name: string; body: string; type: string }): Promise<void>;
}>("ProgressFiles");

/** Preserve browser downloads; Android saves the same bytes via its file picker. */
export async function download(
  name: string,
  body: string,
  type = "application/json",
) {
  if (Capacitor.getPlatform() === "android") {
    await ProgressFiles.save({ name, body, type });
  } else {
    browserDownload(name, body, type);
  }
}
