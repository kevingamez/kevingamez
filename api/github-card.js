const DEFAULT_USERNAME = process.env.GITHUB_USERNAME || "kevingamez";
const CACHE_SECONDS = Number(process.env.CARD_CACHE_SECONDS || 3600);
const USER_AGENT = "kevingamez-profile-card";

const theme = {
  cream: "#15110d",
  cream2: "#1e1812",
  cream3: "#2a221a",
  panel: "#100c08",
  ink: "#f4ede1",
  ink2: "#cabeac",
  muted: "#948a7a",
  line: "rgba(244, 237, 225, 0.1)",
  line2: "rgba(244, 237, 225, 0.2)",
  coral: "#ff6a45",
  coralStrong: "#ff8a68",
  coralOnDark: "#ff7a5c",
};

const LANG_COLOR = {
  TypeScript: "#3178c6",
  JavaScript: "#f1e05a",
  Python: "#3572A5",
  Swift: "#F05138",
  Dart: "#00B4AB",
  Dockerfile: "#384d54",
  CSS: "#563d7c",
  HTML: "#e34c26",
  Astro: "#ff5d01",
  Rust: "#dea584",
  Go: "#00ADD8",
  Ruby: "#701516",
  Java: "#b07219",
  Kotlin: "#A97BFF",
  C: "#555555",
  "C++": "#f34b7d",
  "C#": "#178600",
  Shell: "#89e051",
  PHP: "#4F5D95",
  Lua: "#000080",
  Vue: "#41b883",
  Svelte: "#ff3e00",
  Solidity: "#AA6746",
  TeX: "#3D6117",
  PowerShell: "#012456",
  R: "#198CE7",
  Scala: "#c22d40",
  "Jupyter Notebook": "#DA5B0B",
  SCSS: "#c6538c",
  Sass: "#a53b70",
  Vim: "#199f4b",
  Makefile: "#427819",
  YAML: "#cb171e",
};

const REPO_DESC = {
  "personal-site": "This page, source included.",
  "AD_ASTRA2023-SpaceInvaders": "Aerial object detection for Amazon deforestation events.",
  Palladium_Chat: "Chat experiment in TypeScript.",
  "budget-app": "Personal-finance app, written in Swift.",
  "GCP-CloudRun": "Containerized service deploys on Cloud Run.",
};

const LEVEL_COLOR = ["#2a221a", "#9be9a8", "#40c463", "#30a14e", "#216e39"];
const WEEK_COUNT = 52;
const DAY_COUNT = 7;
const GRAPH_SIZE = WEEK_COUNT * DAY_COUNT;

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
  const [profileResult, reposResult, calendarResult] = await Promise.allSettled([
    fetchJson(`https://api.github.com/users/${encodeURIComponent(username)}`, token),
    fetchJson(
      `https://api.github.com/users/${encodeURIComponent(
        username,
      )}/repos?type=owner&sort=updated&per_page=100`,
      token,
    ),
    fetchContributionCalendar(username, token),
  ]);

  const profile = unwrap(profileResult, {});
  const repos = Array.isArray(unwrap(reposResult, [])) ? unwrap(reposResult, []) : [];
  const ownerRepos = repos.filter((repo) => !repo.fork);
  const languageStats = await buildLanguageStats(ownerRepos, token);
  const calendar = unwrap(calendarResult, null) || emptyCalendar();
  const topRepos = ownerRepos
    .slice()
    .sort(
      (a, b) =>
        Number(b.stargazers_count || 0) - Number(a.stargazers_count || 0) ||
        String(b.updated_at || "").localeCompare(String(a.updated_at || "")),
    )
    .slice(0, 4)
    .map((repo) => ({
      name: repo.name,
      description: REPO_DESC[repo.name] || repo.description || "",
      language: repo.language || "Other",
      color: colorFor(repo.language || "Other"),
      stars: Number(repo.stargazers_count || 0),
      url: repo.html_url || `https://github.com/${username}/${repo.name}`,
    }));

  return {
    username,
    name: profile.name || username,
    publicRepos: Number(profile.public_repos || ownerRepos.length || 0),
    yearsOnGithub: getYearsOnGithub(profile.created_at),
    languagesShipped: languageStats.languagesShipped,
    languageMix: languageStats.languageMix,
    topRepos,
    calendar,
  };
}

