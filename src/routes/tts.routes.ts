import { Router } from "express";
import { synthesizeSpeechHandler } from "../controllers/tts.controller";

const router = Router();

router.post("/", synthesizeSpeechHandler);

export default router;
