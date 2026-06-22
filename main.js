import os from "node:os";
import fs from "node:fs";
import http from "node:http";
import pty from "node-pty";
import stripAnsi from "strip-ansi";

const isWindows = os.platform() === "win32";

const CODEX_CMD = isWindows ? "codex.cmd" : "codex";

const OUTPUT_FILE = "codex-usage.json";

const PORT = Number(process.env.PORT || 3000);

// Wait 30 seconds after reset before refreshing, to avoid stale data
const RESET_REFRESH_DELAY_MS = 30_000;

// Hard timeout: each Codex refresh waits at most 90 seconds
const HARD_TIMEOUT_MS = 90_000;

// Extra delay after detecting the /status panel, to ensure complete TUI output
const FINISH_DELAY_MS = 6_000;

// Periodic refresh interval: every 15 minutes
const PERIODIC_REFRESH_MS = 15 * 60 * 1000;

let currentStatus = normalizeStatus();

let refreshPromise = null;
let nextResetTimer = null;
let periodicTimer = null;

function nowIso() {
  return new Date().toISOString();
}

function normalizeStatus(input = {}) {
  return {
    five_hour_left_percent:
      typeof input.five_hour_left_percent === "number"
        ? input.five_hour_left_percent
        : null,

    weekly_left_percent:
      typeof input.weekly_left_percent === "number"
        ? input.weekly_left_percent
        : null,

    reset_today:
      typeof input.reset_today === "string" && input.reset_today.trim()
        ? input.reset_today.trim()
        : null,

    reset_weekly:
      typeof input.reset_weekly === "string" && input.reset_weekly.trim()
        ? input.reset_weekly.trim()
        : null,

    updated_at:
      typeof input.updated_at === "string" && input.updated_at.trim()
        ? input.updated_at
        : null,

    error:
      typeof input.error === "string" && input.error.trim()
        ? input.error.trim()
        : null,

    error_detail:
      typeof input.error_detail === "string" && input.error_detail.trim()
        ? input.error_detail.trim()
        : null
  };
}

function publicStatus() {
  return normalizeStatus(currentStatus);
}

function logStep(message, extra = {}) {
  try {
    const at = nowIso();

    const suffix =
      extra && Object.keys(extra).length > 0
        ? ` ${JSON.stringify(extra)}`
        : "";

    console.log(`[${at}] ${message}${suffix}`);
  } catch {
    // logging must not affect the main flow
  }
}

function safeWriteStatusFile() {
  try {
    logStep("Writing status file", {
      file: OUTPUT_FILE
    });

    fs.writeFileSync(
      OUTPUT_FILE,
      JSON.stringify(publicStatus(), null, 2),
      "utf8"
    );

    logStep("Status file written successfully");
  } catch (err) {
    logStep("Failed to write status file, service continues running", {
      error: err?.message || String(err)
    });
  }
}

function updateCurrentStatus(next) {
  currentStatus = normalizeStatus({
    ...currentStatus,
    ...next,
    updated_at: nowIso()
  });

  safeWriteStatusFile();

  return publicStatus();
}

function cleanText(text = "") {
  try {
    return stripAnsi(String(text))
      .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
      .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, "")
      .replace(/\x1b[=>]/g, "")
      .replace(/\u001b/g, "")
      .replace(/\r/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{4,}/g, "\n\n\n");
  } catch {
    return "";
  }
}

function hasAny(text, patterns) {
  return patterns.some((p) => text.includes(p));
}

function detectLoginIssue(text) {
  const lower = text.toLowerCase();
  const patterns = [
    "please log in",
    "login required",
    "not logged in",
    "not authenticated",
    "authentication required",
    "sign in",
    "run `codex auth login`",
    "run codex auth login",
    "codex auth login",
    "please authenticate",
    "unauthorized",
    "expired session",
    "session expired",
    "token expired",
    "openai.com/auth",
    "chat.openai.com/auth",
    "platform.openai.com"
  ];

  for (const pattern of patterns) {
    if (lower.includes(pattern.toLowerCase())) {
      return pattern;
    }
  }

  return null;
}