async function buildLanguageStats(repos, token) {
  const skipLangs = new Set(["Jupyter Notebook"]);
  const totals = new Map();
  const languagePayloads = await pMap(repos, 5, (repo) =>
    fetchRepoLanguages(repo.full_name, token),
  );

  for (const langs of languagePayloads) {
    for (const [name, bytes] of Object.entries(langs)) {
      if (skipLangs.has(name)) {
        continue;
      }
      totals.set(name, (totals.get(name) || 0) + Number(bytes || 0));
    }
  }

  if (totals.size === 0) {
    for (const repo of repos) {
      if (!repo.language || skipLangs.has(repo.language)) {
        continue;
      }
      totals.set(repo.language, (totals.get(repo.language) || 0) + 1);
    }
  }

  const totalBytes = Array.from(totals.values()).reduce((sum, value) => sum + value, 0) || 1;
  const languageMix = Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, bytes]) => ({
      name,
      pct: Math.max(1, Math.round((bytes / totalBytes) * 100)),
      color: colorFor(name),
    }));

  const pctSum = languageMix.reduce((sum, item) => sum + item.pct, 0);
  if (languageMix.length > 0 && pctSum !== 100) {
    languageMix[0] = { ...languageMix[0], pct: languageMix[0].pct + (100 - pctSum) };
  }

  return {
    languagesShipped: totals.size,
    languageMix,
  };
}

async function fetchContributionCalendar(username, token) {
  const [publicResult, graphqlResult] = await Promise.allSettled([
    fetchContributionCalendarPublic(username),
    fetchContributionCalendarGraphQL(username, token),
  ]);

  const publicCalendar = unwrap(publicResult, null);
  if (publicCalendar?.days?.length) {
    return publicCalendar;
  }

  const graphqlCalendar = unwrap(graphqlResult, null);
  if (graphqlCalendar?.days?.length) {
    return graphqlCalendar;
  }

  return emptyCalendar();
}

