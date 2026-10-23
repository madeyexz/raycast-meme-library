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
    assert.deepEqual(
      (await readdir(library.folder)).sort(),
      [".meme-library.json", ".thumbnails", first.meme.file, "notes.txt"].sort(),
    );
  } finally {
    server.close();
  }
});

test("Library keeps every entry when saves run at the same time, and backs up a damaged index", async () => {
  const library = new Library(await mkdtemp(join(tmpdir(), "memes-")));
  // Six different images: the same GIF header with a different trailing byte each.
  const images = Array.from({ length: 6 }, (_, i) => Buffer.concat([GIF, Buffer.from([i])]));
  // Each Raycast command runs in its own JavaScript context, like this second copy of the module.
  const other = new (await import("../src/lib/library.ts?other-command")).Library(library.folder);
  const results = await Promise.all(images.map((data, i) => (i % 2 ? other : library).add(data, `meme-${i}.gif`)));
  const index = JSON.parse(await readFile(join(library.folder, ".meme-library.json"), "utf8"));
  assert.deepEqual(Object.keys(index).sort(), results.map((r) => r.meme.file).sort());

  await writeFile(join(library.folder, ".meme-library.json"), '{"abc.gif": {"title": "trunc');
  await library.add(PNG, "after-damage.png");
  const files = await readdir(library.folder);
  const backup = files.find((file) => file.startsWith(".meme-library.damaged-"));
  assert.ok(backup, "the damaged index is kept as a backup");
  assert.equal(await readFile(join(library.folder, backup), "utf8"), '{"abc.gif": {"title": "trunc');
  // The grid still lists every image file after the index is lost.
  assert.equal((await library.list()).length, 7);
});

test("download stops a slow server after the time limit", async () => {
  const server = createServer(() => {}); // Never answers.
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  try {
    await assert.rejects(download(`http://127.0.0.1:${port}/slow.gif`, 200), /timed out after 0 s/);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
