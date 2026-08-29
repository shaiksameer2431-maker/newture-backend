import "dotenv/config";
import dns from "node:dns";

dns.setDefaultResultOrder("ipv4first");

import app, { getFrontendDistDir } from "./src/app.js";
import { getDbPath } from "./src/database/db.js";
import { startWebsiteSyncScheduler } from "./src/services/websiteScheduler.js";
import { recoverStaleCrawlJobs, crawlerRuntime } from "./src/services/websiteCrawler.js";

// Email startup validation - check database settings
async function validateEmailConfiguration() {
  console.log("==================================");
  console.log("EMAIL CONFIGURATION CHECK");
  console.log("==================================");
  
  try {
    const { getDatabaseClient, execQuery } = await import('./src/database/sqliteClient.js');
    const { data, error } = await execQuery(getDatabaseClient().from('app_settings').select('*').eq('id', 'main'));
    
    if (error || !data?.[0]) {
      console.warn("[EMAIL] ⚠️  Gmail settings not found in database");
      console.warn("[EMAIL] Configure Gmail credentials in Notification Settings UI");
    } else {
      const row = data[0];
      const hasGmailEmail = Boolean(row.gmail_user);
      const hasGmailPassword = Boolean(row.gmail_app_password);
      
      if (hasGmailEmail) {
        console.log("[EMAIL] ✅ Gmail Email is configured in database");
      } else {
        console.warn("[EMAIL] ⚠️  Gmail Email is not configured in database");
      }
      
      if (hasGmailPassword) {
        console.log("[EMAIL] ✅ Gmail App Password is configured in database");
      } else {
        console.warn("[EMAIL] ⚠️  Gmail App Password is not configured in database");
      }
      
      if (hasGmailEmail && hasGmailPassword) {
        console.log("[EMAIL] ✅ Email system should be functional");
      } else {
        console.warn("[EMAIL] ⚠️  Email system will be disabled until Gmail credentials are configured in Notification Settings");
      }
    }
  } catch (err) {
    console.error("[EMAIL] ❌ Failed to check email configuration:", err);
  }
  
  console.log("==================================");
}

// Run email validation on startup (fire and forget to not block server start)
validateEmailConfiguration().catch(err => console.error('[EMAIL] Startup validation error:', err));

// Render supplies PORT at runtime. Keep a safe local fallback only when it is absent.
const PORT = Number(process.env.PORT) || 10000;

function printStartupReport(port: number) {
  try {
    console.log("==================================");
    console.log("NEXA BACKEND STARTUP REPORT");
    console.log("==================================");
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Port: ${port}`);
    console.log(`Database Path: ${getDbPath ? getDbPath() : 'unknown'}`);
    console.log('AI generation: bundled local ONNX only (no cloud API)');
    const routesLoaded = (app && (app as any)._router && (app as any)._router.stack) ? (app as any)._router.stack.filter((r: any) => r.route).length : 'unknown';
    console.log(`Routes Loaded: ${routesLoaded}`);
    console.log(`Server Listening Host: 0.0.0.0`);
    console.log("==================================");
  } catch (err) {
    console.warn('Failed to produce startup report:', err);
  }
}

function startServer() {
  const server = app.listen(PORT, "0.0.0.0", () => {
    const staleJobsRecovered = recoverStaleCrawlJobs();
    console.log(`[NECN CRAWLER RUNTIME] version=${crawlerRuntime().crawlerVersion} database=${getDbPath()} persistentQueue=true activeWorkers=0 staleJobsRecovered=${staleJobsRecovered}`);
    if (staleJobsRecovered > 0) {
      console.log(`[STALE JOB RECOVERY] ${staleJobsRecovered} stale job(s) recovered to interrupted status`);
    }
    const isProd = (process.env.NODE_ENV || '').toLowerCase() === 'production';
    const backendUrl = isProd ? 'https://newture-backend.onrender.com' : `http://localhost:${PORT}`;
    const frontendAdminUrl = process.env.FRONTEND_URL
      ? `${process.env.FRONTEND_URL}/?admin=true`
      : (isProd ? 'https://newture-frontend.onrender.com/?admin=true' : `http://localhost:5173/?admin=true`);
    console.log(`API server running on http://0.0.0.0:${PORT}`);
    console.log(`Backend URL: ${backendUrl}`);
    console.log(`Frontend & Admin Console: ${frontendAdminUrl}`);
    startWebsiteSyncScheduler();
    printStartupReport(PORT);
  });

  server.keepAliveTimeout = 120000;
  server.headersTimeout = 120000;

  server.on("error", (error: NodeJS.ErrnoException) => {
    console.error("Failed to start backend server:", error);
    // Do not crash silently; allow process manager to restart if needed
    process.exit(1);
  });

  // graceful shutdown handlers
  const shutdown = (signal?: string) => {
    console.log(`Received ${signal || 'shutdown'}, closing server...`);
    try {
      server.close(() => {
        console.log('HTTP server closed.');
        process.exit(0);
      });
      // Force exit after 10s
      setTimeout(() => {
        console.warn('Forcing shutdown after timeout');
        process.exit(1);
      }, 10000).unref();
    } catch (err) {
      console.error('Error during shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Global error handlers to avoid silent crashes
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err && err.stack ? err.stack : err);
  // allow a short delay for logs to flush, then exit so a process manager can restart
  setTimeout(() => process.exit(1), 1000).unref();
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Keep process running but log clearly; if this becomes noisy consider exiting
});

startServer();
