// Base compartilhada dos runners de agente. Monta as `options` do query() preenchendo
// o scaffolding COMUM (preset claude_code, permissionMode, includePartialMessages, …),
// pra cada runner (main-agent, tester, enhance, …) declarar só o SEU delta. Mata a
// repetição que havia espalhada em cada query().
//
// O tipo das options é derivado do próprio `query` (Parameters<typeof query>) — assim
// não dependemos do nome do tipo exportado pelo SDK e os campos vivos (hooks, mcpServers,
// canUseTool) ficam type-safe.
import { query } from '@anthropic-ai/claude-agent-sdk';

type AgentOptions = NonNullable<Parameters<typeof query>[0]['options']>;

export interface AgentSpec {
  /** system prompt do agente (por padrão vira o `append` do preset claude_code) */
  prompt: string;
  /** model alias/id (omitido = default do SDK/CLI) */
  model?: string;
  /** diretório de trabalho */
  cwd?: string;
  /** tools pré-aprovadas (omitido = não restringe / herda) */
  allowedTools?: string[];
  /** teto de turnos agentivos (default 50) */
  maxTurns?: number;
  /** teto de custo em USD para o query (omitido = sem teto) */
  maxBudgetUsd?: number;
  /** nível de raciocínio (low/medium/high/xhigh) */
  effort?: string;
  /** modo de permissão (default = canUseTool/guard decidem) */
  permissionMode?: AgentOptions['permissionMode'];
  /** emitir stream_event (texto/raciocínio token a token) */
  stream?: boolean;
  /** usar o prompt CRU como systemPrompt, SEM o preset claude_code (ex: enhancer one-shot) */
  rawPrompt?: boolean;
  /** PreToolUse/PostToolUse hooks (guard, tracking, …) */
  hooks?: AgentOptions['hooks'];
  /** servidores MCP in-process, por nome */
  mcpServers?: AgentOptions['mcpServers'];
  /** subagentes nomeados invocáveis via a tool Agent */
  agents?: AgentOptions['agents'];
  /** gate de aprovação humana (human-in-the-loop) */
  canUseTool?: AgentOptions['canUseTool'];
}

export function buildAgentOptions(spec: AgentSpec): AgentOptions {
  return {
    ...(spec.model ? { model: spec.model } : {}),
    ...(spec.cwd ? { cwd: spec.cwd } : {}),
    maxTurns: spec.maxTurns ?? 50,
    ...(spec.maxBudgetUsd != null ? { maxBudgetUsd: spec.maxBudgetUsd } : {}),
    ...(spec.effort ? { effort: spec.effort as any } : {}),
    ...(spec.stream ? { includePartialMessages: true } : {}),
    permissionMode: spec.permissionMode ?? 'default',
    systemPrompt: spec.rawPrompt
      ? spec.prompt
      : { type: 'preset', preset: 'claude_code', append: spec.prompt },
    ...(spec.allowedTools ? { allowedTools: spec.allowedTools } : {}),
    ...(spec.hooks ? { hooks: spec.hooks } : {}),
    ...(spec.mcpServers ? { mcpServers: spec.mcpServers } : {}),
    ...(spec.agents ? { agents: spec.agents } : {}),
    ...(spec.canUseTool ? { canUseTool: spec.canUseTool } : {}),
  };
}
