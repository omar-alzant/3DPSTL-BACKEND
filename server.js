// src/index.js
import express from'express';
import cors from'cors';

import products from'./routes/products.js';
import HomeRoutes from'./routes/home.js';
import adminProducts from'./routes/admin.products.js';
import ratings from'./routes/ratings.js';
import orders from'./routes/orders.js';
import auth from'./routes/auth.js';
import categoryRouter from "./routes/category.js";
import whatsappWebhook from'./routes/webhook.whatsapp.js';
import dotenv from 'dotenv';
import sitemapRouter from './routes/sitemap.js';
import backupRouter from "./routes/backup.js";
import filamentColorsRouter from "./routes/adminFilamentColors.js";
import studioRouter from "./routes/studio.js";
import printersRouter, { bridgeRouter } from "./routes/printers.js";
import humanRouter from "./routes/human.js";
import creditsRouter from "./routes/credits.js";
import { guardWrites } from "./middleware/human.js";
import { logRouter, systemRouter } from "./routes/system.js";
import { logError } from "./services/errorLog.js";
import { startBackupSchedule } from "./services/backup.js";
import searchRouter from "./routes/search.js";
import { startImageSearchSchedule } from "./services/imageSearch.js";

dotenv.config(); // must be first!

const app = express();
// const allowedOrigins = ["https://www.3dpstl.com","https://3dpstl.com", "http://localhost:3000"];
const allowedOrigins = process.env.CORS_ORIGINS.split(",");


app.use(cors({
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("CORS not allowed by server: " + origin));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "X-Filename", "X-Human-Pass"],
  exposedHeaders: ["Content-Disposition", "X-Human-Required"],
}));


  app.use((req, res, next) => {
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });
  
app.use('/sitemap', sitemapRouter);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

app.get('/health', (_, res) => res.json({ ok: true }));

// التحقق البشري: نقطة التحقق + حماية كل طلبات الكتابة على /api (القراءة مفتوحة لمحركات البحث)
app.use('/api/human', humanRouter);
app.use('/api/log', logRouter); // crash reports from browsers — before guardWrites so they always get through
app.use('/api/printers/bridge', bridgeRouter); // the shop's bridge program (its own token, no browser check)
app.use('/api', guardWrites);
app.use('/api/products', products);
app.use('/api/admin/products', adminProducts);
app.use('/api/ratings', ratings);
app.use('/api/orders', orders);
app.use('/api/auth', auth);
app.use('/api/home', HomeRoutes);
app.use("/api/category", categoryRouter);
app.use("/api/admin/backup", backupRouter);
app.use("/api/admin/filament/colors", filamentColorsRouter);
app.use("/api/studio", studioRouter);
app.use("/api/printers", printersRouter);
app.use("/api/credits", creditsRouter);
app.use("/api/system", systemRouter);
app.use("/api/search", searchRouter);

// WhatsApp webhook endpoints
app.use('/webhook/whatsapp', whatsappWebhook);

// 404
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// any error thrown in a route: log it + email, and answer 500 instead of crashing
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('route error:', err);
  if (!/CORS not allowed/.test(err?.message || '')) {
    logError({ source: 'server', message: `${req.method} ${req.path}: ${err?.message || err}`, stack: err?.stack, url: req.originalUrl, userAgent: req.headers['user-agent'], userId: req.id });
  }
  if (!res.headersSent) res.status(err?.status || 500).json({ error: 'Internal Server Error' });
});

process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', reason);
  logError({ source: 'server', message: `unhandledRejection: ${reason?.message || reason}`, stack: reason?.stack });
});
process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err);
  // save it, then exit so Railway restarts a clean server
  logError({ source: 'server', message: `uncaughtException: ${err?.message || err}`, stack: err?.stack })
    .finally(() => setTimeout(() => process.exit(1), 500));
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`API listening on :${port}`);
  startBackupSchedule();
  startImageSearchSchedule();
});
