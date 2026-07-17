/**
 * Provider registry.
 *
 * Add new providers here; everything else should stay provider-agnostic.
 */

import type { QuotaProvider } from "./types.js";

let _providers: QuotaProvider[] | null = null;

export async function getProviders(): Promise<QuotaProvider[]> {
  if (_providers) return _providers;

  const [
    { anthropicProvider },
    { copilotProvider },
    { openaiProvider },
    { cursorProvider },
    { googleAntigravityProvider },
    { googleGeminiCliProvider },
    { googleAgyProvider },
    { syntheticProvider },
    { chutesProvider },
    { qwenCodeProvider },
    { alibabaCodingPlanProvider },
    { zaiProvider },
    { zhipuProvider },
    { nanoGptProvider },
    { minimaxCodingPlanProvider, minimaxChinaCodingPlanProvider },
    { opencodeGoProvider },
    { kimiCodeProvider },
    { deepseekProvider },
    { ollamaCloudProvider },
  ] = await Promise.all([
    import("./anthropic.js"),
    import("./copilot.js"),
    import("./openai.js"),
    import("./cursor.js"),
    import("./google-antigravity.js"),
    import("./google-gemini-cli.js"),
    import("./google-agy.js"),
    import("./synthetic.js"),
    import("./chutes.js"),
    import("./qwen-code.js"),
    import("./alibaba-coding-plan.js"),
    import("./zai.js"),
    import("./zhipu.js"),
    import("./nanogpt.js"),
    import("./minimax-coding-plan.js"),
    import("./opencode-go.js"),
    import("./kimi-code.js"),
    import("./deepseek.js"),
    import("./ollama-cloud.js"),
  ]);

  // Order here defines display ordering in the toast.
  _providers = [
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
