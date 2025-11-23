import { Supertonic, VoiceStyle } from "../lib/tts";
import { env } from "../config/env";

type SynthesisOptions = {
  speed?: number;
  steps?: number;
};

class TTSService {
  private tts = new Supertonic();
  private voiceStyle: VoiceStyle | null = null;
  private isLoading = false;

  private async ensureLoaded() {
    if (this.voiceStyle || this.isLoading) {
      while (this.isLoading && !this.voiceStyle) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return;
    }

    this.isLoading = true;
    try {
      await this.tts.load(env.TTS_MODEL_DIR);
      this.voiceStyle = await this.tts.loadVoice(env.TTS_VOICE_FILE);
    } finally {
      this.isLoading = false;
    }
  }

  async synthesize(text: string, options: SynthesisOptions = {}) {
    await this.ensureLoaded();
    if (!this.voiceStyle) {
      throw new Error("Voice style not available");
    }

    const { speed, steps } = options;
    return this.tts.speak(text, this.voiceStyle, steps ?? 10, speed ?? 1.0);
  }
}

export const ttsService = new TTSService();
