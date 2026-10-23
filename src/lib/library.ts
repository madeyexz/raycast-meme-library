import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";

// This module has no Raycast imports, so you can test it with plain Node.

export type Meme = {
  file: string;
  path: string;
  title: string;
  tags: string[];
  addedAt: number;
  lastUsedAt?: number;
  useCount: number;
};

type Entry = Omit<Meme, "file" | "path">;
type Index = Record<string, Entry>;

export type Source =
  { kind: "url"; url: string } | { kind: "file"; path: string } | { kind: "raw-image" } | { kind: "none" };

const INDEX_FILE = ".meme-library.json";
const EXTENSIONS: Record<string, string> = {
  gif: ".gif",
  png: ".png",
  jpeg: ".jpg",
  webp: ".webp",
  heic: ".heic",
};
const IMAGE_EXTENSIONS = new Set([".gif", ".png", ".jpg", ".jpeg", ".webp", ".heic", ".tiff", ".bmp"]);

export function resolveFolder(folder: string | undefined): string {
  const value = folder?.trim() || "~/Memes";
  return value.startsWith("~") ? join(homedir(), value.slice(1)) : value;
}

export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(path).toLowerCase());
}

// Order matters: the HTML <img src> is the only clipboard field that still points to an
// animated GIF after a browser "Copy Image". The bitmap on the clipboard is a static frame.
export function pickSource(content: { text?: string; file?: string; html?: string }): Source {
  const src = content.html?.match(/<img\b[^>]*?\bsrc\s*=\s*(["'])(.*?)\1/i)?.[2];
  if (src && /^(https?:|data:image\/)/i.test(src)) return { kind: "url", url: decodeEntities(src) };
  if (content.file) {
    const path = content.file.startsWith("file://") ? decodeURIComponent(new URL(content.file).pathname) : content.file;
    if (isImagePath(path)) return { kind: "file", path };
  }
  const text = content.text?.trim();
  if (text && /^(https?:\/\/\S+|data:image\/\S+)$/i.test(text)) return { kind: "url", url: text };
  return { kind: "raw-image" };
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export function detectImageType(data: Buffer): keyof typeof EXTENSIONS | undefined {
  const ascii = data.subarray(0, 12).toString("latin1");
  if (ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a")) return "gif";
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "jpeg";
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") return "webp";
  if (ascii.slice(4, 8) === "ftyp" && /^(heic|heix|mif1|avif)/.test(ascii.slice(8, 12))) return "heic";
  return undefined;
}

export async function download(url: string): Promise<{ data: Buffer; name?: string }> {
  if (url.startsWith("data:")) {
    const comma = url.indexOf(",");
    const meta = url.slice(0, comma);
    const body = url.slice(comma + 1);
    return { data: meta.endsWith(";base64") ? Buffer.from(body, "base64") : Buffer.from(decodeURIComponent(body)) };
  }
  const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Macintosh) Raycast Meme Library" } });
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const name = decodeURIComponent(basename(new URL(response.url || url).pathname));
  return { data: Buffer.from(await response.arrayBuffer()), name };
}

export class Library {
  readonly folder: string;

  constructor(folder: string | undefined) {
    this.folder = resolveFolder(folder);
  }

  private async readIndex(): Promise<Index> {
    try {
      return JSON.parse(await readFile(join(this.folder, INDEX_FILE), "utf8")) as Index;
    } catch {
      return {};
    }
  }

  private async writeIndex(index: Index): Promise<void> {
    const target = join(this.folder, INDEX_FILE);
    await writeFile(`${target}.tmp`, JSON.stringify(index, null, 2));
    await rename(`${target}.tmp`, target);
  }

  // Files that you drop into the folder yourself also show up. They use the file time.
  async list(): Promise<Meme[]> {
    await mkdir(this.folder, { recursive: true });
    const index = await this.readIndex();
    const files = (await readdir(this.folder)).filter((file) => !file.startsWith(".") && isImagePath(file));
    const memes = await Promise.all(
      files.map(async (file) => {
        const path = join(this.folder, file);
        const entry = index[file] ?? {
          title: basename(file, extname(file)),
          tags: [],
          addedAt: (await stat(path)).mtimeMs,
          useCount: 0,
        };
        return { ...entry, file, path };
      }),
    );
    return memes.sort((a, b) => (b.lastUsedAt ?? b.addedAt) - (a.lastUsedAt ?? a.addedAt));
  }

  // Returns the saved meme and whether it was already in the library.
  async add(data: Buffer, title?: string): Promise<{ meme: Meme; duplicate: boolean }> {
    const type = detectImageType(data);
    if (!type) throw new Error("This is not a GIF, PNG, JPEG, WebP, or HEIC image");
    await mkdir(this.folder, { recursive: true });
    const file = createHash("sha256").update(data).digest("hex").slice(0, 16) + EXTENSIONS[type];
    const path = join(this.folder, file);
    const index = await this.readIndex();
    const existing = index[file];
    if (existing) return { meme: { ...existing, file, path }, duplicate: true };
    await writeFile(path, data);
    const cleanTitle = title ? basename(title, extname(title)).replace(/[-_]+/g, " ").trim() : "";
    const entry: Entry = { title: cleanTitle || "Untitled meme", tags: [], addedAt: Date.now(), useCount: 0 };
    index[file] = entry;
    await this.writeIndex(index);
    return { meme: { ...entry, file, path }, duplicate: false };
  }

  async addFile(path: string): Promise<{ meme: Meme; duplicate: boolean }> {
    return this.add(await readFile(path), basename(path));
  }

  async update(meme: Meme, changes: Partial<Pick<Entry, "title" | "tags" | "lastUsedAt" | "useCount">>): Promise<void> {
    const index = await this.readIndex();
    const { title, tags, addedAt, lastUsedAt, useCount } = meme;
    index[meme.file] = { ...(index[meme.file] ?? { title, tags, addedAt, lastUsedAt, useCount }), ...changes };
    await this.writeIndex(index);
  }

  async markUsed(meme: Meme): Promise<void> {
    const index = await this.readIndex();
    await this.update(meme, { lastUsedAt: Date.now(), useCount: (index[meme.file]?.useCount ?? meme.useCount) + 1 });
  }

  async remove(meme: Meme, deleteFile: (path: string) => Promise<void> = (p) => rm(p)): Promise<void> {
    await deleteFile(meme.path);
    const index = await this.readIndex();
    delete index[meme.file];
    await this.writeIndex(index);
  }
}
