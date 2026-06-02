<div align="center">

# 🤖 my-agent

### Um agente de código local sobre o **[Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript)**

Um chat web completo — **`my-agent-chat`** — que lê e edita o teu código, roda comandos e responde
**ancorado na documentação oficial** do SDK via RAG. Começou como o exemplo *bug-fixing* do quickstart.
Hoje é uma ferramenta de trabalho.

<br/>

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Claude Agent SDK](https://img.shields.io/badge/Claude_Agent_SDK-D97757?logo=anthropic&logoColor=white)](https://github.com/anthropics/claude-agent-sdk-typescript)
[![React 18](https://img.shields.io/badge/React_18-20232A?logo=react&logoColor=61DAFB)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite_5-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![Tailwind](https://img.shields.io/badge/Tailwind_3-06B6D4?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Neon](https://img.shields.io/badge/Neon_+_pgvector-00E599?logo=postgresql&logoColor=white)](https://neon.tech/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

<sub>Tudo em TypeScript, rodado com <code>tsx</code> · single-user, local-first · cada ação que mexe no sistema passa por <b>aprovação</b> no browser</sub>

</div>

---

## ✨ Destaques

> **Streaming** com raciocínio visível · **diff Git estruturado** · **prompt enhancer que aprende** ·
> aprovação human-in-the-loop · **Ctrl+K** · slash-commands · multimodal · RAG ancorado nas docs.

| | |
|---|---|
| 🤖 **Agente de código** | lê (`Read`/`Glob`/`Grep`), edita (`Edit`/`Write`), roda comandos (`Bash`) e consulta um **guardião** ancorado nas docs |
| 🧠 **RAG ancorado** | indexa a doc num vetor store (Jina → Neon/pgvector) e responde **só com base nas fontes** — ancoragem garantida por **código**, não por prompt |
| 🛡️ **Segurança em 2 camadas** | *guard hook* veta o destrutivo automaticamente; `canUseTool` pede **tua confirmação** antes de cada escrita/comando (com "✓ Sempre") |
| 💬 **Web chat rico** | `my-agent-chat` — streaming, raciocínio, diff, enhancer e mais ([abaixo](#-my-agent-chat-a-ui-web)) |
| ⌨️ **CLI** | pergunta única, revisão de arquivo, chat no terminal |

---

## 💬 `my-agent-chat` (a UI web)

<table>
<tr><td><b>⚡ Streaming</b></td><td>respostas token a token; <b>raciocínio (extended thinking) visível</b> num bloco colapsável e <b>persistido</b> no histórico</td></tr>
<tr><td><b>🎨 Código</b></td><td>markdown + <b>syntax highlight (Shiki)</b>; botão copiar por bloco e por mensagem</td></tr>
<tr><td><b>🌿 Git</b></td><td>painel de diff <b>estruturado</b>: por arquivo, badges Adicionado/Modificado/Removido, contagem +/−, unificado/dividido, escopo "último turno" vs "tudo"</td></tr>
<tr><td><b>📡 Painéis ao vivo</b></td><td>🔧 Tools · 📋 Tarefas (TodoWrite) · 🌿 Git</td></tr>
<tr><td><b>🧩 Sub-agentes</b></td><td>delegações (Task) e consultas ao guardião viram <b>cards inline</b> no fluxo</td></tr>
<tr><td><b>🎛️ Controle</b></td><td>seletor de modelo (Sonnet/Opus/Haiku), <b>esforço de raciocínio</b> (Padrão→Máximo), <code>cwd</code> configurável, botão parar</td></tr>
<tr><td><b>⌨️ Input</b></td><td><code>@</code> referencia arquivos · <b>colar imagem</b> (multimodal, persistida) · <b>✨ prompt enhancer</b> · multilinha (Shift+Enter)</td></tr>
<tr><td><b>/ Slash-commands</b></td><td><code>/clear</code> <code>/git</code> <code>/tools</code> <code>/tarefas</code> <code>/compact</code> <code>/guardian</code></td></tr>
<tr><td><b>🔍 Atalhos</b></td><td><b>Ctrl+K</b> command palette (busca arquivos + ações)</td></tr>
<tr><td><b>🗂️ Sessões</b></td><td>renomear/arquivar, retomar contexto, persistência em <b>SQLite</b></td></tr>
<tr><td><b>🔔 Feedback</b></td><td>aprovação human-in-the-loop, toasts, <b>medidor de uso de contexto</b>, custo/tokens por turno</td></tr>
</table>

### ✨ Prompt enhancer (com aprendizado)

Botão que reescreve o teu rascunho num prompt claro e acionável para o agente (via **Haiku**, one-shot).
**Evolui com o uso**: cada par `(rascunho → prompt enviado)` aprovado é guardado no SQLite e injetado como
**few-shot** nas próximas melhorias, pegando o teu estilo e os padrões do projeto. Volta pro input pra revisão —
nunca envia sozinho.

---

## 🏗️ Arquitetura

```
sources/          # docs do Agent SDK em Markdown (ver "Obter as docs")
src/
  rag/            # indexador (chunk fence-aware → Jina embed → Neon/pgvector) + retriever
  agents/
    runtime.ts              Base buildAgentOptions — scaffolding comum das options do query()
    main-agent.ts           Definição do agente principal (web): system prompt + tools + aprovação
    subagents.ts            Subagentes read-only (explorer/reviewer/planner) via a tool Agent
    tester.ts               Runner do /test (query próprio, Bash liberado, guard ativo)
    enhance.ts              Prompt enhancer (✨) — reescreve a mensagem num prompt acionável
    guardian.ts             Guardian of Library — responde ancorado nas fontes (loop travado)
    guardian-of-library.ts  CLI do guardião (npm run ask)
    consultor.ts            Expõe o guardião como MCP server in-process (consultar_guardian)
  core/
    guard.ts      Hook PreToolUse — veta destrutivo; askOnMutate → roteia Write/Edit/Bash ao canUseTool
    hooks.ts      Tracking de toda tool call (logger)
    logger.ts     Log JSONL + .log legível + EventEmitter (para a UI)
web/
  server/         Express + WebSocket
    ai-client.ts  query() do SDK: streaming, effort, canUseTool, hooks
    session.ts    sessão por chat: streaming (texto/thinking), aprovação, /compact, histórico
    server.ts     rotas REST + WS, git diff/numstat, /api/enhance, /api/project/info
    enhance.ts    prompt enhancer (Haiku one-shot + few-shot dos exemplos aprovados)
    chat-store.ts SQLite: chats, mensagens (texto/thinking), imagens, prompt_examples
    uploads.ts    persistência das imagens coladas (valida tipo/tamanho/IO)
  client/         React 18 + Vite + Tailwind 3 (chat, painéis, palette, modais)
```

<details>
<summary><b>🧠 Fluxo RAG — ancoragem por código</b></summary>

```
sources/*.md → chunker (section + fence-aware) → Jina embed (passage)
             → Neon (pgvector, idempotente por chunk_hash)
                            ↑
pergunta → [pre-fetch] Jina embed (query) → top-8 → injeta no prompt → Guardian → resposta citada
```

A ancoragem é **garantida por código**: o retrieve roda *antes* do `query()` e o contexto é injetado no prompt —
o modelo não decide se busca ou não.

</details>

<details>
<summary><b>🛡️ Segurança em camadas — ordem de avaliação do SDK</b></summary>

```
ação do agente
  → 1. guard hook       ⛔ veta rm -rf / .env / fora do projeto (automático)
                        ↳ askOnMutate: Write/Edit/Bash não-perigosos → 'ask'
  → 2. deny/allow rules
  → 3. permission mode (default)
  → 4. canUseTool       ⚠️ Write/Edit/Bash → pede TUA aprovação no browser ("✓ Sempre" memoriza)
```

> ⚠️ Um PreToolUse hook que retorna `{}` resolve a permissão como *allow* e **curto-circuita antes do
> `canUseTool`**. Por isso o guard usa `permissionDecision: 'ask'` para rotear as ações mutantes ao modal.

</details>

---

## 🚀 Setup

**Pré-requisitos:** Node.js ≥ 20 · conta no [Neon](https://neon.tech) (free) com a extensão `vector` ·
chaves da [Anthropic](https://console.anthropic.com) e da [Jina](https://jina.ai).

**1. `.env` (na raiz)**

```bash
DATABASE_URL=postgresql://...   # connection string do Neon
# ANTHROPIC_API_KEY e JINA_API_KEY podem estar no ambiente ou no .env
```

**2. Banco (uma vez)** — crie a tabela do vetor store no Neon:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE documents (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source text NOT NULL, chunk_index int NOT NULL,
  content text NOT NULL, chunk_hash text NOT NULL UNIQUE,
  embedding vector(1024) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX documents_embedding_hnsw ON documents USING hnsw (embedding vector_cosine_ops);
```

> 💾 O SQLite local (`data/chat.db`) é criado e migrado automaticamente — guarda conversas, imagens e os
> exemplos do prompt enhancer.

**3. Docs + índice** — o repo **não inclui** a documentação do Agent SDK (conteúdo da Anthropic). Coloque os
`.md` das docs em `sources/` e indexe:

```bash
npm install
npm run index          # lê sources/, embeda e grava no Neon
```

---

## ▶️ Uso

**Web (`my-agent-chat`)**

```bash
npm run web            # sobe server (3001) + Vite (5173)  →  http://localhost:5173
```

**CLI**

```bash
npm run ask "como configuro tools no SDK?"     # pergunta às docs (guardião + RAG)
npm run typecheck                              # tsc servidor (NodeNext) + cliente (bundler)
```

---

## 🧰 Stack

| Camada | Tecnologia |
|---|---|
| Agentes | `@anthropic-ai/claude-agent-sdk` |
| Embeddings | Jina AI (`jina-embeddings-v5-text-small`, 1024d) |
| Vector store | Neon + pgvector |
| Conversas / exemplos | SQLite (`better-sqlite3`) |
| Servidor | Express + `ws` |
| Cliente | React 18 + Vite 5 + Tailwind 3 · react-markdown · **Shiki** · **lucide-react** · **sonner** · react-textarea-autosize |
| Runtime | tsx (ESM) |

---

## 🎯 Escopo & limites

- **Local-first, single-user.** Sem autenticação, multi-tenant ou deploy de produção — feito pra rodar na tua máquina, editando os teus projetos.
- A documentação em `sources/` pertence à **Anthropic**; não é redistribuída aqui.
- A UI nasceu do demo oficial [`simple-chatapp`](https://github.com/anthropics/claude-agent-sdk-demos), mas a lógica de agentes e quase toda a UI foram reescritas.

<div align="center"><sub>MIT · construído pra aprender o Agent SDK na prática — e virou ferramenta.</sub></div>
