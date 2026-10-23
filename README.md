# Meme Library

A Raycast extension for your own meme library. Save the GIFs and images that you find online, then find them again by looking at a grid. You do not have to remember keywords.

## Commands

| Command | Suggested hotkey | What it does |
| --- | --- | --- |
| **Save Meme** | ⌥⌘S | Saves what you copied to the library. Shows a HUD and does not open a window. |
| **Meme Library** | ⌘⇧H | Opens a grid of your memes. Use the arrow keys to select one. Press Enter to paste it. |

Set hotkeys in Raycast Settings → Extensions → Meme Library.

## How to save a meme

1. In the browser, right-click the image and select **Copy Image** (or **Copy Image Address**).
2. Press the **Save Meme** hotkey.

Save Meme also accepts:

- A file that you copied in Finder.
- Image files that you selected in Finder (Finder must be the frontmost app).
- A static image that you copied from Preview, a screenshot, or another app.
- One of your last 6 clipboard entries: open Meme Library and press ⌘N.

### Animated GIFs

When you copy an image in a browser, macOS puts a **static** bitmap on the clipboard. Save Meme first reads the `<img src>` URL that the browser also puts on the clipboard, and downloads the original file. This keeps the GIF animation. If there is no URL, it uses the copied file, and then the static bitmap.

## Library folder

Memes are normal files in `~/Memes` (you can change this in the preferences). File names are content hashes, so the same meme is not saved two times. Titles, tags, and usage data are in `~/Memes/.meme-library.json`. Images that you put in the folder yourself also show in the grid.

The grid shows the most recently used memes first.

## Development

```bash
npm install
npm run dev     # opens the extension in Raycast
npm test        # library and clipboard-source tests (plain Node)
npm run lint
```
