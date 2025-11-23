import * as ort from "onnxruntime-node";
import * as fs from "fs/promises";
import * as path from "path";

interface TTSConfig {
  ae: { sample_rate: number; base_chunk_size: number };
  ttl: { chunk_compress_factor: number; latent_dim: number };
}

export interface VoiceStyle {
  ttl: ort.Tensor;
  dp: ort.Tensor;
}

export class Supertonic {
  private sessions: { [key: string]: ort.InferenceSession } = {};
  private config: TTSConfig | null = null;
  private unicodeIndexer: number[] = [];

  private readonly SILENCE_DURATION = 0.2;

  async load(modelDir: string) {
    console.log(`Loading Supertonic models from ${modelDir}...`);

    const [cfgData, idxData] = await Promise.all([
      fs.readFile(path.join(modelDir, "tts.json"), "utf-8"),
      fs.readFile(path.join(modelDir, "unicode_indexer.json"), "utf-8"),
    ]);

    this.config = JSON.parse(cfgData) as TTSConfig;
    this.unicodeIndexer = JSON.parse(idxData) as number[];

    const models = [
      "duration_predictor",
      "text_encoder",
      "vector_estimator",
      "vocoder",
    ];

    const promises = models.map(async (name) => {
      const modelPath = path.join(modelDir, `${name}.onnx`);
      const session = await ort.InferenceSession.create(modelPath);
      return { name, session };
    });

    const results = await Promise.all(promises);
    results.forEach((r) => (this.sessions[r.name] = r.session));

    console.log("Supertonic Loaded successfully.");
  }

  async loadVoice(filePath: string): Promise<VoiceStyle> {
    const content = await fs.readFile(filePath, "utf-8");
    const json = JSON.parse(content);

    const toTensor = (node: any) => {
      const flatData = node.data.flat(Infinity);
      const data = new Float32Array(flatData);
      return new ort.Tensor("float32", data, node.dims);
    };

    return {
      ttl: toTensor(json.style_ttl),
      dp: toTensor(json.style_dp),
    };
  }

  async speak(
    text: string,
    voice: VoiceStyle,
    steps: number = 10,
    speed: number = 1.0
  ) {
    if (!this.config)
      throw new Error("Supertonic not loaded. Call load() first.");

    const chunks = this.chunkText(text);
    let finalWav: number[] = [];
    let totalDuration = 0;

    for (const chunk of chunks) {
      const { wav, duration } = await this.inferBatch(
        chunk,
        voice,
        steps,
        speed
      );

      if (finalWav.length > 0) {
        const silenceSamples = Math.floor(
          this.SILENCE_DURATION * this.config.ae.sample_rate
        );
        finalWav = finalWav.concat(new Array(silenceSamples).fill(0));
      }
      finalWav = finalWav.concat(wav);
      totalDuration += duration;
    }

    const buffer = this.createWavBuffer(finalWav, this.config.ae.sample_rate);
    return { buffer, duration: totalDuration };
  }

