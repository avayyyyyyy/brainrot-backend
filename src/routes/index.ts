import type { Application } from "express";
import { Router } from "express";
import scriptRouter from "./script.routes";
import ttsRouter from "./tts.routes";

export const registerRoutes = (app: Application) => {
  const apiRouter = Router();

  apiRouter.use("/generate", scriptRouter);
  apiRouter.use("/tts", ttsRouter);

  app.use("/api", apiRouter);

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });
};
