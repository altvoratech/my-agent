// Prompt enhancer (✨) com propósito ÚNICO: reescrever a mensagem do usuário
// num prompt claro e acionável para o my-agent (agente de código). Self-contained
// (sem o motor multi-modo do prompt-enhancer, que tem modos cinematic/image que
// não fazem sentido aqui). Roda via Agent SDK com Haiku (rápido/barato), one-shot.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { buildAgentOptions } from "./runtime.ts";

const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM = `Sua tarefa é REESCREVER o rascunho do usuário num prompt melhor para um AGENTE DE CÓDIGO autônomo (o "my-agent") que pode ler/editar arquivos e rodar comandos no projeto.

CRÍTICO — o que NÃO fazer:
- NÃO execute a tarefa. NÃO responda em primeira pessoa ("vou fazer", "entendi", "deixa eu..."). Você NÃO é o agente — você só melhora o pedido que será enviado a ele.
- NÃO invente requisitos, arquivos, bibliotecas ou tecnologias que o usuário não mencionou.

O que fazer:
- Produza o pedido em modo imperativo (uma instrução para o agente), preservando a intenção original.
- Deixe específico e acionável: o que fazer, escopo, e resultado esperado. Quando fizer sentido, peça para investigar/validar (ler arquivos relevantes, rodar build/testes) antes e depois.
- Seja objetivo; mantenha o MESMO idioma do usuário.
- Responda APENAS com o texto do prompt melhorado — sem comentários, sem aspas, sem blocos de código.

Exemplo:
Rascunho: "arruma o login"
Prompt melhorado: "Investigue o fluxo de login do projeto, identifique o que está quebrado (leia os arquivos envolvidos e rode os testes se houver), corrija a causa raiz e valide que o login funciona."`;

// Monta o prompt do usuário, opcionalmente com exemplos few-shot (rascunho ->
// prompt final que o usuário aprovou) para o enhancer ir pegando o estilo dele.
function buildUserPrompt(text: string, examples: { original: string; final: string }[]): string {
  const ask = `Reescreva este rascunho num prompt melhor (responda só com o prompt):\n"""\n${text}\n"""`;
  if (!examples.length) return ask;
  const shots = examples
    .slice()
    .reverse() // do mais antigo ao mais recente
    .map((e, i) => `[${i + 1}] Rascunho: ${e.original.slice(0, 300)}\n    Prompt melhorado: ${e.final.slice(0, 700)}`)
    .join("\n\n");
  return `Exemplos de como ESTE usuário gosta dos prompts finais (siga o mesmo estilo/nível de detalhe, sem copiar o conteúdo):\n\n${shots}\n\n${ask}`;
}

export async function enhancePrompt(
  text: string,
  examples: { original: string; final: string }[] = [],
): Promise<{ originalPrompt: string; improvedPrompt: string; usedExamples: number }> {
  const q = query({
    prompt: buildUserPrompt(text, examples),
    // one-shot: prompt CRU (sem o preset claude_code), 1 turno
    options: buildAgentOptions({ model: MODEL, maxTurns: 1, prompt: SYSTEM, rawPrompt: true }),
  });
  let out = "";
  for await (const m of q) {
    if (m.type === "assistant") {
      const c: any = m.message.content;
      if (typeof c === "string") out += c;
      else if (Array.isArray(c)) for (const b of c) if (b.type === "text") out += b.text;
    } else if (m.type === "result") {
      break;
    }
  }
  const improvedPrompt = out
    .trim()
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  return { originalPrompt: text, improvedPrompt, usedExamples: examples.length };
}
