import { StreamableFile } from "@nestjs/common";
import { lastValueFrom, of } from "rxjs";
import { describe, expect, it } from "vitest";
import { Decimal } from "../../../generated/prisma/internal/prismaNamespace";
import { SignedUploadsInterceptor } from "./signed-uploads.interceptor";

const PHOTO = "/uploads/people/3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f.jpg";
const LOGO = "/uploads/companies/3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f.png";

const run = (body: unknown) =>
  lastValueFrom(
    new SignedUploadsInterceptor("segredo").intercept({} as never, {
      handle: () => of(body),
    }),
  );

describe("SignedUploadsInterceptor", () => {
  it("assina as fotos privadas em qualquer nível e deixa a logo como está", async () => {
    const body = {
      items: [{ client: { name: "Ana", photoUrl: PHOTO } }],
      company: { logoUrl: LOGO },
    };

    const result = (await run(body)) as typeof body;

    expect(result.items[0].client.photoUrl).toMatch(
      new RegExp(`^${PHOTO}\\?exp=\\d+&sig=[\\w-]+$`),
    );
    expect(result.company.logoUrl).toBe(LOGO);
    // O objeto original não muda.
    expect(body.items[0].client.photoUrl).toBe(PHOTO);
  });

  it("não mexe em Date, Decimal, arquivos nem valores vazios", async () => {
    const date = new Date();
    const amount = new Decimal("10.5");
    const file = new StreamableFile(Buffer.from("pdf"));

    const result = (await run({ date, amount, photoUrl: null })) as Record<
      string,
      unknown
    >;

    expect(result.date).toBe(date);
    expect(result.amount).toBe(amount);
    expect(result.photoUrl).toBeNull();
    await expect(run(file)).resolves.toBe(file);
    await expect(run(undefined)).resolves.toBeUndefined();
  });
});
