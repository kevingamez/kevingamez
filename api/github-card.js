const DEFAULT_USERNAME = process.env.GITHUB_USERNAME || "kevingamez";
const CACHE_SECONDS = Number(process.env.CARD_CACHE_SECONDS || 3600);
const USER_AGENT = "kevingamez-profile-card";

const colors = {
  background: "#0d1117",
  panel: "#161b22",
  panelSoft: "#1f2933",
  border: "#30363d",
  text: "#f0f6fc",
  muted: "#8b949e",
  cyan: "#39c5cf",
  green: "#7ee787",
  amber: "#f2cc60",
  coral: "#ff7b72",
  violet: "#d2a8ff",
};

module.exports = async function handler(req, res) {
  const username = getQueryValue(req, "username") || DEFAULT_USERNAME;

  try {
    const data = await buildCardData(username);

    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader(
      "Cache-Control",
      `public, max-age=0, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=86400`,
    );
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.statusCode = 200;
    res.end(renderSvg(data));
  } catch (error) {
    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=0, s-maxage=300");
    res.statusCode = 200;
    res.end(renderErrorSvg(username, error));
  }
};

async function buildCardData(username) {
  const token = process.env.GITHUB_TOKEN;

  const [profileResult, reposResult, eventsResult, contributionsResult] =
    await Promise.allSettled([
      fetchJson(`https://api.github.com/users/${encodeURIComponent(username)}`, token),
      fetchJson(
        `https://api.github.com/users/${encodeURIComponent(
          username,
        )}/repos?type=owner&sort=pushed&per_page=100`,
        token,
      ),
      fetchJson(
        `https://api.github.com/users/${encodeURIComponent(
          username,
        )}/events/public?per_page=100`,
        token,
      ),
      fetchContributionCalendar(username, token),
    ]);

  const profile = unwrap(profileResult, {});
  const repos = Array.isArray(unwrap(reposResult, [])) ? unwrap(reposResult, []) : [];
  const events = Array.isArray(unwrap(eventsResult, [])) ? unwrap(eventsResult, []) : [];
  const contributions = unwrap(contributionsResult, null);
  const ownerRepos = repos.filter((repo) => !repo.fork);
  const pushedThisYear = ownerRepos.filter((repo) => isWithinDays(repo.pushed_at, 365));

  const totalStars = ownerRepos.reduce(
    (sum, repo) => sum + Number(repo.stargazers_count || 0),
    0,
  );
  const totalForks = ownerRepos.reduce((sum, repo) => sum + Number(repo.forks_count || 0), 0);
  const languages = getTopLanguages(ownerRepos);
  const recentDays = getRecentActivityDays(events);
  const topRepos = ownerRepos
    .slice()
    .sort((a, b) => Number(b.stargazers_count || 0) - Number(a.stargazers_count || 0))
    .slice(0, 3)
    .map((repo) => ({
      name: repo.name,
      stars: Number(repo.stargazers_count || 0),
      language: repo.language || "Code",
    }));

  return {
    username,
    name: profile.name || username,
    publicRepos: Number(profile.public_repos || ownerRepos.length || 0),
    followers: Number(profile.followers || 0),
    totalStars,
    totalForks,
    pushedThisYear: pushedThisYear.length,
    languages,
    topRepos,
    recentDays,
    contributions,
    updatedAt: new Date(),
  };
}

async function fetchContributionCalendar(username, token) {
  if (!token) {
    return null;
  }

  const query = `
    query ProfileCard($login: String!) {
      user(login: $login) {
        contributionsCollection {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                date
                contributionCount
              }
            }
          }
        }
      }
    }
  `;

  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: getGithubHeaders(token, true),
    body: JSON.stringify({ query, variables: { login: username } }),
  });

  if (!response.ok) {
    throw new Error(`GitHub GraphQL ${response.status}`);
  }

  const payload = await response.json();
  if (payload.errors) {
    throw new Error(payload.errors.map((item) => item.message).join(", "));
  }

  return payload.data?.user?.contributionsCollection?.contributionCalendar || null;
}

async function fetchJson(url, token) {
  const response = await fetch(url, {
    headers: getGithubHeaders(token, false),
  });

  if (!response.ok) {
    throw new Error(`GitHub REST ${response.status}`);
  }

  return response.json();
}

