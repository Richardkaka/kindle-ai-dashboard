import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(fileURLToPath(new URL("..", import.meta.url)));
const configPath = join(rootDir, "config.json");
const todosPath = join(rootDir, "todos.md");
const publicDir = join(rootDir, "public");
const designsDir = join(rootDir, "designs");

const weatherCache = {
  updatedAt: 0,
  data: null,
  error: null
};

function mergeConfig(base, override) {
  return {
    ...base,
    ...override,
    server: { ...base.server, ...override.server },
    display: { ...base.display, ...override.display },
    location: { ...base.location, ...override.location },
    codex: { ...base.codex, ...override.codex },
    claude: { ...base.claude, ...override.claude },
    breakReminder: { ...base.breakReminder, ...override.breakReminder }
  };
}

async function loadJson(path, fallback) {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function loadConfig() {
  const defaults = {
    server: { host: "0.0.0.0", port: 8787, refreshMinutes: 30 },
    display: { title: "AI Coding", timezone: "Asia/Shanghai" },
    location: {
      label: "Beijing",
      query: "Beijing",
      latitude: 30.5928,
      longitude: 114.3055
    },
    codex: { mode: "manual", remaining: "手动填写", resetAt: "", note: "" },
    claude: { mode: "manual", remaining: "手动填写", resetAt: "", note: "" },
    breakReminder: {
      workMinutes: 50,
      breakMinutes: 10,
      dayStart: "09:30",
      dayEnd: "23:30"
    }
  };
  return mergeConfig(defaults, await loadJson(configPath, {}));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatTime(date, timezone) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function minutesUntil(isoValue) {
  if (!isoValue) return null;
  const target = new Date(isoValue).getTime();
  if (Number.isNaN(target)) return null;
  return Math.max(0, Math.ceil((target - Date.now()) / 60000));
}

function formatDuration(minutes) {
  if (minutes == null) return "未设置";
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}

async function loadTodos() {
  try {
    const raw = await readFile(todosPath, "utf8");
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^- \[[ xX]\]/.test(line))
      .map((line) => ({
        done: /^- \[[xX]\]/.test(line),
        text: line.replace(/^- \[[ xX]\]\s*/, "").trim()
      }))
      .slice(0, 6);
  } catch {
    return [];
  }
}

function weatherCodeText(code) {
  const map = {
    0: "晴",
    1: "多晴",
    2: "少云",
    3: "阴",
    45: "雾",
    48: "雾凇",
    51: "小毛毛雨",
    53: "毛毛雨",
    55: "大毛毛雨",
    61: "小雨",
    63: "中雨",
    65: "大雨",
    71: "小雪",
    73: "中雪",
    75: "大雪",
    80: "阵雨",
    81: "强阵雨",
    82: "暴阵雨",
    95: "雷暴"
  };
  return map[code] ?? "未知";
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Weather HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (error.name === "AbortError") throw new Error("天气请求超时");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function translateWttrText(value) {
  const text = String(value ?? "").trim().toLowerCase();
  const map = {
    clear: "晴",
    sunny: "晴",
    "partly cloudy": "多云",
    cloudy: "多云",
    overcast: "阴",
    mist: "薄雾",
    fog: "雾",
    "patchy rain nearby": "附近有雨",
    "light rain shower": "小阵雨",
    "light rain": "小雨",
    "moderate rain": "中雨",
    "heavy rain": "大雨",
    "thundery outbreaks in nearby": "附近雷雨"
  };
  return map[text] ?? value ?? "未知";
}

async function fetchWttrWeather(config) {
  const query = encodeURIComponent(config.location.query ?? config.location.label);
  const json = await fetchJsonWithTimeout(`https://wttr.in/${query}?format=j1`, 5000);
  const current = json.current_condition?.[0] ?? {};
  return {
    source: "wttr.in",
    currentTemp: Math.round(Number(current.temp_C)),
    currentText: translateWttrText(current.weatherDesc?.[0]?.value),
    days: (json.weather ?? []).slice(0, 3).map((day) => ({
      day: day.date,
      text: translateWttrText(day.hourly?.[4]?.weatherDesc?.[0]?.value),
      high: Math.round(Number(day.maxtempC)),
      low: Math.round(Number(day.mintempC))
    }))
  };
}

async function fetchOpenMeteoWeather(config) {
  const { latitude, longitude } = config.location;
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    current: "temperature_2m,weather_code",
    daily: "weather_code,temperature_2m_max,temperature_2m_min",
    forecast_days: "3",
    timezone: config.display.timezone
  });
  const json = await fetchJsonWithTimeout(`https://api.open-meteo.com/v1/forecast?${params}`, 3500);
  return {
    source: "Open-Meteo",
    currentTemp: Math.round(json.current.temperature_2m),
    currentText: weatherCodeText(json.current.weather_code),
    days: json.daily.time.map((day, index) => ({
      day,
      text: weatherCodeText(json.daily.weather_code[index]),
      high: Math.round(json.daily.temperature_2m_max[index]),
      low: Math.round(json.daily.temperature_2m_min[index])
    }))
  };
}

