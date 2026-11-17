(() => {
  "use strict";

  const GOAL_LOW = 155, GOAL_HIGH = 157, TARGET = 157;

  // ---------- helpers ----------
  function parseCSV(text) {
    const rows = [];
    let row = [], field = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
        } else field += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.some(f => f !== "")) rows.push(row);
        row = [];
      } else field += c;
    }
    row.push(field);
    if (row.some(f => f !== "")) rows.push(row);
    const head = rows.shift().map(h => h.trim());
    return rows.map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? "").trim()])));
  }

  const toDate = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const mondayOf = d => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
  const fmtShort = d => d.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
  const fmtDay = d => d.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric" });
  const n = v => Number(v) || 0;
  const int = v => Math.round(v).toLocaleString("en-US");
  const one = v => v.toFixed(1);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const signed = v => (v > 0 ? "+" : v < 0 ? "−" : "±") + Math.abs(v).toFixed(1);

  async function load(name) {
    const r = await fetch(`data/${name}.csv?v=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) throw new Error(`Couldn't load ${name}.csv (${r.status})`);
    return parseCSV(await r.text());
  }

  // ---------- weights ----------
  function weekly(weights) {
    const map = new Map();
    for (const w of weights) {
      const k = iso(mondayOf(w.d));
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(w.weight);
    }
    return [...map.entries()]
      .map(([k, arr]) => ({ start: toDate(k), avg: arr.reduce((a, b) => a + b, 0) / arr.length, count: arr.length }))
      .sort((a, b) => a.start - b.start);
  }

  // ---------- meals ----------
  const MACROS = [
    ["calories", "kcal", ""], ["protein", "P", "g"], ["carbs", "C", "g"],
    ["fat", "F", "g"], ["fiber", "Fibre", "g"], ["sodium", "Na", "mg"]
  ];

  function mealOrder(name) { const m = /^(\d+)\s*·\s*/.exec(name); return m ? Number(m[1]) : 999; }
  function mealLabel(name) { return name.replace(/^\d+\s*·\s*/, ""); }

  function groupDays(meals) {
    const map = new Map();
    for (const m of meals) {
      if (!map.has(m.date)) map.set(m.date, []);
      map.get(m.date).push(m);
    }
    return [...map.entries()].map(([date, list]) => {
      list.sort((a, b) => mealOrder(a.meal) - mealOrder(b.meal));
      const tot = {};
      for (const [k] of MACROS) tot[k] = list.reduce((s, m) => s + n(m[k]), 0);
      return { date, d: toDate(date), meals: list, tot };
    }).sort((a, b) => b.d - a.d);
  }

  function statusPills(t, inProgress) {
    if (inProgress) return [["In progress", "grey"]];
    const p = [];
    const kcal = t.calories, pro = t.protein;
    if (kcal > 2150) p.push(["Over", "amber"]);
    if (pro < 140) p.push(["Low protein", "red"]);
    else if (pro < 160) p.push(["Protein short", "amber"]);
    else if (kcal < 1850) p.push(["Under", "amber"]);
    else if (kcal <= 2150) p.push(["On target", "green"]);
    return p;
  }

  function macroLine(o, withProtein) {
    return `<div class="macros">
      ${withProtein ? `<span><b>${int(n(o.protein))}</b> g protein</span>` : ""}
      <span><b>${int(n(o.carbs))}</b> g carbs</span>
      <span><b>${int(n(o.fat))}</b> g fat</span>
      <span><b>${int(n(o.fiber))}</b> g fibre</span>
      <span><b>${int(n(o.sodium))}</b> mg sodium</span>
    </div>`;
  }

  // ---------- chart ----------
  function drawChart(el, pts) {
    const W = Math.max(300, Math.min(820, Math.round(el.clientWidth || 640)));
    const H = W < 500 ? 230 : 300, padL = 34, padR = 10, padT = 20, padB = 26;
    const xs = pts.map(p => p.d.getTime());
    const ys = pts.map(p => p.weight);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const yMin = Math.floor(Math.min(GOAL_LOW, ...ys) - 1);
    const yMax = Math.ceil(Math.max(...ys) + 1);
    const sx = t => padL + (x1 === x0 ? 0.5 : (t - x0) / (x1 - x0)) * (W - padL - padR);
    const sy = v => padT + (1 - (v - yMin) / (yMax - yMin)) * (H - padT - padB);

    let g = "";
    const step = (yMax - yMin) > 12 ? 4 : 2;
    for (let v = Math.ceil(yMin / step) * step; v <= yMax; v += step) {
      g += `<line x1="${padL}" x2="${W - padR}" y1="${sy(v)}" y2="${sy(v)}" stroke="#1a2656" stroke-width="1"/>`;
      g += `<text x="${padL - 8}" y="${sy(v) + 4}" text-anchor="end" fill="#9aa6cc" font-size="12">${v}</text>`;
    }
    // x labels: first, last, and Mondays spaced out
    const labels = [];
    const span = x1 - x0, day = 864e5;
    const every = span / day > 60 ? 28 : span / day > 21 ? 14 : 7;
    for (let d = mondayOf(new Date(x0)); d.getTime() <= x1; d.setDate(d.getDate() + every)) if (d.getTime() >= x0) labels.push(d.getTime());
    for (const t of labels) {
      g += `<text x="${sx(t)}" y="${H - 8}" text-anchor="middle" fill="#9aa6cc" font-size="12">${fmtShort(new Date(t))}</text>`;
    }
    const band = `<rect x="${padL}" width="${W - padL - padR}" y="${sy(GOAL_HIGH)}" height="${sy(GOAL_LOW) - sy(GOAL_HIGH)}" fill="rgba(47,209,122,.18)"/>
      <text x="${W - padR - 6}" y="${sy(GOAL_HIGH) - 6}" text-anchor="end" fill="#2fd17a" font-size="12" font-weight="600">Goal 155–157</text>`;
    const path = pts.map((p, i) => `${i ? "L" : "M"}${sx(p.d.getTime()).toFixed(1)},${sy(p.weight).toFixed(1)}`).join("");
    const last = pts.length - 1;
    const dots = pts.map((p, i) => i === last
      ? `<circle cx="${sx(p.d.getTime())}" cy="${sy(p.weight)}" r="9" fill="rgba(91,124,255,.35)"/><circle cx="${sx(p.d.getTime())}" cy="${sy(p.weight)}" r="5.5" fill="#fff" stroke="#5b7cff" stroke-width="2.5"/>`
      : `<circle cx="${sx(p.d.getTime())}" cy="${sy(p.weight)}" r="4" fill="#5b7cff"/>`).join("");

    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Weight over time">
      ${band}${g}
      <path d="${path}" fill="none" stroke="#5b7cff" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      <line class="cross" y1="${padT}" y2="${H - padB}" stroke="#ffffff" stroke-opacity=".25" stroke-width="1" style="display:none"/>
      ${dots}
      <rect class="hit" x="0" y="0" width="${W}" height="${H}" fill="transparent"/>
    </svg><div class="tip"></div>`;

    const svg = el.querySelector("svg"), tip = el.querySelector(".tip"), cross = el.querySelector(".cross");
    function show(evt) {
      const r = svg.getBoundingClientRect();
      const cx = (evt.clientX - r.left) * (W / r.width);
      let best = 0;
      pts.forEach((p, i) => { if (Math.abs(sx(p.d.getTime()) - cx) < Math.abs(sx(pts[best].d.getTime()) - cx)) best = i; });
      const p = pts[best], px = sx(p.d.getTime()), py = sy(p.weight);
      cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.style.display = "";
      tip.textContent = `${fmtDay(p.d)} · ${one(p.weight)} lb`;
      tip.style.display = "block";
      let left = px * r.width / W;
      left = Math.max(70, Math.min(r.width - 70, left));
      tip.style.left = `${left}px`;
      tip.style.top = `${py * r.height / H}px`;
    }
    function hide() { tip.style.display = "none"; cross.style.display = "none"; }
    svg.addEventListener("pointermove", show);
    svg.addEventListener("pointerdown", show);
    svg.addEventListener("pointerleave", e => { if (e.pointerType === "mouse") hide(); });
    document.addEventListener("pointerdown", e => { if (!el.contains(e.target)) hide(); });
  }

  // ---------- render ----------
  async function main() {
    const [wRaw, mRaw, lRaw] = await Promise.all([load("weights"), load("meals"), load("lifts")]);
    const today = iso(new Date());

    const weights = wRaw.filter(r => r.date && r.weight)
      .map(r => ({ ...r, d: toDate(r.date), weight: Number(r.weight) }))
      .sort((a, b) => a.d - b.d);
    const weeks = weekly(weights);
    const latest = weights[weights.length - 1];
    const thisMon = iso(mondayOf(new Date()));
    const thisWeek = weeks.find(w => iso(w.start) === thisMon) || weeks[weeks.length - 1];
    const prevWeek = weeks[weeks.indexOf(thisWeek) - 1];

    // header sentence
    const sumEl = document.getElementById("summary");
    if (thisWeek) {
      let s = `This week's average is ${one(thisWeek.avg)} lb (${thisWeek.count} weigh-in${thisWeek.count === 1 ? "" : "s"})`;
      if (prevWeek) {
        const diff = thisWeek.avg - prevWeek.avg;
        s += diff < -0.05 ? `, down ${one(-diff)} lb from last week.` : diff > 0.05 ? `, up ${one(diff)} lb from last week.` : `, flat with last week.`;
      } else s += ".";
      sumEl.textContent = s;
    }

    // calories / protein over last 7 logged days (today excluded while it's still being logged)
    const days = groupDays(mRaw.filter(r => r.date));
    const complete = days.filter(d => d.date !== today).slice(0, 7);
    const avgK = complete.reduce((s, d) => s + d.tot.calories, 0) / (complete.length || 1);
    const avgP = complete.reduce((s, d) => s + d.tot.protein, 0) / (complete.length || 1);
    const left = thisWeek ? thisWeek.avg - TARGET : NaN;

    document.getElementById("tiles").innerHTML = `
      <div class="tile"><div class="k">Latest weigh-in</div>
        <div class="v">${latest ? one(latest.weight) : "—"}<small>lb</small></div>
        <div class="s">${latest ? fmtDay(latest.d) : ""}</div></div>
      <div class="tile"><div class="k">This week's average</div>
        <div class="v">${thisWeek ? one(thisWeek.avg) : "—"}<small>lb</small></div>
        <div class="s">Last week ${prevWeek ? one(prevWeek.avg) + " lb" : "—"}</div></div>
      <div class="tile"><div class="k">Left to 157 lb</div>
        <div class="v">${isNaN(left) ? "—" : one(Math.max(0, left))}<small>lb</small></div>
        <div class="s">From this week's average</div></div>
      <div class="tile"><div class="k">Last ${complete.length} logged days</div>
        <div class="v">${int(avgK)}<small>kcal</small></div>
        <div class="s">${int(avgP)} g protein / day</div></div>`;

    if (weights.length) {
      const chartEl = document.getElementById("chart");
      drawChart(chartEl, weights);
      let lastW = chartEl.clientWidth;
      addEventListener("resize", () => {
        if (Math.abs(chartEl.clientWidth - lastW) > 20) { lastW = chartEl.clientWidth; drawChart(chartEl, weights); }
      });
    }

    document.getElementById("weeks").innerHTML =
      `<tr><th>Week of</th><th class="num">Average</th><th class="num">Change</th><th class="num">Weigh-ins</th></tr>` +
      weeks.slice().reverse().map((w, i, arr) => {
        const prev = arr[i + 1];
        return `<tr><td>${fmtShort(w.start)}</td><td class="num">${one(w.avg)} lb</td>
          <td class="num">${prev ? signed(w.avg - prev.avg) : ""}</td><td class="num">${w.count}</td></tr>`;
      }).join("");

    document.getElementById("days").innerHTML = days.map(day => {
      const t = day.tot;
      const pills = statusPills(t, day.date === today).map(([l, c]) => `<span class="pill ${c}">${l}</span>`).join("");
      const meals = day.meals.map(m => `
        <div class="meal">
          <div class="meal-h"><span class="meal-name">${esc(mealLabel(m.meal))}</span><span class="meal-kcal">${int(n(m.calories))}<small style="font-family:var(--sans);font-size:11px;color:var(--muted)"> kcal</small></span></div>
          <div class="meal-items">${esc(m.items)}</div>
          ${macroLine(m, true)}
        </div>`).join("");
      return `<div class="day">
        <button type="button" aria-expanded="false">
          <div class="day-top"><span class="day-date">${fmtDay(day.d)}${day.date === today ? " · today" : ""}<span class="chev">▾</span></span><span class="pills">${pills}</span></div>
          <div class="day-main"><span class="day-kcal">${int(t.calories)}<small>kcal</small></span><span class="day-pro">${int(t.protein)}<small>g protein</small></span></div>
          ${macroLine(t)}
        </button>
        <div class="meals">${meals}</div>
      </div>`;
    }).join("");
    document.querySelectorAll(".day > button").forEach(b => b.addEventListener("click", () => {
      const open = b.parentElement.classList.toggle("open");
      b.setAttribute("aria-expanded", String(open));
    }));

    const lifts = lRaw.filter(r => r.date).map((r, i) => ({ ...r, i, d: toDate(r.date) }))
      .sort((a, b) => b.d - a.d || a.i - b.i);
    document.getElementById("lifts").innerHTML =
      `<tr><th>Date</th><th>Lift</th><th class="num">Weight</th><th class="num">Reps</th><th class="num">e1RM</th><th class="gym-col">Gym</th></tr>` +
      lifts.map(l => {
        const w = n(l.weight), r = n(l.reps);
        return `<tr><td>${fmtShort(l.d)}</td><td>${esc(l.lift)}</td><td class="num">${esc(l.weight)}</td>
          <td class="num">${esc(l.reps)}</td><td class="num">${Math.round(w * (1 + r / 30))}</td><td class="gym gym-col">${esc(l.gym)}</td></tr>`;
      }).join("");

    const lastLogged = [latest && latest.d, days[0] && days[0].d, lifts[0] && lifts[0].d].filter(Boolean).sort((a, b) => b - a)[0];
    if (lastLogged) document.getElementById("foot").textContent = `Data through ${fmtDay(lastLogged)}`;
  }

  main().catch(e => {
    document.getElementById("summary").innerHTML = `<span class="err">${esc(e.message)}</span>`;
    console.error(e);
  });
})();
