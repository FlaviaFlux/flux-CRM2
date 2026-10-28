/**
 * O link de redefinição de senha que QUEM ADMINISTRA a organização manda a um
 * membro (`POST /api/v1/team/[user_id]/password-reset`).
 *
 * Diferente de `acesso-gotrue.ts`, este e-mail é montado e ENVIADO por nós: o
 * link chega pronto (`/auth/confirm?type=recovery&token_hash=…`), gerado pela
 * API administrativa. Por isso não depende do modelo gravado no provedor de
 * autenticação — o modelo padrão, que linka para um `code` PKCE, falha quando a
 * pessoa abre o e-mail noutro navegador; `token_hash` não depende de cookie.
 *
 * O texto diz que o pedido veio da equipe, e não "recebemos um pedido": quem
 * recebe sem ter pedido precisa saber de onde veio para não tomar por golpe. E
 * diz que a senha atual continua valendo até a pessoa escolher outra — o admin
 * não vê nem escolhe a senha.
 *
 * Mesmo molde de `aviso-de-troca-de-email.ts`: marca resolvida
 * (`marcaDaSaida`), estilo inline, idioma de quem recebe.
 */
import { NEUTROS_DE_SAIDA, type MarcaDeSaida } from "@/lib/branding/saida";
import { traduzir } from "@/lib/i18n/dicionario";
import type { Idioma } from "@/lib/i18n/idiomas";

export interface RedefinicaoPelaEquipeOpcoes {
  marca: MarcaDeSaida;
  /** O link completo, já com `token_hash`. */
  link: string;
  idioma: Idioma;
}

export function buildRedefinicaoPelaEquipe(opts: RedefinicaoPelaEquipeOpcoes): {
  subject: string;
  html: string;
  text: string;
} {
  const t = (texto: string) => traduzir(texto, opts.idioma);
  const subject = t("Defina uma nova senha · {marca}").replace("{marca}", opts.marca.nome);
  const titulo = t("Defina uma nova senha");
  const corpo = t(
    "Quem administra a sua empresa no {marca} pediu que você defina uma nova senha. Clique no botão abaixo para escolher a sua.",
  ).replace("{marca}", opts.marca.nome);
  const botao = t("Definir nova senha");
  const copie = t("Ou copie e cole este link no navegador:");
  const rodape = t(
    "Sua senha atual continua valendo até você escolher outra. Se não esperava este e-mail, fale com quem administra a sua empresa.",
  );

  const logo = opts.marca.logoUrl
    ? `<p style="margin:0 0 24px"><img src="${escapeHtml(opts.marca.logoUrl)}" alt="${escapeHtml(opts.marca.nome)}" height="40" style="height:40px;width:auto;max-width:200px;border:0;display:block"></p>`
    : "";
  const link = escapeHtml(opts.link);

  const html = `<!doctype html>
<html lang="${opts.idioma}">
<body style="margin:0;padding:0;background:${NEUTROS_DE_SAIDA.fundo};font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:${NEUTROS_DE_SAIDA.texto}">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px">
    ${logo}
    <h1 style="font-size:22px;line-height:1.3;margin:0 0 16px;color:${NEUTROS_DE_SAIDA.texto}">
      ${escapeHtml(titulo)}
    </h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.5">${escapeHtml(corpo)}</p>
    <p style="margin:24px 0">
      <a href="${link}" style="display:inline-block;padding:12px 24px;background:${opts.marca.accent};color:${opts.marca.accentFg};border-radius:6px;text-decoration:none;font-weight:600">
        ${escapeHtml(botao)}
      </a>
    </p>
    <p style="margin:0 0 8px;font-size:13px;color:${NEUTROS_DE_SAIDA.suave}">
      ${escapeHtml(copie)}<br>
      <span style="word-break:break-all;color:${opts.marca.accent}">${link}</span>
    </p>
    <p style="margin:24px 0 0;font-size:13px;color:${NEUTROS_DE_SAIDA.suave}">${escapeHtml(rodape)}</p>
  </div>
</body>
</html>`;

  const text = [corpo, "", opts.link, "", rodape].join("\n");
  return { subject, html, text };
}

/**
 * O aviso ao dono da conta de que a senha foi DEFINIDA pelo administrador da
 * plataforma (`PATCH /api/v1/admin/tenants/[id]/members/[userId]/password`). É a
 * guarda de quem não pediu: diz quando e a quem recorrer, e nunca leva a senha.
 */
export function buildAvisoDeSenhaDefinida(opts: {
  marca: MarcaDeSaida;
  data: string;
  idioma: Idioma;
}): {
  subject: string;
  html: string;
  text: string;
} {
  const t = (texto: string) => traduzir(texto, opts.idioma);
  const subject = t("A senha da sua conta foi redefinida");
  const quando = t(
    "A senha da sua conta foi redefinida pelo administrador da plataforma em {data}.",
  ).replace("{data}", opts.data);
  const oQueFazer = t("Se você não pediu esta mudança, fale com o administrador da sua empresa.");

  const html = `<!doctype html>
<html lang="${opts.idioma}">
<body style="margin:0;padding:0;background:${NEUTROS_DE_SAIDA.fundo};font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:${NEUTROS_DE_SAIDA.texto}">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px">
    <h1 style="font-size:20px;line-height:1.3;margin:0 0 16px;color:${NEUTROS_DE_SAIDA.texto}">${escapeHtml(subject)}</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.5">${escapeHtml(quando)}</p>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.5"><strong>${escapeHtml(oQueFazer)}</strong></p>
    <p style="margin:24px 0 0;font-size:13px;color:${NEUTROS_DE_SAIDA.suave}">${escapeHtml(opts.marca.nome)}</p>
  </div>
</body>
</html>`;

  return { subject, html, text: [quando, "", oQueFazer].join("\n") };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
