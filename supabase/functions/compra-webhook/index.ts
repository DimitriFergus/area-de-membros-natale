// =====================================================================
// Webhook de compra · roda no servidor do Supabase (Edge Function)
//
// Cakto/Kiwify/Hotmart avisam aqui quando uma compra é aprovada ou reembolsada.
//   aprovada    → registra a compra, cria a conta com senha aleatória e manda a senha por e-mail
//   reembolso,  → registra; o banco corta o acesso na hora (tem_acesso)
//   chargeback,
//   cancelada
//
// Segredos (NUNCA no código, só em "supabase secrets set"):
//   WEBHOOK_SEGREDO  chave secreta do webhook da Cakto, token da Kiwify ou hottok da Hotmart (mín. 16 caracteres)
//   GMAIL_REMETENTE  seu Gmail, e GMAIL_SENHA_APP  senha de app do Google (envio do e-mail com a senha), ou
//   BREVO_API_KEY    chave de API da Brevo, ou
//   RESEND_API_KEY   chave da Resend (exige domínio próprio)
//   EMAIL_REMETENTE  ex.: Natalê <seuemail@gmail.com>
//   SITE_URL         endereço da área de membros, ex.: https://areademembroskitnatale.netlify.app
// O Supabase injeta sozinho SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (a chave
// secreta fica só no servidor e nunca chega ao navegador).
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { autenticado, gerarSenha, interpretar } from "./regras.ts";
import { emailBoasVindas, enviarEmail } from "./email.ts";
import { enviarCompraMeta, eventoCompraCakto } from "./meta.ts";

const META_PIXEL_ID = Deno.env.get("META_PIXEL_ID") ?? "";
const META_CAPI_TOKEN = Deno.env.get("META_CAPI_TOKEN") ?? "";
const SITE_VENDAS = Deno.env.get("SITE_VENDAS") ?? "https://kitnatalle.netlify.app/";

const SEGREDO = Deno.env.get("WEBHOOK_SEGREDO") ?? "";
const SITE_URL = (Deno.env.get("SITE_URL") ?? "").replace(/\/+$/, "");
const LINK_MEMBROS = SITE_URL + "/"; // a área de membros fica na raiz do site dela
const CHAVES_EMAIL = {
  gmail: Deno.env.get("GMAIL_REMETENTE") ?? "", gmailSenha: Deno.env.get("GMAIL_SENHA_APP") ?? "",
  brevo: Deno.env.get("BREVO_API_KEY") ?? "", resend: Deno.env.get("RESEND_API_KEY") ?? "",
};
const TEM_EMAIL = !!((CHAVES_EMAIL.gmail && CHAVES_EMAIL.gmailSenha) || CHAVES_EMAIL.brevo || CHAVES_EMAIL.resend);
const EMAIL_REMETENTE = Deno.env.get("EMAIL_REMETENTE") ?? "";
const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const resposta = (status: number, msg: string) =>
  new Response(JSON.stringify({ ok: status < 300, msg }), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return resposta(405, "use POST");
  if (SEGREDO.length < 16) return resposta(500, "WEBHOOK_SEGREDO não configurado");
  if (!SITE_URL || !TEM_EMAIL || !EMAIL_REMETENTE) return resposta(500, "SITE_URL, chave de e-mail (Gmail/Brevo/Resend) ou EMAIL_REMETENTE não configurado");

  const tamanho = Number(req.headers.get("content-length") ?? "0");
  if (tamanho > 200_000) return resposta(413, "corpo grande demais");
  const corpo = await req.text();
  if (corpo.length > 200_000) return resposta(413, "corpo grande demais");

  const url = new URL(req.url);
  const ok = await autenticado(SEGREDO, corpo, url.searchParams.get("signature"), req.headers.get("x-hotmart-hottok"), req.headers.get("x-webhook-segredo"));
  if (!ok) return resposta(401, "não autorizado");

  let dados: unknown;
  try { dados = JSON.parse(corpo); } catch { return resposta(400, "JSON inválido"); }
  const ev = interpretar(dados);
  if (!ev) return resposta(200, "evento ignorado"); // boleto gerado, pix pendente, recusado...

  const { error } = await admin.from("compras").upsert(
    { email: ev.email, status: ev.status, plataforma: ev.plataforma, transacao: ev.transacao, produto: ev.produto, atualizado_em: new Date().toISOString() },
    { onConflict: "plataforma,transacao" },
  );
  if (error) { console.error("compras.upsert", error.message); return resposta(500, "falha ao registrar"); }

  if (ev.status === "aprovada") {
    // Cria a conta com uma senha aleatória (e-mail já confirmado) e manda a senha para o e-mail da compra.
    // Se a pessoa já tem conta (comprou antes ou a plataforma reenviou o aviso), não troca a senha: só registra a compra.
    const senha = gerarSenha();
    const { data: criado, error: e2 } = await admin.auth.admin.createUser({ email: ev.email, password: senha, email_confirm: true });
    if (e2) {
      if (!/already|registered|exists/i.test(e2.message)) { console.error("criar conta", e2.message); return resposta(500, "compra registrada, conta falhou"); }
    } else {
      try {
        await enviarEmail(CHAVES_EMAIL, EMAIL_REMETENTE, ev.email, emailBoasVindas(ev.email, senha, LINK_MEMBROS));
      } catch (e3) {
        // sem o e-mail a cliente não teria a senha: desfaz a conta para a plataforma reenviar o aviso e tudo recomeçar
        console.error("email", String((e3 as Error).message));
        if (criado?.user?.id) await admin.auth.admin.deleteUser(criado.user.id);
        return resposta(500, "compra registrada, e-mail falhou");
      }
    }
    // Conversão "Purchase" para os anúncios da Meta (repetições do mesmo pedido são descartadas pela Meta pelo event_id)
    if (ev.plataforma === "cakto" && META_PIXEL_ID && META_CAPI_TOKEN) {
      const r = await enviarCompraMeta(META_PIXEL_ID, META_CAPI_TOKEN, await eventoCompraCakto(dados, SITE_VENDAS), url.searchParams.get("meta_teste") ?? undefined);
      console.log("meta purchase", r);
    }
  }
  console.log("compra", ev.plataforma, ev.status); // sem e-mail no log
  return resposta(200, "ok");
});
