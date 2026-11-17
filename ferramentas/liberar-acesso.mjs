// =====================================================================
// NATALÊ · liberar acesso na mão
// Cria a conta da cliente com senha aleatória, registra a compra como aprovada
// e copia uma mensagem pronta (link + e-mail + senha) para colar no WhatsApp/e-mail.
//
// Uso: dois cliques em "Liberar acesso Natalê" na Área de Trabalho
//      (ou: node ferramentas/liberar-acesso.mjs)
// As chaves vêm de supabase/segredos.env (só no seu computador). Nenhuma chave fica aqui.
// =====================================================================
import { readFileSync } from "node:fs";
import { randomInt } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARQ = join(RAIZ, "supabase", "segredos.env");

function lerSegredos() {
  const txt = readFileSync(ARQ, "utf8");
  const val = (nome) => {
    const linhas = txt.split(/\r?\n/).filter((l) => new RegExp(`^\\s*(#\\s*)?${nome}\\s*=`).test(l));
    if (!linhas.length) return "";
    return linhas.at(-1).replace(/^[^=]*=/, "").replace(/["']/g, "").trim();
  };
  const token = val("SUPABASE_ACCESS_TOKEN") || (txt.match(/sbp_[A-Za-z0-9]+/) || [""])[0];
  const ref = val("PROJECT_REF").replace(/^https?:\/\//, "").replace(/\.supabase\.co.*$/, "").replace(/\/.*$/, "");
  const site = val("SITE_URL").replace(/\/+$/, "");
  if (!token || !ref || !site) throw new Error("Faltam SUPABASE_ACCESS_TOKEN, PROJECT_REF ou SITE_URL em " + ARQ);
  return { token, ref, site };
}

const LETRAS = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function gerarSenha() {
  for (;;) {
    const s = Array.from({ length: 10 }, () => LETRAS[randomInt(LETRAS.length)]).join("");
    if (/[a-zA-Z]/.test(s) && /[0-9]/.test(s)) return s;
  }
}
const EMAIL = /^[^\s@<>()[\]\\,;:"']{1,64}@[a-z0-9.-]{1,180}\.[a-z]{2,24}$/;

function copiar(texto) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-Command",
    "[Console]::InputEncoding=[Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())"], { input: texto });
  return r.status === 0;
}

async function main() {
  const { token, ref, site } = lerSegredos();
  const mg = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const chaves = await (await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`, { headers: mg })).json();
  const sr = Array.isArray(chaves) && chaves.find((k) => k.type === "secret")?.api_key;
  if (!sr) throw new Error("Não consegui acessar o Supabase. O token (sbp_) pode ter vencido: gere outro e cole no segredos.env.");
  const U = `https://${ref}.supabase.co`;
  const H = { apikey: sr, Authorization: `Bearer ${sr}`, "Content-Type": "application/json" };
  const sql = async (q) => (await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, { method: "POST", headers: mg, body: JSON.stringify({ query: q }) })).json();

  const rl = createInterface({ input: process.stdin, terminal: false });
  const linhas = rl[Symbol.asyncIterator]();
  const pergunta = async (p) => { process.stdout.write(p); const r = await linhas.next(); if (r.done) { process.stdout.write("\n"); return ""; } return r.value; };
  console.log("\n  NATALÊ · Liberar acesso\n  (deixe em branco e aperte Enter para sair)\n");
  for (;;) {
    const email = (await pergunta("  E-mail da cliente: ")).trim().toLowerCase();
    if (!email) break;
    if (!EMAIL.test(email)) { console.log("  ✖ E-mail inválido, confira e digite de novo.\n"); continue; }

    const senha = gerarSenha();
    const existe = await sql(`select id from auth.users where lower(email) = '${email.replace(/'/g, "''")}' limit 1`);
    if (Array.isArray(existe) && existe[0]?.id) {
      const resp = (await pergunta("  Essa cliente já tem conta. Gerar uma senha NOVA para ela? (s/n): ")).trim().toLowerCase();
      if (resp !== "s") { console.log("  Nada mudou.\n"); continue; }
      const r = await fetch(`${U}/auth/v1/admin/users/${existe[0].id}`, { method: "PUT", headers: H, body: JSON.stringify({ password: senha, email_confirm: true }) });
      if (!r.ok) { console.log("  ✖ Erro ao trocar a senha:", r.status, (await r.text()).slice(0, 200), "\n"); continue; }
    } else {
      const r = await fetch(`${U}/auth/v1/admin/users`, { method: "POST", headers: H, body: JSON.stringify({ email, password: senha, email_confirm: true }) });
      if (!r.ok) { console.log("  ✖ Erro ao criar a conta:", r.status, (await r.text()).slice(0, 200), "\n"); continue; }
    }
    // registra (ou reativa) a compra: sem compra aprovada, a conta não entra
    const c = await fetch(`${U}/rest/v1/compras?on_conflict=plataforma,transacao`, {
      method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ email, status: "aprovada", plataforma: "manual", transacao: "manual-" + email, atualizado_em: new Date().toISOString() }),
    });
    if (!c.ok) { console.log("  ✖ Conta criada, mas a compra não foi registrada:", c.status, (await c.text()).slice(0, 200), "\n"); continue; }

    const msg = `Olá! Seu acesso ao Natalê chegou 🎄\n\nEntre em: ${site}/\nE-mail: ${email}\nSenha: ${senha}\n\nDica: no celular, toque em "Instalar o app" para ter as receitas sempre à mão.`;
    console.log("\n  ✔ Acesso liberado!\n\n" + msg.replace(/^/gm, "    ") + "\n");
    console.log(copiar(msg) ? "  📋 Mensagem COPIADA. É só colar (Ctrl+V) no WhatsApp ou no e-mail da cliente.\n" : "  (Não consegui copiar sozinho: selecione o texto acima e copie.)\n");
  }
  rl.close();
}

main().catch((e) => { console.error("\n  ✖ " + e.message + "\n"); process.exitCode = 1; });