function detectBlockedTerminal(text) {
  const lower = text.toLowerCase();
  const patterns = [
    "are you sure",
    "do you want to",
    "continue?",
    "proceed?",
    "accept",
    "decline",
    "overwrite",
    "permission denied",
    "access denied",
    "confirm your identity",
    "sudo",
    "password",
    "press any key",
    "press [enter]",
    "hit enter",
    "type yes",
    "type no",
    "y/n",
    "[y/n]",
    "agree to the terms",
    "accept the terms",
    "terms of service",
    "privacy policy"
  ];

  for (const pattern of patterns) {
    if (lower.includes(pattern.toLowerCase())) {
      return pattern;
    }
  }

  return null;
}

function stripBox(line = "") {
  return String(line)
    .replace(/[│╭╮╰╯─]/g, "")
    .replace(/[█░]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractStatusBlock(text) {
  logStep("Extracting /status panel");

  const lines = cleanText(text).split("\n");

  let start = -1;

  for (let i = lines.length - 1; i >= 0; i--) {
    const nearby = lines.slice(i, i + 60).join("\n");

    if (
      lines[i].includes("OpenAI Codex") &&
      nearby.includes("5h limit") &&
      nearby.includes("Weekly limit")
    ) {
      start = i;
      break;
    }
  }

  if (start === -1) {
    logStep("Status panel not found — Codex UI may have changed");
    return "";
  }

  const block = [];

  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    block.push(line);

    if (
      line.includes("╰") &&
      block.some((x) => x.includes("5h limit")) &&
      block.some((x) => x.includes("Weekly limit"))
    ) {
      break;
    }
  }

  logStep("Status panel extraction complete");

  return block.join("\n");
}

function parsePercentAndReset(line) {
  const plain = stripBox(line);

  const percentMatch = plain.match(/(\d{1,3})\s*%\s*left/i);
  const resetMatch = plain.match(/\(resets\s+(.+?)\)/i);

  const percent = percentMatch ? Number(percentMatch[1]) : null;

  return {
    percent:
      Number.isFinite(percent) && percent >= 0 && percent <= 100
        ? percent
        : null,
    reset: resetMatch ? resetMatch[1].trim() : null
  };
}

function parseStatusOutput(text) {
  try {
    logStep("Cleaning Codex output");

    const clean = cleanText(text);
    const statusBlock = extractStatusBlock(clean);

    if (!statusBlock) {
      logStep("Parse failed: no status panel found, keeping previous status");

      return {
        ...publicStatus(),
        updated_at: nowIso()
      };
    }

    const lines = statusBlock
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    let fiveHourLeftPercent = null;
    let weeklyLeftPercent = null;
    let resetToday = null;
    let resetWeekly = null;

    for (const line of lines) {
      const plain = stripBox(line);
      const lower = plain.toLowerCase();

      if (lower.startsWith("5h limit:")) {
        logStep("Parsing 5h limit");

        const parsed = parsePercentAndReset(line);

        fiveHourLeftPercent = parsed.percent;
        resetToday = parsed.reset;

        logStep("5h limit parsed", {
          five_hour_left_percent: fiveHourLeftPercent,
          reset_today: resetToday
        });
      }

      if (lower.startsWith("weekly limit:")) {
        logStep("Parsing weekly limit");

        const parsed = parsePercentAndReset(line);

        weeklyLeftPercent = parsed.percent;
        resetWeekly = parsed.reset;

        logStep("Weekly limit parsed", {
          weekly_left_percent: weeklyLeftPercent,
          reset_weekly: resetWeekly
        });
      }
    }

    const parsedStatus = normalizeStatus({
      five_hour_left_percent: fiveHourLeftPercent,
      weekly_left_percent: weeklyLeftPercent,
      reset_today: resetToday,
      reset_weekly: resetWeekly,
      updated_at: nowIso()
    });

    logStep("Codex status parsed successfully", parsedStatus);

    return parsedStatus;
  } catch (err) {
    logStep("Parse error, keeping previous status", {
      error: err?.message || String(err)
    });

    return {
      ...publicStatus(),
      updated_at: nowIso()
    };
  }
}

function parseTodayResetTime(resetToday) {
  try {
    if (!resetToday) return null;

    const m = String(resetToday).match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;

    const hour = Number(m[1]);
    const minute = Number(m[2]);

    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      return null;
    }

    const d = new Date();
    d.setHours(hour, minute, 0, 0);

    return d;
  } catch {
    return null;
  }
}

