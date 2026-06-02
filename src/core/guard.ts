// Guard hook (PreToolUse) — guarda-corpo determinístico para o chat capaz.
// Deixa o agente ler/editar/rodar, MAS veta ações perigosas antes de executarem.
// Bloqueio acontece no passo "Deny rules/hooks" da avaliação de permissão (hooks.md):
// retornar permissionDecision:"deny" impede a tool, mesmo em acceptEdits.
import { resolve } from 'node:path';
import type { HookCallback, PreToolUseHookInput } from '@anthropic-ai/claude-agent-sdk';
import { log } from './logger.ts';
import { onPreToolUse, onPostToolUse } from './hooks.ts';

// Comandos shell destrutivos / de escalonamento.
// >\/dev\/... só é perigoso para device files (ex: /dev/sda). Redirecionamentos
// comuns e inofensivos (>/dev/null, 2>/dev/null, /dev/std*, /dev/tty, /dev/fd/N)
// são liberados via negative lookahead — senão o guard barra um idioma onipresente.
const DANGEROUS_BASH = /\brm\s+-[rf]{1,2}\b|\bmkfs\b|\bdd\s+if=|:\(\)\s*\{|>\s*\/dev\/(?!null|std(?:in|out|err)|tty|fd\/|zero|u?random)|\bsudo\b|\bchmod\s+-R\b|\bgit\s+(reset\s+--hard|clean\s+-[fd])/;

// Tools que mexem no sistema -> candidatas a confirmação humana (canUseTool).
const MUTATING_TOOLS = ['Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit'];

// Recebe o cwd configurado para a sessão (pode diferir de process.cwd()).
// askOnMutate: para tools mutantes NÃO-perigosas, devolve permissionDecision:'ask'
//   em vez de {}. Necessário porque um PreToolUse hook que retorna {} resolve a
//   permissão como "allow" no passo 1 (hooks) e CURTO-CIRCUITA antes do canUseTool
//   (passo 5) — sem 'ask', o modal de aprovação no browser nunca dispara.
export function createGuardedHooks(cwd: string, opts: { askOnMutate?: boolean } = {}) {
  const resolvedCwd = resolve(cwd);

  const hook: HookCallback = async (input) => {
    const pre = input as PreToolUseHookInput;
    const ti = (pre.tool_input ?? {}) as Record<string, unknown>;
    let reason: string | null = null;

    if (pre.tool_name === 'Bash') {
      const cmd = String(ti.command ?? '');
      if (DANGEROUS_BASH.test(cmd)) reason = `comando destrutivo: ${cmd}`;
    } else if (['Write', 'Edit', 'MultiEdit'].includes(pre.tool_name)) {
      const fp = String(ti.file_path ?? '');
      const name = fp.split('/').pop() ?? '';
      if (name === '.env') reason = 'escrita em .env';
      else if (fp && !resolve(fp).startsWith(resolvedCwd)) reason = `escrita fora do projeto: ${fp}`;
    }

    if (reason) {
      await log.warn('guard.deny', { tool: pre.tool_name, reason });
      return {
        hookSpecificOutput: {
          hookEventName: pre.hook_event_name,
          permissionDecision: 'deny',
          permissionDecisionReason: `Bloqueado pelo guard: ${reason}`,
        },
      };
    }

    // não-perigoso, mas mutante: encaminha para o prompt (canUseTool) em vez de auto-allow
    if (opts.askOnMutate && MUTATING_TOOLS.includes(pre.tool_name)) {
      return {
        hookSpecificOutput: {
          hookEventName: pre.hook_event_name,
          permissionDecision: 'ask',
        },
      };
    }

    return {};
  };

  return {
    PreToolUse: [{ hooks: [onPreToolUse, hook] }],
    PostToolUse: [{ hooks: [onPostToolUse] }],
  };
}

// Compat: usa o cwd do processo (comportamento original)
export const guardedHooks = createGuardedHooks(process.cwd());