async function fetchWeather(config) {
  const now = Date.now();
  if (weatherCache.data && now - weatherCache.updatedAt < 20 * 60 * 1000) {
    return weatherCache;
  }

  const errors = [];
  for (const provider of [fetchWttrWeather, fetchOpenMeteoWeather]) {
    try {
      weatherCache.updatedAt = now;
      weatherCache.error = null;
      weatherCache.data = await provider(config);
      return weatherCache;
    } catch (error) {
      errors.push(error.message);
    }
  }

  weatherCache.updatedAt = now;
  weatherCache.error = errors.join(" / ");

  return weatherCache;
}

function parseClockMinutes(value) {
  const [hour, minute] = String(value).split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 0;
  return hour * 60 + minute;
}

function getLocalClockParts(date, timezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  return {
    hour: Number(parts.find((part) => part.type === "hour")?.value ?? 0),
    minute: Number(parts.find((part) => part.type === "minute")?.value ?? 0)
  };
}

function getBreakState(config) {
  const rule = config.breakReminder;
  const now = getLocalClockParts(new Date(), config.display.timezone);
  const current = now.hour * 60 + now.minute;
  const start = parseClockMinutes(rule.dayStart);
  const end = parseClockMinutes(rule.dayEnd);
  if (current < start || current > end) {
    return { title: "休息中", detail: "不在工作时段，放过自己。" };
  }

  const cycle = rule.workMinutes + rule.breakMinutes;
  const elapsed = (current - start) % cycle;
  if (elapsed < rule.workMinutes) {
    return {
      title: "专注中",
      detail: `${rule.workMinutes - elapsed} 分钟后休息 ${rule.breakMinutes} 分钟`
    };
  }

  return {
    title: "该休息了",
    detail: `剩余 ${cycle - elapsed} 分钟，离开屏幕一下`
  };
}

function getLanAddresses(port) {
  const addresses = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) {
        addresses.push(`http://${entry.address}:${port}`);
      }
    }
  }
  return addresses;
}

function renderQuotaCard(name, quota, timezone) {
  const resetMinutes = minutesUntil(quota.resetAt);
  const resetTime = quota.resetAt ? formatTime(new Date(quota.resetAt), timezone) : "未设置";
  return `
    <section class="panel">
      <div class="panel-head">
        <h2>${escapeHtml(name)}</h2>
        <span>${escapeHtml(quota.mode)}</span>
      </div>
      <div class="metric">${escapeHtml(quota.remaining)}</div>
      <p class="muted">重置 ${escapeHtml(resetTime)} · ${escapeHtml(formatDuration(resetMinutes))}</p>
      <p>${escapeHtml(quota.note)}</p>
    </section>
  `;
}

