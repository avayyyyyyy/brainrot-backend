import dotenv from "dotenv";
import path from "path";

dotenv.config();

const requiredEnvVars = ["OPENAI_API_KEY"] as const;

requiredEnvVars.forEach((name) => {
  if (!process.env[name]) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
});

const resolveFromRoot = (relativePath: string) =>
  path.resolve(process.cwd(), relativePath);

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  PORT: Number(process.env.PORT ?? 3001),
  OPENAI_API_KEY: process.env.OPENAI_API_KEY!,
  TTS_MODEL_DIR: resolveFromRoot("models"),
  TTS_VOICE_FILE: resolveFromRoot("voice_styles/F2.json"),
};
