export const MODELS = [
  // ── Anthropic ──────────────────────────────────────────
  { id: "claude-opus-4.6",        label: "Claude Opus 4.6",          provider: "Anthropic" },
  { id: "claude-sonnet-4.6",      label: "Claude Sonnet 4.6",        provider: "Anthropic" },
  { id: "claude-sonnet-4.5",      label: "Claude Sonnet 4.5",        provider: "Anthropic" },
  { id: "claude-opus-4.5",        label: "Claude Opus 4.5",          provider: "Anthropic" },
  { id: "claude-haiku-4.5",       label: "Claude Haiku 4.5",         provider: "Anthropic" },
  { id: "claude-sonnet-4",        label: "Claude Sonnet 4",          provider: "Anthropic" },
  // ── OpenAI ─────────────────────────────────────────────
  { id: "gpt-5.4",                label: "GPT-5.4",                  provider: "OpenAI"    },
  { id: "gpt-5.4-mini",           label: "GPT-5.4 Mini",             provider: "OpenAI"    },
  { id: "gpt-5.3-codex",          label: "GPT-5.3 Codex",            provider: "OpenAI"    },
  { id: "gpt-5.2",                label: "GPT-5.2",                  provider: "OpenAI"    },
  { id: "gpt-5.2-codex",          label: "GPT-5.2 Codex",            provider: "OpenAI"    },
  { id: "gpt-5.1",                label: "GPT-5.1",                  provider: "OpenAI"    },
  { id: "gpt-5.1-codex",          label: "GPT-5.1 Codex",            provider: "OpenAI"    },
  { id: "gpt-5.1-codex-mini",     label: "GPT-5.1 Codex Mini",       provider: "OpenAI"    },
  { id: "gpt-5.1-codex-max",      label: "GPT-5.1 Codex Max",        provider: "OpenAI"    },
  { id: "gpt-5-mini",             label: "GPT-5 Mini",               provider: "OpenAI"    },
  // ── Google ─────────────────────────────────────────────
  { id: "gemini-3-pro-preview",   label: "Gemini 3 Pro Preview",     provider: "Google"    },
  { id: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview",   provider: "Google"    },
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview",   provider: "Google"    },
  { id: "gemini-2.5-pro",         label: "Gemini 2.5 Pro",           provider: "Google"    },
  // ── xAI ────────────────────────────────────────────────
  { id: "grok-code-fast-1",       label: "Grok Code Fast 1",         provider: "xAI"       },
  // ── Copilot Special ────────────────────────────────────
  { id: "oswe-vscode-prime",      label: "OSWE VSCode Prime",        provider: "Copilot"   },
  { id: "oswe-vscode-secondary",  label: "OSWE VSCode Secondary",    provider: "Copilot"   },
] as const;

export type ModelId = typeof MODELS[number]["id"];
