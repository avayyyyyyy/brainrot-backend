import { openai } from "../lib/openai";
import { SCRIPT_GENERATOR_PROMPT } from "../constants/prompts";

export const streamScriptGeneration = async (prompt: string) => {
  return openai.chat.completions.stream({
    model: "gpt-4.1-nano",
    stream: true,
    messages: [
      {
        role: "system",
        content: SCRIPT_GENERATOR_PROMPT,
      },
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.7,
    max_tokens: 2000,
  });
};
