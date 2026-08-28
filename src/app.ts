import "dotenv/config";
import express from "express";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import cors from "cors";
import nodemailer from 'nodemailer';
import { getDatabaseClient, execQuery } from "./database/sqliteClient.js";
import { getDb, getDbPath } from "./database/db.js";
import authRoutes from "./routes/authRoutes.js";
import { requireAdmin } from "./middleware/auth.js";
import { ensureUploadsDir } from "./middleware/upload.js";
import { parallelMultiSourceSearch, findBestStrictAnswer } from "./services/knowledgeEngine.js";
import { crawlWebsite, crawlerRuntime, recoverStaleCrawlJobs, syncJobMetricsFromUrls } from "./services/websiteCrawler.js";
import { backfillWebsiteEmbeddings } from "./services/websiteSearch.js";
import { semanticRagStatus } from "./services/semanticRag.js";
import { localLlm } from "./services/localLlm.js";
import { probeExternalSource } from "./services/externalHealth.js";
import { sendTicketCreatedEmails, sendTicketUpdateEmail, encryptSecret } from "./services/emailService.js";
import { getCorsOrigin } from "./config/index.js";


let lastSuccessfulHardResetAt = 0;

export function getFrontendDistDir(): string | null {
  let baseDir = process.cwd();
  try {
    if (typeof __dirname !== 'undefined' && __dirname) {
      baseDir = __dirname;
    } else if (typeof import.meta !== 'undefined' && import.meta.url) {
      baseDir = path.dirname(fileURLToPath(import.meta.url));
    }
  } catch (e) {
    baseDir = process.cwd();
  }

  const candidates = [
    path.resolve(process.cwd(), 'frontend/dist'),
    path.resolve(process.cwd(), '../frontend/dist'),
    path.resolve(baseDir, '../frontend/dist'),
    path.resolve(baseDir, '../../frontend/dist'),
    path.resolve(baseDir, './frontend/dist'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) {
      return dir;
    }
  }
  return null;
}

