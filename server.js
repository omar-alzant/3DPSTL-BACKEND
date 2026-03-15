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
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", "X-Filename"],
  exposedHeaders: ["Content-Disposition"],
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
app.use('/api/products', products);
app.use('/api/admin/products', adminProducts);
app.use('/api/ratings', ratings);
app.use('/api/orders', orders);
app.use('/api/auth', auth);
app.use('/api/home', HomeRoutes);
app.use("/api/category", categoryRouter);
app.use("/api/admin/backup", backupRouter);
app.use("/api/admin/filament/colors", filamentColorsRouter);

// WhatsApp webhook endpoints
app.use('/webhook/whatsapp', whatsappWebhook);

// 404
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`API listening on :${port}`));
