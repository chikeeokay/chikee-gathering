import express, { Request, Response } from "express";
import path from "path";
import fs from "fs";

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

app.use(express.json());

// API Routes
// All data is now handled by Firebase Firestore on the client side.
// This server primarily serves the static files and handles the Vite dev middleware.

// Catch-all for unmatched API routes
app.use("/api", (req: Request, res: Response) => {
  res.status(404).json({ error: "API route not found" });
});

// Global error handler for API routes
app.use("/api", (err: any, req: Request, res: Response, next: any) => {
  console.error("API Error:", err);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), "dist")));
    app.get("*", (req: Request, res: Response) => {
      if (!req.path.startsWith("/api")) {
        res.sendFile(path.join(process.cwd(), "dist", "index.html"));
      }
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