function scheduleNextRefreshFromReset(resetToday) {
  try {
    logStep("Calculating next auto-refresh time", {
      reset_today: resetToday
    });

    if (nextResetTimer) {
      clearTimeout(nextResetTimer);
      nextResetTimer = null;

      logStep("Cleared previous auto-refresh timer");
    }

    const resetDate = parseTodayResetTime(resetToday);

    if (!resetDate) {
      logStep("No valid reset_today, skipping auto-refresh scheduling");
      return;
    }

    const refreshAt = new Date(resetDate.getTime() + RESET_REFRESH_DELAY_MS);
    const now = new Date();

    if (refreshAt <= now) {
      logStep("Reset time already passed, skipping this auto-refresh", {
        refresh_at: refreshAt.toISOString()
      });

      return;
    }

    const delayMs = refreshAt.getTime() - now.getTime();

    logStep("Auto-refresh scheduled after reset", {
      refresh_at: refreshAt.toISOString(),
      delay_ms: delayMs
    });

    nextResetTimer = setTimeout(() => {
      logStep("Reset time reached, starting auto-refresh");

      refreshStatus("auto_reset_refresh").catch((err) => {
        logStep("Auto-refresh failed, service continues running", {
          error: err?.message || String(err)
        });
      });
    }, delayMs);
  } catch (err) {
    logStep("Auto-refresh scheduling error, service continues running", {
      error: err?.message || String(err)
    });
  }
}

