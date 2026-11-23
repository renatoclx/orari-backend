import type { MailMessage } from "../mail/mail.service";

// Escapa o nome antes de pôr no HTML (ele vem do cadastro).
const escape = (value: string) =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** E-mail do "Esqueci minha senha": o link, a validade e o que fazer se não pediu. */
export function passwordResetEmail(input: {
  to: string;
  name: string;
  link: string;
  minutes: number;
}): MailMessage {
  const firstName = input.name.trim().split(/\s+/)[0] || "Olá";
  const subject = "Redefinir a sua senha do Orari";
  const text = [
    `Olá, ${firstName}!`,
    "",
    "Recebemos um pedido para redefinir a senha da sua conta no Orari.",
    `Para criar uma senha nova, abra o link abaixo (ele vale por ${input.minutes} minutos e só pode ser usado uma vez):`,
    "",
    input.link,
    "",
    "Se não foi você, ignore este e-mail: a sua senha continua a mesma.",
    "",
    "Equipe Orari",
  ].join("\n");
  const html = `<!doctype html>
<html lang="pt-BR">
<body style="margin:0;padding:24px;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
  <div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:32px">
    <p style="margin:0 0 16px;font-size:20px;font-weight:bold;color:#00b8db">Orari</p>
    <p style="margin:0 0 12px">Olá, ${escape(firstName)}!</p>
    <p style="margin:0 0 20px;line-height:1.5">Recebemos um pedido para redefinir a senha da sua conta no Orari. Para criar uma senha nova, clique no botão abaixo.</p>
    <p style="margin:0 0 20px"><a href="${input.link}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:8px">Criar senha nova</a></p>
    <p style="margin:0 0 12px;font-size:13px;color:#475569;line-height:1.5">O link vale por ${input.minutes} minutos e só pode ser usado uma vez. Se o botão não funcionar, copie e cole este endereço no navegador:<br><span style="word-break:break-all">${input.link}</span></p>
    <p style="margin:0;font-size:13px;color:#475569">Se não foi você, ignore este e-mail: a sua senha continua a mesma.</p>
  </div>
</body>
</html>`;
  return { to: input.to, subject, text, html };
}
