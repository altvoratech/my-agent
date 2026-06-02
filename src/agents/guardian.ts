// Guardian of Library — núcleo reutilizável. Responde perguntas ANCORADO nas
// fontes do Neon (jina embed -> pgvector top-8 -> guardian responde).
//
// Loop TRAVADO: o contexto é pré-buscado no código (pre-fetch obrigatório) e
// injetado no prompt, então TODA resposta nasce ancorada — o modelo não pode
// "decidir não buscar". A tool search_docs fica disponível só para refinamento
// opcional (multi-hop), com readOnlyHint para poder rodar em paralelo.
import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { retrieve, type RetrievedChunk } from '../rag/retrieve.ts';
import { log } from '../core/logger.ts';
import { trackingHooks } from '../core/hooks.ts';
import { buildAgentOptions } from './runtime.ts';

const TOP_K = 8;

function formatHits(hits: RetrievedChunk[]): string {
  return hits
    .map((h, i) => `[${i + 1}] fonte: ${h.source} (score ${h.score.toFixed(2)})\n${h.content}`)
    .join('\n\n---\n\n');
}

const searchDocs = tool(
  'search_docs',
  'Busca trechos adicionais na base de docs do Claude Agent SDK. Use APENAS se o contexto já fornecido não bastar para responder.',
  {
    query: z.string().describe('Consulta em linguagem natural; reformule para refinar a busca'),
  },
  async (args) => {
    const hits = await retrieve(args.query, { topK: TOP_K });
    await log.info('guardian.search', {
      query: args.query,
      hits: hits.length,
      sources: [...new Set(hits.map((h) => h.source))],
    });
    const text = hits.length === 0 ? 'Nenhum trecho relevante encontrado.' : formatHits(hits);
    return { content: [{ type: 'text', text }] };
  },
  { annotations: { readOnlyHint: true } }, // sem efeitos colaterais -> pode rodar em paralelo
);

const libraryServer = createSdkMcpServer({ name: 'library', version: '1.0.0', tools: [searchDocs] });

const SYSTEM = `Você é o Guardian of Library, guardião de uma biblioteca de documentação.
O prompt já traz um bloco "CONTEXTO DAS FONTES" pré-buscado para a pergunta.
Regras invioláveis:
- Responda SOMENTE com base no CONTEXTO DAS FONTES (e em buscas extras, se fizer). Nunca use conhecimento próprio.
- Se o contexto não bastar, chame search_docs para buscar mais — não invente.
- Se mesmo assim as fontes não cobrirem, diga "Não encontrei isso nas fontes".
- Cite as fontes ao final no formato [fonte: arquivo.md].
- Responda em português do Brasil, de forma objetiva. Para código, copie verbatim da fonte (não reescreva de memória).`;

export interface GuardianResult {
  answer: string;
  cost: number;
  turns: number;
}

/**
 * Consulta o guardião e retorna a resposta final (texto) + métricas.
 * Faz pre-fetch obrigatório das fontes antes de chamar o modelo (ancoragem garantida).
 */
export async function askGuardian(
  pergunta: string,
  onProgress?: (line: string) => void,
): Promise<GuardianResult> {
  let answer = '';
  let cost = 0;
  let turns = 0;

  await log.info('guardian.ask', { pergunta });

  // pre-fetch: SEMPRE busca antes de responder -> trava a ancoragem
  const hits = await retrieve(pergunta, { topK: TOP_K });
  await log.info('guardian.prefetch', {
    hits: hits.length,
    sources: [...new Set(hits.map((h) => h.source))],
  });

  const contexto = hits.length
    ? `CONTEXTO DAS FONTES (pré-buscado para a pergunta):\n\n${formatHits(hits)}`
    : 'CONTEXTO DAS FONTES: nenhum trecho relevante encontrado no acervo.';
  const prompt = `${contexto}\n\n---\n\nPERGUNTA: ${pergunta}`;

  for await (const message of query({
    prompt,
    options: buildAgentOptions({
      model: 'claude-sonnet-4-6',
      maxTurns: 6,
      maxBudgetUsd: 0.5,
      prompt: SYSTEM,
      allowedTools: ['mcp__library__search_docs'],
      mcpServers: { library: libraryServer },
      hooks: trackingHooks, // captura tool calls do guardião (ex: search_docs extra)
    }),
  })) {
    if (message.type === 'assistant' && message.message?.content) {
      for (const block of message.message.content) {
        if ('text' in block) {
          answer += block.text;
          onProgress?.(block.text);
        } else if ('name' in block) {
          onProgress?.(`\n[tool: ${block.name}]`);
        }
      }
    } else if (message.type === 'result') {
      turns = 'num_turns' in message ? message.num_turns : 0;
      cost = 'total_cost_usd' in message ? message.total_cost_usd : 0;
      await log.info('guardian.result', {
        subtype: message.subtype,
        turns,
        cost,
        answerChars: answer.trim().length,
        answer: answer.trim(),
      });
    }
  }
  return { answer: answer.trim(), cost, turns };
}