function refreshStatus(trigger = "manual") {
  if (refreshPromise) {
    logStep("Refresh already in progress, reusing current task", {
      trigger
    });

    return refreshPromise;
  }

  refreshPromise = new Promise((resolve) => {
    let term = null;

    try {
      logStep("Starting Codex status refresh", {
        trigger
      });

      logStep("Spawning codex command", {
        command: CODEX_CMD,
        cwd: process.cwd()
      });

      term = pty.spawn(CODEX_CMD, [], {
        name: "xterm-256color",
        cols: 160,
        rows: 60,
        cwd: process.cwd(),
        env: {
          ...process.env,
          FORCE_COLOR: "0",
          NO_COLOR: "1"
        }
      });
    } catch (err) {
      logStep("Codex command failed to start", {
        error: err?.message || String(err)
      });

      currentStatus = normalizeStatus({
        ...currentStatus,
        error: "command_failed",
        error_detail: `Codex command '${CODEX_CMD}' failed to start: ${err?.message || String(err)}. Make sure Codex CLI is installed and available in PATH.`,
        updated_at: nowIso()
      });

      safeWriteStatusFile();

      refreshPromise = null;
      resolve(publicStatus());
      return;
    }

    let buffer = "";

    let handledUpdatePrompt = false;
    let handledTrustPrompt = false;
    let handledGenericEnter = false;

    let codexUiReady = false;
    let sentStatus = false;
    let statusDetected = false;
    let finished = false;
    let loginIssueDetected = false;
    let blockedTerminalDetected = false;

    let statusSendTimer = null;
    let finishTimer = null;
    let hardTimeoutTimer = null;

    function safeTermWrite(data, label) {
      try {
        term.write(data);
      } catch (err) {
        logStep(`${label} failed`, {
          error: err?.message || String(err)
        });
      }
    }

    function safeTermKill() {
      try {
        if (term) term.kill();
      } catch (err) {
        logStep("Failed to close Codex pty, service continues running", {
          error: err?.message || String(err)
        });
      }
    }

    function pressEnter() {
      safeTermWrite("\r", "Press Enter");
    }

    function submitSlashCommand(command) {
      logStep("Clearing Codex input buffer");

      safeTermWrite("\x15", "Clear input");

      setTimeout(() => {
        logStep("Typing slash command", {
          command
        });

        safeTermWrite(command, "Type command");
      }, 300);

      setTimeout(() => {
        logStep("Submitting slash command", {
          command
        });

        safeTermWrite("\r", "Submit command");
      }, 800);

      setTimeout(() => {
        logStep("Confirming slash command", {
          command
        });

        safeTermWrite("\r", "Confirm command");
      }, 1400);
    }

    function scheduleFinish(delayMs = FINISH_DELAY_MS) {
      clearTimeout(finishTimer);

      logStep("Status output detected, scheduling finish", {
        delay_ms: delayMs
      });

      finishTimer = setTimeout(() => {
        finish("scheduled_finish");
      }, delayMs);
    }

    function finish(reason = "finish") {
      if (finished) return;
      finished = true;

      logStep("Ending Codex session", {
        reason
      });

      clearTimeout(statusSendTimer);
      clearTimeout(finishTimer);
      clearTimeout(hardTimeoutTimer);

      safeTermWrite("\x03", "Send Ctrl+C");
      safeTermKill();

      logStep("Parsing status output");

      const parsed = parseStatusOutput(buffer);

      // If /status was sent but no valid data was parsed, set ui_changed error
      if (
        sentStatus &&
        parsed.five_hour_left_percent === null &&
        parsed.weekly_left_percent === null &&
        !currentStatus.error
      ) {
        parsed.error = "ui_changed";
        parsed.error_detail =
          "The /status command was sent but the parser could not find the expected status panel. The Codex UI layout may have changed.";
      }

      currentStatus = normalizeStatus({
        ...parsed,
        updated_at: nowIso()
      });

      // If parsing succeeded and we got valid data, clear any previous error
      if (
        currentStatus.five_hour_left_percent !== null ||
        currentStatus.weekly_left_percent !== null
      ) {
        currentStatus = normalizeStatus({
          ...currentStatus,
          error: null,
          error_detail: null
        });
      }

      safeWriteStatusFile();

      logStep("Status updated", publicStatus());

      scheduleNextRefreshFromReset(currentStatus.reset_today);

      refreshPromise = null;

      resolve(publicStatus());
    }

    function maybeHandleUpdatePrompt(clean) {
      if (handledUpdatePrompt) return false;

      const isUpdatePrompt = hasAny(clean, [
        "Update available",
        "Update now",
        "Skip until next version"
      ]);

      if (!isUpdatePrompt) return false;

      handledUpdatePrompt = true;

      logStep("Codex update prompt detected, auto-confirming default option");

      setTimeout(() => {
        pressEnter();
      }, 800);

      return true;
    }

    function maybeHandleTrustPrompt(clean) {
      if (handledTrustPrompt) return false;

      const isTrustPrompt = hasAny(clean, [
        "Do you trust the contents of this directory",
        "Yes, continue",
        "Working with untrusted contents"
      ]);

      if (!isTrustPrompt) return false;

      handledTrustPrompt = true;

      logStep("Directory trust prompt detected, auto-confirming default option");

      setTimeout(() => {
        pressEnter();
      }, 800);

      return true;
    }

    function maybeHandleGenericPressEnter(clean) {
      if (handledGenericEnter) return false;

      const isGenericEnterPrompt =
        clean.includes("Press enter to continue") &&
        !clean.includes("Update available") &&
        !clean.includes("Do you trust the contents of this directory");

      if (!isGenericEnterPrompt) return false;

      handledGenericEnter = true;

      logStep("'Press enter to continue' detected, auto-continuing");

      setTimeout(() => {
        pressEnter();
      }, 800);

      return true;
    }

    function updateRuntimeFlags(clean) {
      if (
        !codexUiReady &&
        hasAny(clean, [
          "OpenAI Codex",
          "Write tests for @filename",
          "/model to change",
          "Tip: Use /skills",
          "gpt-5.4",
          "gpt-5"
        ])
      ) {
        codexUiReady = true;

        logStep("Codex main UI detected");
      }

      const tail = clean.slice(-4000).toLowerCase();

      if (
        sentStatus &&
        (
          tail.includes("5h limit") ||
          tail.includes("weekly limit") ||
          tail.includes("remaining") ||
          tail.includes("resets") ||
          tail.includes("用量") ||
          tail.includes("额度") ||
          tail.includes("剩余") ||
          tail.includes("重置")
        ) &&
        !tail.includes("context left")
      ) {
        if (!statusDetected) {
          statusDetected = true;

          logStep("Status panel detected in output");
        }
      }
    }

    function shouldSendStatus(clean) {
      if (sentStatus) return false;
      if (!codexUiReady) return false;

      const tail = clean.slice(-2500);

      if (
        tail.includes("Update available") ||
        tail.includes("Do you trust the contents of this directory") ||
        tail.includes("Press enter to continue")
      ) {
        return false;
      }

      if (
        tail.includes("Starting MCP servers") ||
        tail.includes("esc to interrupt")
      ) {
        return false;
      }

      return true;
    }

    function maybeSendStatus(clean) {
      if (!shouldSendStatus(clean)) return false;

      sentStatus = true;

      logStep("Preparing to send /status command");

      statusSendTimer = setTimeout(() => {
        submitSlashCommand("/status");
        scheduleFinish(FINISH_DELAY_MS);
      }, 2500);

      return true;
    }

    try {
      term.onData((data) => {
        try {
          buffer += data;

          const clean = cleanText(buffer);

          updateRuntimeFlags(clean);

          // Detect login issues
          if (!loginIssueDetected) {
            const loginPattern = detectLoginIssue(clean);
            if (loginPattern) {
              loginIssueDetected = true;
              logStep(
                `Login issue detected: Codex is not logged in (matched: "${loginPattern}"). Please run 'codex auth login' in your terminal first.`
              );
              currentStatus = normalizeStatus({
                ...currentStatus,
                error: "not_logged_in",
                error_detail: `Codex requires authentication. Detected login prompt: "${loginPattern}". Run 'codex auth login' to fix this.`,
                updated_at: nowIso()
              });
              safeWriteStatusFile();
            }
          }

          // Detect blocked terminal (unknown prompts)
          if (!blockedTerminalDetected && !codexUiReady) {
            const blockedPattern = detectBlockedTerminal(clean);
            if (blockedPattern) {
              blockedTerminalDetected = true;
              logStep(
                `Terminal may be blocked by an unexpected prompt (matched: "${blockedPattern}"). Check the terminal output.`
              );
              currentStatus = normalizeStatus({
                ...currentStatus,
                error: "terminal_blocked",
                error_detail: `The terminal appears to be blocked by an unexpected prompt: "${blockedPattern}". Check the terminal output and dismiss the prompt manually.`,
                updated_at: nowIso()
              });
              safeWriteStatusFile();
            }
          }

          if (maybeHandleUpdatePrompt(clean)) return;
          if (maybeHandleTrustPrompt(clean)) return;
          if (maybeHandleGenericPressEnter(clean)) return;

          if (maybeSendStatus(clean)) return;

          if (sentStatus && statusDetected) {
            scheduleFinish(FINISH_DELAY_MS);
          }
        } catch (err) {
          logStep("Error processing Codex output, service continues running", {
            error: err?.message || String(err)
          });
        }
      });

      term.onExit(({ exitCode, signal }) => {
        logStep("Codex process exited", {
          exitCode,
          signal
        });

        if (!finished) {
          finish(`terminal_exit_${exitCode ?? "unknown"}_${signal ?? "none"}`);
        }
      });
    } catch (err) {
      logStep("Failed to bind Codex events, returning current status", {
        error: err?.message || String(err)
      });

      finish("bind_event_failed");
    }

    hardTimeoutTimer = setTimeout(() => {
      logStep("Refresh timed out, ending current task", {
        timeout_ms: HARD_TIMEOUT_MS
      });

      if (!currentStatus.error) {
        currentStatus = normalizeStatus({
          ...currentStatus,
          error: "refresh_timeout",
          error_detail: `Refresh exceeded the ${HARD_TIMEOUT_MS / 1000}s hard timeout. This may indicate a network issue, Codex CLI problem, or that the user is not logged in.`,
          updated_at: nowIso()
        });
        safeWriteStatusFile();
      }

      finish("hard_timeout");
    }, HARD_TIMEOUT_MS);
  });

  return refreshPromise;
}

