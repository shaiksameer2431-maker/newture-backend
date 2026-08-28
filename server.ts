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

const DEFAULT_PORT = Number(process.env.PORT) || 3000;

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

function startServer(port: number, attempt = 1) {
  process.env.PORT = String(port);

  const server = app.listen(port, "0.0.0.0", () => {
    const staleJobsRecovered = recoverStaleCrawlJobs();
    console.log(`[NECN CRAWLER RUNTIME] version=${crawlerRuntime().crawlerVersion} database=${getDbPath()} persistentQueue=true activeWorkers=0 staleJobsRecovered=${staleJobsRecovered}`);
    if (staleJobsRecovered > 0) {
      console.log(`[STALE JOB RECOVERY] ${staleJobsRecovered} stale job(s) recovered to interrupted status`);
    }
    const distDir = getFrontendDistDir ? getFrontendDistDir() : null;
    const frontendAdminUrl = distDir
      ? `http://localhost:${port}/?admin=true`
      : (process.env.FRONTEND_URL || 'http://localhost:5173/?admin=true');
    console.log(`API server running on http://0.0.0.0:${port}`);
    console.log(`Open the app & admin console at: ${frontendAdminUrl}`);
    console.log(`Backend root URL: http://localhost:${port}`);
    startWebsiteSyncScheduler();
    printStartupReport(port);
  });

  server.on("error", (error: NodeJS.ErrnoException) => {
    if ((error as any).code === "EADDRINUSE" && attempt < 10) {
      const fallbackPort = port + 1;
      console.warn(`Port ${port} is already in use. Trying ${fallbackPort}...`);
      try { server.close(() => startServer(fallbackPort, attempt + 1)); } catch (e) { startServer(fallbackPort, attempt + 1); }
      return;
    }

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

startServer(DEFAULT_PORT);
