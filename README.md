# Área de membros Natalê

App (PWA) da área de membros + banco de dados (Supabase). As páginas de oferta ficam em outro repositório (`kit-doce-natal`).

| O quê | Onde |
|---|---|
| App | `index.html`, `app.js`, `conta.js`, `membros.css`, `sw.js`, `data/` |
| Configuração (Supabase, contatos) | `assets/js/kit.js` |
| Banco de dados e webhook de compra | `supabase/` (guia em `BANCO-DE-DADOS.md`) |
| Chaves secretas | `supabase/segredos.env` (só no seu computador, nunca no GitHub) |

Publicação: Netlify, a cada push na `main` (sem build, `netlify.toml`).
**Sempre que publicar mudanças no app, troque `VERSAO` no topo de `sw.js`.**
