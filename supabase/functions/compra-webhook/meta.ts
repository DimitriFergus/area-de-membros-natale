// Evento "Purchase" da Meta (Facebook/Instagram Ads) enviado pelo servidor (API de Conversões)
// quando a compra é aprovada. Não depende do navegador da cliente: conta mesmo se ela fechar a página.
//
// Segredos: META_PIXEL_ID (ID do pixel) e META_CAPI_TOKEN (token de acesso gerado no Gerenciador de Eventos).
// Sem eles, nada é enviado. O e-mail, telefone e nome vão com hash SHA-256, como a Meta exige.

const sha256 = async (s: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))))
    .map((b) => b.toString(16).padStart(2, "0")).join("");

const limpa = (v: unknown) => (v === null || v === undefined ? "" : String(v).trim().toLowerCase());
const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");

/** Telefone brasileiro só com dígitos e DDI 55. */
export function telefoneBR(v: unknown): string {
  let d = limpa(v).replace(/\D/g, "");
  if (!d) return "";
  if (d.length <= 11) d = "55" + d.replace(/^0+/, "");
  return d;
}

/** Monta o evento Purchase a partir do corpo do webhook da Cakto (função pura, para testar). */
export async function eventoCompraCakto(c: any, siteVendas: string) {
  const d = c?.data ?? {};
  const cli = d.customer ?? {};
  const email = limpa(cli.email);
  const partes = limpa(cli.name).split(/\s+/).filter(Boolean);
  const fn = sem(partes[0] ?? ""), ln = sem(partes.length > 1 ? partes[partes.length - 1] : "");
  const ph = telefoneBR(cli.phone);
  const valor = Number(d.amount ?? d.baseAmount ?? 0);
  const quando = Date.parse(d.paidAt ?? d.createdAt ?? "") || Date.now();
  const user_data: Record<string, unknown> = {};
  if (email) { user_data.em = [await sha256(email)]; user_data.external_id = [await sha256(email)]; }
  if (ph) user_data.ph = [await sha256(ph)];
  if (fn) user_data.fn = [await sha256(fn)];
  if (ln) user_data.ln = [await sha256(ln)];
  user_data.country = [await sha256("br")];
  if (d.fbc) user_data.fbc = String(d.fbc);
  if (d.fbp) user_data.fbp = String(d.fbp);
  const custom_data: Record<string, unknown> = {
    currency: "BRL", value: Number.isFinite(valor) ? Math.round(valor * 100) / 100 : 0,
    content_name: d.product?.name ?? "Natalê", content_type: "product", order_id: String(d.id ?? d.refId ?? ""),
  };
  if (d.product?.id) custom_data.content_ids = [String(d.product.id)];
  return {
    event_name: "Purchase",
    event_time: Math.min(Math.floor(quando / 1000), Math.floor(Date.now() / 1000)),
    event_id: "cakto-" + String(d.id ?? d.refId ?? ""),          // a Meta descarta repetições com o mesmo id
    action_source: "website",
    event_source_url: siteVendas,
    user_data, custom_data,
  };
}

/** Envia para a Meta. Nunca lança erro: a compra da cliente não pode falhar por causa do anúncio. */
export async function enviarCompraMeta(pixel: string, token: string, evento: unknown, testCode?: string) {
  if (!pixel || !token) return "sem pixel/token";
  try {
    const corpo: Record<string, unknown> = { data: [evento] };
    if (testCode) corpo.test_event_code = testCode;
    const r = await fetch(`https://graph.facebook.com/v21.0/${pixel}/events?access_token=${encodeURIComponent(token)}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(8000),
    });
    const t = await r.text();
    return r.ok ? "ok" : `erro ${r.status}: ${t.slice(0, 200)}`;
  } catch (e) {
    return "falha: " + String((e as Error).message);
  }
}