function renderWeather(weather, config) {
  if (!weather.data) {
    return `
      <section class="panel">
        <div class="panel-head"><h2>天气</h2><span>${escapeHtml(config.location.label)}</span></div>
        <div class="metric">暂无</div>
        <p class="muted">${escapeHtml(weather.error ?? "等待天气数据")}</p>
      </section>
    `;
  }

  return `
    <section class="panel">
      <div class="panel-head"><h2>天气</h2><span>${escapeHtml(config.location.label)}</span></div>
      <div class="metric">${weather.data.currentTemp}° ${escapeHtml(weather.data.currentText)}</div>
      <div class="forecast">
        ${weather.data.days
          .map(
            (day) => `
              <div>
                <b>${escapeHtml(day.day.slice(5))}</b>
                <span>${escapeHtml(day.text)}</span>
                <em>${day.low}°/${day.high}°</em>
              </div>
            `
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderTodos(todos, breakState) {
  const todoItems = todos.length
    ? todos
        .map(
          (todo) => `
            <li class="${todo.done ? "done" : ""}">
              <span>${todo.done ? "✓" : "□"}</span>
              ${escapeHtml(todo.text)}
            </li>
          `
        )
        .join("")
    : "<li><span>□</span> 在 todos.md 添加待办</li>";

  return `
    <section class="panel panel-todos">
      <div class="panel-head"><h2>待办 & 休息</h2><span>${escapeHtml(breakState.title)}</span></div>
      <ul>${todoItems}</ul>
      <p class="break">${escapeHtml(breakState.detail)}</p>
    </section>
  `;
}

function renderPixelIcon(rows) {
  return `
    <table class="pxi" aria-hidden="true">
      ${rows
        .map(
          (row) => `
            <tr>${row
              .split("")
              .map((cell) => `<td${cell === "1" ? ' class="on"' : ""}></td>`)
              .join("")}</tr>
          `
        )
        .join("")}
    </table>
  `;
}

const cardIcons = {
  codex: ["0111110", "1100011", "1001001", "1010101", "1001001", "1100011", "0111110"],
  claude: ["0001000", "1001001", "0101010", "1111111", "0101010", "1001001", "0001000"],
  weather: ["0011000", "0100100", "1000010", "1011011", "0111111", "0010100", "0101010"],
  break: ["1111111", "0100010", "0010100", "0001000", "0010100", "0100010", "1111111"]
};

function renderQuotaCardBoard({ icon, title, value, meta, barClass }) {
  return `
    <article class="card card-quota">
      <div class="card-line">
        <div class="icon-wrap">${renderPixelIcon(cardIcons[icon])}</div>
        <h2>${escapeHtml(title)}</h2>
        <p class="card-value">${escapeHtml(value)}</p>
      </div>
      <div class="bar"><span class="${barClass}"></span></div>
      <p class="meta">${escapeHtml(meta)}</p>
    </article>
  `;
}

function renderWeatherCardBoard({ value, meta }) {
  return `
    <article class="card card-simple">
      <div class="card-line">
        <div class="icon-wrap">${renderPixelIcon(cardIcons.weather)}</div>
        <h2>Weather</h2>
      </div>
      <p class="weather-value">${escapeHtml(value)}</p>
      <p class="weather-meta">${escapeHtml(meta)}</p>
    </article>
  `;
}

function splitBreakDetail(detail) {
  const text = String(detail ?? "");
  const match = text.match(/^(.+?)(?:，|,|;|；)\s*(.+)$/);
  if (match) return { primary: match[1], secondary: match[2] };
  const fallback = text.replace("，离开屏幕一下", "");
  return { primary: fallback, secondary: "休息 10 分钟" };
}

function renderBreakCardBoard({ title, detail }) {
  const split = splitBreakDetail(detail);
  return `
    <article class="card card-break">
      <div class="card-line">
        <div class="icon-wrap">${renderPixelIcon(cardIcons.break)}</div>
        <h2>Break</h2>
        <p class="card-value">${escapeHtml(title)}</p>
      </div>
      <p class="break-primary">${escapeHtml(split.primary)}</p>
      <p class="break-secondary">${escapeHtml(split.secondary)}</p>
    </article>
  `;
}

function renderCardBoardTodos(todos) {
  const shownTodos = todos.slice(0, 6);
  const todoItems = shownTodos.length
    ? shownTodos
        .map(
          (todo) => `
            <li class="${todo.done ? "done" : ""}">
              <span>${todo.done ? "✓" : "□"}</span>${escapeHtml(todo.text)}
            </li>
          `
        )
        .join("")
    : "<li><span>□</span> 在 todos.md 添加待办</li>";

  return `
    <section class="today">
      <div class="today-head">
        <div class="today-mark">□</div>
        <h2>Today</h2>
        <span>${shownTodos.length} items</span>
      </div>
      <ul>${todoItems}</ul>
    </section>
  `;
}

function renderCardBoardPage({ config, weather, todos, breakState }) {
  const refreshSeconds = Math.max(1, Number(config.server.refreshMinutes)) * 60;
  const now = formatTime(new Date(), config.display.timezone);
  const codexReset = formatDuration(minutesUntil(config.codex.resetAt));
  const claudeReset = formatDuration(minutesUntil(config.claude.resetAt));
  const weatherValue = weather.data
    ? `${weather.data.currentTemp}° ${weather.data.currentText}`
    : "暂无";
  const weatherMeta = weather.data
    ? `${config.location.label} ${weather.data.days[0]?.low ?? ""}°/${weather.data.days[0]?.high ?? ""}°`
    : `${config.location.label} · ${weather.error ?? "等待天气"}`;

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="${refreshSeconds}">
  <title>Kindle Card Board</title>
  <link rel="stylesheet" href="/d.css">
</head>
<body>
  <main class="screen">
    <header class="topbar">
      <div>
        <h1>${escapeHtml(config.display.title)}</h1>
        <p>${escapeHtml(now)} · ${escapeHtml(config.server.refreshMinutes)}m refresh</p>
      </div>
      <div class="status">${escapeHtml(breakState.title)}</div>
    </header>

    <section class="grid">
      ${renderQuotaCardBoard({
        icon: "codex",
        title: "Codex",
        value: config.codex.remaining,
        meta: `reset in ${codexReset}`,
        barClass: "bar-6"
      })}
      ${renderQuotaCardBoard({
        icon: "claude",
        title: "Claude",
        value: config.claude.remaining,
        meta: `reset in ${claudeReset}`,
        barClass: "bar-4"
      })}
      ${renderWeatherCardBoard({
        value: weatherValue,
        meta: weatherMeta
      })}
      ${renderBreakCardBoard({
        title: breakState.title,
        detail: breakState.detail
      })}
    </section>

    ${renderCardBoardTodos(todos)}
  </main>
</body>
</html>`;
}

