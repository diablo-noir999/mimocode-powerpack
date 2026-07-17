/**
 * Provider registry for quota tracking.
 *
 * Adapted from dev/opencode-quota/src/providers/registry.ts
 */

import type { QuotaProvider } from "./types.js"

let _providers: QuotaProvider[] | undefined;

export async function getProviders(): Promise<QuotaProvider[]> {
  if (_providers) return _providers;

  const [
    { mimoProvider },
    { anthropicProvider },
    { copilotProvider },
    { openaiProvider },
    { cursorProvider },
    { qwenCodeProvider },
    { alibabaCodingPlanProvider },
    { syntheticProvider },
    { chutesProvider },
    { googleAntigravityProvider },
    { googleGeminiCliProvider },
    { googleAgyProvider },
    { zaiProvider },
    { zhipuProvider },
    { nanoGptProvider },
    { minimaxCodingPlanProvider, minimaxChinaCodingPlanProvider },
    { kimiCodeProvider },
    { deepseekProvider },
    { opencodeGoProvider },
    { ollamaCloudProvider },
  ] = await Promise.all([
    import("./mimo.js"),
    import("./anthropic.js"),
    import("./copilot.js"),
    import("./openai.js"),
    import("./cursor.js"),
    import("./qwen-code.js"),
    import("./alibaba-coding-plan.js"),
    import("./synthetic.js"),
    import("./chutes.js"),
    import("./google-antigravity.js"),
    import("./google-gemini-cli.js"),
    import("./google-agy.js"),
    import("./zai.js"),
    import("./zhipu.js"),
    import("./nanogpt.js"),
    import("./minimax-coding-plan.js"),
    import("./kimi-code.js"),
    import("./deepseek.js"),
    import("./opencode-go.js"),
    import("./ollama-cloud.js"),
  ]);

  _providers = [
    mimoProvider,
    anthropicProvider,
    copilotProvider,
    openaiProvider,
    cursorProvider,
    qwenCodeProvider,
    alibabaCodingPlanProvider,
    syntheticProvider,
    chutesProvider,
    googleAntigravityProvider,
    googleGeminiCliProvider,
    googleAgyProvider,
    zaiProvider,
    zhipuProvider,
    nanoGptProvider,
    minimaxCodingPlanProvider,
    minimaxChinaCodingPlanProvider,
    kimiCodeProvider,
    deepseekProvider,
    opencodeGoProvider,
    ollamaCloudProvider,
  ];

  return _providers;
}
