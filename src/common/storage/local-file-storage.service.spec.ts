import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectImageExtension } from "./image-type";
import { LocalFileStorage } from "./local-file-storage.service";

// Usa uma pasta temporária de verdade: o que importa aqui é o disco.
describe("LocalFileStorage", () => {
  const storage = new LocalFileStorage();
  let root: string;
  const previous = process.env.UPLOADS_DIR;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "orari-uploads-"));
    process.env.UPLOADS_DIR = root;
  });

  afterEach(async () => {
    process.env.UPLOADS_DIR = previous;
    await rm(root, { recursive: true, force: true });
  });

  it("deve gravar com nome aleatório e devolver o caminho público", async () => {
    const path = await storage.save("people", Buffer.from("abc"), "jpg");

    expect(path).toMatch(/^\/uploads\/people\/[0-9a-f-]{36}\.jpg$/);
    const saved = await readFile(join(root, path.replace("/uploads/", "")));
    expect(saved.toString()).toBe("abc");
  });

  it("deve apagar o arquivo de um caminho público", async () => {
    const path = await storage.save("people", Buffer.from("abc"), "png");

    await storage.remove(path);

    await expect(
      stat(join(root, path.replace("/uploads/", ""))),
    ).rejects.toThrow();
  });

  it("não deve falhar ao apagar um arquivo que já não existe", async () => {
    await expect(
      storage.remove("/uploads/people/inexistente.jpg"),
    ).resolves.toBeUndefined();
  });

  it("deve ignorar caminhos fora da pasta de uploads", async () => {
    const outside = join(root, "..", `fora-${Date.now()}.txt`);
    await writeFile(outside, "não apagar");

    await storage.remove(`/uploads/../${outside.split("/").pop()}`);

    await expect(readFile(outside, "utf8")).resolves.toBe("não apagar");
    await rm(outside, { force: true });
  });
});

describe("detectImageExtension", () => {
  it("deve reconhecer JPEG e PNG pelo conteúdo", () => {
    expect(detectImageExtension(Buffer.from([0xff, 0xd8, 0xff, 0xdb]))).toBe(
      "jpg",
    );
    expect(
      detectImageExtension(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toBe("png");
  });

  it("deve recusar outros formatos e arquivos vazios", () => {
    expect(detectImageExtension(Buffer.from("GIF89a"))).toBeNull();
    expect(detectImageExtension(Buffer.from("<svg></svg>"))).toBeNull();
    expect(detectImageExtension(Buffer.alloc(0))).toBeNull();
  });
});
