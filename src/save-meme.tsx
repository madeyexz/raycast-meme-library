import { getFrontmostApplication, getSelectedFinderItems, showHUD, showToast, Toast } from "@raycast/api";
import { isImagePath } from "./lib/library";
import { getLibrary, readClipboardSource, saveSource } from "./lib/save";

async function selectedFinderImages(): Promise<string[]> {
  try {
    const app = await getFrontmostApplication();
    if (app.bundleId !== "com.apple.finder") return [];
    return (await getSelectedFinderItems()).map((item) => item.path).filter(isImagePath);
  } catch {
    return [];
  }
}

export default async function Command() {
  const library = getLibrary();
  try {
    const finderImages = await selectedFinderImages();
    if (finderImages.length > 0) {
      const results = await Promise.all(finderImages.map((path) => library.addFile(path)));
      const added = results.filter((result) => !result.duplicate).length;
      await showHUD(`Saved ${added} meme${added === 1 ? "" : "s"} from Finder`);
      return;
    }
    const toast = await showToast({ style: Toast.Style.Animated, title: "Saving meme…" });
    const { meme, duplicate } = await saveSource(library, await readClipboardSource());
    toast.hide();
    await showHUD(duplicate ? "Already in your meme library" : `Saved ${meme.file.endsWith(".gif") ? "GIF" : "image"}`);
  } catch (error) {
    await showToast({
      style: Toast.Style.Failure,
      title: "Could not save meme",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
