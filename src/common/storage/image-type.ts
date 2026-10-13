/**
 * Formato de uma imagem pelo conteúdo do arquivo (os primeiros bytes, a
 * "assinatura"), e não pela extensão ou pelo tipo informado pelo navegador,
 * que podem ser falsificados. Devolve a extensão a usar no arquivo salvo, ou
 * null quando não é um formato aceito.
 */
export function detectImageExtension(content: Buffer): "jpg" | "png" | null {
  // JPEG: FF D8 FF
  if (
    content.length >= 3 &&
    content[0] === 0xff &&
    content[1] === 0xd8 &&
    content[2] === 0xff
  ) {
    return "jpg";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (
    content.length >= png.length &&
    png.every((byte, index) => content[index] === byte)
  ) {
    return "png";
  }

  return null;
}
