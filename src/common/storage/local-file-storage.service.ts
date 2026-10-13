import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

// Prefixo público dos arquivos: é por onde a API os serve (ver main.ts).
export const UPLOADS_PUBLIC_PREFIX = "/uploads";

// Pasta no disco; configurável para não depender de onde o processo foi iniciado.
export function uploadsRoot(): string {
  return resolve(process.env.UPLOADS_DIR ?? "uploads");
}

/**
 * Armazenamento de arquivos em uma pasta local, para o ambiente de
 * desenvolvimento. Para produção, este é o único ponto a trocar por um
 * armazenamento em nuvem (ver docs/technical-debt.md): quem usa só conhece
 * save e remove, e guarda o caminho público devolvido.
 */
@Injectable()
export class LocalFileStorage {
  /**
   * Grava o conteúdo com um nome aleatório (sem colisão nem nome adivinhável)
   * e devolve o caminho público, ex.: /uploads/people/<uuid>.jpg.
   */
  async save(
    folder: string,
    content: Buffer,
    extension: string,
  ): Promise<string> {
    const fileName = `${randomUUID()}.${extension}`;
    const directory = join(uploadsRoot(), folder);

    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, fileName), content);

    return `${UPLOADS_PUBLIC_PREFIX}/${folder}/${fileName}`;
  }

  /**
   * Apaga o arquivo de um caminho público devolvido por save. Um arquivo que já
   * não existe não é erro. Caminhos fora da pasta de uploads são ignorados, por
   * segurança (ex.: "/uploads/../.env").
   */
  async remove(publicPath: string): Promise<void> {
    if (!publicPath.startsWith(`${UPLOADS_PUBLIC_PREFIX}/`)) {
      return;
    }

    const root = uploadsRoot();
    const filePath = resolve(
      root,
      publicPath.slice(UPLOADS_PUBLIC_PREFIX.length + 1),
    );
    if (!filePath.startsWith(root + sep)) {
      return;
    }

    await rm(filePath, { force: true });
  }
}
