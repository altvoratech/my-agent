// Adaptado do simple-chatapp da Anthropic: mantém a MessageQueue (streaming input
// mode), mas pluga a NOSSA config — agente-revisor capaz com guardião ancorado nas
// docs (consultar_guardian) + guard hook vetando o perigoso.
import { query } from '@anthropic-ai/claude-agent-sdk';
import { consultorServer, CONSULTOR_TOOL } from '../../src/agents/consultor.ts';
import { subagents } from '../../src/agents/subagents.ts';
import { createGuardedHooks } from '../../src/core/guard.ts';

function buildSystemPrompt(cwd: string) {
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

export interface ImagePart {
  media_type: string;
  data: string; // base64 puro (sem o prefixo data:...;base64,)
}
type UserMessage = { type: 'user'; message: { role: 'user'; content: any } };

// Fila assíncrona: push() de fora, consumida via async iteration pelo query().
class MessageQueue {
  private messages: UserMessage[] = [];
  private waiting: ((msg: UserMessage) => void) | null = null;
  private closed = false;

  push(content: string, images?: ImagePart[]) {
    // multimodal: se houver imagens, content vira um array texto + blocos image.
    const body =
      images && images.length
        ? [
            { type: 'text', text: content },
            ...images.map((img) => ({
              type: 'image',
              source: { type: 'base64', media_type: img.media_type, data: img.data },
            })),
          ]
        : content;
    const msg: UserMessage = { type: 'user', message: { role: 'user', content: body } };
    if (this.waiting) {
      this.waiting(msg);
      this.waiting = null;
    } else {
      this.messages.push(msg);
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<UserMessage> {
    while (!this.closed) {
      if (this.messages.length > 0) yield this.messages.shift()!;
      else yield await new Promise<UserMessage>((resolve) => (this.waiting = resolve));
    }
  }

  close() {
    this.closed = true;
  }
}

// Ações que mexem no sistema -> pedem confirmação humana via canUseTool.
const NEEDS_APPROVAL = new Set(['Write', 'Edit', 'MultiEdit', 'Bash', 'NotebookEdit']);

export type ApprovalFn = (req: { tool: string; input: any }) => Promise<boolean>;

export class AgentSession {
  private queue = new MessageQueue();
  private q: ReturnType<typeof query>;
  private outputIterator: AsyncIterator<any>;

  constructor(model = 'claude-sonnet-4-6', onApproval?: ApprovalFn, cwd = process.cwd(), effort?: string) {
    this.q = query({
      prompt: this.queue as any,
      options: {
        model,
        cwd,
        maxTurns: 200,
        // nível de raciocínio (low/medium/high/xhigh); omitido = default do SDK
        ...(effort ? { effort: effort as any } : {}),
        // emite stream_event (text_delta) para o front renderizar token a token
        includePartialMessages: true,
        mcpServers: { consultor: consultorServer },
        // subagentes especialistas (read-only) que o agente principal invoca via Agent
        agents: subagents,
        // leitura + delegação pré-aprovadas; escrita/exec caem no canUseTool (default mode)
        allowedTools: ['Read', 'Glob', 'Grep', 'TodoWrite', 'Agent', 'Task', CONSULTOR_TOOL],
        permissionMode: 'default',
        systemPrompt: { type: 'preset', preset: 'claude_code', append: buildSystemPrompt(cwd) },
        hooks: createGuardedHooks(cwd, { askOnMutate: true }),
        canUseTool: async (toolName: string, input: any) => {
          if (!NEEDS_APPROVAL.has(toolName) || !onApproval) {
            return { behavior: 'allow', updatedInput: input };
          }
          const ok = await onApproval({ tool: toolName, input });
          return ok
            ? { behavior: 'allow', updatedInput: input }
            : { behavior: 'deny', message: 'Ação recusada pelo usuário.' };
        },
      },
    });
    this.outputIterator = this.q[Symbol.asyncIterator]();
  }

  sendMessage(content: string, images?: ImagePart[]) {
    this.queue.push(content, images);
  }

  // Interrompe o turno atual sem encerrar a sessão (streaming input mode).
  async interrupt() {
    try {
      await this.q.interrupt();
    } catch {
      /* já parado / entre turnos: ignora */
    }
  }

  async *getOutputStream() {
    while (true) {
      const { value, done } = await this.outputIterator.next();
      if (done) break;
      yield value;
    }
  }

  close() {
    this.queue.close();
  }
}
