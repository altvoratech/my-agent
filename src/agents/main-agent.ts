// Definição do AGENTE PRINCIPAL do my-agent — o orquestrador que o chat web conversa.
// Aqui mora o DOMÍNIO do agente: system prompt, tools, subagentes especialistas e a
// política de aprovação (human-in-the-loop). O TRANSPORTE da sessão (MessageQueue +
// AgentSession, streaming-input mode) fica em web/server/ai-client.ts.
import { consultorServer, CONSULTOR_TOOL } from './consultor.ts';
import { subagents } from './subagents.ts';
import { createGuardedHooks } from '../core/guard.ts';
import { buildAgentOptions } from './runtime.ts';

export function buildSystemPrompt(cwd: string) {
  return `Você é um assistente de engenharia trabalhando no projeto em: ${cwd}
Capacidades: ler (Read, Glob, Grep), editar/criar arquivos (Edit, Write), rodar comandos (Bash),
consultar o guardião (consultar_guardian) — ancorado na doc OFICIAL do Claude Agent SDK — e
DELEGAR subtarefas a subagentes especialistas via a tool Agent.
Subagentes disponíveis (read-only; eles reportam, você implementa):
- explorer: mapeia/entende o código antes de implementar (arquitetura, onde algo vive, fluxos).
- reviewer: revisa código contra a doc oficial do SDK (via guardião).
- planner: planeja uma implementação não-trivial (passos, arquivos, riscos) sem escrever código.
Regras:
- O diretório de trabalho é ${cwd}. Use caminhos relativos a esse diretório ou absolutos dentro dele.
- Quando o usuário referenciar um arquivo com @caminho/do/arquivo, leia-o com Read antes de responder.
- Para tarefas grandes/desconhecidas, delegue a exploração/plano antes de editar (use explorer/planner).
- Para QUALQUER afirmação sobre a API do Agent SDK, consulte o guardião antes — não confie na memória.
- Você pode corrigir o código diretamente (Edit/Write) quando fizer sentido.
- Um guard bloqueia ações destrutivas (rm -rf, escrita fora do projeto, .env). Se algo for bloqueado, explique e siga outro caminho.
- Responda em português do Brasil, de forma objetiva.`;
}

// Ações que mexem no sistema -> pedem confirmação humana via canUseTool.
const NEEDS_APPROVAL = new Set(['Write', 'Edit', 'MultiEdit', 'Bash', 'NotebookEdit']);

export type ApprovalFn = (req: { tool: string; input: any }) => Promise<boolean>;

export interface MainAgentParams {
  model: string;
  cwd: string;
  effort?: string;
  onApproval?: ApprovalFn;
}

// Monta as `options` do query() do agente principal (tudo menos o prompt/queue — isso é
// transporte). Recebe o onApproval (callback que pergunta ao browser) por injeção.
// O scaffolding comum (preset, permissionMode, stream) vem de buildAgentOptions.
export function buildMainAgentOptions({ model, cwd, effort, onApproval }: MainAgentParams) {
  return buildAgentOptions({
    model,
    cwd,
    effort,
    maxTurns: 200,
    stream: true, // emite stream_event para o front renderizar token a token
    prompt: buildSystemPrompt(cwd),
    mcpServers: { consultor: consultorServer },
    // subagentes especialistas (read-only) que o agente principal invoca via Agent
    agents: subagents,
    // leitura + delegação pré-aprovadas; escrita/exec caem no canUseTool (default mode)
    allowedTools: ['Read', 'Glob', 'Grep', 'TodoWrite', 'Agent', 'Task', CONSULTOR_TOOL],
    // guard veta o destrutivo e encaminha mutações ao canUseTool (askOnMutate)
    hooks: createGuardedHooks(cwd, { askOnMutate: true }),
    canUseTool: async (toolName, input) => {
      if (!NEEDS_APPROVAL.has(toolName) || !onApproval) {
        return { behavior: 'allow', updatedInput: input };
      }
      const ok = await onApproval({ tool: toolName, input });
      return ok
        ? { behavior: 'allow', updatedInput: input }
        : { behavior: 'deny', message: 'Ação recusada pelo usuário.' };
    },
  });
}