async function fetchContributionCalendarPublic(username) {
  const response = await fetch(
    `https://github.com/users/${encodeURIComponent(username)}/contributions`,
    {
      headers: {
        Accept: "text/html",
        "User-Agent": USER_AGENT,
      },
    },
  );

  if (!response.ok) {
    return null;
  }

  const html = await response.text();
  const cellRe = /<td\b[^>]*class="[^"]*ContributionCalendar-day[^"]*"[^>]*>/g;
  const cells = [];
  let match;

  while ((match = cellRe.exec(html)) !== null) {
    const tag = match[0];
    const date = tag.match(/data-date="([\d-]+)"/)?.[1];
    const level = tag.match(/data-level="(\d)"/)?.[1];
    const id = tag.match(/\sid="([^"]+)"/)?.[1] || null;

    if (!date || level == null) {
      continue;
    }

    cells.push({
      id,
      date,
      level: clampLevel(Number(level)),
    });
  }

  if (cells.length === 0) {
    return null;
  }

  const counts = new Map();
  const tipRe = /<tool-tip\b[^>]*\sfor="([^"]+)"[^>]*>([^<]+)<\/tool-tip>/g;

  while ((match = tipRe.exec(html)) !== null) {
    const id = match[1];
    const text = decodeHtml(match[2]);
    const count = text.match(/^([\d,]+|No)\s+contribution/i);
    counts.set(
      id,
      count
        ? count[1].toLowerCase() === "no"
          ? 0
          : Number(count[1].replace(/,/g, ""))
        : 0,
    );
  }

  const days = cells
    .map((cell) => {
      const known = cell.id ? counts.get(cell.id) : undefined;
      return {
        date: cell.date,
        count: known ?? (cell.level === 0 ? 0 : cell.level * 2),
        level: cell.level,
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const totalContributions = days.reduce((sum, day) => sum + day.count, 0);
  const { longest, current } = getStreaks(days);
  return {
    totalContributions,
    days,
    longestStreak: longest,
    currentStreak: current,
  };
}

async function fetchContributionCalendarGraphQL(username, token) {
  if (!token) {
    return null;
  }

  const to = new Date();
  const from = new Date(to.getTime() - 365 * 24 * 60 * 60 * 1000);
  const query = `
    query ProfileContribs($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          restrictedContributionsCount
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                date
                contributionCount
                contributionLevel
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
    body: JSON.stringify({
      query,
      variables: {
        login: username,
        from: from.toISOString(),
        to: to.toISOString(),
      },
    }),
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  const collection = payload.data?.user?.contributionsCollection;
  const calendar = collection?.contributionCalendar;

  if (!calendar?.weeks) {
    return null;
  }

  const days = calendar.weeks.flatMap((week) =>
    (week.contributionDays || []).map((day) => ({
      date: day.date,
      count: Number(day.contributionCount || 0),
      level: contributionLevelToNumber(day.contributionLevel),
    })),
  );
  const { longest, current } = getStreaks(days);

  return {
    totalContributions:
      Number(calendar.totalContributions || 0) +
      Number(collection.restrictedContributionsCount || 0),
    days,
    longestStreak: longest,
    currentStreak: current,
  };
}

async function fetchRepoLanguages(fullName, token) {
  if (!fullName) {
    return {};
  }

  try {
    return await fetchJson(`https://api.github.com/repos/${fullName}/languages`, token);
  } catch {
    return {};
  }
}

async function fetchJson(url, token) {
  const response = await fetch(url, {
    headers: getGithubHeaders(token, false),
  });

  if (!response.ok) {
    throw new Error(`GitHub ${response.status}`);
  }

  return response.json();
}

function getGithubHeaders(token, isGraphql) {
  const headers = {
    Accept: "application/vnd.github+json",
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

function renderSvg(data) {
  const calendarDays = getGraphDays(data.calendar);
  const languageMix =
    data.languageMix.length > 0
      ? data.languageMix
      : [{ name: "Code", pct: 100, color: theme.coralOnDark }];
  const repos = data.topRepos.length > 0 ? data.topRepos : fallbackRepos(data.username);

  return `
<svg width="900" height="650" viewBox="0 0 900 650" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(data.name)} GitHub activity</title>
  <desc id="desc">GitHub profile animation styled after kevingamez.com.</desc>
  <style>
    .sans { font-family: "Hanken Grotesk", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .mono { font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .serif { font-family: Fraunces, Georgia, "Times New Roman", serif; }
    .cap { fill: ${theme.coralOnDark}; font-size: 10.5px; letter-spacing: .06em; }
    .stat { animation: gh-stat-in .6s ease both; }
    .stat-num { fill: ${theme.ink}; font-size: 58px; font-weight: 500; letter-spacing: 0; }
    .stat-lbl { fill: ${theme.coralOnDark}; font-size: 11.5px; letter-spacing: .04em; }
    .stat-sub { fill: rgba(250, 247, 240, .55); font-size: 13px; }
    .lang-head { fill: rgba(250, 247, 240, .55); font-size: 12px; letter-spacing: .01em; }
    .lang-head-strong { fill: ${theme.ink}; font-size: 12px; font-weight: 600; letter-spacing: .01em; }
    .lang-seg { animation: lang-grow 1.5s cubic-bezier(.2,.8,.3,1) both; transform-box: fill-box; transform-origin: left center; }
    .legend { fill: rgba(250, 247, 240, .78); font-size: 11px; }
    .card-title { fill: ${theme.ink}; font-size: 22px; font-weight: 400; letter-spacing: 0; }
    .card-kicker { fill: ${theme.muted}; font-size: 11px; letter-spacing: .06em; }
    .dow, .month, .small { fill: ${theme.muted}; font-size: 10px; letter-spacing: .04em; }
    .day { animation: day-in .55s cubic-bezier(.2,.8,.3,1.25) both; transform-box: fill-box; transform-origin: center; }
    .cs { animation: gh-stat-in .6s ease both; }
    .cs-num { fill: ${theme.ink}; font-size: 28px; font-weight: 400; letter-spacing: 0; }
    .cs-num.coral { fill: ${theme.coral}; }
    .cs-lbl { fill: ${theme.muted}; font-size: 9.5px; letter-spacing: .04em; }
    .repo-row { animation: repo-in .55s ease both; }
    .repo-name { fill: ${theme.ink}; font-size: 13px; font-weight: 500; letter-spacing: 0; }
    .repo-desc { fill: ${theme.muted}; font-size: 12.5px; letter-spacing: 0; }
    .repo-stat { fill: ${theme.muted}; font-size: 11px; letter-spacing: 0; }
    @keyframes gh-stat-in { from { opacity: .45; } to { opacity: 1; } }
    @keyframes lang-grow { from { transform: scaleX(.18); } to { transform: scaleX(1); } }
    @keyframes day-in { from { opacity: .35; transform: scale(.55); } to { opacity: 1; transform: scale(1); } }
    @keyframes repo-in { from { opacity: .45; } to { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) {
      .stat, .lang-seg, .day, .cs, .repo-row { animation: none !important; opacity: 1 !important; transform: none !important; }
    }
  </style>

  <rect width="900" height="650" rx="14" fill="${theme.cream}"/>

  <g transform="translate(20 20)">
    <rect width="860" height="260" rx="14" fill="${theme.panel}" stroke="${theme.line}"/>
    <text class="mono cap" x="32" y="32">github.com/${escapeXml(data.username)} · updated daily</text>

    <g transform="translate(32 70)">
      ${renderBannerStat(0, data.publicRepos, "repos shipped", "public and org work", 0)}
      ${renderBannerStat(268, data.languagesShipped, "languages shipped", "TypeScript leads · Python is second", 100)}
      ${renderBannerStat(536, data.yearsOnGithub, "years on github", "joined April 2019", 200)}
    </g>

    <g transform="translate(32 190)">
      <text class="sans lang-head" x="0" y="0">language mix</text>
      <text class="sans lang-head-strong" x="610" y="0">across all repos I work on</text>
      <rect x="0" y="15" width="796" height="14" rx="7" fill="rgba(250, 247, 240, .07)"/>
      ${renderLanguageSegments(languageMix)}
      ${renderLanguageLegend(languageMix.slice(0, 5))}
    </g>
  </g>

  <g transform="translate(20 315)">
    <rect width="535" height="315" rx="12" fill="${theme.cream2}" stroke="${theme.line}"/>
    <text class="serif card-title" x="22" y="37">Contributions · @${escapeXml(data.username)}</text>
    <text class="mono card-kicker" x="513" y="36" text-anchor="end">last 12 months</text>
    ${renderContributionGraph(calendarDays)}
    ${renderContributionLegend()}
    <line x1="22" x2="513" y1="238" y2="238" stroke="${theme.line2}" stroke-dasharray="4 5"/>
    <g transform="translate(22 276)">
      ${renderContribStat(0, data.calendar.totalContributions, "Commits · 12mo", true, 200)}
      ${renderContribStat(164, data.calendar.currentStreak, "Current streak", false, 400)}
      ${renderContribStat(328, data.calendar.longestStreak, "Longest streak", false, 600)}
    </g>
  </g>

  <g transform="translate(575 315)">
    ${repos.map((repo, index) => renderRepoRow(repo, data.username, index)).join("")}
  </g>
</svg>`.trim();
}

function renderBannerStat(x, value, label, sub, delay) {
  return `
      <g class="stat" style="animation-delay:${delay}ms" transform="translate(${x} 0)">
        <rect x="0" y="0" width="2" height="82" rx="1" fill="${theme.coralOnDark}"/>
        <text class="mono stat-num" x="18" y="46">${escapeXml(formatPlainNumber(value))}</text>
        <text class="mono stat-lbl" x="18" y="70">${escapeXml(label)}</text>
        <text class="sans stat-sub" x="18" y="91">${escapeXml(sub)}</text>
      </g>`;
}

function renderLanguageSegments(languageMix) {
  let x = 0;
  return languageMix
    .map((lang, index) => {
      const width = Math.max(4, Math.round((lang.pct / 100) * 796));
      const segment = `<rect class="lang-seg" style="animation-delay:${600 + index * 90}ms" x="${x}" y="15" width="${width}" height="14" fill="${lang.color}"/>`;
      x += width;
      return segment;
    })
    .join("");
}

function renderLanguageLegend(languageMix) {
  let x = 0;
  return languageMix
    .map((lang) => {
      const label = `${lang.name} · ${lang.pct}%`;
      const item = `
      <g transform="translate(${x} 55)">
        <rect x="0" y="-8" width="9" height="9" rx="2" fill="${lang.color}"/>
        <text class="mono legend" x="16" y="0">${escapeXml(label)}</text>
      </g>`;
      x += Math.min(190, 31 + label.length * 7);
      return item;
    })
    .join("");
}

function renderContributionGraph(days) {
  const graphX = 75;
  const graphY = 64;
  const size = 7;
  const gap = 2;

  return `
    <g transform="translate(22 58)">
      <text class="mono dow" x="0" y="${graphY + 1 * (size + gap) + 6}">Mon</text>
      <text class="mono dow" x="0" y="${graphY + 3 * (size + gap) + 6}">Wed</text>
      <text class="mono dow" x="0" y="${graphY + 5 * (size + gap) + 6}">Fri</text>
      ${renderMonthLabels(days, graphX, 43, size, gap)}
      <g transform="translate(${graphX} ${graphY})">
        ${days
          .map((day, index) => {
            const week = Math.floor(index / DAY_COUNT);
            const dow = index % DAY_COUNT;
            const x = week * (size + gap);
            const y = dow * (size + gap);
            const level = clampLevel(day.level);
            const delay = week * 14 + dow * 5;

            return `<rect class="day" style="animation-delay:${delay}ms" x="${x}" y="${y}" width="${size}" height="${size}" rx="2" fill="${LEVEL_COLOR[level]}" stroke="rgba(31, 29, 26, .04)"><title>${escapeXml(`${day.count} contribution${day.count === 1 ? "" : "s"} on ${day.date}`)}</title></rect>`;
          })
          .join("")}
      </g>
    </g>`;
}

function renderMonthLabels(days, graphX, y, size, gap) {
  const labels = new Array(WEEK_COUNT).fill("");
  let previousMonth = "";
  let previousLabelWeek = -10;

  days.forEach((day, index) => {
    const date = new Date(`${day.date}T00:00:00Z`);
    const monthKey = `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
    const week = Math.floor(index / DAY_COUNT);

    if (index === 0 || monthKey !== previousMonth) {
      if (week - previousLabelWeek >= 4) {
        labels[week] = date.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
        previousLabelWeek = week;
      }
      previousMonth = monthKey;
    }
  });

  return labels
    .map((label, week) =>
      label
        ? `<text class="mono month" x="${graphX + week * (size + gap)}" y="${y}">${escapeXml(label)}</text>`
        : "",
    )
    .join("");
}

function renderContributionLegend() {
  return `
    <g transform="translate(22 216)">
      <text class="mono small" x="0" y="0">Less</text>
      ${LEVEL_COLOR.map(
        (color, index) =>
          `<rect x="${368 + index * 15}" y="-10" width="11" height="11" rx="2" fill="${color}"/>`,
      ).join("")}
      <text class="mono small" x="452" y="0">More</text>
    </g>`;
}

function renderContribStat(x, value, label, coral, delay) {
  return `
      <g class="cs" style="animation-delay:${delay}ms" transform="translate(${x} 0)">
        <text class="serif cs-num${coral ? " coral" : ""}" x="0" y="0">${escapeXml(formatPlainNumber(value))}</text>
        <text class="mono cs-lbl" x="0" y="22">${escapeXml(label)}</text>
      </g>`;
}

function renderRepoRow(repo, username, index) {
  const y = index * 67;
  const stat = repo.stars > 0 ? `★ ${repo.stars}   ${repo.language}` : repo.language;

  return `
    <g class="repo-row" style="animation-delay:${320 + index * 90}ms" transform="translate(0 ${y})">
      <rect width="305" height="57" rx="8" fill="${theme.cream}" stroke="${theme.line}"/>
      <text class="mono repo-name" x="16" y="22">${escapeXml(truncate(`${username} / ${repo.name}`, 34))}</text>
      <text class="sans repo-desc" x="16" y="42">${escapeXml(truncate(repo.description, 42))}</text>
      <circle cx="218" cy="21" r="4.5" fill="${repo.color}"/>
      <text class="mono repo-stat" x="235" y="25">${escapeXml(truncate(stat, 12))}</text>
    </g>`;
}

function renderErrorSvg(username, error) {
  return `
<svg width="900" height="220" viewBox="0 0 900 220" fill="none" xmlns="http://www.w3.org/2000/svg" role="img">
  <rect width="900" height="220" rx="14" fill="${theme.cream}"/>
  <rect x="20" y="20" width="860" height="180" rx="14" fill="${theme.panel}" stroke="${theme.line}"/>
  <text x="52" y="72" fill="${theme.ink}" font-family="Georgia, serif" font-size="26">GitHub</text>
  <text x="52" y="105" fill="${theme.muted}" font-family="ui-monospace, Menlo, monospace" font-size="13">@${escapeXml(username)} data is temporarily unavailable.</text>
  <text x="52" y="132" fill="${theme.coralOnDark}" font-family="ui-monospace, Menlo, monospace" font-size="12">${escapeXml(error.message || "Unknown error")}</text>
</svg>`.trim();
}

function getGraphDays(calendar) {
  const source = Array.isArray(calendar?.days) ? calendar.days.slice() : [];

  if (source.length >= GRAPH_SIZE) {
    return source.slice(-GRAPH_SIZE);
  }

  const filler = buildEmptyDays(GRAPH_SIZE - source.length, source[0]?.date);
  return filler.concat(source);
}

function buildEmptyDays(count, beforeDate) {
  const days = [];
  const end = beforeDate ? new Date(`${beforeDate}T00:00:00Z`) : startOfUtcDay(new Date());
  end.setUTCDate(end.getUTCDate() - (beforeDate ? 1 : 0));

  for (let index = count - 1; index >= 0; index -= 1) {
    const date = new Date(end);
    date.setUTCDate(end.getUTCDate() - index);
    days.push({
      date: date.toISOString().slice(0, 10),
      count: 0,
      level: 0,
    });
  }

  return days;
}

function fallbackRepos(username) {
  return [
    {
      name: "github",
      description: "Public work, commits, and language mix.",
      language: "GitHub",
      color: theme.coralOnDark,
      stars: 0,
      url: `https://github.com/${username}`,
    },
  ];
}

function emptyCalendar() {
  return {
    totalContributions: 0,
    days: [],
    longestStreak: 0,
    currentStreak: 0,
  };
}

function getStreaks(days) {
  let longest = 0;
  let run = 0;

  for (const day of days) {
    if (day.count > 0) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 0;
    }
  }

  let current = 0;
  let start = days.length - 1;
  if (start >= 0 && days[start].count === 0) {
    start -= 1;
  }

  for (let index = start; index >= 0; index -= 1) {
    if (days[index].count > 0) {
      current += 1;
    } else {
      break;
    }
  }

  return { longest, current };
}

async function pMap(items, concurrency, fn) {
  const output = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await fn(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return output;
}

function contributionLevelToNumber(level) {
  return (
    {
      NONE: 0,
      FIRST_QUARTILE: 1,
      SECOND_QUARTILE: 2,
      THIRD_QUARTILE: 3,
      FOURTH_QUARTILE: 4,
    }[level] ?? 0
  );
}

function getYearsOnGithub(createdAt) {
  if (!createdAt) {
    return 0;
  }

  const created = new Date(createdAt);
  return Math.max(
    0,
    Math.floor((Date.now() - created.getTime()) / (365.25 * 24 * 60 * 60 * 1000)),
  );
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

function colorFor(name) {
  return LANG_COLOR[name] || "#888888";
}

function clampLevel(level) {
  return Math.max(0, Math.min(4, Number(level || 0)));
}

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function formatPlainNumber(value) {
  return new Intl.NumberFormat("en-US").format(Number(value || 0));
}

function truncate(value, maxLength) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text;
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
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
