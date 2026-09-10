import { Router } from "express";

const router = Router();

router.get("/test1", (req, res) => {
    res.json({ message: "Users test 1" });
});

router.get("/test2", (req, res) => {
    res.json({ message: "Users test 2" });
});

export default router;