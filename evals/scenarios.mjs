// One row per behavior. `expect` maps criteria (criteria.mjs) to their arguments; `answer` and other per-host
// arguments live under `hosts`. `control` names the criteria the ablate arm (adapter delivery removed) must fail.
// Prompts are what a user types: no mention of how the run is observed.

export const SCENARIOS = [
  {
    id: "help-models",
    skill: "poteto-help",
    fixture: "invoice-service",
    prompt: "how do I choose which model each pstack role uses, and where does that setting live?",
    expect: { loaded: true, adapter: true, spawns: [0, 0], clean: true, rulesUntouched: true },
    hosts: {
      claude: { answer: ["/pstack:setup-pstack", "~/\\.claude/rules/pstack-models\\.md"] },
      pi: { answer: ["/skill:setup-pstack", "~/\\.pi/agent/pstack-models\\.md"] },
    },
    control: ["adapter", "answer"],
    why: "The answer is right only if the adapter was applied: harness setup command and rule path, not Cursor's.",
  },
  {
    id: "how-simple",
    skill: "how",
    fixture: "billing-service",
    prompt: "how does computeTax decide whether to round tax per line or once for the whole order?",
    expect: { loaded: true, adapter: true, spawns: [1, 1], readonly: true, modelsValid: true, announced: true, clean: true, rulesUntouched: true },
    hosts: { claude: {}, pi: { noLeftover: true }, cursor: {}, grok: {} },
    control: ["adapter"],
    why: "A narrow question takes the simple path: one read-only explainer, no explorers, Task mapped to the harness.",
  },
  {
    id: "how-complex",
    skill: "how",
    fixture: "billing-service",
    prompt:
      "give me a full architectural overview of this service: how a POST /invoices request becomes a stored, numbered invoice, across validation, catalog tiers, discount stacking, currency conversion and regional tax, and where each rule lives.",
    expect: {
      loaded: true, adapter: true, spawns: [3, 5], parallel: 2, readonly: true, modelsValid: true, announced: true, clean: true, rulesUntouched: true,
    },
    hosts: { claude: {}, pi: { noLeftover: true }, cursor: {}, grok: {} },
    control: ["adapter"],
    why: "A full overview takes the complex path: explorers in one batch, then one explainer, all read-only; explorer default model is not a Claude or Pi model, so the fallback must be announced.",
  },
  {
    id: "interrogate-staged",
    skill: "interrogate",
    fixture: "invoice-service",
    overlay: { dir: "staged-fixed-discount", staged: true },
    prompt: "tear apart my staged change before I commit it.",
    expect: {
      loaded: true, adapter: true, spawns: [2, 4], parallel: 2, readonly: true, modelsValid: true, announced: true, stagedIntact: true, rulesUntouched: true,
    },
    hosts: { claude: {}, pi: { noLeftover: true } },
    control: ["adapter"],
    why: "Reviewers fan out together, read-only, and nothing is applied; the flaw is visible only against invoice.js.",
  },
  {
    id: "swarm-worktree",
    skill: "swarm",
    fixture: "invoice-service",
    prompt:
      "2 workers: each adds a one-line JSDoc summary above a different exported function in src/currency.js (one takes toMinor, the other fromMinor), commits it on its own branch, and reports the branch name.",
    expect: { loaded: true, adapter: true, spawns: [2, 2], parallel: 2, worktree: true, modelsValid: true, rulesUntouched: true },
    hosts: { claude: {}, pi: { noLeftover: true } },
    control: ["adapter"],
    why: "environment: \"cloud\" workers must each get an isolated worktree, started together.",
  },
  {
    id: "no-comments-agent",
    skill: "no-comments",
    fixture: "invoice-service",
    overlay: { dir: "narrated-report", staged: false },
    prompt: "src/report.js",
    expect: { loaded: true, adapter: true, spawns: [1, 2], agent: "comment-sicko", rulesUntouched: true },
    hosts: { claude: {}, pi: { noLeftover: true } },
    control: ["adapter"],
    why: "The skill's work is done by the named comment-sicko agent, translated to each harness's agent mechanism.",
  },
  {
    id: "setup-gate",
    skill: "setup-pstack",
    fixture: "invoice-service",
    prompt: "",
    expect: { loaded: true, adapter: true, spawns: [0, 0], asks: true, rulesUntouched: true, answer: ["unlimited", "large", "medium", "small"] },
    hosts: { claude: {}, pi: {} },
    control: ["adapter"],
    why: "Setup stops at the budget question with the four labels and writes no rule file before an answer.",
  },
  {
    id: "models-rule",
    skill: "how",
    fixture: "billing-service",
    overlay: { dir: "project-models-rule", staged: false },
    prompt: "how does computeTax decide whether to round tax per line or once for the whole order?",
    expect: { loaded: true, adapter: true, spawns: [1, 1], model: { model: "sonnet", effort: "low" }, rulesUntouched: true },
    hosts: { claude: {} },
    control: ["adapter"],
    why: "A rule file in context overrides the role defaults; here a project-level rule sets the explainer to sonnet low.",
  },
];

export const scenarioById = (id) => SCENARIOS.find((s) => s.id === id);

export function expectFor(scenario, host) {
  const { answer, ...rest } = scenario.expect;
  const perHost = scenario.hosts[host] ?? {};
  return { ...rest, ...(answer ? { answer } : {}), ...perHost };
}
