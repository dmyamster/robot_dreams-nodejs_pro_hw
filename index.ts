import { AsyncLocalStorage } from "async_hooks";
import express, { type Request, type Response, type NextFunction, type ErrorRequestHandler } from "express";
import router from "./usersRouter.ts";

const app = express();
const asyncLocalStorage = new AsyncLocalStorage<Record<string, any>>();

app.use(express.json());

function printRequestId() {
    const store = asyncLocalStorage.getStore();
    console.log(store?.requestId);
}

app.use((req, res, next) => {
    const start = performance.now();
    const context: Record<string, any> = {
        requestId: Math.random().toString(36).substring(7),
    };
    
    res.on("finish", () => {
        const duration = performance.now() - start;

        console.log(`method ${req.method} on path ${req.url} finished in ${duration}ms with status ${res.statusCode}`);
    });

    asyncLocalStorage.run(context, () => next());
});

app.get(/^\/(\d+)$/, (req: Request, res: Response) => {
    res.status(200).json({"message": "Hello World!", id: req.params.id});
});

app.post("/users", (req, res) => {
    res.json({ status: "ok" });
});

app.post("/test",(req,res, next) => {
    if (req.headers['x-api-key'] !== '123') {
        return res.status(401).json({ status: "Unauthorized" });
    }

    res.locals.test = "123";

    next();
}, (req, res, next) => {
    if (req.headers['x-api-key'] !== "123") {
        return res.status(401).json({ status: "Unauthorized" });
    }
    
    console.log("test 2");
    next();
}, (req,res, next) => {
    console.log("test 3");
    printRequestId();
    res.json({status: "ok", test: res.locals.test});
} );

app.get("/test-error", (req: Request, res: Response) => {
    throw new Error("Test error");
});

app.use("/users", router);

app.get('/health', (req, res) => {
    res.status(200).json({ status: "healthy" });
})

app.use((req: Request, res: Response) => {
    res.status(404).json({
        success: false,
        error: `Маршрут ${req.method} ${req.url} не знайдено`
    });
});

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    res.status(500).json({ status: err });
});



app.listen(3000, () => {
    console.log("Server started on port 3000");
});