function getGithubHeaders(token, isGraphql) {
  const headers = {
    Accept: isGraphql ? "application/vnd.github+json" : "application/vnd.github+json",
    "User-Agent": USER_AGENT,
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (isGraphql) {
    headers["Content-Type"] = "application/json";
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

function getTopLanguages(repos) {
  const totals = new Map();

  for (const repo of repos) {
    if (!repo.language) {
      continue;
    }

    const current = totals.get(repo.language) || 0;
    totals.set(repo.language, current + Math.max(1, Number(repo.stargazers_count || 0) + 1));
  }

  const sorted = Array.from(totals.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 5);

  const total = sorted.reduce((sum, item) => sum + item.value, 0) || 1;
  return sorted.map((item) => ({
    ...item,
    percent: Math.round((item.value / total) * 100),
  }));
}

function getRecentActivityDays(events) {
  const counts = new Map();
  const today = startOfDay(new Date());

  for (let index = 29; index >= 0; index -= 1) {
    const day = new Date(today);
    day.setUTCDate(day.getUTCDate() - index);
    counts.set(toDateKey(day), 0);
  }

  for (const event of events) {
    const key = toDateKey(new Date(event.created_at));
    if (counts.has(key)) {
      counts.set(key, counts.get(key) + 1);
    }
  }

  const max = Math.max(1, ...Array.from(counts.values()));
  return Array.from(counts.entries()).map(([date, count]) => ({
    date,
    count,
    level: count === 0 ? 0 : Math.max(1, Math.ceil((count / max) * 4)),
  }));
}

function renderSvg(data) {
  const contributions = getContributionDays(data.contributions);
  const activityDays = contributions.length > 0 ? contributions : data.recentDays;
  const contributionTotal = data.contributions?.totalContributions;
  const metricLabel = contributionTotal == null ? "Public activity" : "Contributions";
  const metricValue = contributionTotal == null ? sumRecentActivity(data.recentDays) : contributionTotal;
  const updated = formatUpdatedAt(data.updatedAt);
  const langRows = data.languages.length > 0 ? data.languages : [{ name: "Code", percent: 100 }];
  const topRepos = data.topRepos.length > 0 ? data.topRepos : [{ name: "Public repos", stars: data.publicRepos, language: "GitHub" }];

  return `
<svg width="900" height="330" viewBox="0 0 900 330" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(data.name)} GitHub activity</title>
  <desc id="desc">Animated GitHub profile card generated from public GitHub data.</desc>
  <style>
    .label { fill: ${colors.muted}; font: 500 12px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing: 0; }
    .title { fill: ${colors.text}; font: 700 26px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing: 0; }
    .subtitle { fill: ${colors.muted}; font: 500 14px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing: 0; }
    .metric-value { fill: ${colors.text}; font: 700 26px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing: 0; }
    .metric-name { fill: ${colors.muted}; font: 600 11px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing: .7px; text-transform: uppercase; }
    .repo { fill: ${colors.text}; font: 650 13px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing: 0; }
    .small { fill: ${colors.muted}; font: 500 11px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing: 0; }
    .metric, .repo-row, .lang-row { animation: fadeUp .72s cubic-bezier(.2,.8,.2,1) both; }
    .day { animation: dayIn .42s cubic-bezier(.2,.8,.2,1) both; transform-box: fill-box; transform-origin: center; }
    .bar-fill { animation: growX .9s cubic-bezier(.2,.8,.2,1) both; transform-box: fill-box; transform-origin: left center; }
    .scan { animation: scan 4.4s linear infinite; }
    .pulse { animation: pulse 2.6s ease-in-out infinite; }
    .dash { animation: draw 2.4s cubic-bezier(.2,.8,.2,1) both; stroke-dasharray: 520; stroke-dashoffset: 520; }
    @keyframes fadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes dayIn { from { opacity: 0; transform: scale(.25); } to { opacity: 1; transform: scale(1); } }
    @keyframes growX { from { transform: scaleX(.05); } to { transform: scaleX(1); } }
    @keyframes scan { from { transform: translateX(-160px); } to { transform: translateX(920px); } }
    @keyframes pulse { 0%, 100% { opacity: .46; } 50% { opacity: 1; } }
    @keyframes draw { to { stroke-dashoffset: 0; } }
  </style>

  <defs>
    <linearGradient id="edge" x1="0" x2="900" y1="0" y2="330" gradientUnits="userSpaceOnUse">
      <stop stop-color="${colors.cyan}" stop-opacity=".55"/>
      <stop offset=".48" stop-color="${colors.green}" stop-opacity=".32"/>
      <stop offset="1" stop-color="${colors.coral}" stop-opacity=".42"/>
    </linearGradient>
    <linearGradient id="scanFill" x1="0" x2="140" y1="0" y2="0" gradientUnits="userSpaceOnUse">
      <stop stop-color="${colors.cyan}" stop-opacity="0"/>
      <stop offset=".5" stop-color="${colors.cyan}" stop-opacity=".28"/>
      <stop offset="1" stop-color="${colors.cyan}" stop-opacity="0"/>
    </linearGradient>
    <clipPath id="clip">
      <rect x="1" y="1" width="898" height="328" rx="8"/>
    </clipPath>
  </defs>

  <rect x="1" y="1" width="898" height="328" rx="8" fill="${colors.background}" stroke="url(#edge)" stroke-width="1.5"/>
  <g clip-path="url(#clip)">
    <rect class="scan" x="0" y="0" width="140" height="330" fill="url(#scanFill)" opacity=".72"/>
    <path class="dash" d="M35 270 C142 238 183 302 283 250 C369 206 434 221 506 178 C604 119 679 155 794 98" stroke="${colors.cyan}" stroke-width="1.5" opacity=".26"/>
  </g>

  <g transform="translate(34 31)">
    <text class="title" x="0" y="27">${escapeXml(data.name)}</text>
    <text class="subtitle" x="0" y="52">@${escapeXml(data.username)} · GitHub pulse · ${escapeXml(updated)}</text>
    <circle class="pulse" cx="822" cy="18" r="6" fill="${colors.green}"/>
    <text class="label" x="696" y="23">live from GitHub</text>
  </g>

  <g transform="translate(34 100)">
    ${renderMetric(0, metricLabel, formatNumber(metricValue), colors.green, 0)}
    ${renderMetric(143, "Stars", formatNumber(data.totalStars), colors.amber, 80)}
    ${renderMetric(286, "Repos", formatNumber(data.publicRepos), colors.cyan, 160)}
    ${renderMetric(429, "Active repos", formatNumber(data.pushedThisYear), colors.coral, 240)}
  </g>

  <g transform="translate(34 184)">
    <text class="metric-name" x="0" y="0">Activity map</text>
    ${renderActivityMap(activityDays)}
    <text class="small" x="0" y="104">${escapeXml(getActivityCaption(data.contributions))}</text>
  </g>

  <g transform="translate(610 100)">
    <text class="metric-name" x="0" y="0">Top languages</text>
    ${langRows.map((item, index) => renderLanguageRow(item, index)).join("")}
  </g>

  <g transform="translate(610 222)">
    <text class="metric-name" x="0" y="0">Notable repos</text>
    ${topRepos.map((repo, index) => renderRepoRow(repo, index)).join("")}
  </g>
</svg>`.trim();
}

function renderMetric(x, name, value, color, delay) {
  return `
    <g class="metric" style="animation-delay: ${delay}ms" transform="translate(${x} 0)">
      <rect x="0" y="0" width="124" height="58" rx="8" fill="${colors.panel}" stroke="${colors.border}"/>
      <rect x="0" y="0" width="3" height="58" rx="1.5" fill="${color}"/>
      <text class="metric-value" x="15" y="32">${escapeXml(value)}</text>
      <text class="metric-name" x="15" y="49">${escapeXml(name)}</text>
    </g>`;
}

function renderActivityMap(days) {
  const size = 8;
  const gap = 3;
  const colorsByLevel = ["#21262d", "#123923", "#1f6f3b", "#2ea043", "#7ee787"];
  const maxColumns = Math.ceil(days.length / 7);

  return days
    .map((day, index) => {
      const column = Math.floor(index / 7);
      const row = index % 7;
      const x = column * (size + gap);
      const y = 18 + row * (size + gap);
      const level = Math.max(0, Math.min(4, Number(day.level || 0)));
      const delay = Math.min(900, index * (maxColumns > 30 ? 3 : 14));

      return `<rect class="day" style="animation-delay: ${delay}ms" x="${x}" y="${y}" width="${size}" height="${size}" rx="2" fill="${colorsByLevel[level]}"><title>${escapeXml(day.date)}: ${Number(day.count || 0)}</title></rect>`;
    })
    .join("");
}

function renderLanguageRow(item, index) {
  const y = 22 + index * 20;
  const palette = [colors.cyan, colors.green, colors.amber, colors.coral, colors.violet];
  const width = Math.max(6, Math.min(190, Math.round((item.percent / 100) * 190)));

  return `
    <g class="lang-row" style="animation-delay: ${220 + index * 90}ms" transform="translate(0 ${y})">
      <text class="small" x="0" y="0">${escapeXml(truncate(item.name, 18))}</text>
      <text class="small" x="214" y="0" text-anchor="end">${item.percent}%</text>
      <rect x="0" y="7" width="214" height="5" rx="2.5" fill="${colors.panelSoft}"/>
      <rect class="bar-fill" x="0" y="7" width="${width}" height="5" rx="2.5" fill="${palette[index % palette.length]}"/>
    </g>`;
}

function renderRepoRow(repo, index) {
  const y = 22 + index * 22;
  const palette = [colors.amber, colors.cyan, colors.green];

  return `
    <g class="repo-row" style="animation-delay: ${360 + index * 90}ms" transform="translate(0 ${y})">
      <circle cx="5" cy="-4" r="4" fill="${palette[index % palette.length]}"/>
      <text class="repo" x="17" y="0">${escapeXml(truncate(repo.name, 22))}</text>
      <text class="small" x="214" y="0" text-anchor="end">${escapeXml(repo.language)} · ${formatNumber(repo.stars)} stars</text>
    </g>`;
}

function getContributionDays(calendar) {
  if (!calendar?.weeks) {
    return [];
  }

  const days = calendar.weeks.flatMap((week) => week.contributionDays || []);
  const max = Math.max(1, ...days.map((day) => Number(day.contributionCount || 0)));

  return days.map((day) => {
    const count = Number(day.contributionCount || 0);
    return {
      date: day.date,
      count,
      level: count === 0 ? 0 : Math.max(1, Math.ceil((count / max) * 4)),
    };
  });
}

function getActivityCaption(contributions) {
  if (contributions?.totalContributions != null) {
    return `${formatNumber(contributions.totalContributions)} contributions in the current GitHub contribution year`;
  }

  return "Public REST activity shown here. Set GITHUB_TOKEN on Vercel for the full contribution calendar.";
}

function renderErrorSvg(username, error) {
  return `
<svg width="900" height="220" viewBox="0 0 900 220" fill="none" xmlns="http://www.w3.org/2000/svg" role="img">
  <rect x="1" y="1" width="898" height="218" rx="8" fill="${colors.background}" stroke="${colors.border}"/>
  <text x="34" y="62" fill="${colors.text}" font-family="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="26" font-weight="700">GitHub pulse</text>
  <text x="34" y="96" fill="${colors.muted}" font-family="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="15">@${escapeXml(username)} data is temporarily unavailable.</text>
  <text x="34" y="128" fill="${colors.coral}" font-family="ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" font-size="13">${escapeXml(error.message || "Unknown error")}</text>
</svg>`.trim();
}

function getQueryValue(req, key) {
  if (req.query && req.query[key]) {
    return String(Array.isArray(req.query[key]) ? req.query[key][0] : req.query[key]);
  }

  if (!req.url) {
    return "";
  }

  try {
    const url = new URL(req.url, "http://localhost");
    return url.searchParams.get(key) || "";
  } catch {
    return "";
  }
}

function unwrap(result, fallback) {
  return result.status === "fulfilled" ? result.value : fallback;
}

function isWithinDays(dateValue, days) {
  if (!dateValue) {
    return false;
  }

  const date = new Date(dateValue);
  const now = Date.now();
  return now - date.getTime() <= days * 24 * 60 * 60 * 1000;
}

function startOfDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function toDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function sumRecentActivity(days) {
  return days.reduce((sum, day) => sum + Number(day.count || 0), 0);
}

function formatNumber(value) {
  return new Intl.NumberFormat("en", {
    notation: Number(value) >= 10000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(Number(value || 0));
}

function formatUpdatedAt(date) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(date);
}

function truncate(value, maxLength) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

module.exports._internal = {
  buildCardData,
  renderSvg,
  renderErrorSvg,
};
