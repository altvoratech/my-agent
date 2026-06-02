// Runner do "tester" — um agente que SÓ o usuário dispara (via /test).
// Diferente dos subagentes read-only (explorer/reviewer/planner), este roda em
// um query() PRÓPRIO com perfil de permissão separado: o Bash é liberado SEM
// passar pelo modal de aprovação. A autorização humana é a própria ação de
// disparar o /test ("sei que ele vai rodar comandos e aceito").
//
// A rede de segurança continua: usamos createGuardedHooks(cwd) SEM askOnMutate,
// então o guard ainda BLOQUEIA o destrutivo (rm -rf, git reset --hard, escrita
// em .env / fora do cwd). E o allowedTools NÃO inclui Write/Edit — o tester lê,
// roda testes e reporta; quem escreve continua sendo o agente principal.
import { query } from '@anthropic-ai/claude-agent-sdk';
import { createGuardedHooks } from '../core/guard.ts';
import { buildAgentOptions } from './runtime.ts';

const TESTER_SYSTEM = `Você é o Tester — valida o projeto e REPORTA, sem consertar.
Processo:
1. Descubra COMO o projeto valida: leia package.json (scripts test/typecheck/lint),
   tsconfig.json e a config de vitest/jest se houver.
2. Rode, na ordem, o que existir (via Bash): typecheck (ex: tsc --noEmit) e a suíte de testes.
   Rode lint só se for rápido e existir script dedicado.
3. NÃO edite código, NÃO instale dependências, NÃO altere configs — apenas execute e observe.
4. Reporte de forma objetiva: para cada comando, o que rodou e o exit code; depois liste as
   FALHAS com arquivo:linha e a causa provável de cada uma (sem corrigir). Se tudo passou, diga.
Responda em português do Brasil, conciso e factual.`;

// Gera as mensagens do SDK do tester. instruction opcional foca o que rodar.
export async function* runTester(cwd: string, instruction?: string) {
  const task = instruction?.trim()
    ? instruction.trim()
    : 'Rode a validação completa do projeto (typecheck + testes) e reporte o resultado.';

  const q = query({
    prompt: task,
    // Bash liberado; SEM canUseTool e SEM askOnMutate -> não cai no modal. O guard
    // segue ativo barrando o destrutivo (DANGEROUS_BASH / .env / fora do cwd).
    options: buildAgentOptions({
      model: 'claude-sonnet-4-6',
      cwd,
      maxTurns: 30,
      stream: true, // streama o relatório token a token
      prompt: TESTER_SYSTEM,
      allowedTools: ['Read', 'Glob', 'Grep', 'Bash', 'TodoWrite'],
      hooks: createGuardedHooks(cwd),
    }),
  });

  for await (const msg of q) yield msg;
}
