import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { download, Library, pickSource } from "../src/lib/library.ts";

// Smallest valid GIF89a and PNG headers. The library checks magic bytes, not extensions.
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("pickSource prefers the <img> URL, so a browser 'Copy Image' keeps the GIF animation", () => {
  // Chrome puts a static bitmap, the page HTML, and sometimes a temp file on the clipboard.
  const copied = {
    text: "",
    file: "/var/folders/x/clipboard.png",
    html: `<meta charset="utf-8"><img src="https://media.example.com/cat.gif?a=1&amp;b=2" alt="cat">`,
  };
  assert.deepEqual(pickSource(copied), { kind: "url", url: "https://media.example.com/cat.gif?a=1&b=2" });
  assert.deepEqual(pickSource({ text: "", file: "/Users/me/Downloads/dance.gif" }), {
    kind: "file",
    path: "/Users/me/Downloads/dance.gif",
  });
  assert.deepEqual(pickSource({ text: "  https://i.imgur.com/abc.gif \n" }), {
    kind: "url",
    url: "https://i.imgur.com/abc.gif",
  });
  // A copied PDF or a sentence is not a meme; fall back to the raw clipboard bitmap.
  assert.deepEqual(pickSource({ text: "report.pdf", file: "/Users/me/report.pdf" }), { kind: "raw-image" });
  assert.deepEqual(pickSource({ text: "lol look at this https://x.com/a.gif" }), { kind: "raw-image" });
});

test("Library saves downloads by content type, skips duplicates, and lists recently used first", async () => {
  const server = createServer((req, res) => {
    // The URL says .png but the bytes are a GIF; the saved file must keep the GIF type.
    res.end(req.url === "/fake.png" ? GIF : PNG);
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  try {
    const library = new Library(await mkdtemp(join(tmpdir(), "memes-")));

    const gif = await download(`http://127.0.0.1:${port}/fake.png`);
    const first = await library.add(gif.data, gif.name);
    assert.equal(first.duplicate, false);
    assert.match(first.meme.file, /\.gif$/);
    assert.deepEqual(await readFile(first.meme.path), GIF);

    const again = await library.add(GIF);
    assert.equal(again.duplicate, true);

    await new Promise((resolve) => setTimeout(resolve, 5));
    const png = await library.add(PNG, "thumbs-up.png");
    assert.equal(png.meme.title, "thumbs up");
    await writeFile(join(library.folder, "notes.txt"), "not a meme");
    await assert.rejects(library.add(Buffer.from("<html>nope</html>")), /not a GIF/);

    assert.deepEqual(
      (await library.list()).map((meme) => meme.file),
      [png.meme.file, first.meme.file],
    );
    await library.markUsed(first.meme);
    await library.update(first.meme, { tags: ["cat", "dance"] });
    const [top] = await library.list();
    assert.equal(top.file, first.meme.file);
    assert.deepEqual(top.tags, ["cat", "dance"]);
    assert.equal(top.useCount, 1);

    await library.remove(png.meme);
    assert.deepEqual((await readdir(library.folder)).sort(), [".meme-library.json", first.meme.file, "notes.txt"].sort());
  } finally {
    server.close();
  }
});
