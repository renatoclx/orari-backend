import { describe, expect, it } from "vitest";
import {
  isPrivateUploadPath,
  isValidUploadSignature,
  secondsUntil,
  signUploadPath,
} from "./signed-upload-url";

const SECRET = "segredo-de-teste";
const PATH = "/uploads/people/3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f.jpg";
// 11/11/2026 10:20 UTC.
const NOW = Date.UTC(2026, 10, 11, 10, 20);

// Separa exp e sig do link assinado.
const parts = (signed: string) => {
  const query = new URLSearchParams(signed.split("?")[1]);
  return { exp: query.get("exp")!, sig: query.get("sig")! };
};

describe("isPrivateUploadPath", () => {
  it.each([
    [PATH, true],
    ["/uploads/products/3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f.png", true],
    ["/uploads/client-accounts/3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f.jpg", true],
    // Logo é pública; texto qualquer não é caminho de foto.
    ["/uploads/companies/3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f.png", false],
    ["Óleo de massagem", false],
    [`${PATH}?exp=1&sig=x`, false],
  ])("%s → %s", (value, expected) => {
    expect(isPrivateUploadPath(value)).toBe(expected);
  });
});

describe("signUploadPath / isValidUploadSignature", () => {
  it("vale até o fim da hora seguinte, e o link é o mesmo dentro da hora", () => {
    const signed = signUploadPath(PATH, SECRET, NOW);
    const { exp } = parts(signed);

    // 10:20 → vale até 12:00.
    expect(Number(exp)).toBe(Date.UTC(2026, 10, 11, 12, 0) / 1000);
    expect(signUploadPath(PATH, SECRET, NOW + 30 * 60_000)).toBe(signed);
    expect(secondsUntil(exp, NOW)).toBe(100 * 60);
  });

  it("aceita a assinatura certa dentro do prazo", () => {
    const { exp, sig } = parts(signUploadPath(PATH, SECRET, NOW));

    expect(isValidUploadSignature(PATH, exp, sig, SECRET, NOW)).toBe(true);
  });

  it("recusa link vencido, de outro arquivo, de outro segredo ou adulterado", () => {
    const { exp, sig } = parts(signUploadPath(PATH, SECRET, NOW));
    const later = Number(exp) * 1000;
    const other = PATH.replace("3f2b", "aaaa");

    expect(isValidUploadSignature(PATH, exp, sig, SECRET, later)).toBe(false);
    expect(isValidUploadSignature(other, exp, sig, SECRET, NOW)).toBe(false);
    expect(isValidUploadSignature(PATH, exp, sig, "outro", NOW)).toBe(false);
    expect(
      isValidUploadSignature(
        PATH,
        String(Number(exp) + 3600),
        sig,
        SECRET,
        NOW,
      ),
    ).toBe(false);
    expect(isValidUploadSignature(PATH, exp, undefined, SECRET, NOW)).toBe(
      false,
    );
    expect(isValidUploadSignature(PATH, ["1"], sig, SECRET, NOW)).toBe(false);
  });
});