export function createApp() {
const app = express();

// Initialize SQLite database on startup
getDb();
ensureUploadsDir();

const uploadsDir = path.join(process.cwd(), 'uploads');
app.use('/uploads', express.static(uploadsDir));

const frontendDistDir = getFrontendDistDir();
if (frontendDistDir) {
  app.use(express.static(frontendDistDir));
}

app.use(cors({
  origin: getCorsOrigin(),
  credentials: true,
}));

const healthHandler = (_req: express.Request, res: express.Response) => {
  try {
    getDb().prepare('SELECT 1').get();
    res.json({
      status: 'ok',
      service: 'Narayana NEXA Backend',
      database: 'connected',
      localLlm: localLlm.status(),
    });
  } catch (err: any) {
    res.status(500).json({ status: 'error', error: err.message });
  }
};

app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

function getAdminConsoleUrl() {
  const configuredFrontendUrl = process.env.FRONTEND_URL || process.env.VITE_FRONTEND_URL;
  const frontendBase = configuredFrontendUrl || 'http://localhost:5173';
  return new URL('/?admin=true', frontendBase).toString();
}

function respondWithAdminConsole(req: express.Request, res: express.Response) {
  const target = getAdminConsoleUrl();

  if (req.headers.accept && req.headers.accept.includes('text/html')) {
    return res.type('html').send(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="refresh" content="0; url=${target}" />
    <title>Admin Console</title>
  </head>
  <body style="font-family: Arial, sans-serif; padding: 24px;">
    <h2>Opening admin console...</h2>
    <p>If it does not open automatically, use this link:</p>
    <p><a href="${target}">${target}</a></p>
  </body>
</html>`);
  }

  res.json({
    message: 'Open the admin console in your browser at the frontend address below.',
    frontendAdminUrl: target,
  });
}

// Root and health endpoints
app.get(['/', '/admin', '/admin-console'], (req, res) => {
  const distDir = getFrontendDistDir();
  if (distDir && fs.existsSync(path.join(distDir, 'index.html'))) {
    return res.sendFile(path.join(distDir, 'index.html'));
  }
  if (req.path === '/' && (process.env.NODE_ENV || '').toLowerCase() === 'production') {
    return res.json({
      status: 'online',
      service: 'Narayana NEXA Backend',
      database: 'SQLite'
    });
  }
  respondWithAdminConsole(req, res);
});

app.get('/health', (_req, res) => {
  return res.json({ status: 'healthy' });
});

app.get('/health/database', (_req, res) => {
  try {
    getDb().prepare('SELECT 1').get();
    return res.json({ status: 'healthy', database: getDbPath() });
  } catch (error: any) {
    return res.status(503).json({ status: 'degraded', error: error.message || 'database_unavailable' });
  }
});

app.get('/health/external-sources', async (_req, res) => {
  const necn = await probeExternalSource(process.env.NECN_CRAWL_URL || 'https://necn.ac.in/');
  const degraded = necn.http !== 'ok';
  return res.status(200).json({ status: degraded ? 'degraded' : 'healthy', necn });
});

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use('/api/auth', authRoutes);

// Small dependency-free limiter for the public ticket endpoint. Admin APIs
// remain authenticated as before, while ticket creation is protected from abuse.
const ticketSubmissionWindows = new Map<string, { count: number; resetAt: number }>();
function ticketSubmissionRateLimit(req: express.Request, res: express.Response, next: express.NextFunction) {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const current = ticketSubmissionWindows.get(key);
  const entry = !current || current.resetAt <= now ? { count: 0, resetAt: now + 15 * 60 * 1000 } : current;
  entry.count += 1;
  ticketSubmissionWindows.set(key, entry);
  if (entry.count > 8) {
    res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
    return res.status(429).json({ error: 'Too many ticket submissions. Please try again later.' });
  }
  next();
}

// Helper to get no verified info warning
function getNoVerifiedInfoWarning() {
  return "I couldn't find this information in the Knowledge Base.";
}

// Cloud AI integration removed — application is rule-based. Translation cache retained for internal logic
const translationCache = new Map<string, { question: string, answer: string, originalHash: string }>();

// Cloud translation stubs are permanently disabled; only local processing is allowed.
function getCloudClient(): any | null { return null; }
async function safeGenerateContent(_models: any, _opts: any): Promise<any> { throw new Error('Cloud inference disabled'); }
const Type: any = { OBJECT: 'object', ARRAY: 'array', STRING: 'string' };

function getRuleHash(question: string, answer: string): string {
  const q = question || "";
  const a = answer || "";
  return `${q.length}_${a.length}_${q.slice(0, 15)}_${a.slice(0, 15)}`;
}

  // --- Website Knowledge Engine Helpers ---

  function getDbClient(_customUrl?: string, _customKey?: string) {
    return getDatabaseClient();
  }

  async function safeUpsert(db: any, table: string, payload: any) {
    let currentData = { ...payload };
    for (let i = 0; i < 10; i++) {
      const { data, error } = await execQuery(db.from(table).upsert(currentData).select());
      if (error) {
        const match = error.message?.match(/Could not find the '(.*?)' column/) || error.message?.match(/has no column named (\w+)/);
        if (match && match[1]) {
          console.warn(`[safeUpsert] Column '${match[1]}' missing in '${table}', stripping...`);
          delete currentData[match[1]];
          continue;
        }
        throw error;
      }
      return data;
    }
    throw new Error("Too many retries in safeUpsert");
  }

  async function safeInsert(db: any, table: string, payload: any) {
    let currentData = { ...payload };
    for (let i = 0; i < 10; i++) {
      const { data, error } = await execQuery(db.from(table).insert([currentData]).select());
      if (error) {
        const match = error.message?.match(/Could not find the '(.*?)' column/) || error.message?.match(/has no column named (\w+)/);
        if (match && match[1]) {
          console.warn(`[safeInsert] Column '${match[1]}' missing in '${table}', stripping...`);
          delete currentData[match[1]];
          continue;
        }
        throw error;
      }
      return data;
    }
    throw new Error("Too many retries in safeInsert");
  }

  async function safeUpdate(db: any, table: string, payload: any, matchField: string, matchValue: any) {
    let currentData = { ...payload };
    for (let i = 0; i < 10; i++) {
      const { data, error } = await execQuery(db.from(table).update(currentData).eq(matchField, matchValue).select());
      if (error) {
        const match = error.message?.match(/Could not find the '(.*?)' column/) || error.message?.match(/has no column named (\w+)/);
        if (match && match[1]) {
          console.warn(`[safeUpdate] Column '${match[1]}' missing in '${table}', stripping...`);
          delete currentData[match[1]];
          continue;
        }
        throw error;
      }
      if (!data || data.length === 0) {
        throw new Error(`${table} record not found or could not be updated`);
      }
      return data;
    }
    throw new Error("Too many retries in safeUpdate");
  }




  /** Insert a notification into the SQLite notifications table instead of sending email */
  async function createTicketNotification(ticket: any) {
    const ticketId = ticket.ticket_id || ticket.ticketId || ticket.id;
    const studentName = ticket.student_name || ticket.studentName || "Student";
    const status = ticket.status || "Resolved";
    const adminResponse = ticket.admin_response || ticket.adminResponse || "No comment provided.";

    const db = getDbClient();
    try {
      await execQuery(db.from("notifications").insert([{
        id: crypto.randomUUID(),
        user_id: ticket.user_id || null,
        title: `Ticket #${ticketId} Update: ${status}`,
        message: `Dear ${studentName}, your ticket #${ticketId} has been updated. Status: ${status}. Response: ${adminResponse}`,
        type: 'ticket_update',
        is_read: 0,
        created_at: new Date().toISOString()
      }]));
      console.log(`[NOTIFICATION] Ticket notification saved for #${ticketId}`);
    } catch (err: any) {
      console.warn("[NOTIFICATION] Could not save notification:", err.message);
    }
  }
  app.post("/api/translate-rules", async (req, res) => {
    try {
      const { rules = [], language } = req.body;
      if (!language || language === 'en' || rules.length === 0) {
        return res.json({ translatedRules: [] });
      }

      // Filter active rules to translate
      const activeRules = rules.filter((r: any) => r.status === 'Active');
      if (activeRules.length === 0) {
        return res.json({ translatedRules: [] });
      }

      const translatedRules: any[] = [];
      const missingRules: any[] = [];

      for (const rule of activeRules) {
        const cacheKey = `${language}_${rule.id}`;
        const currentHash = getRuleHash(rule.question, rule.answer);
        const cached = translationCache.get(cacheKey);

        if (cached && cached.originalHash === currentHash) {
          translatedRules.push({
            id: rule.id,
            question: cached.question,
            answer: cached.answer
          });
        } else {
          missingRules.push(rule);
        }
      }

      // If everything is already cached, return immediately
      if (missingRules.length === 0) {
        return res.json({ translatedRules });
      }

      const client = getCloudClient();
      if (!client) {
        // Fallback: remote translation is disabled; return the original rules.
        const merged = [
          ...translatedRules,
          ...missingRules.map((r: any) => ({ id: r.id, question: r.question, answer: r.answer }))
        ];
        return res.json({ translatedRules: merged, isFallback: true });
      }

      const langName = language === 'te' ? 'Telugu (తెలుగు)' : language === 'hi' ? 'Hindi (हिन्दी)' : 'English';

      // Chunk rules to translate in groups of 25 to protect rate limits and prevent model output limits
      const chunkSize = 25;
      const chunks: any[][] = [];
      for (let i = 0; i < missingRules.length; i += chunkSize) {
        chunks.push(missingRules.slice(i, i + chunkSize));
      }

      const newTranslations: any[] = [];
      for (const chunk of chunks) {
        try {
          const prompt = `You are a professional translator. Translate the following college Q&A rules into ${langName}.
You must preserve the original 'id' for each rule, but translate the 'question' and 'answer' into fluent, natural ${langName}. Keep any technical terms, branch names (like CSE, ECE), emails, phone numbers, and URLs as they are.

Rules to translate:
${JSON.stringify(chunk.map((r: any) => ({ id: r.id, question: r.question, answer: r.answer })))}

You MUST return your response as a valid JSON object matching the requested schema exactly.`;

          const response = await safeGenerateContent(client.models, {
            model: 'disabled-cloud-model',
            contents: prompt,
            config: {
              responseMimeType: "application/json",
              temperature: 0.1,
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  translatedRules: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        id: { type: Type.STRING },
                        question: { type: Type.STRING },
                        answer: { type: Type.STRING }
                      },
                      required: ["id", "question", "answer"]
                    }
                  }
                },
                required: ["translatedRules"]
              }
            }
          });

          const text = response.text || "{}";
          const parsed = JSON.parse(text);
          const results = parsed.translatedRules || [];
          newTranslations.push(...results);

          if (chunks.length > 1) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
        } catch (chunkErr) {
          console.error("Rule chunk translation failed:", chunkErr);
        }
      }

      // Save new translations to cache
      for (const item of newTranslations) {
        if (!item || !item.id) continue;
        const origRule = missingRules.find((r: any) => r.id === item.id);
        if (origRule) {
          const cacheKey = `${language}_${item.id}`;
          const currentHash = getRuleHash(origRule.question, origRule.answer);
          translationCache.set(cacheKey, {
            question: item.question || origRule.question,
            answer: item.answer || origRule.answer,
            originalHash: currentHash
          });
          translatedRules.push({
            id: item.id,
            question: item.question || origRule.question,
            answer: item.answer || origRule.answer
          });
        }
      }

      // For any missing rules that failed to get translated, make sure we have them
      for (const rule of missingRules) {
        if (!translatedRules.some((r: any) => r.id === rule.id)) {
          translatedRules.push({
            id: rule.id,
            question: rule.question,
            answer: rule.answer
          });
        }
      }

      res.json({ translatedRules });
    } catch (err: any) {
      console.warn("Translate rules error (falling back to original text):", err);
      // Fallback: Return original untranslated rules so that the app stays functional
      const fallbackRules = req.body.rules.map((r: any) => ({
        id: r.id,
        question: r.question,
        answer: r.answer
      }));
      res.json({ translatedRules: fallbackRules, isFallback: true, error: err.message });
    }
  });

  // Dynamic message-translation endpoint (offline fallback only)
  app.post("/api/translate-messages", async (req, res) => {
    try {
      const { messages = [], targetLanguage } = req.body;
      if (!targetLanguage || targetLanguage === 'en' || messages.length === 0) {
        return res.json({ translatedMessages: [] });
      }

      const client = getCloudClient();
      if (!client) {
        // Fallback: remote translation is disabled; return original messages.
        return res.json({ translatedMessages: messages.map((m: any) => ({ id: m.id, text: m.text })), isFallback: true });
      }

      const langName = targetLanguage === 'te' ? 'Telugu (తెలుగు)' : targetLanguage === 'hi' ? 'Hindi (हिन्दी)' : targetLanguage;

      const prompt = `You are a professional, expert translator. Translate the following user and bot chat messages into fluent, natural, and friendly ${langName}.
You must preserve the original 'id' for each message, and translate the 'text' of the message. Keep any technical terms, college names (like Narayana Engineering College, Narayana Student Portal, Nexa, CSE, B.Tech, Hall Ticket, CGPA, etc.), emails, phone numbers, and URLs exactly as they are. Keep emojis intact.

Messages to translate:
${JSON.stringify(messages.map((m: any) => ({ id: m.id, text: m.text })))}

You MUST return your response as a valid JSON object matching the requested schema exactly.`;

      const response = await safeGenerateContent(client.models, {
        model: 'disabled-cloud-model',
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          temperature: 0.1,
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              translatedMessages: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    id: { type: Type.STRING },
                    text: { type: Type.STRING }
                  },
                  required: ["id", "text"]
                }
              }
            },
            required: ["translatedMessages"]
          }
        }
      });

      const text = response.text || "{}";
      const parsed = JSON.parse(text);
      const translatedMessages = parsed.translatedMessages || [];

      res.json({ translatedMessages });
    } catch (err: any) {
      console.warn("Translate messages error (falling back to original text):", err);
      // Fallback: Return original untranslated messages so that the app stays functional
      const fallbackMessages = req.body.messages.map((m: any) => ({
        id: m.id,
        text: m.text
      }));
      res.json({ translatedMessages: fallbackMessages, isFallback: true, error: err.message });
    }
  });

  // --- Casual Conversation Layer Structures ---

  const casualResponses = {
    greetings: {
      en: [
        "Hi! 👋 Welcome to Narayana Engineering College. How can I help you today?",
        "Hello! 😊 It's great to see you. How may I assist you today?",
        "Hey! 👋 Welcome. Feel free to ask me anything related to the college.",
        "Welcome! 😊 I'm here to help. What would you like to know today?"
      ],
      hi: [
        "नमस्ते! 👋 नारायण इंजीनियरिंग कॉलेज में आपका स्वागत है। आज मैं आपकी क्या सहायता कर सकता हूँ?",
        "नमस्कार! 😊 आपसे मिलकर बहुत अच्छा लगा। आज मैं आपकी कैसे मदद कर सकता हूँ?",
        "हेलो! 👋 स्वागत है। कॉलेज से संबंधित कुछ भी पूछने में संकोच न करें।",
        "स्वागत है! 😊 मैं यहाँ आपकी मदद के लिए हूँ। आज आप क्या जानना चाहेंगे?"
      ],
      te: [
        "హలో! 👋 నారాయణ ఇంజనీరింగ్ కాలేజీకి స్వాగతం. ఈరోజు నేను మీకు ఎలా సహాయపడగలను?",
        "నమస్కారం! 😊 మిమ్మల్ని కలవడం చాలా సంతోషంగా ఉంది. నేను మీకు ఎలా సహాయం చేయగలను?",
        "హే! 👋 స్వాగతం. కాలేజీకి సంబంధించిన ఏదైనా నన్ను నిస్సంకోచంగా అడగండి.",
        "స్వాగతం! 😊 నేను మీకు సహాయం చేయడానికి ఇక్కడే ఉన్నాను. ఈరోజు మీరు ఏమి తెలుసుకోవాలనుకుంటున్నారు?"
      ]
    },
    time_greetings: {
      en: [
        "Good day! 😊 Welcome to Narayana Engineering College. How can I assist you?",
        "Hello! Hope you are having a wonderful day. How can I help you today? 👋",
        "Greetings! 😊 I'm ready to answer any questions about our college!"
      ],
      hi: [
        "आपका दिन शुभ हो! 😊 नारायण इंजीनियरिंग कॉलेज में आपका स्वागत है। मैं आपकी क्या सहायता कर सकता हूँ?",
        "नमस्ते! आशा है कि आपका दिन बहुत अच्छा जा रहा होगा। आज मैं आपकी क्या मदद कर सकता हूँ? 👋",
        "शुभकामनाएं! 😊 मैं हमारे कॉलेज के बारे में किसी भी प्रश्न का उत्तर देने के लिए तैयार हूँ!"
      ],
      te: [
        "శుభోదయం/శుభదినం! 😊 నారాయణ ఇంజనీరింగ్ కాలేజీకి స్వాగతం. నేను మీకు ఎలా సహాయపడగలను?",
        "నమస్కారం! మీ రోజు అద్భుతంగా సాగుతుందని ఆశిస్తున్నాను. ఈరోజు నేను మీకు ఎలా సహాయం చేయగలను? 👋",
        "శుభాకాంక్షలు! 😊 మా కాలేజీ గురించి మీకున్న ఎలాంటి ప్రశ్నలకైనా సమాధానం ఇవ్వడానికి నేను సిద్ధంగా ఉన్నాను!"
      ]
    },
    thanks: {
      en: [
        "You're very welcome! 😊 Let me know if you need anything else.",
        "Anytime! 👍 I'm always happy to help with college queries.",
        "Glad I could help! 😊 Feel free to ask more questions anytime.",
        "My pleasure! Let me know if you have any other questions about admissions or attendance."
      ],
      hi: [
        "आपका बहुत-बहुत स्वागत है! 😊 अगर आपको कुछ और चाहिए तो मुझे बताएं।",
        "कभी भी! 👍 कॉलेज के प्रश्नों में मदद करके मुझे हमेशा खुशी होती है।",
        "खुशी हुई कि मैं मदद कर सका! 😊 कभी भी बेझिझक और प्रश्न पूछें।",
        "मेरा सौभाग्य! यदि आपके पास प्रवेश या उपस्थिति के बारे में कोई अन्य प्रश्न हैं तो मुझे बताएं।"
      ],
      te: [
        "మీకు చాలా స్వాగతం! 😊 మీకు ఇంకా ఏదైనా సహాయం కావాలంటే నాకు తెలియజేయండి.",
        "ఎప్పుడైనా! 👍 కాలేజీ సందేహాలకు సహాయం చేయడానికి నేను ఎల్లప్పుడూ సిద్ధంగా ఉంటాను.",
        "సహాయం చేయగలిగినందుకు సంతోషంగా ఉంది! 😊 ఎప్పుడైనా మరిన్ని ప్రశ్నలు అడగడానికి సంకోచించకండి.",
        "నా సంతోషం! అడ్మిషన్లు లేదా హాజరు గురించి మీకు ఇంకా ఏవైనా ప్రశ్నలు ఉంటే నన్ను అడగండి."
      ]
    },
    farewell: {
      en: [
        "Goodbye! 👋 Have a wonderful day ahead. Come back anytime!",
        "Bye! 😊 Wishing you the absolute best. Feel free to reach out later.",
        "See you! 👋 Hope to assist you again soon with Narayana Engineering College details.",
        "Take care! 👍 Let us know if you need any more info in the future."
      ],
      hi: [
        "अलविदा! 👋 आपका दिन मंगलमय हो। कभी भी वापस आएं!",
        "बाय! 😊 आपको बहुत-बहुत शुभकामनाएं। बाद में कभी भी संपर्क करें।",
        "फिर मिलते हैं! 👋 नारायण इंजीनियरिंग कॉलेज के विवरण के साथ जल्द ही आपकी फिर से सहायता करने की उम्मीद है।",
        "अपना ख्याल रखें! 👍 भविष्य में यदि आपको कोई और जानकारी चाहिए तो हमें बताएं।"
      ],
      te: [
        "సెలవు! 👋 మీ రోజు అద్భుతంగా సాగాలని కోరుకుంటున్నాను. ఎప్పుడైనా మళ్లీ రండి!",
        "బాయ్! 😊 మీకు అంతా మంచి జరగాలని కోరుకుంటున్నాను. తర్వాత ఎప్పుడైనా నన్ను సంప్రదించవచ్చు.",
        "మళ్ళీ కలుద్దాం! 👋 నారాయణ ఇంజనీరింగ్ కాలేజీ వివరాలతో త్వరలోనే మళ్లీ మీకు సహాయం చేయాలని ఆశిస్తున్నాను.",
        "జాగ్రత్త! 👍 భవిష్యత్తులో మీకు మరికొంత సమాచారం అవసరమైతే మాకు తెలియజేయండి."
      ]
    },
    small_talk: {
      en: [
        "I'm doing great, thank you for asking! 😊 How are you doing today?",
        "I'm here and ready to assist! 💻 How can I help you learn about Narayana today?",
        "Everything is running smoothly! 😊 Hope you are having a wonderful day. How can I guide you?",
        "I am doing fantastic! How has your day been?"
      ],
      hi: [
        "मैं बहुत अच्छा कर रहा हूँ, पूछने के लिए धन्यवाद! 😊 आज आप कैसे हैं?",
        "मैं यहाँ हूँ और सहायता के लिए तैयार हूँ! 💻 आज नारायणा के बारे में जानने में मैं आपकी क्या मदद कर सकता हूँ?",
        "सब कुछ बहुत अच्छे से चल रहा है! 😊 आशा है कि आपका दिन बहुत अच्छा बीत रहा होगा। मैं आपका मार्गदर्शन कैसे कर सकता हूँ?",
        "मैं बहुत बढ़िया हूँ! आपका दिन कैसा रहा?"
      ],
      te: [
        "నేను చాలా బాగున్నాను, అడిగినందుకు ధన్యవాదాలు! 😊 ఈరోజు మీరు ఎలా ఉన్నారు?",
        "నేను ఇక్కడే ఉన్నాను మరియు మీకు సహాయం చేయడానికి సిద్ధంగా ఉన్నాను! 💻 ఈరోజు నారాయణ గురించి తెలుసుకోవడంలో నేను మీకు ఎలా సహాయపడగలను?",
        "అంతా సజావుగా సాగుతోంది! 😊 మీ రోజు అద్భుతంగా సాగుతుందని ఆశిస్తున్నాను. నేను మీకు ఎలా మార్గదర్శకత్వం వహించగలను?",
        "నేను చాలా అద్భుతంగా ఉన్నాను! మీ రోజు ఎలా గడిచింది?"
      ]
    },
    identity: {
      en: [
        "I am Narayana NEXA, the official digital counselor assistant for Narayana Engineering College. 🎓 I can help you with admissions, placements, fee structure, branches, and student portal details like attendance and internal marks!",
        "I'm NEXA, your friendly Narayana Engineering College counselor chatbot. 😊 I am designed to answer your queries about academic schedules, admissions, library facilities, and college departments."
      ],
      hi: [
        "मैं नारायणा नेक्सा (Narayana NEXA) हूँ, नारायण इंजीनियरिंग कॉलेज का आधिकारिक डिजिटल काउंसलर सहायक। 🎓 मैं प्रवेश, प्लेसमेंट, शुल्क संरचना, विभिन्न शाखाओं, और छात्र पोर्टल विवरण जैसे कि उपस्थिति और आंतरिक अंकों के बारे में आपकी सहायता कर सकता हूँ!",
        "मैं नेक्सा हूँ, नारायण इंजीनियरिंग कॉलेज की आपकी मित्रवत काउंसलर चैटबॉट। 😊 मैं आपके शैक्षणिक कार्यक्रम, प्रवेश, पुस्तकालय सुविधाओं और कॉलेज विभागों के बारे में प्रश्नों का उत्तर देने के लिए डिज़ाइन की गई हूँ।"
      ],
      te: [
        "నేను నారాయణ నెక్సా (Narayana NEXA), నారాయణ ఇంజనీరింగ్ కాలేజ్ యొక్క అధికారిక డిజిటల్ కౌన్సిలర్ అసిస్టెంట్‌ని. 🎓 నేను మీకు అడ్మిషన్లు, ప్లేస్‌మెంట్‌లు, ఫీజుల వివరాలు, వివిధ బ్రాంచ్‌లు మరియు హాజరు, అంతర్గత మార్కులు వంటి విద్యార్థి పోర్టల్ వివరాలలో సహాయం చేయగలను!",
        "నేను నెక్సా, మీ నారాయణ ఇంజనీరింగ్ కాలేజ్ కౌన్సిలర్ చాట్‌బాట్. 😊 అకడమిక్ షెడ్యూల్‌లు, అడ్మిషన్లు, లైబ్రరీ సౌకర్యాలు మరియు కాలేజ్ విభాగాల గురించి మీ ప్రశ్నలకు సమాధానమివ్వడానికి నేను డిజైన్ చేయబడ్డాను."
      ]
    },
    context_fallback: {
      en: [
        "That's wonderful to hear! 😊 What would you like to know about the college today?",
        "Awesome! 👍 How can I help you navigate your college journey today?",
        "Great! Let me know what information you are looking for regarding Narayana Engineering College."
      ],
      hi: [
        "यह सुनकर बहुत अच्छा लगा! 😊 आज आप कॉलेज के बारे में क्या जानना चाहेंगे?",
        "शानदार! 👍 आज मैं आपकी कॉलेज यात्रा में क्या मदद कर सकता हूँ?",
        "बहुत बढ़िया! मुझे बताएं कि आप नारायण इंजीनियरिंग कॉलेज के बारे में क्या जानकारी खोज रहे हैं।"
      ],
      te: [
        "అది వినడం చాలా సంతోషంగా ఉంది! 😊 ఈరోజు కాలేజీ గురించి మీరు ఏమి తెలుసుకోవాలనుకుంటున్నారు?",
        "అద్భుతం! 👍 ఈరోజు మీ కాలేజ్ ప్రయాణంలో నేను మీకు ఎలా సహాయపడగలను?",
        "చాలా బాగుంది! నారాయణ ఇంజనీరింగ్ కాలేజీకి సంబంధించి మీరు ఏ సమాచారం కోసం చూస్తున్నారో నాకు తెలియజేయండి."
      ]
    }
  };

  function normalizeText(text: string): string {
    let cleaned = text.toLowerCase().trim();
    cleaned = cleaned.replace(/[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD00-\uDFFF]/g, '');
    cleaned = cleaned.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, "");
    cleaned = cleaned.replace(/(.)\1{2,}/g, "$1$1");
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    return cleaned;
  }

  // Text-to-speech endpoint (disabled in the offline deployment)
  app.post("/api/tts", async (req, res) => {
    try {
      const { text, language } = req.body;
      if (!text) {
        return res.status(400).json({ error: "Text is required" });
      }

      const client = getCloudClient();
      if (!client) {
        return res.status(400).json({ error: "Cloud text-to-speech is not configured" });
      }

      console.log(`[TTS PIPELINE] Generating speech for text: "${text.slice(0, 60)}..." [Language: ${language || 'en'}]`);

      const systemInstruction = `You are a professional text-to-speech engine. Your absolute requirement is to synthesize the provided text into a natural-sounding female voice. 
Language context: ${language === 'hi' ? 'Hindi' : (language === 'te' ? 'Telugu' : 'English')}.
STRICT RULE: Output ONLY the audio for the exact text provided. Do not speak any other words except those in the input. No chatter, no explanations.`;

      // Keep Kore as the shared female voice. Try both available TTS model
      // families, because deployment accounts may have access to one preview
      // model before the other. This prevents Telugu from being blocked by a
      // single unavailable model name.
      const ttsModels = [
        "disabled-cloud-tts"
      ];
      let audioPart: any;
      let lastTtsError: any;

      // Cloud TTS integration has been removed. Return a machine-readable message.
      return res.status(410).json({ error: 'Text-to-speech endpoint removed. System is rule-based; TTS disabled in this deployment.' });
    } catch (err: any) {
      console.error('[TTS ERROR]', err);
      // Keep behavior conservative: TTS is disabled; report server error if something unexpected happens.
      return res.status(500).json({ error: 'Text-to-speech processing failed' });
    }
  });



    // Chat Endpoint



    // Chat Endpoint
  app.post("/api/chat", async (req, res) => {
    const { message, language, chatHistory = [] } = req.body;
    const langName = language === 'te' ? 'Telugu (తెલુંగు)' : language === 'hi' ? 'Hindi (हिन्दी)' : 'English';
    
    const lang = language || 'en';
    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    // --- Intent Detection layer (executed under 5ms, returns immediately) ---
    const normalizedInput = normalizeText(message);
    let detectedIntent: keyof typeof casualResponses | null = null;

    if (/^(hi+|hello+|hey+|hola+|namaste+|yo+|greetings+)$/i.test(normalizedInput) || normalizedInput === 'hi' || normalizedInput === 'hii' || normalizedInput === 'hiii' || normalizedInput === 'hey' || normalizedInput === 'heyy') {
      detectedIntent = 'greetings';
    } else if (normalizedInput.includes('good morning') || normalizedInput.includes('good afternoon') || normalizedInput.includes('good evening') || normalizedInput.includes('good night')) {
      detectedIntent = 'time_greetings';
    } else if (normalizedInput.includes('thank you') || normalizedInput.includes('thanks') || normalizedInput === 'thx' || normalizedInput.includes('dhanyavad') || normalizedInput.includes('shukriya')) {
      detectedIntent = 'thanks';
    } else if (normalizedInput.includes('goodbye') || normalizedInput === 'bye' || normalizedInput.includes('see you') || normalizedInput.includes('talk to you later')) {
      detectedIntent = 'farewell';
    } else if (normalizedInput.includes('how are you') || normalizedInput.includes('how r u') || normalizedInput.includes('how are u') || normalizedInput.includes('how is it going') || normalizedInput.includes('hows it going') || normalizedInput.includes('how you doing')) {
      detectedIntent = 'small_talk';
    } else if (normalizedInput.includes('who are you') || normalizedInput.includes('your name') || normalizedInput.includes('what can you do') || normalizedInput.includes('are you a robot') || normalizedInput.includes('about yourself')) {
      detectedIntent = 'identity';
    } else if (/^(ok|okay|cool|nice|awesome|hmm+|yes|no|fine|good|great|im good|i am good|doing well|perfect)$/i.test(normalizedInput) || normalizedInput.includes('im good') || normalizedInput.includes('doing well')) {
      const lastBotMsg = chatHistory.slice().reverse().find((m: any) => m.sender === 'bot');
      const textLower = lastBotMsg ? String(lastBotMsg.text).toLowerCase() : '';
      if (lastBotMsg && (
        textLower.includes('how') ||
        textLower.includes('you doing') ||
        textLower.includes('about you') ||
        textLower.includes('kaise') ||
        textLower.includes('unnar')
      )) {
        detectedIntent = 'context_fallback';
      } else {
        detectedIntent = 'small_talk';
      }
    }

    if (detectedIntent) {
      const variations = casualResponses[detectedIntent][lang as 'en' | 'hi' | 'te'] || casualResponses[detectedIntent]['en'];
      const randomIndex = Math.floor(Math.random() * variations.length);
      const chosenText = variations[randomIndex];
      
      console.log(`[CHAT PIPELINE] Casual intent detected: "${detectedIntent}". Responding immediately with variation.`);
      return res.json({
        text: chosenText,
        source: "Casual",
        confidence: 100,
        isCasual: true
      });
    }

    console.log(`[CHAT PIPELINE] Educational query detected: "${message}" [Language: ${langName}]`);
    let bestMatch: any = null;

    try {
      // 1. Strict selection pipeline (single source of truth)
      const strict = await findBestStrictAnswer(message, langName);
      if (!strict) {
        console.log('[CHAT PIPELINE] No strict/high-confidence match found. Returning standardized fallback.');
        return res.json({
          text: getNoVerifiedInfoWarning(),
          isNoVerifiedWarning: true,
          source: 'None',
          suggestOpenTicket: true
        });
      }

      console.log(`[CHAT PIPELINE] Strict match found with confidence: ${strict.confidence}% (isConfident: ${strict.isConfident})`);
      
      // Only suggest support ticket if match is not confident
      const suggestTicket = !strict.isConfident;
      
      const responseData = {
        text: strict.answer,
        answer: strict.answer,
        source: strict.source,
        confidence: strict.confidence,
        lastUpdated: strict.lastUpdated,
        matchedRuleId: (strict as any).matchedRuleId || null,
        matchedQuestion: (strict as any).matchedQuestion || null,
        sourceUrl: (strict as any).url || null,
        sourcePage: (strict as any).pageTitle || null,
        sourceCategory: (strict as any).category || null,
        grounded: Boolean((strict as any).grounded || (strict as any).url),
        sources: (strict as any).sources || ((strict as any).url ? [{ title: (strict as any).pageTitle || 'NECN Official Website', url: (strict as any).url, pageId: null, chunkId: (strict as any).chunkId || null }] : []),
        suggestOpenTicket: suggestTicket
      };
      
      // Send email notifications
      const studentName = (req.body as any).studentName || 'Student';
      const studentEmail = (req.body as any).studentEmail;
      if (studentEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(studentEmail)) {
        const { sendQueryResponseEmail, sendQueryReceivedAdminEmail } = await import('./services/emailService');
        
        // Send admin notification of new query
        sendQueryReceivedAdminEmail(studentName, studentEmail, message).catch((err: any) => {
          console.error('[EMAIL] Failed to send query received admin email:', err);
        });
        
        // Send student email with response
        sendQueryResponseEmail(studentName, studentEmail, message, strict.answer).catch((err: any) => {
          console.error('[EMAIL] Failed to send query response email:', err);
        });
      }
      
      console.log('[CHAT PIPELINE] CHAT_RESPONSE_SENT');
      return res.json(responseData);

    } catch (err: any) {
      console.error("[CHAT PIPELINE ERROR]:", err);
      if (bestMatch) {
        return res.json({
          text: bestMatch.answer,
          source: bestMatch.source,
          confidence: bestMatch.confidence,
          lastUpdated: bestMatch.lastUpdated
        });
      }

      return res.json({
        text: "I'm sorry, I encountered an error while processing your request. Please try again.",
        isNoVerifiedWarning: true,
        source: "None"
      });
    }
  });

  // ==========================================
  //            ADMIN API ENDPOINTS
  // ==========================================


  // --- Internal verification endpoints (Phase 1 helpers) ---
  app.get('/api/internal/verify/kb', async (req, res) => {
    try {
      const qParam = String(req.query.q || '');
      if (!qParam) return res.status(400).json({ ok: false, error: 'Provide one or more test queries via ?q=first|second' });
      const queries = qParam.split('|').map(s => s.trim()).filter(Boolean);
      const results: Record<string, any> = {};
      for (const q of queries) {
        try {
          const strict = await findBestStrictAnswer(q);
          const search = await parallelMultiSourceSearch(q);
          results[q] = { strict, searchCount: Array.isArray(search) ? search.length : 0, topSearch: (Array.isArray(search) && search[0]) ? search[0] : null };
        } catch (inner) {
          results[q] = { error: String(inner) };
        }
      }
      res.json({ ok: true, results });
    } catch (err: any) {
      console.error('[INTERNAL VERIFY] KB verify failed:', err);
      res.status(500).json({ ok: false, error: String(err) });
    }
  });

  // --- Seeding ---
  app.post("/api/admin/seed", async (req, res) => {
    try {
      const db = getDbClient();
      console.log("[API] Starting seed process...");
      
      // Clear existing rules and faculty to ensure clean slate
      await execQuery(db.from("rules").delete().neq('id', 'placeholder'));
      await execQuery(db.from("faculty").delete().neq('id', 'placeholder'));
      
      const { rules, departments, categories, faculty } = req.body;
      
      if (rules && rules.length > 0) await execQuery(db.from("rules").upsert(rules));
      if (departments && departments.length > 0) await execQuery(db.from("departments").upsert(departments));
      if (categories && categories.length > 0) await execQuery(db.from("categories").upsert(categories));
      if (faculty && faculty.length > 0) await execQuery(db.from("faculty").upsert(faculty));
      
      // Seed students table
      const defaultStudents = [
        { reg_no: '26911A0501', name: 'Sameer Shaik', branch: 'Computer Science Engineering (CSE)', attendance: 88.5, cgpa: 9.2, mid1: 23, mid2: 24 },
        { reg_no: '26911A0502', name: 'Prashanth Kumar', branch: 'Computer Science Engineering (CSE)', attendance: 71.2, cgpa: 7.8, mid1: 19, mid2: 20 },
        { reg_no: '26911A0503', name: 'Anjali Devi', branch: 'Electronics & Communication (ECE)', attendance: 92.4, cgpa: 8.9, mid1: 24, mid2: 25 },
        { reg_no: '26911A0504', name: 'Rohit Sharma', branch: 'Computer Science Engineering (CSE)', attendance: 65.0, cgpa: 6.9, mid1: 15, mid2: 17 },
        { reg_no: '26911A0505', name: 'Sneha Reddy', branch: 'Electrical & Electronics (EEE)', attendance: 78.1, cgpa: 8.1, mid1: 21, mid2: 22 },
        { reg_no: '26911A0506', name: 'Harsha Vardhan', branch: 'Information Technology (IT)', attendance: 84.6, cgpa: 8.5, mid1: 22, mid2: 23 },
        { reg_no: '26911A0507', name: 'Kavya Sri', branch: 'Computer Science Engineering (CSE)', attendance: 95.0, cgpa: 9.6, mid1: 25, mid2: 25 },
        { reg_no: '26911A0508', name: 'Ravi Teja', branch: 'Mechanical Engineering', attendance: 74.5, cgpa: 7.2, mid1: 18, mid2: 19 },
        { reg_no: '26911A0509', name: 'Siddharth Roy', branch: 'Electronics & Communication (ECE)', attendance: 80.2, cgpa: 8.3, mid1: 20, mid2: 21 },
        { reg_no: '26911A0510', name: 'Divya Teja', branch: 'Information Technology (IT)', attendance: 68.8, cgpa: 7.5, mid1: 17, mid2: 18 }
      ];
      await execQuery(db.from("students").upsert(defaultStudents));
      
      console.log("[API] Seeding complete successfully.");
      res.json({ success: true });
    } catch (err: any) {
      console.error("[API] Seeding failed:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/hard-reset", requireAdmin, async (req, res) => {
    try {
      const userId = (req as any).user.id;
      const userEmail = (req as any).user.email;
      console.warn(`[HARD RESET] Invocation requested by admin ${userEmail} (${userId}) at ${new Date().toISOString()}`);
      if (process.env.NODE_ENV === 'production' && process.env.ALLOW_HARD_RESET_IN_PRODUCTION !== 'true') return res.status(403).json({ error: 'Hard reset is disabled in production.' });
      if (req.body?.confirm !== 'DELETE_ALL_DATA') return res.status(400).json({ error: 'Confirmation must exactly equal DELETE_ALL_DATA.' });
      const cooldownMs = 5 * 60 * 1000;
      if (Date.now() - lastSuccessfulHardResetAt < cooldownMs) {
        const retryAt = new Date(lastSuccessfulHardResetAt + cooldownMs).toISOString();
        return res.status(429).json({ error: `Hard reset cooldown active. Retry after ${retryAt}.` });
      }

      const rawDb = getDb();

      // 1. Create database backup file before wiping
      const dbPath = getDbPath();
      let backupFileName = "";
      if (fs.existsSync(dbPath)) {
        try {
          const backupDir = path.join(path.dirname(dbPath), 'backups');
          if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
          }
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          backupFileName = `db_backup_${timestamp}.db`;
          const backupPath = path.join(backupDir, backupFileName);
          fs.copyFileSync(dbPath, backupPath);
          console.log(`[HARD RESET] Backup created at ${backupPath}`);
        } catch (backupErr: any) {
          throw backupErr;
        }
      } else throw new Error('Backup source database does not exist; reset aborted.');

      // Comprehensive list of operational tables to wipe
      const tablesToWipe = [
        "ticket_messages",
        "support_tickets",
        "notifications",
        "chat_logs",
        "feedback",
        "students",
        "rules",
        "notices",
        "portal_links",
        "faculty",
        "departments",
        "categories",
        "app_settings",
        "website_knowledge_settings"
      ];

      // Audit log entry
      try {
        rawDb.prepare(`INSERT INTO audit_log (admin_id, action, tables_affected, timestamp) VALUES (?, ?, ?, ?)`)
          .run(userId, "HARD_RESET", JSON.stringify(tablesToWipe), new Date().toISOString());
      } catch (auditErr: any) {
        console.warn("[HARD RESET] Could not write to audit_log table:", auditErr.message);
      }

      // Execute atomic transaction for table purges
      const wipeAll = rawDb.transaction(() => {
        for (const table of tablesToWipe) {
          console.log(`[HARD RESET] Purging table: ${table}...`);
          rawDb.prepare(`DELETE FROM ${table}`).run();
        }
        // Re-initialize default website settings record
        rawDb.prepare(`INSERT OR IGNORE INTO website_knowledge_settings (id, domain, updated_at) VALUES ('main', 'college.edu', datetime('now'))`).run();
      });
      wipeAll();
      lastSuccessfulHardResetAt = Date.now();

      res.json({
        success: true,
        message: "Database hard reset completed successfully. Operational tables purged and backup saved.",
        backupFile: backupFileName,
        tablesClearedCount: tablesToWipe.length
      });
    } catch (err: any) {
      console.error("[API] Hard reset failed:", err);
      res.status(500).json({ error: err.message || "Hard reset failed" });
    }
  });


  // --- AI Instant Suggestions ---
  app.get("/api/kb/suggest", async (req, res) => {
    try {
      const { q } = req.query;
      if (!q || typeof q !== 'string') {
        return res.json([]);
      }
      const db = getDbClient();
      const { data, error } = await execQuery(db.from("rules")
        .select("id, question")
        .ilike("question", `%${q}%`)
        .limit(8));
      if (error) throw error;
      res.json(data || []);
    } catch (err: any) {
      console.error("[API] Failed to fetch suggestions:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // --- Canonical / Single Source of Truth endpoints for frontend
  app.get('/api/canonical/faculty', async (_req, res) => {
    try {
      const db = getDbClient();
      const { data, error } = await execQuery(db.from('faculty').select('*'));
      if (error) throw error;
      const rows = data || [];
      // Normalize and dedupe by email (preferred) then name
      const seenEmails = new Map<string, any>();
      const fallback: any[] = [];
      for (const r of rows) {
        const email = (r.email || '').toLowerCase().trim();
        const normalized = {
          id: r.id,
          name: r.name,
          designation: r.designation || r.role || r.position || null,
          department: r.department || r.department_name || null,
          email: r.email || null,
          phone: r.phone || r.contact_number || r.mobile || null,
          is_hod: Boolean(r.is_hod || String(r.designation || '').toLowerCase().includes('hod') || String(r.role || '').toLowerCase().includes('hod'))
        };
        if (email) {
          const existing = seenEmails.get(email);
          if (!existing) seenEmails.set(email, normalized);
          else {
            // prefer one with designation or phone
            if ((!existing.designation && normalized.designation) || (!existing.phone && normalized.phone)) {
              seenEmails.set(email, { ...existing, ...normalized });
            }
          }
        } else {
          fallback.push(normalized);
        }
      }
      const combined = [...Array.from(seenEmails.values()), ...fallback];
      // Ensure designation fallback
      const mapped = combined.map((f: any) => ({
        id: f.id,
        name: f.name,
        designation: f.designation || 'Designation Not Available',
        department: f.department || 'Not Assigned',
        email: f.email || null,
        phone: f.phone || null,
        isHod: !!f.is_hod
      }));
      res.json(mapped);
    } catch (err: any) {
      console.error('[API] Failed to return canonical faculty:', err.message || err);
      res.status(500).json({ error: 'Failed to load faculty' });
    }
  });

  app.get('/api/canonical/departments', async (_req, res) => {
    try {
      const db = getDbClient();
      const { data, error } = await execQuery(db.from('departments').select('*'));
      if (error) throw error;
      const depts = data || [];
      // Try to determine HOD from department row or faculty table match
      const { data: facultyRows } = await execQuery(db.from('faculty').select('*'));
      const mapped = (depts || []).map((d: any) => {
        const hodFromRow = d.hod || d.head || null;
        let hod = null;
        if (hodFromRow) {
          hod = { name: hodFromRow };
        } else if (facultyRows && facultyRows.length > 0) {
          const match = facultyRows.find((f: any) => (f.department || '').toLowerCase().includes((d.name || '').toLowerCase()) && (String(f.designation || f.role || '').toLowerCase().includes('hod') || String(f.designation || f.role || '').toLowerCase().includes('head')));
          if (match) hod = { name: match.name, email: match.email || null, phone: match.phone || match.mobile || null };
        }
        return {
          id: d.id,
          name: d.name,
          code: d.code || d.contact_number || null,
          location: d.location || null,
          contactNumber: d.contact_number || d.contactNumber || null,
          hod: hod ? {
            name: hod.name,
            email: hod.email || null,
            phone: hod.phone || null
          } : null
        };
      });
      res.json(mapped);
    } catch (err: any) {
      console.error('[API] Failed to return canonical departments:', err.message || err);
      res.status(500).json({ error: 'Failed to load departments' });
    }
  });

  // --- Knowledge Categories API ---
  app.get('/api/admin/categories', async (_req, res) => {
    try {
      const rawDb = getDb();
      const rows = rawDb.prepare('SELECT id, name, description, created_at FROM categories ORDER BY name ASC').all();
      res.json(rows || []);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/admin/categories', async (req, res) => {
    try {
      const { id, name, description } = req.body;
      if (!name) return res.status(400).json({ error: 'Category name is required' });
      const catId = id || `cat_${Date.now()}`;
      const rawDb = getDb();
      rawDb.prepare('INSERT OR REPLACE INTO categories (id, name, description, created_at) VALUES (?, ?, ?, datetime(\'now\'))')
        .run(catId, name, description || '');
      res.json({ success: true, id: catId });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put('/api/admin/categories/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const { name, description } = req.body;
      const rawDb = getDb();
      rawDb.prepare('UPDATE categories SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?')
        .run(name, description, id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/admin/categories/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const rawDb = getDb();
      rawDb.prepare('DELETE FROM categories WHERE id = ?').run(id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Public Ticket Tracking ---
  app.get("/api/tickets/track", async (req, res) => {
    try {
      const { id, email } = req.query;
      const db = getDbClient();
      if (!id && !email) {
        return res.status(400).json({ error: "Either ticket ID or email is required" });
      }

      let queryBuilder = db.from("support_tickets").select("id, timestamp, student_name, query, status, admin_response, responded_at");

      if (id) {
        queryBuilder = queryBuilder.eq("id", String(id).trim());
      } else if (email) {
        queryBuilder = queryBuilder.eq("email", String(email).trim());
      }

      const { data, error } = await execQuery(queryBuilder.order("timestamp", { ascending: false }));
      if (error) throw error;

      if (!data || data.length === 0) {
        return res.status(404).json({ error: "No tickets found for the given criteria." });
      }

      const mapped = data.map(t => ({
        ticket_id: t.id,
        status: t.status,
        created_at: t.timestamp,
        resolved_at: t.responded_at,
        resolution_notes: t.admin_response,
        student_name: t.student_name,
        query: t.query
      }));

      res.json(mapped);
    } catch (err: any) {
      console.error("[API] Ticket tracking failed:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // --- Support Tickets ---
  app.get("/api/admin/settings", async (_req, res) => {
    try {
      const { data, error } = await execQuery(getDbClient().from("app_settings").select("*").eq("id", "main"));
      if (error) throw error;
      const row = data?.[0] || {};
      const hasGmailConfig = Boolean(row.gmail_user && row.gmail_app_password);
      res.json({
        notificationEmail: row.notification_email || '',
        gmailEmail: row.gmail_user || '',
        gmailAppPassword: '', // Never return password
        notifyAdminOnTicket: row.notify_admin_on_ticket !== 0 && row.notify_admin_on_ticket !== false,
        sendStudentAcknowledgement: row.send_student_acknowledgement !== 0 && row.send_student_acknowledgement !== false,
        sendStudentReplyNotifications: row.send_student_reply_notifications !== 0 && row.send_student_reply_notifications !== false,
        gmailConfigured: hasGmailConfig
      });
    } catch (err: any) {
      console.error("[API] Failed to load notification settings:", err.message);
      res.status(500).json({ error: "Unable to load notification settings" });
    }
  });

  app.put("/api/admin/settings", async (req, res) => {
    try {
      const notificationEmail = String(req.body.notificationEmail || '').trim();
      if (notificationEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notificationEmail)) {
        return res.status(400).json({ error: "Please enter a valid notification email address." });
      }

      const gmailEmail = String(req.body.gmailEmail || '').trim();
      if (gmailEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(gmailEmail)) {
        return res.status(400).json({ error: "Please enter a valid Gmail address." });
      }

      const existingRow = await execQuery(getDbClient().from("app_settings").select("*").eq("id", "main"));
      const existing = existingRow.data?.[0] || {};

      const settings: any = {
        id: 'main',
        notification_email: notificationEmail,
        gmail_user: gmailEmail || existing.gmail_user || undefined,
        notify_admin_on_ticket: Boolean(req.body.notifyAdminOnTicket),
        send_student_acknowledgement: Boolean(req.body.sendStudentAcknowledgement),
        send_student_reply_notifications: Boolean(req.body.sendStudentReplyNotifications),
        updated_at: new Date().toISOString()
      };

      // Handle password: only update if provided, otherwise keep existing
      if (req.body.gmailAppPassword) {
        const rawPass = String(req.body.gmailAppPassword).trim();
        // Encrypt at rest if a master key is configured; otherwise store as-is
        if (process.env.NEXA_SECRET_KEY) {
          try {
            const { encryptSecret } = await import('./services/emailService');
            settings.gmail_app_password = encryptSecret(rawPass, process.env.NEXA_SECRET_KEY);
          } catch (e) {
            console.warn('[SECURITY] Failed to encrypt Gmail password, storing plaintext as fallback');
            settings.gmail_app_password = rawPass;
          }
        } else {
          settings.gmail_app_password = rawPass;
        }
      } else if (existing.gmail_app_password) {
        settings.gmail_app_password = existing.gmail_app_password;
      }

      await safeUpsert(getDbClient(), "app_settings", settings);

      // Verify Gmail credentials if provided
      if (gmailEmail && req.body.gmailAppPassword) {
        try {
          const nodemailer = await import('nodemailer');
          const passToUse = req.body.gmailAppPassword;
          const testTransporter = nodemailer.createTransport({
            service: 'gmail',
            auth: { user: gmailEmail, pass: passToUse }
          });
          await testTransporter.verify();
          console.log("[EMAIL] Gmail credentials verified successfully");
        } catch (verifyErr: any) {
          console.error("[EMAIL] Gmail credentials verification failed:", verifyErr.message);
          return res.status(400).json({ error: "Gmail credentials verification failed. Please check your email and app password." });
        }
      }

      const hasGmailConfig = Boolean(settings.gmail_user && settings.gmail_app_password);
      res.json({ success: true, gmailConfigured: hasGmailConfig });
    } catch (err: any) {
      console.error("[API] Failed to save notification settings:", err.message);
      res.status(500).json({ error: "Unable to save notification settings" });
    }
  });

  // Test Gmail connection endpoint
  app.post('/api/admin/settings/test-gmail', async (req, res) => {
    try {
      const { data } = await execQuery(getDbClient().from('app_settings').select('*').eq('id', 'main'));
      const row = data?.[0] || {};
      
      const gmailEmail = row.gmail_user;
      let gmailAppPassword = row.gmail_app_password;
      
      if (!gmailEmail || !gmailAppPassword) {
        return res.status(400).json({ success: false, error: 'Gmail credentials not configured in settings' });
      }
      
      // Decrypt password if encryption key is available
      if (gmailAppPassword && process.env.NEXA_SECRET_KEY) {
        try {
          const { decryptSecret } = await import('./services/emailService');
          gmailAppPassword = decryptSecret(gmailAppPassword, process.env.NEXA_SECRET_KEY);
        } catch (e) {
          console.warn('[EMAIL] Password decryption failed, using stored value as-is');
        }
      }
      
      const nodemailer = await import('nodemailer');
      const testTransporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: gmailEmail, pass: gmailAppPassword }
      });
      
      await testTransporter.verify();
      console.log('[EMAIL] Gmail connection test successful');
      res.json({ success: true });
    } catch (err: any) {
      console.error('[EMAIL] Gmail connection test failed:', err.message);
      res.status(500).json({ success: false, error: err.message || 'Gmail connection test failed' });
    }
  });

  // Send test email endpoint
  app.post('/api/admin/settings/send-test-email', async (req, res) => {
    try {
      const to = String(req.body.to || '').trim();
      if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        return res.status(400).json({ success: false, error: 'Valid recipient email required' });
      }
      
      const { sendEmail } = await import('./services/emailService');
      const subject = 'NEXA Email Test';
      const html = `<p>This is a test email from Narayana NEXA to verify email configuration.</p><p>Time: ${new Date().toLocaleString()}</p>`;
      const text = `This is a test email from Narayana NEXA to verify email configuration. Time: ${new Date().toLocaleString()}`;
      
      const result = await sendEmail({ to, subject, html, text });
      
      if (result) {
        console.log('[EMAIL] Test email sent successfully to', to);
        res.json({ success: true });
      } else {
        res.status(500).json({ success: false, error: 'Failed to send test email' });
      }
    } catch (err: any) {
      console.error('[EMAIL] Send test email failed:', err.message);
      res.status(500).json({ success: false, error: err.message || 'Send test email failed' });
    }
  });

  app.get("/api/admin/tickets", async (req, res) => {
    try {
      const db = getDbClient();
      const { data, error } = await execQuery(db.from("support_tickets").select("*").order("timestamp", { ascending: false }));
      if (error) throw error;
      res.json(data || []);
    } catch (err: any) {
      console.error("[API] Failed to fetch tickets:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/tickets", async (req, res) => {
    try {
      const db = getDbClient();
      const ticket = {
        ...req.body,
        timestamp: req.body.timestamp || new Date().toISOString()
      };
      
      await safeUpsert(db, "support_tickets", ticket);
      res.json({ success: true });
    } catch (err: any) {
      console.error("[API] Failed to save ticket:", err);
      res.status(500).json({ error: err.message });
    }
  });

  
  
  
  app.delete("/api/admin/tickets/:id", async (req, res) => {
    try {
      const db = getDbClient();
      const { error } = await execQuery(db.from("support_tickets").delete().eq("id", req.params.id));
      if (error) throw error;
      res.json({ success: true });
    } catch (err: any) {
      console.error("[API] Failed to delete ticket:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/admin/tickets/:id", async (req, res) => {
    try {
      const db = getDbClient();
      
      // 1. Fetch the existing ticket first to have details like email, student name, ticket ID
      let existingTicket: any = null;
      try {
        const { data: existingTickets, error: fetchError } = await execQuery(db
          .from("support_tickets")
          .select("*")
          .eq("id", req.params.id));
          
        if (fetchError) {
          console.error("[API] Failed to fetch ticket for email notification:", fetchError);
        } else if (existingTickets && existingTickets.length > 0) {
          existingTicket = existingTickets[0];
        }
      } catch (fetchErr) {
        console.error("[API] Error fetching ticket:", fetchErr);
      }
        
      // 2. Prepare the update payload and persist the ticket changes first
      const updatePayload: any = { ...req.body };
      if (req.body.admin_response && req.body.admin_response !== existingTicket?.admin_response && !req.body.responded_at) {
        updatePayload.responded_at = new Date().toISOString();
      }
      await safeUpdate(db, "support_tickets", updatePayload, "id", req.params.id);

      const { data: updatedTickets, error: updatedTicketError } = await execQuery(db.from("support_tickets").select("*").eq("id", req.params.id));
      const updatedTicket = updatedTickets?.[0] ?? null;

      let emailWarning: string | null = null;

      if (existingTicket && updatedTicket) {
        const isStatusChange = req.body.status && req.body.status !== existingTicket.status;
        const isResponseProvided = req.body.admin_response && req.body.admin_response !== existingTicket.admin_response;

        if (isStatusChange || isResponseProvided) {
          console.log(`[API] Ticket status or response changed. Creating notification for ticket ${updatedTicket.id}...`);
          try {
            await createTicketNotification(updatedTicket);
            console.log(`[API] Notification created for ticket ${updatedTicket.id}`);
          } catch (notifyErr: any) {
            console.error("[API] Failed to create ticket notification:", notifyErr);
            emailWarning = "Ticket updated, but dashboard notification could not be created";
          }
          // E-mail delivery is deliberately non-blocking: a Gmail outage must
          // never undo an already-persisted ticket update.
          if (isResponseProvided) {
            console.log('[API] Admin response provided, sending ticket update email');
            try {
              const emailResult = await sendTicketUpdateEmail(updatedTicket);
              if (emailResult) {
                console.log('[API] Ticket update email sent successfully');
              } else {
                console.warn('[API] Ticket update email was not sent (likely due to missing configuration or email)');
                emailWarning = emailWarning || "Ticket updated, but email notification failed";
              }
            } catch (emailErr: any) {
              console.error('[API] Failed to send ticket update email:', emailErr);
              emailWarning = emailWarning || "Ticket updated, but email notification failed";
            }
          }
          if (isStatusChange) {
            console.log('[API] Status changed, sending ticket status email');
            try {
              const { sendTicketStatusEmail } = await import('./services/emailService');
              const emailResult = await sendTicketStatusEmail(updatedTicket);
              if (emailResult) {
                console.log('[API] Ticket status email sent successfully');
              } else {
                console.warn('[API] Ticket status email was not sent (likely due to missing configuration or email)');
                emailWarning = emailWarning || "Ticket updated, but status email notification failed";
              }
            } catch (emailErr: any) {
              console.error('[API] Failed to send ticket status email:', emailErr);
              emailWarning = emailWarning || "Ticket updated, but status email notification failed";
            }
          }
        }
      }

      if (emailWarning) {
        res.json({ success: true, emailWarning });
      } else {
        res.json({ success: true });
      }
    } catch (err: any) {
      console.error("[API] Failed to update ticket:", err);
      res.status(500).json({ error: err.message });
    }
  });



  // Ticket messages endpoint
  app.post("/api/admin/tickets/:id/messages", async (req, res) => {
    try {
      const db = getDbClient();
      const messageData = {
        id: crypto.randomUUID(),
        ticket_id: req.params.id,
        sender: req.body.sender || 'admin',
        message: req.body.message,
        created_at: new Date().toISOString()
      };
      
      await safeInsert(db, "ticket_messages", messageData);

      if (messageData.sender === 'admin') {
        const ticketUpdate = {
          admin_response: messageData.message,
          responded_at: new Date().toISOString()
        };
        await safeUpdate(db, "support_tickets", ticketUpdate, "id", req.params.id);
        
        console.log('[API] Admin message sent, attempting to send ticket update email');
        const { data: tickets } = await execQuery(db.from("support_tickets").select("*").eq("id", req.params.id));
        if (tickets?.[0]) {
          try {
            const emailResult = await sendTicketUpdateEmail(tickets[0]);
            if (emailResult) {
              console.log('[API] Ticket update email sent successfully for message');
            } else {
              console.warn('[API] Ticket update email was not sent for message (likely due to missing configuration or email)');
            }
          } catch (emailErr: any) {
            console.error('[API] Failed to send ticket update email for message:', emailErr);
          }
        }
      }

      res.json({ success: true, data: messageData });
    } catch (err: any) {
      console.error("[API] Failed to add message:", err);
      res.status(500).json({ error: err.message });
    }
  });
  
  app.get("/api/tickets/:id/messages", async (req, res) => {
    try {
      const db = getDbClient();
      const { data, error } = await execQuery(db.from("ticket_messages").select("*").eq("ticket_id", req.params.id).order("created_at", { ascending: true }));
      if (error) throw error;
      res.json(data || []);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });


  // Ticket resolution notification simulation
  
  app.post("/api/admin/tickets/:id/notify", async (req, res) => {
    try {
      const { adminResponse, ticketId } = req.body;
      
      console.log(`[NOTIFICATION] Ticket response message logged for ticket #${ticketId}`);
      
      // Insert into ticket_messages
      const db = getDbClient();
      const messageData = {
        id: crypto.randomUUID(),
        ticket_id: req.params.id,
        sender: 'admin',
        message: adminResponse,
        created_at: new Date().toISOString()
      };
      await safeInsert(db, "ticket_messages", messageData);

      res.json({ 
        success: true, 
        message: "Notification message logged and saved."
      });
    } catch (err: any) {
      console.error("[API] Failed to dispatch notification:", err);
      res.status(500).json({ error: err.message });
    }
  });






  app.post("/api/notify", async (req, res) => {
    try {
      const db = getDbClient();
      const ticket = req.body;
      await execQuery(db.from("notifications").insert([{
        id: crypto.randomUUID(),
        user_id: ticket.user_id || null,
        title: `New Helpdesk Ticket Submitted`,
        message: `Student ${ticket.student_name || ticket.studentName || "Student"} submitted a new ticket: ${ticket.query}`,
        type: 'ticket_created',
        is_read: 0,
        created_at: new Date().toISOString()
      }]));
      res.json({ success: true });
    } catch (err: any) {
      console.error("[API] Failed to record notification:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/tickets", ticketSubmissionRateLimit, async (req, res) => {
    try {
      const db = getDbClient();
      const fullName = String(req.body.fullName || req.body.student_name || '').trim();
      const email = String(req.body.email || '').trim();
      const countryCode = String(req.body.countryCode || '+91').trim();
      const phone = String(req.body.phone || '').trim();
      const message = String(req.body.message || req.body.query || '').trim();
      const originalQuery = req.body.originalQuery || null;
      const sourcePage = req.body.sourcePage || null;
      
      if (!fullName || !email || !message) {
        return res.status(400).json({ error: 'Full name, email, and message are required.' });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || message.length > 5000 || fullName.length > 120) {
        return res.status(400).json({ error: 'Please provide valid ticket details.' });
      }
      if (!phone || phone.length < 7) {
        return res.status(400).json({ error: 'Please provide a valid phone number.' });
      }
      // Ensure query field is not empty for database NOT NULL constraint
      if (!message || message.trim() === '') {
        return res.status(400).json({ error: 'Message cannot be empty.' });
      }
      
      // Enforce server-side Ticket ID generation for absolute security
      const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '');
      const randomDigits = Math.floor(100000 + Math.random() * 900000); // 6 random digits
      const generatedTicketId = `TCK-${dateStr}-${randomDigits}`;

      const ticket = {
        id: generatedTicketId, // Use ticket ID as primary key
        timestamp: new Date().toISOString(),
        student_name: fullName,
        email,
        country_code: countryCode,
        phone,
        role: 'Guest',
        query: message, // Map message to query field for database (NOT NULL)
        status: "Open",
        admin_response: null,
        responded_at: null,
        notification_channels: JSON.stringify({ email: true }),
        user_notified: 0,
        chat_session_id: null,
        conversation_id: null,
        language: 'en',
        user_id: null,
        current_page: sourcePage,
        website_section: null
      };
      
      const data = await safeInsert(db, "support_tickets", ticket);

      // Queue both administrator alert and student acknowledgement only after
      // SQLite confirms the ticket exists. Failures are isolated in the mail service.
      const emailResult = await sendTicketCreatedEmails({
        ...ticket,
        student_name: fullName,
        query: message
      });
      
      if (!emailResult) {
        console.warn('[API] Ticket created but email notifications failed');
      }
      
      // Create a dashboard notification for the new ticket
      try {
        await execQuery(db.from("notifications").insert([{
          id: crypto.randomUUID(),
          user_id: null,
          title: `New Ticket: ${generatedTicketId}`,
          message: `New support ticket from ${fullName}: ${message.slice(0, 100)}`,
          type: 'ticket_created',
          is_read: 0,
          created_at: new Date().toISOString()
        }]));
      } catch (notifyErr: any) {
        console.warn("[API] Ticket notification insert failed:", notifyErr.message);
      }
      
      res.json({
        ticketId: generatedTicketId,
        fullName: fullName,
        createdAt: ticket.timestamp
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/tickets", async (req, res) => {
    try {
      const db = getDbClient();
      const { data, error } = await execQuery(db.from("support_tickets").select("*").order("timestamp", { ascending: false }));
      if (error) throw error;
      res.json(data || []);
    } catch (err: any) {
      console.error("[API] Failed to fetch tickets:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/tickets/:id", async (req, res) => {
    try {
      const db = getDbClient();
      const { data, error } = await execQuery(db.from("support_tickets").select("*").eq("id", req.params.id));
      if (error) throw error;
      if (!data || data.length === 0) {
        return res.status(404).json({ error: "Ticket not found" });
      }
      res.json(data[0]);
    } catch (err: any) {
      console.error("[API] Failed to fetch ticket:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/tickets/:id", async (req, res) => {
    try {
      const db = getDbClient();
      const { data, error } = await execQuery(db.from("support_tickets").update({
        status: req.body.status,
        updated_at: new Date().toISOString()
      }).eq("id", req.params.id).select());
      if (error) throw error;
      if (!data || data.length === 0) {
        return res.status(404).json({ error: "Ticket not found" });
      }
      res.json(data[0]);
    } catch (err: any) {
      console.error("[API] Failed to update ticket:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/tickets/:id", async (req, res) => {
    try {
      const db = getDbClient();
      const { error } = await execQuery(db.from("support_tickets").delete().eq("id", req.params.id));
      if (error) throw error;
      res.json({ success: true });
    } catch (err: any) {
      console.error("[API] Failed to delete ticket:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/students", async (req, res) => {
    try {
      const db = getDbClient();
      const { data, error } = await execQuery(db.from("students").select("*").order("reg_no", { ascending: true }));
      if (error) throw error;
      res.json(data || []);
    } catch (err: any) {
      console.error("[API] Failed to fetch students:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // --- Knowledge Base / Rules API ---
  app.get("/api/admin/rules", async (req, res) => {
    try {
      const db = getDbClient();
      const { data, error } = await execQuery(db.from("rules").select("*").order("created_at", { ascending: false }));
      if (error) throw error;
      res.json(data);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/rules", async (req, res) => {
    try {
      const db = getDbClient();
      const payload = req.body;
      const rule = {
        ...payload,
        related_questions: Array.isArray(payload.relatedQuestions) ? JSON.stringify(payload.relatedQuestions) : 
                          (Array.isArray(payload.related_questions) ? JSON.stringify(payload.related_questions) : JSON.stringify([])),
        related_department: payload.relatedDepartment || payload.related_department || "",
        keywords: payload.keywords || payload.question || "",
        created_at: new Date().toISOString()
      };
      
      // Remove camelCase versions to ensure only snake_case columns are used
      delete (rule as any).relatedQuestions;
      delete (rule as any).relatedDepartment;

      const data = await safeInsert(db, "rules", rule);
      res.json(data[0]);
    } catch (err: any) {
      console.error("[API] Failed to save rule:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/rules/bulk", async (req, res) => {
    console.log("[API] Received bulk rules request");
    try {
      const db = getDbClient();
      console.log("[API] SQLite client initialized");
      const rules = req.body;
      if (!Array.isArray(rules)) {
        console.log("[API] Payload is not an array");
        return res.status(400).json({ error: "Payload must be an array of rules" });
      }

      console.log(`[API] Formatting ${rules.length} rules for bulk transactional write...`);
      const formattedRules = rules.map(payload => {
        let relatedQuestionsVal = payload.related_questions || payload.relatedQuestions;
        if (typeof relatedQuestionsVal === 'string') {
          try {
            relatedQuestionsVal = JSON.parse(relatedQuestionsVal);
          } catch {
            relatedQuestionsVal = String(relatedQuestionsVal).split(/[,\n]/).map((q: string) => q.trim()).filter(Boolean);
          }
        }
        if (!Array.isArray(relatedQuestionsVal)) {
          relatedQuestionsVal = [];
        }

        return {
          id: String(payload.id || `excel-rule-${Date.now()}-${Math.floor(Math.random() * 10000)}`),
          category: String(payload.category || 'General').trim(),
          status: String(payload.status || 'Active').trim(),
          question: String(payload.question || '').trim(),
          answer: String(payload.answer || '').trim(),
          keywords: String(payload.keywords || payload.question || '').trim(),
          synonyms: String(payload.synonyms || '').trim(),
          priority: Number(payload.priority) || 1,
          related_questions: relatedQuestionsVal,
          related_department: String(payload.related_department || payload.relatedDepartment || '').trim(),
          created_at: payload.created_at || new Date().toISOString()
        };
      }).filter(r => r.question && r.answer);

      console.log(`[API] Executing transactional bulk write of ${formattedRules.length} rules...`);
      const { data, error } = await execQuery(db.from("rules").upsert(formattedRules).select());
      
      if (error) {
        console.error("[API] Transactional bulk write failed:", error);
        throw error;
      }

      const savedCount = (data || []).length;
      console.log(`[API] Transactional bulk write completed successfully. Saved ${savedCount} rules.`);
      res.json({ success: true, count: savedCount, rules: data });
    } catch (err: any) {
      console.error("[API] Failed to bulk save rules:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/admin/rules/:id", async (req, res) => {
    try {
      const db = getDbClient();
      const { id } = req.params;
      const updates = { ...req.body };

      if (updates.relatedQuestions !== undefined) {
        const relatedQuestions = Array.isArray(updates.relatedQuestions)
          ? updates.relatedQuestions
          : String(updates.relatedQuestions).split(/[\n,]/).map((question: string) => question.trim()).filter(Boolean);
        updates.related_questions = JSON.stringify(relatedQuestions);
        delete updates.relatedQuestions;
      }
      
      if (updates.relatedDepartment !== undefined) {
        updates.related_department = updates.relatedDepartment;
        delete updates.relatedDepartment;
      }
      
      delete updates.id;
      const data = await safeUpdate(db, "rules", updates, "id", id);
      res.json(data[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/admin/rules/:id", async (req, res) => {
    try {
      const db = getDbClient();
      const { id } = req.params;
      const { error } = await execQuery(db.from("rules").delete().eq('id', id));
      if (error) throw error;
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/admin/rules", async (req, res) => {
    try {
      const db = getDbClient();
      // Delete all rules from the table
      const { error } = await execQuery(db.from("rules").delete().neq('id', 'none_placeholder_delete_all'));
      if (error) throw error;
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/students", async (req, res) => {
    try {
      const db = getDbClient();
      await safeUpsert(db, "students", req.body);
      res.json({ success: true });
    } catch (err: any) {
      console.error("[API] Failed to save student:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/admin/students/:regNo", async (req, res) => {
    try {
      const db = getDbClient();
      await safeUpdate(db, "students", req.body, "reg_no", req.params.regNo);
      res.json({ success: true });
    } catch (err: any) {
      console.error("[API] Failed to update student:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/admin/students/:regNo", async (req, res) => {
    try {
      const db = getDbClient();
      const { error } = await execQuery(db.from("students").delete().eq("reg_no", req.params.regNo));
      if (error) throw error;
      res.json({ success: true });
    } catch (err: any) {
      console.error("[API] Failed to delete student:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/students/bulk", async (req, res) => {
    try {
      const records = req.body;
      if (!Array.isArray(records)) {
        return res.status(400).json({ error: "Expected an array of student records" });
      }
      
      const db = getDbClient();
      let successCount = 0;
      for (const record of records) {
        try {
          await safeUpsert(db, "students", record);
          successCount++;
        } catch (e) {
          console.error("Failed to upsert student:", e);
        }
      }
      
      res.json({ success: true, count: successCount });
    } catch (err: any) {
      console.error("[API] Failed to bulk import students:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/students/import", async (req, res) => {
    try {
      const { fileData, fileName } = req.body;
      if (!fileData) {
        return res.status(400).json({ error: "No file data provided" });
      }

      const XLSX = await import('xlsx');
      const workbook = XLSX.read(fileData, { type: 'base64' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rawRows: any[] = XLSX.utils.sheet_to_json(sheet);

      if (rawRows.length === 0) {
        return res.json({ success: true, added: 0, updated: 0, failed: [{ row: 1, reason: "The uploaded sheet is empty." }] });
      }

      const db = getDbClient();
      
      // Fetch existing students to check for additions vs updates
      const { data: existingStudents, error: fetchErr } = await execQuery(db.from("students").select("reg_no"));
      if (fetchErr) throw fetchErr;
      const existingRegNos = new Set((existingStudents || []).map((s: any) => String(s.reg_no).toLowerCase().trim()));

      const failed: any[] = [];
      const validRecords: any[] = [];
      let added = 0;
      let updated = 0;

      rawRows.forEach((row, index) => {
        const rowNum = index + 2; // 1-indexed, header is row 1
        
        // Map keys to standard fields
        const mapped: any = {};
        Object.keys(row).forEach(k => {
          const keyLower = k.toLowerCase().trim();
          if (keyLower.includes("reg") || keyLower.includes("ticket") || keyLower.includes("number")) {
            mapped.reg_no = String(row[k]).trim();
          } else if (keyLower.includes("name")) {
            mapped.name = String(row[k]).trim();
          } else if (keyLower.includes("branch") || keyLower.includes("dept") || keyLower.includes("department")) {
            mapped.branch = String(row[k]).trim();
          } else if (keyLower.includes("attendance") || keyLower.includes("percentage") || keyLower.includes("presence")) {
            mapped.attendance = parseFloat(row[k]);
          } else if (keyLower.includes("cgpa") || keyLower.includes("gpa") || keyLower.includes("grade")) {
            mapped.cgpa = parseFloat(row[k]);
          } else if (keyLower.includes("mid1") || keyLower.includes("mid 1")) {
            mapped.mid1 = parseInt(row[k], 10);
          } else if (keyLower.includes("mid2") || keyLower.includes("mid 2")) {
            mapped.mid2 = parseInt(row[k], 10);
          }
        });

        // Validation
        if (!mapped.reg_no) {
          failed.push({ row: rowNum, reason: "Registration Number (reg_no) is empty or missing" });
          return;
        }
        if (!mapped.name) {
          failed.push({ row: rowNum, reason: "Student Name (name) is empty or missing" });
          return;
        }
        if (!mapped.branch) {
          failed.push({ row: rowNum, reason: "Branch (branch) is empty or missing" });
          return;
        }

        // Attendance validation
        if (mapped.attendance === undefined || isNaN(mapped.attendance) || mapped.attendance < 0 || mapped.attendance > 100) {
          failed.push({ row: rowNum, reason: `Attendance must be a valid percentage between 0 and 100 (got: ${row.attendance || row.Attendance || 'none'})` });
          return;
        }

        // CGPA validation
        if (mapped.cgpa === undefined || isNaN(mapped.cgpa) || mapped.cgpa < 0 || mapped.cgpa > 10) {
          failed.push({ row: rowNum, reason: `CGPA must be a valid grade point between 0.0 and 10.0 (got: ${row.cgpa || row.CGPA || 'none'})` });
          return;
        }

        // Mids validation
        if (mapped.mid1 !== undefined && (isNaN(mapped.mid1) || mapped.mid1 < 0 || mapped.mid1 > 25)) {
          failed.push({ row: rowNum, reason: "Mid 1 marks must be an integer between 0 and 25" });
          return;
        }
        if (mapped.mid2 !== undefined && (isNaN(mapped.mid2) || mapped.mid2 < 0 || mapped.mid2 > 25)) {
          failed.push({ row: rowNum, reason: "Mid 2 marks must be an integer between 0 and 25" });
          return;
        }

        // Check added vs updated
        const regLower = mapped.reg_no.toLowerCase().trim();
        if (existingRegNos.has(regLower)) {
          updated++;
        } else {
          added++;
        }

        validRecords.push({
          reg_no: mapped.reg_no,
          name: mapped.name,
          branch: mapped.branch,
          attendance: mapped.attendance,
          cgpa: mapped.cgpa,
          mid1: mapped.mid1 || 0,
          mid2: mapped.mid2 || 0,
          created_at: new Date().toISOString()
        });
      });

      // Upsert valid records
      if (validRecords.length > 0) {
        const { error: upsertErr } = await execQuery(db.from("students").upsert(validRecords));
        if (upsertErr) throw upsertErr;
      }

      res.json({
        success: true,
        added,
        updated,
        failed
      });
    } catch (err: any) {
      console.error("[API ERROR] Students Excel import failed:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/rules/import", async (req, res) => {
    try {
      const { fileData, fileName } = req.body;
      if (!fileData) {
        return res.status(400).json({ error: "No file data provided" });
      }

      const XLSX = await import('xlsx');
      const workbook = XLSX.read(fileData, { type: 'base64' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rawRows: any[] = XLSX.utils.sheet_to_json(sheet);

      if (rawRows.length === 0) {
        return res.json({ success: true, added: 0, updated: 0, failed: [{ row: 1, reason: "The uploaded sheet is empty." }] });
      }

      const db = getDbClient();
      
      // Fetch existing rules to check for additions vs updates
      const { data: existingRules, error: fetchErr } = await execQuery(db.from("rules").select("id"));
      if (fetchErr) throw fetchErr;
      const existingRuleIds = new Set((existingRules || []).map((r: any) => String(r.id).toLowerCase().trim()));

      const failed: any[] = [];
      const validRecords: any[] = [];
      let added = 0;
      let updated = 0;

      rawRows.forEach((row, index) => {
        const rowNum = index + 2;

        const mapped: any = {};
        Object.keys(row).forEach(k => {
          const keyLower = k.toLowerCase().trim();
          if (keyLower === "id" || keyLower === "rule_id" || keyLower === "rule id") {
            mapped.id = String(row[k]).trim();
          } else if (keyLower.includes("category")) {
            mapped.category = String(row[k]).trim();
          } else if (keyLower.includes("question") || keyLower.includes("query")) {
            mapped.question = String(row[k]).trim();
          } else if (keyLower.includes("keyword")) {
            mapped.keywords = String(row[k]).trim();
          } else if (keyLower.includes("synonym")) {
            mapped.synonyms = String(row[k]).trim();
          } else if (keyLower.includes("answer") || keyLower.includes("response") || keyLower.includes("reply")) {
            mapped.answer = String(row[k]).trim();
          } else if (keyLower.includes("department") || keyLower.includes("related_dept")) {
            mapped.related_department = String(row[k]).trim();
          } else if (keyLower.includes("priority") || keyLower.includes("importance")) {
            mapped.priority = parseInt(row[k], 10);
          } else if (keyLower.includes("status") || keyLower.includes("state")) {
            mapped.status = String(row[k]).trim();
          }
        });

        // ID generation or validation
        if (!mapped.id) {
          mapped.id = `rule-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
        }

        if (!mapped.category) {
          failed.push({ row: rowNum, reason: "Category is empty or missing" });
          return;
        }
        if (!mapped.question) {
          failed.push({ row: rowNum, reason: "Question is empty or missing" });
          return;
        }
        if (!mapped.answer) {
          failed.push({ row: rowNum, reason: "Answer response is empty or missing" });
          return;
        }

        // Count added vs updated
        const idLower = mapped.id.toLowerCase().trim();
        if (existingRuleIds.has(idLower)) {
          updated++;
        } else {
          added++;
        }

        validRecords.push({
          id: mapped.id,
          category: mapped.category,
          question: mapped.question,
          keywords: mapped.keywords || mapped.question,
          synonyms: mapped.synonyms || "",
          answer: mapped.answer,
          related_department: mapped.related_department || "",
          related_questions: JSON.stringify([]),
          priority: isNaN(mapped.priority) ? 1 : mapped.priority,
          status: mapped.status || "Active",
          created_at: new Date().toISOString()
        });
      });

      if (validRecords.length > 0) {
        const { error: upsertErr } = await execQuery(db.from("rules").upsert(validRecords));
        if (upsertErr) throw upsertErr;
      }

      res.json({
        success: true,
        added,
        updated,
        failed
      });
    } catch (err: any) {
      console.error("[API ERROR] Rules Excel import failed:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/students/sync", async (req, res) => {
    try {
      const db = getDbClient();
      // Fetch existing students
      const { data: list, error: fetchErr } = await execQuery(db.from("students").select("*"));
      if (fetchErr) throw fetchErr;
      
      const studentsList = list || [];
      const updatedList = studentsList.map((s: any) => {
        if (s.attendance < 98) {
          const increment = Math.round((Math.random() * 1.5 + 0.2) * 10) / 10;
          return {
            ...s,
            attendance: Math.min(100, Math.round((s.attendance + increment) * 10) / 10)
          };
        }
        return s;
      });
      
      if (updatedList.length > 0) {
        // we cannot use safeUpsert with array easily, let it be
        const { error: upsertErr } = await execQuery(db.from("students").upsert(updatedList));
        if (upsertErr) throw upsertErr;
      }
      
      res.json({ success: true, count: updatedList.length });
    } catch (err: any) {
      console.error("[API] Student sync failed:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // --- Departments ---
  app.get("/api/admin/departments", async (req, res) => {
    try {
      const db = getDbClient();
      if (!db || typeof db.from !== 'function') {
        throw new Error("Database client is not properly initialized");
      }
      const { data, error } = await execQuery(db.from("departments").select("*"));
      if (error) throw error;
      res.json(data || []);
    } catch (err: any) {
      console.error("[API] Failed to fetch departments:", JSON.stringify(err, null, 2));
      res.status(500).json({ error: err.message || JSON.stringify(err) });
    }
  });

  app.post("/api/admin/departments", async (req, res) => {
    try {
      const db = getDbClient();
      const payload = req.body;
      const dept = {
        id: payload.id,
        name: payload.name,
        contact_number: payload.code || payload.contact_number || "",
        email: payload.email || "",
        location: payload.hod || payload.location || "",
        code: payload.code || payload.contact_number || "",
        hod: payload.hod || payload.location || ""
      };
      await safeUpsert(db, "departments", dept);
      res.json({ success: true });
    } catch (err: any) {
      console.error("[API] Failed to save department:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/admin/departments/:id", async (req, res) => {
    try {
      const db = getDbClient();
      const payload = req.body;
      const dept = {
        name: payload.name,
        contact_number: payload.code || payload.contact_number || "",
        email: payload.email || "",
        location: payload.hod || payload.location || "",
        code: payload.code || payload.contact_number || "",
        hod: payload.hod || payload.location || ""
      };
      await safeUpdate(db, "departments", dept, "id", req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      console.error("[API] Failed to update department:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/admin/departments/:id", async (req, res) => {
    try {
      const db = getDbClient();
      const { error } = await execQuery(db.from("departments").delete().eq("id", req.params.id));
      if (error) throw error;
      res.json({ success: true });
    } catch (err: any) {
      console.error("[API] Failed to delete department:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // --- Faculty ---
  app.get("/api/admin/faculty", async (req, res) => {
    try {
      const db = getDbClient();
      const { data, error } = await execQuery(db.from("faculty").select("*"));
      if (error) throw error;
      res.json(data || []);
    } catch (err: any) {
      console.error("[API] Failed to fetch faculty:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/faculty", async (req, res) => {
    try {
      const db = getDbClient();
      const payload = req.body;
      const facultyData = {
        id: payload.id,
        name: payload.name,
        designation: payload.role || payload.designation || "",
        department: payload.department || "",
        email: payload.email || "",
        contact: payload.contact || ""
      };
      await safeUpsert(db, "faculty", facultyData);
      res.json({ success: true });
    } catch (err: any) {
      console.error("[API] Failed to save faculty:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/admin/faculty/:id", async (req, res) => {
    try {
      const db = getDbClient();
      const payload = req.body;
      const facultyData = {
        name: payload.name,
        designation: payload.role || payload.designation || "",
        department: payload.department || "",
        email: payload.email || "",
        contact: payload.contact || ""
      };
      await safeUpdate(db, "faculty", facultyData, "id", req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      console.error("[API] Failed to update faculty:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/admin/faculty/:id", async (req, res) => {
    try {
      const db = getDbClient();
      const { error } = await execQuery(db.from("faculty").delete().eq("id", req.params.id));
      if (error) throw error;
      res.json({ success: true });
    } catch (err: any) {
      console.error("[API] Failed to delete faculty:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // --- Notices ---
  app.get("/api/admin/notices", async (req, res) => {
    try {
      const db = getDbClient();
      const { data, error } = await execQuery(db.from("notices").select("*"));
      if (error) throw error;
      res.json(data || []);
    } catch (err: any) {
      console.error("[API] Failed to fetch notices:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/notices", async (req, res) => {
    try {
      const db = getDbClient();
      const payload = req.body;
      const notice = {
        id: payload.id,
        title: payload.title,
        date: payload.date,
        description: payload.description || payload.desc || "",
        type: payload.type || "",
        image_url: payload.attachment || payload.image_url || payload.imageUrl || "",
        is_pinned: payload.pinned || payload.is_pinned ? 1 : 0
      };
      await safeUpsert(db, "notices", notice);
      res.json({ success: true });
    } catch (err: any) {
      console.error("[API] Failed to save notice:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/admin/notices/:id", async (req, res) => {
    try {
      const db = getDbClient();
      const payload = req.body;
      const notice = {
        title: payload.title,
        date: payload.date,
        description: payload.description || payload.desc || "",
        type: payload.type || "",
        image_url: payload.attachment || payload.image_url || payload.imageUrl || "",
        is_pinned: payload.pinned || payload.is_pinned ? 1 : 0
      };
      
      await safeUpdate(db, "notices", notice, "id", req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      console.error("[API] Failed to update notice:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/admin/notices/:id", async (req, res) => {
    try {
      const db = getDbClient();
      const { error } = await execQuery(db.from("notices").delete().eq("id", req.params.id));
      if (error) throw error;
      res.json({ success: true });
    } catch (err: any) {
      console.error("[API] Failed to delete notice:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // --- Portal Links ---
  app.get("/api/admin/portal-links", async (req, res) => {
    try {
      const db = getDbClient();
      const { data, error } = await execQuery(db.from("portal_links").select("*"));
      if (error) throw error;
      res.json(data || []);
    } catch (err: any) {
      console.error("[API] Failed to fetch portal links:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/portal-links", async (req, res) => {
    try {
      const db = getDbClient();
      const payload = req.body;
      const portalLink = {
        id: payload.id,
        title: payload.title,
        link: payload.url || payload.link || "",
        description: payload.description || ""
      };
      await safeUpsert(db, "portal_links", portalLink);
      res.json({ success: true });
    } catch (err: any) {
      console.error("[API] Failed to save portal link:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/admin/portal-links/:id", async (req, res) => {
    try {
      const db = getDbClient();
      const payload = req.body;
      const portalLink = {
        title: payload.title,
        link: payload.url || payload.link || "",
        description: payload.description || ""
      };
      await safeUpdate(db, "portal_links", portalLink, "id", req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      console.error("[API] Failed to update portal link:", err);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/admin/portal-links/:id", async (req, res) => {
    try {
      const db = getDbClient();
      const { error } = await execQuery(db.from("portal_links").delete().eq("id", req.params.id));
      if (error) throw error;
      res.json({ success: true });
    } catch (err: any) {
      console.error("[API] Failed to delete portal link:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // --- Website knowledge sync ---
  app.get('/api/website-sync/diagnostics', (_req, res) => {
    const db = getDb();
    const active = db.prepare("SELECT id FROM crawl_jobs WHERE status='running' LIMIT 1").get() as any;
    res.json({ ...crawlerRuntime(), databasePath: getDbPath(), activeJobId: active?.id || null });
  });
  app.post("/api/admin/website-sync", async (req, res) => {
    try {
      const db = getDb();
      const active = db.prepare("SELECT id, status FROM crawl_jobs WHERE status = 'running' ORDER BY started_at DESC LIMIT 1").get() as any;
      if (active?.id) {
        return res.status(409).json({ success: false, error: 'A website crawl is already running.', jobId: active.id });
      }
      const settings = db.prepare("SELECT * FROM website_knowledge_settings WHERE id = 'main'").get() as any;
      const startUrl = String(req.body?.startUrl || settings?.crawl_url || settings?.domain || 'https://necn.ac.in/');
      const maxPages = Number(req.body?.maxPages ?? settings?.crawl_limit ?? 0);
      const jobType = req.body?.type === 'INCREMENTAL' ? 'INCREMENTAL' : 'FULL';
      // Start in the background so the admin UI remains responsive and can show live progress.
      const jobPromise = crawlWebsite({ startUrl, maxPages, type: jobType });
      void jobPromise.catch((err: any) => console.error('[WEBSITE SYNC] Background crawl failed:', err));
      // The crawler creates its job row synchronously before its first network request.
      await new Promise(resolve => setTimeout(resolve, 25));
      const latest = db.prepare("SELECT * FROM crawl_jobs WHERE status = 'running' ORDER BY started_at DESC LIMIT 1").get() as any;
      res.status(202).json({ success: true, started: true, jobId: latest?.id || null, status: latest?.status || 'running' });
    } catch (err: any) {
      console.error('[WEBSITE SYNC] Failed:', err);
      res.status(500).json({ success: false, error: err.message || 'Website sync failed' });
    }
  });

  app.post("/api/admin/website-sync/retry-failed", async (_req, res) => {
    try {
      const db = getDb();
      const active = db.prepare("SELECT id FROM crawl_jobs WHERE status='running' LIMIT 1").get() as any;
      if (active) return res.status(409).json({ success: false, error: 'A website crawl is already running.', jobId: active.id });
      const urls = db.prepare(`SELECT url FROM crawl_errors WHERE stage != 'skipped_due_to_size' AND id IN (
        SELECT MAX(id) FROM crawl_errors GROUP BY url
      ) ORDER BY created_at DESC LIMIT 500`).all().map((row: any) => row.url);
      if (!urls.length) return res.json({ success: true, started: false, message: 'There are no recorded failed URLs.' });
      const jobPromise = crawlWebsite({ startUrl: 'https://necn.ac.in/', type: 'RETRY_FAILED', retryOnlyUrls: urls });
      void jobPromise.catch((err: any) => console.error('[WEBSITE SYNC] Failed URL retry failed:', err));
      await new Promise(resolve => setTimeout(resolve, 25));
      const latest = db.prepare("SELECT * FROM crawl_jobs WHERE status='running' ORDER BY started_at DESC LIMIT 1").get() as any;
      res.status(202).json({ success: true, started: true, jobId: latest?.id || null });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || 'Could not retry failed URLs' });
    }
  });

  app.post("/api/admin/website-sync/resume", async (req, res) => {
    try {
      const db = getDb();
      const jobId = req.body?.jobId;
      
      if (!jobId) {
        // Auto-resume the most recent interrupted job
        const interrupted = db.prepare("SELECT id FROM crawl_jobs WHERE status='interrupted' ORDER BY started_at DESC LIMIT 1").get() as any;
        if (!interrupted) return res.status(404).json({ success: false, error: 'No interrupted crawl job found to resume.' });
        return res.json({ success: true, jobId: interrupted.id, message: 'Found interrupted job. Use POST with jobId to resume.' });
      }

      const job = db.prepare("SELECT id, status, start_url FROM crawl_jobs WHERE id = ?").get(jobId) as any;
      if (!job) return res.status(404).json({ success: false, error: 'Crawl job not found.' });
      if (job.status === 'running') return res.status(409).json({ success: false, error: 'Job is already running.', jobId });
      
      // Check if job has persistent queue
      const hasQueue = db.prepare("SELECT COUNT(*) as count FROM crawl_job_urls WHERE job_id = ?").get(jobId) as any;
      
      if (hasQueue.count > 0) {
        // Modern job with persistent queue - update status and let crawler load from queue
        db.prepare("UPDATE crawl_jobs SET status='running', last_heartbeat_at=?, error=NULL WHERE id=?").run(new Date().toISOString(), jobId);
        const jobPromise = crawlWebsite({ startUrl: job.start_url, type: 'FULL' });
        void jobPromise.catch((err: any) => console.error('[WEBSITE SYNC] Resume failed:', err));
        await new Promise(resolve => setTimeout(resolve, 25));
        res.status(202).json({ success: true, started: true, jobId, message: 'Resumed job with persistent queue' });
      } else {
        // Legacy job without persistent queue - treat as incremental crawl
        console.log(`[RESUME] Legacy job ${jobId} has no persistent queue, starting incremental crawl`);
        db.prepare("UPDATE crawl_jobs SET status='running', last_heartbeat_at=?, error=NULL WHERE id=?").run(new Date().toISOString(), jobId);
        const jobPromise = crawlWebsite({ startUrl: job.start_url, type: 'INCREMENTAL' });
        void jobPromise.catch((err: any) => console.error('[WEBSITE SYNC] Resume failed:', err));
        await new Promise(resolve => setTimeout(resolve, 25));
        res.status(202).json({ success: true, started: true, jobId, message: 'Resumed legacy job as incremental crawl' });
      }
    } catch (err: any) {
      console.error('[WEBSITE SYNC] Resume failed:', err);
      res.status(500).json({ success: false, error: err.message || 'Could not resume crawl job' });
    }
  });

  app.get("/api/admin/website-sync/jobs", async (req, res) => {
    try {
      const limit = Math.max(1, Math.min(Number(req.query?.limit || 12), 50));
      const db = getDb();
      const jobs = db.prepare("SELECT * FROM crawl_jobs ORDER BY started_at DESC LIMIT ?").all(limit) as any[];
      for (const job of jobs) {
        syncJobMetricsFromUrls(db, job.id, null);
      }
      const updatedJobs = db.prepare("SELECT * FROM crawl_jobs ORDER BY started_at DESC LIMIT ?").all(limit);
      res.json({ jobs: updatedJobs });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/website-sync/jobs/:id", async (req, res) => {
    try {
      const db = getDb();
      syncJobMetricsFromUrls(db, req.params.id, null);
      const job = db.prepare("SELECT * FROM crawl_jobs WHERE id = ? LIMIT 1").get(req.params.id);
      if (!job) return res.status(404).json({ error: 'Crawl job not found' });
      res.json({ job });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/website-pages", async (req, res) => {
    try {
      const limit = Math.max(1, Math.min(Number(req.query?.limit || 50), 200));
      const search = String(req.query?.search || '').trim();
      const db = getDb();
      let pages: any[];
      if (search) {
        const like = `%${search}%`;
        pages = db.prepare(`SELECT id,url,title,category,content_type,http_status,last_crawled,last_changed,is_active
          FROM website_pages WHERE is_active = 1 AND (url LIKE ? OR title LIKE ? OR category LIKE ?)
          ORDER BY last_crawled DESC LIMIT ?`).all(like, like, like, limit) as any[];
      } else {
        pages = db.prepare(`SELECT id,url,title,category,content_type,http_status,last_crawled,last_changed,is_active
          FROM website_pages WHERE is_active = 1 ORDER BY last_crawled DESC LIMIT ?`).all(limit) as any[];
      }
      res.json({ pages });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/website-sync/status", async (_req, res) => {
    try {
      const db = getDb();
      recoverStaleCrawlJobs();
      const latest = db.prepare("SELECT * FROM crawl_jobs ORDER BY started_at DESC LIMIT 1").get() as any;
      if (latest?.id) {
        syncJobMetricsFromUrls(db, latest.id, null);
      }
      const updatedLatest = db.prepare("SELECT * FROM crawl_jobs ORDER BY started_at DESC LIMIT 1").get();
      const stats = db.prepare(`SELECT
        (SELECT COUNT(*) FROM website_pages WHERE is_active = 1) AS pages_indexed,
        (SELECT COUNT(*) FROM website_chunks) AS chunks_indexed,
        (SELECT COUNT(*) FROM website_pages WHERE is_active = 1 AND content_type LIKE '%pdf%') AS pdf_documents
      `).get();
      const rag = semanticRagStatus();
      const settings = db.prepare("SELECT is_scheduled_sync, scheduled_interval_hours FROM website_knowledge_settings WHERE id='main'").get();
      res.json({ latest: updatedLatest, stats, rag, scheduler: settings || { is_scheduled_sync: 0, scheduled_interval_hours: 0 } });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/website-sync/embeddings", async (req, res) => {
    try {
      const limit = Math.max(1, Math.min(Number(req.body?.limit || 40), 200));
      const result = await backfillWebsiteEmbeddings(limit);
      res.json({ success: true, ...result, rag: semanticRagStatus() });
    } catch (err: any) {
      console.error('[RAG] Embedding backfill failed:', err);
      res.status(500).json({ success: false, error: err.message || 'Embedding backfill failed' });
    }
  });

  // --- Website settings ---
  // Stored separately from admin notification settings to avoid endpoint collision.
  app.get("/api/admin/website-settings", async (req, res) => {
    try {
      const db = getDbClient();
      const { data, error } = await execQuery(db.from("website_knowledge_settings").select("*").eq("id", "main").limit(1));
      if (error || !data || data.length === 0) {
        return res.json({ id: "main", domain: "necn.ac.in", crawl_url: "https://necn.ac.in/" });
      }
      res.json(data[0]);
    } catch (err: any) {
      res.json({ id: "main", domain: "necn.ac.in", crawl_url: "https://necn.ac.in/" });
    }
  });

  app.post("/api/admin/website-settings", async (req, res) => {
    try {
      const db = getDbClient();
      const requested = { ...req.body };
      // Always persist the canonical NECN origin. This prevents the old www
      // hostname from returning after an admin saves the settings.
      requested.domain = 'necn.ac.in';
      requested.crawl_url = 'https://necn.ac.in/';
      await safeUpsert(db, "website_knowledge_settings", { ...requested, id: "main", updated_at: new Date().toISOString() });
      res.json({ success: true, domain: requested.domain, crawl_url: requested.crawl_url });
    } catch (err: any) {
      console.error("[API] Failed to save website settings:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // --- Chat Logs ---
  app.get("/api/admin/chat-logs", async (req, res) => {
    try {
      const db = getDbClient();
      const { data, error } = await execQuery(db.from("chat_logs").select("*").order("timestamp", { ascending: false }));
      if (error) throw error;
      res.json(data || []);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/chat-logs", async (req, res) => {
    try {
      const db = getDbClient();
      const log = {
        id: req.body.id || crypto.randomUUID(),
        timestamp: req.body.timestamp || new Date().toISOString(),
        user_query: req.body.user_query || req.body.userQuery,
        matched_rule_id: req.body.matched_rule_id || req.body.matchedRuleId || null,
        matched_question: req.body.matched_question || req.body.matchedQuestion || null,
        score: req.body.score || 0,
        user_role: req.body.user_role || req.body.userRole || 'Visitor',
        fallback_triggered: req.body.fallback_triggered || req.body.fallbackTriggered || false,
      };
      await safeUpsert(db, "chat_logs", log);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/admin/chat-logs", async (req, res) => {
    try {
      const db = getDbClient();
      const { error } = await execQuery(db.from("chat_logs").delete());
      if (error) throw error;
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Notifications ---
  app.get("/api/admin/notifications", async (req, res) => {
    try {
      const db = getDbClient();
      const { data, error } = await execQuery(db.from("notifications").select("*").order("created_at", { ascending: false }));
      if (error) throw error;
      res.json(data || []);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/notifications/read/:id", async (req, res) => {
    try {
      const db = getDbClient();
      const { error } = await execQuery(db.from("notifications").update({ is_read: 1 }).eq("id", req.params.id));
      if (error) throw error;
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/admin/notifications/:id", async (req, res) => {
    try {
      const db = getDbClient();
      const { error } = await execQuery(db.from("notifications").delete().eq("id", req.params.id));
      if (error) throw error;
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/admin/notifications", async (req, res) => {
    try {
      const db = getDbClient();
      const { error } = await execQuery(db.from("notifications").delete());
      if (error) throw error;
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- Feedback ---
  app.get("/api/admin/feedback", async (req, res) => {
    try {
      const db = getDbClient();
      const { data, error } = await execQuery(db.from("feedback").select("*").order("created_at", { ascending: false }));
      if (error) throw error;
      res.json(data || []);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/feedback", async (req, res) => {
    try {
      const db = getDbClient();
      const feedback = {
        id: req.body.id || crypto.randomUUID(),
        user_id: req.body.user_id || req.body.userId || null,
        rating: req.body.rating,
        comment: req.body.comment || '',
        created_at: req.body.created_at || req.body.createdAt || new Date().toISOString(),
      };
      await safeUpsert(db, "feedback", feedback);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- User Profiles ---
  app.get("/api/admin/user-profiles", async (req, res) => {
    try {
      const db = getDbClient();
      const { data, error } = await execQuery(db.from("user_profiles").select("*"));
      if (error) throw error;
      res.json(data || []);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/user-profiles", async (req, res) => {
    try {
      const db = getDbClient();
      await safeUpsert(db, "user_profiles", mapProfilePayload(req.body));
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/admin/user-profiles/:id", async (req, res) => {
    try {
      const db = getDbClient();
      await safeUpdate(db, "user_profiles", mapProfilePayload(req.body), "id", req.params.id);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  function mapProfilePayload(body: any) {
    return {
      id: body.id,
      full_name: body.full_name || body.fullName,
      role: body.role || 'Student',
      is_admin: body.is_admin ?? body.isAdmin ?? false,
      created_at: body.created_at || body.createdAt || new Date().toISOString(),
    };
  }

  // --- Download / View SQLite Database ---
  app.get("/api/admin/download-fallback", async (req, res) => {
    try {
      const rawDb = getDb();
      const tables = rawDb.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all();
      const result: Record<string, any> = {};
      for (const t of tables) {
        const tableName = (t as any).name;
        result[tableName] = rawDb.prepare(`SELECT * FROM ${tableName}`).all();
      }
      res.setHeader('Content-Type', 'application/json');
      res.json(result);
    } catch (err: any) {
      console.error("[API] Failed to export database:", err);
      res.status(500).json({ error: err.message });
    }
  });

  // ==================================================
  // BULK DELETE & DELETE ALL ENGINE
  // ==================================================
  const BULK_ALLOWED_TABLES: Record<string, string> = {
    rules: 'id',
    faculty: 'id',
    departments: 'id',
    categories: 'id',
    notices: 'id',
    support_tickets: 'id',
    tickets: 'id',
    students: 'reg_no',
    portal_links: 'id',
    portalLinks: 'id',
    notifications: 'id',
    chat_logs: 'id',
    chatLogs: 'id',
    feedback: 'id'
  };

  const TABLE_CANONICAL_NAMES: Record<string, string> = {
    rules: 'rules',
    faculty: 'faculty',
    departments: 'departments',
    categories: 'categories',
    notices: 'notices',
    support_tickets: 'support_tickets',
    tickets: 'support_tickets',
    students: 'students',
    portal_links: 'portal_links',
    portalLinks: 'portal_links',
    notifications: 'notifications',
    chat_logs: 'chat_logs',
    chatLogs: 'chat_logs',
    feedback: 'feedback'
  };

  const performBulkDelete = (tableName: string, ids?: string[], deleteAll?: boolean) => {
    const canonicalTable = TABLE_CANONICAL_NAMES[tableName];
    if (!canonicalTable) {
      throw new Error(`Invalid or unsupported table for bulk delete: ${tableName}`);
    }
    const idCol = BULK_ALLOWED_TABLES[tableName] || 'id';
    const rawDb = getDb();

    if (deleteAll) {
      if (canonicalTable === 'support_tickets') {
        rawDb.prepare('DELETE FROM ticket_messages').run();
      }
      const stmt = rawDb.prepare(`DELETE FROM ${canonicalTable}`);
      const info = stmt.run();
      return info.changes;
    }

    if (Array.isArray(ids) && ids.length > 0) {
      let totalDeleted = 0;
      const chunkSize = 500;
      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        const placeholders = chunk.map(() => '?').join(',');
        if (canonicalTable === 'support_tickets') {
          const msgPlaceholders = chunk.map(() => '?').join(',');
          rawDb.prepare(`DELETE FROM ticket_messages WHERE ticket_id IN (${msgPlaceholders})`).run(...chunk);
        }
        const stmt = rawDb.prepare(`DELETE FROM ${canonicalTable} WHERE ${idCol} IN (${placeholders})`);
        const info = stmt.run(...chunk);
        totalDeleted += info.changes;
      }
      return totalDeleted;
    }

    return 0;
  };

  // Unified Bulk Delete Endpoint
  app.post("/api/admin/bulk-delete", async (req, res) => {
    try {
      const { table, ids, deleteAll } = req.body;
      if (!table) {
        return res.status(400).json({ error: "Table name is required" });
      }
      const count = performBulkDelete(table, ids, deleteAll);
      res.json({ success: true, deletedCount: count, message: `Successfully deleted ${count} records from ${table}` });
    } catch (err: any) {
      console.error("[API] Bulk delete error:", err);
      res.status(500).json({ error: err.message || "Bulk delete failed" });
    }
  });

  // Module Specific Bulk Endpoints
  const modulesToWire = [
    { route: 'rules', table: 'rules' },
    { route: 'faculty', table: 'faculty' },
    { route: 'departments', table: 'departments' },
    { route: 'categories', table: 'categories' },
    { route: 'notices', table: 'notices' },
    { route: 'tickets', table: 'support_tickets' },
    { route: 'students', table: 'students' },
    { route: 'portal-links', table: 'portal_links' },
    { route: 'notifications', table: 'notifications' },
    { route: 'chat-logs', table: 'chat_logs' }
  ];

  modulesToWire.forEach(({ route, table }) => {
    app.post(`/api/admin/${route}/bulk-delete`, async (req, res) => {
      try {
        const { ids, regNos } = req.body;
        const targetIds = ids || regNos || [];
        const count = performBulkDelete(table, targetIds, false);
        res.json({ success: true, deletedCount: count });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });

    app.delete(`/api/admin/${route}/all`, async (_req, res) => {
      try {
        const count = performBulkDelete(table, undefined, true);
        res.json({ success: true, deletedCount: count });
      } catch (err: any) {
        res.status(500).json({ error: err.message });
      }
    });
  });

  // SPA fallback for frontend routes
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/uploads')) {
      const distDir = getFrontendDistDir();
      if (distDir && fs.existsSync(path.join(distDir, 'index.html'))) {
        return res.sendFile(path.join(distDir, 'index.html'));
      }
    }
    next();
  });

  // 404 handler for unknown routes
  app.use((req, res) => {
    res.status(404).json({ error: 'Not Found' });
  });

  // Centralized Express error handler
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[UNHANDLED EXPRESS ERROR]:', err && err.stack ? err.stack : err);
    if (res.headersSent) {
      return;
    }
    const status = err && (err.status || err.statusCode) ? (err.status || err.statusCode) : 500;
    res.status(status).json({ error: err && err.message ? err.message : 'Internal Server Error' });
  });

  return app;
}

const app = createApp();
export default app;
