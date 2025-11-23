import type { Request, Response } from "express";
import { streamScriptGeneration } from "../services/script.service";

export const generateScriptHandler = async (req: Request, res: Response) => {
  const { prompt } = req.body;

  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    return res.status(400).json({ error: "Prompt is required" });
  }

  try {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Transfer-Encoding", "chunked");

    const stream = await streamScriptGeneration(prompt.trim());

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || "";
      if (text) {
        res.write(text);
      }
    }

    res.end();
  } catch (error) {
    console.error("Script generation failed", error);
    res.status(500).json({ error: "Failed to generate script" });
  }
};
