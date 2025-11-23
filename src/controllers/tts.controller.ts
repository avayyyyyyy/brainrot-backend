import type { Request, Response } from "express";
import { ttsService } from "../services/tts.service";

export const synthesizeSpeechHandler = async (req: Request, res: Response) => {
  const { text, speed, steps } = req.body as {
    text?: string;
    speed?: number;
    steps?: number;
  };

  if (!text || typeof text !== "string" || !text.trim()) {
    return res.status(400).json({ error: "Text is required" });
  }

  try {
    const { buffer, duration } = await ttsService.synthesize(text.trim(), {
      speed,
      steps,
    });

    res.setHeader("Content-Type", "audio/wav");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=brainrot-tts.wav"
    );
    res.setHeader("X-Audio-Duration", duration.toString());
    res.send(buffer);
  } catch (error) {
    console.error("TTS synthesis failed", error);
    res.status(500).json({ error: "Failed to synthesize speech" });
  }
};