  private async inferBatch(
    text: string,
    style: VoiceStyle,
    steps: number,
    speed: number
  ) {
    const { ids, mask } = this.processText(text);
    const bsz = 1;

    const idsTensor = new ort.Tensor(
      "int64",
      new BigInt64Array(ids.flat().map(BigInt)),
      [bsz, ids[0].length]
    );
    const maskTensor = new ort.Tensor(
      "float32",
      new Float32Array(mask.flat(2)),
      [bsz, 1, mask[0][0].length]
    );

    const dpOut = await this.sessions.duration_predictor.run({
      text_ids: idsTensor,
      style_dp: style.dp,
      text_mask: maskTensor,
    });
    const durations = Array.from(dpOut.duration.data as Float32Array).map(
      (d) => d / speed
    );

    const encOut = await this.sessions.text_encoder.run({
      text_ids: idsTensor,
      style_ttl: style.ttl,
      text_mask: maskTensor,
    });

    const { latent, latentMask } = this.generateNoise(durations);
    let currentLatent = latent;

    const latentMaskTensor = this.createTensor(latentMask, [
      bsz,
      1,
      latentMask[0][0].length,
    ]);
    const totalStepTensor = new ort.Tensor(
      "float32",
      new Float32Array([steps]),
      [bsz]
    );

    for (let i = 0; i < steps; i++) {
      const stepTensor = new ort.Tensor("float32", new Float32Array([i]), [
        bsz,
      ]);
      const noisyTensor = this.createTensor(currentLatent, [
        bsz,
        currentLatent[0].length,
        currentLatent[0][0].length,
      ]);

      const estOut = await this.sessions.vector_estimator.run({
        noisy_latent: noisyTensor,
        text_emb: encOut.text_emb,
        style_ttl: style.ttl,
        latent_mask: latentMaskTensor,
        text_mask: maskTensor,
        current_step: stepTensor,
        total_step: totalStepTensor,
      });

      currentLatent = this.unflatten(
        estOut.denoised_latent.data as Float32Array,
        currentLatent
      );
    }

    const finalTensor = this.createTensor(currentLatent, [
      bsz,
      currentLatent[0].length,
      currentLatent[0][0].length,
    ]);
    const vocoderOut = await this.sessions.vocoder.run({ latent: finalTensor });

    return {
      wav: Array.from(vocoderOut.wav_tts.data as Float32Array),
      duration: durations[0],
    };
  }

  private processText(text: string) {
    const normalized = text.normalize("NFKC");
    const ids: number[] = [];

    for (let i = 0; i < normalized.length; i++) {
      const code = normalized.codePointAt(i);
      ids.push(
        code !== undefined && code < this.unicodeIndexer.length
          ? this.unicodeIndexer[code]
          : -1
      );
    }

    const mask = Array(ids.length).fill(1);

    return { ids: [ids], mask: [[mask]] };
  }

  private generateNoise(durations: number[]) {
    const sr = this.config!.ae.sample_rate;
    const chunkSize =
      this.config!.ae.base_chunk_size * this.config!.ttl.chunk_compress_factor;
    const latentDim =
      this.config!.ttl.latent_dim * this.config!.ttl.chunk_compress_factor;

    const wavLen = Math.floor(durations[0] * sr);
    const latentLen = Math.ceil(wavLen / chunkSize);

    const latent = Array(1)
      .fill(0)
      .map(() =>
        Array(latentDim)
          .fill(0)
          .map(() =>
            Array(latentLen)
              .fill(0)
              .map(() => {
                const u1 = Math.max(1e-4, Math.random());
                const u2 = Math.random();
                return (
                  Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2)
                );
              })
          )
      );

    const latentMask = [[[...Array(latentLen).fill(1)]]];

    return { latent, latentMask };
  }

  private createTensor(data: any[], shape: number[]) {
    return new ort.Tensor(
      "float32",
      new Float32Array(data.flat(Infinity) as number[]),
      shape
    );
  }

  private unflatten(data: Float32Array, template: any[][][]) {
    let idx = 0;
    return template.map((batch) =>
      batch.map((row) => row.map(() => data[idx++]))
    );
  }

  private chunkText(text: string): string[] {
    return (
      text
        .match(/[^.!?]+[.!?]+|[^.!?]+$/g)
        ?.map((s) => s.trim())
        .filter((s) => s) || [text]
    );
  }

  private createWavBuffer(audioData: number[], sampleRate: number): Buffer {
    const headerSize = 44;
    const dataSize = audioData.length * 2;
    const buffer = Buffer.alloc(headerSize + dataSize);

    buffer.write("RIFF", 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write("WAVE", 8);

    buffer.write("fmt ", 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);

    buffer.write("data", 36);
    buffer.writeUInt32LE(dataSize, 40);

    let offset = 44;
    for (let i = 0; i < audioData.length; i++) {
      const s = Math.max(-1, Math.min(1, audioData[i]));
      const val = s < 0 ? s * 0x8000 : s * 0x7fff;
      buffer.writeInt16LE(val, offset);
      offset += 2;
    }

    return buffer;
  }
}
