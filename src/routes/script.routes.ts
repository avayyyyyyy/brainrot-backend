import { Router } from "express";
import { generateScriptHandler } from "../controllers/script.controller";

const router = Router();

router.post("/", generateScriptHandler);

export default router;
