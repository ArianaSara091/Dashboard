import { Router, type IRouter } from "express";
import healthRouter from "./health";
import vampireAuthRouter from "./vampire-auth";
import vampireGuildsRouter from "./vampire-guilds";

const router: IRouter = Router();

router.use(healthRouter);
router.use(vampireAuthRouter);
router.use(vampireGuildsRouter);

export default router;