function renderPage({ config, weather, todos, breakState }) {
  const refreshSeconds = Math.max(1, Number(config.server.refreshMinutes)) * 60;
  const now = formatTime(new Date(), config.display.timezone);

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="${refreshSeconds}">
  <title>${escapeHtml(config.display.title)}</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <main class="screen">
    <header>
      <h1>${escapeHtml(config.display.title)}</h1>
      <p>${escapeHtml(now)} · 每 ${escapeHtml(config.server.refreshMinutes)} 分钟刷新</p>
    </header>
    ${renderQuotaCard("Codex App", config.codex, config.display.timezone)}
    ${renderQuotaCard("Claude Code", config.claude, config.display.timezone)}
    ${renderWeather(weather, config)}
    ${renderTodos(todos, breakState)}
  </main>
</body>
</html>`;
}

async function serveStatic(pathname, response) {
  const filePath = join(publicDir, pathname === "/" ? "index.html" : pathname);
  if (!filePath.startsWith(publicDir) || !existsSync(filePath)) return false;
  const ext = extname(filePath);
  const contentTypes = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8"
  };
  response.writeHead(200, {
    "content-type": contentTypes[ext] ?? "text/plain; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(await readFile(filePath));
  return true;
}

async function serveDesign(pathname, response) {
  const designMap = {
    "/d.css": "card-board.css"
  };
  const filename = designMap[pathname];
  if (!filename) return false;

  const filePath = join(designsDir, filename);
  const ext = extname(filePath);
  response.writeHead(200, {
    "content-type": ext === ".css" ? "text/css; charset=utf-8" : "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(await readFile(filePath, "utf8"));
  return true;
}

function serveClean(response) {
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Clean</title>
  <style>
    html, body { margin: 0; min-height: 100%; background: #fff; }
    body { width: 100%; height: 100vh; }
  </style>
</head>
<body></body>
</html>`);
}

const config = await loadConfig();
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  if (url.pathname === "/c") {
    serveClean(response);
    return;
  }
  if (url.pathname === "/d") {
    const currentConfig = await loadConfig();
    const [weather, todos] = await Promise.all([
      fetchWeather(currentConfig),
      loadTodos()
    ]);
    const breakState = getBreakState(currentConfig);
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    });
    response.end(renderCardBoardPage({ config: currentConfig, weather, todos, breakState }));
    return;
  }
  if (await serveDesign(url.pathname, response)) return;
  if (await serveStatic(url.pathname, response)) return;

  if (url.pathname !== "/") {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const currentConfig = await loadConfig();
  const [weather, todos] = await Promise.all([
    fetchWeather(currentConfig),
    loadTodos()
  ]);
  const breakState = getBreakState(currentConfig);
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(renderPage({ config: currentConfig, weather, todos, breakState }));
});

server.listen(config.server.port, config.server.host, () => {
  console.log(`Kindle dashboard is running on http://localhost:${config.server.port}`);
  for (const address of getLanAddresses(config.server.port)) {
    console.log(`LAN: ${address}`);
  }
});