function startPeriodicRefresh() {
  if (periodicTimer) {
    clearInterval(periodicTimer);
    periodicTimer = null;
  }

  logStep("Starting periodic refresh timer", {
    interval_ms: PERIODIC_REFRESH_MS,
    interval_min: PERIODIC_REFRESH_MS / 60_000
  });

  periodicTimer = setInterval(() => {
    logStep("Periodic refresh triggered");

    refreshStatus("periodic").catch((err) => {
      logStep("Periodic refresh failed, service continues running", {
        error: err?.message || String(err)
      });
    });
  }, PERIODIC_REFRESH_MS);
}

function sendJson(res, statusCode, body) {
  try {
    res.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    });

    res.end(JSON.stringify(body, null, 2));
  } catch (err) {
    logStep("Failed to send HTTP response", {
      error: err?.message || String(err)
    });
  }
}

async function handleRefresh(res, trigger) {
  try {
    logStep("Refresh request received", {
      trigger
    });

    const result = await refreshStatus(trigger);

    sendJson(res, 200, result);
  } catch (err) {
    logStep("Refresh handler error, returning current status", {
      error: err?.message || String(err)
    });

    sendJson(res, 200, publicStatus());
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "OPTIONS") {
      sendJson(res, 200, {
        ok: true
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/status") {
      logStep("GET /status request received");

      sendJson(res, 200, publicStatus());
      return;
    }

    // Browser can visit http://localhost:3000/refresh to trigger a refresh
    if (req.method === "GET" && url.pathname === "/refresh") {
      await handleRefresh(res, "browser_get_refresh");
      return;
    }

    // POST is also supported for programmatic calls
    if (req.method === "POST" && url.pathname === "/refresh") {
      await handleRefresh(res, "api_post_refresh");
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, {
        ok: true,
        status: publicStatus()
      });
      return;
    }

    sendJson(res, 404, {
      error: "not_found",
      status: publicStatus()
    });
  } catch (err) {
    logStep("HTTP request handler error, returning current status", {
      error: err?.message || String(err)
    });

    sendJson(res, 200, publicStatus());
  }
});

server.on("error", (err) => {
  logStep("HTTP server error", {
    error: err?.message || String(err)
  });
});

process.on("uncaughtException", (err) => {
  logStep("Caught uncaughtException, service continues running", {
    error: err?.message || String(err)
  });
});

process.on("unhandledRejection", (reason) => {
  logStep("Caught unhandledRejection, service continues running", {
    error: reason?.message || String(reason)
  });
});

server.listen(PORT, () => {
  logStep("Codex status service started", {
    port: PORT,
    status_url: `http://localhost:${PORT}/status`,
    refresh_url: `http://localhost:${PORT}/refresh`,
    periodic_refresh_min: PERIODIC_REFRESH_MS / 60_000
  });

  refreshStatus("startup").catch((err) => {
    logStep("Startup auto-refresh failed, service continues running", {
      error: err?.message || String(err)
    });
  });

  startPeriodicRefresh();
});