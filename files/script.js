/* ============================================================
   SenseIQ IoT Dashboard — script.js
   ============================================================
   Replace SUPABASE_URL and SUPABASE_ANON_KEY with your values.
   ============================================================ */

const CONFIG = {
  SUPABASE_URL:      'https://darlrsjmdvyahmteihtl.supabase.co/rest/v1/sensor_dataL',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRhcmxyc2ptZHZ5YWhtdGVpaHRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3ODEzMDMsImV4cCI6MjA5MDM1NzMwM30.BdMKmcCPU4owoSB8RHOXOy_Vd1cAw41hg3KlSMFbD84',
  TABLE:             'sensor_data',
  REFRESH_MS:        2000,
  FEED_LIMIT:        50,
  CHART_POINTS:      20,
};

/* ── State ── */
let chart       = null;
let chartLabels = [];
let chartData   = [];
let prevTotal   = null;
let knownIds    = new Set();
let toastTimer  = null;

/* ── DOM ── */
const $ = id => document.getElementById(id);
const dom = {
  clock:        $('clock'),
  liveRing:     $('liveRing'),
  liveBadge:    $('liveBadge'),
  statusText:   $('statusText'),
  connDot:      $('connDot'),
  connLabel:    $('connLabel'),
  total:        $('totalDetections'),
  totalDelta:   $('totalDelta'),
  latestTime:   $('latestTime'),
  latestDate:   $('latestDate'),
  lastSensor:   $('lastSensor'),
  sensorStatus: $('sensorStatus'),
  recentCount:  $('recentCount'),
  recentDelta:  $('recentDelta'),
  feedList:     $('feedList'),
  feedCount:    $('feedCount'),
  toast:        $('toast'),
  toastMsg:     $('toastMsg'),
};

/* ============================================================
   ANIMATED CANVAS BACKGROUND — Particle star field
   ============================================================ */
(function initBg() {
  const canvas = $('bgCanvas');
  const ctx    = canvas.getContext('2d');
  let W, H, particles = [], lines = [];

  const COLORS = ['#4f9eff', '#b06ef3', '#00e5c3', '#f953c6', '#ff8c42'];

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function Particle() {
    this.reset = function() {
      this.x   = Math.random() * W;
      this.y   = Math.random() * H;
      this.r   = Math.random() * 1.6 + 0.3;
      this.vx  = (Math.random() - 0.5) * 0.35;
      this.vy  = (Math.random() - 0.5) * 0.35;
      this.col = COLORS[Math.floor(Math.random() * COLORS.length)];
      this.alpha = Math.random() * 0.6 + 0.15;
    };
    this.reset();
  }

  function init() {
    resize();
    particles = [];
    const count = Math.floor((W * H) / 9000);
    for (let i = 0; i < count; i++) {
      particles.push(new Particle());
    }
  }

  function drawConnectionLines() {
    const maxDist = 130;
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx   = particles[i].x - particles[j].x;
        const dy   = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < maxDist) {
          const a = (1 - dist / maxDist) * 0.12;
          ctx.beginPath();
          ctx.strokeStyle = `rgba(100,150,255,${a})`;
          ctx.lineWidth   = 0.6;
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.stroke();
        }
      }
    }
  }

  function tick() {
    ctx.clearRect(0, 0, W, H);

    drawConnectionLines();

    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < -10) p.x = W + 10;
      if (p.x > W + 10) p.x = -10;
      if (p.y < -10) p.y = H + 10;
      if (p.y > H + 10) p.y = -10;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.col + Math.floor(p.alpha * 255).toString(16).padStart(2, '0');
      ctx.fill();

      // soft glow
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 5);
      g.addColorStop(0, p.col + '22');
      g.addColorStop(1, 'transparent');
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 5, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
    });

    requestAnimationFrame(tick);
  }

  window.addEventListener('resize', init);
  init();
  tick();
})();

/* ============================================================
   CLOCK
   ============================================================ */
function tickClock() {
  dom.clock.textContent = new Date().toLocaleTimeString('en-GB', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}
setInterval(tickClock, 1000);
tickClock();

/* ============================================================
   STATUS
   ============================================================ */
function setStatus(state) {
  dom.liveRing.className  = 'live-ring';
  dom.connDot.className   = 'conn-dot';
  dom.liveBadge.className = 'live-badge';

  if (state === 'online') {
    dom.liveRing.classList.add('online');
    dom.connDot.classList.add('online');
    dom.liveBadge.classList.add('online');
    dom.statusText.textContent = 'Live';
    dom.connLabel.textContent  = 'Connected';
  } else if (state === 'error') {
    dom.liveRing.classList.add('error');
    dom.connDot.classList.add('error');
    dom.liveBadge.classList.add('error');
    dom.statusText.textContent = 'Error';
    dom.connLabel.textContent  = 'Disconnected';
  } else {
    dom.statusText.textContent = 'Connecting';
    dom.connLabel.textContent  = 'Connecting…';
  }
}

/* ============================================================
   TOAST
   ============================================================ */
function showToast(msg) {
  dom.toastMsg.textContent = msg;
  dom.toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toast.classList.remove('show'), 5000);
}

/* ============================================================
   VALUE ANIMATION
   ============================================================ */
function setVal(el, text) {
  const s = el.querySelector('.val');
  if (!s || s.textContent === text) return;
  s.classList.add('flash');
  setTimeout(() => { s.textContent = text; s.classList.remove('flash'); }, 180);
}

/* ============================================================
   FETCH
   ============================================================ */
async function fetchData() {
  const url = `${CONFIG.SUPABASE_URL}/rest/v1/${CONFIG.TABLE}` +
    `?select=*&order=created_at.desc&limit=${CONFIG.FEED_LIMIT}`;
  const res = await fetch(url, {
    headers: {
      apikey: CONFIG.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* ============================================================
   KPIs
   ============================================================ */
function updateKPIs(rows) {
  const total = rows.length;
  setVal(dom.total, total.toLocaleString());

  if (prevTotal !== null) {
    const diff = total - prevTotal;
    dom.totalDelta.textContent = diff > 0
      ? `↑ ${diff} new since last refresh`
      : 'No new detections';
    dom.totalDelta.style.color = diff > 0 ? 'var(--green)' : '';
  } else {
    dom.totalDelta.textContent = 'All-time records loaded';
  }
  prevTotal = total;

  const latest = rows[0];
  if (latest) {
    const tsRaw = latest.created_at ?? latest.timestamp ?? latest.time;
    const d     = tsRaw ? new Date(tsRaw) : null;
    if (d && !isNaN(d)) {
      setVal(dom.latestTime, d.toLocaleTimeString('en-GB', { hour12: false }));
      dom.latestDate.textContent = d.toLocaleDateString('en-GB', {
        weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
      });
    } else {
      setVal(dom.latestTime, 'N/A');
      dom.latestDate.textContent = 'Timestamp unavailable';
    }

    const sid = latest.sensor_id ?? latest.sensor ?? latest.id ?? 'N/A';
    setVal(dom.lastSensor, String(sid).toUpperCase());
    dom.sensorStatus.textContent = latest.status ?? latest.type ?? 'ACTIVE';
  }

  const now    = Date.now();
  const recent = rows.filter(r => {
    const ts = r.created_at ?? r.timestamp ?? r.time;
    if (!ts) return false;
    const t = new Date(ts);
    return !isNaN(t) && now - t.getTime() <= 60_000;
  }).length;

  setVal(dom.recentCount, recent.toString());
  dom.recentDelta.textContent = recent > 0
    ? `${recent} event${recent !== 1 ? 's' : ''} in the last minute`
    : 'No events in the last minute';
  dom.recentDelta.style.color = recent > 0 ? 'var(--green)' : '';
}

/* ============================================================
   CHART
   ============================================================ */
function initChart() {
  const ctx  = document.getElementById('detectionChart').getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, 280);
  grad.addColorStop(0,   'rgba(79,158,255,0.35)');
  grad.addColorStop(0.6, 'rgba(176,110,243,0.12)');
  grad.addColorStop(1,   'rgba(79,158,255,0)');

  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: chartLabels,
      datasets: [{
        label: 'Detections',
        data: chartData,
        borderColor: '#4f9eff',
        borderWidth: 2.5,
        backgroundColor: grad,
        pointBackgroundColor: '#4f9eff',
        pointBorderColor: '#04060f',
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 7,
        pointHoverBackgroundColor: '#fff',
        tension: 0.45,
        fill: true,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400, easing: 'easeInOutQuart' },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(10,15,35,0.95)',
          borderColor: 'rgba(79,158,255,0.35)',
          borderWidth: 1,
          titleColor: '#f0f6ff',
          bodyColor:  '#8899bb',
          titleFont:  { family: "'JetBrains Mono'", size: 11, weight: '500' },
          bodyFont:   { family: "'JetBrains Mono'", size: 11 },
          padding: 12,
          cornerRadius: 10,
          displayColors: false,
        },
      },
      scales: {
        x: {
          grid:  { color: 'rgba(255,255,255,0.04)', lineWidth: 1 },
          ticks: { color: '#3a4a66', font: { family: "'JetBrains Mono'", size: 9 }, maxTicksLimit: 8, maxRotation: 0 },
          border:{ color: 'rgba(255,255,255,0.05)' },
        },
        y: {
          grid:  { color: 'rgba(255,255,255,0.04)', lineWidth: 1 },
          ticks: { color: '#3a4a66', font: { family: "'JetBrains Mono'", size: 9 }, maxTicksLimit: 5, precision: 0 },
          border:{ color: 'rgba(255,255,255,0.05)' },
          beginAtZero: true,
        },
      },
    },
  });
}

function pushChart(rows) {
  const now    = new Date();
  const label  = now.toLocaleTimeString('en-GB', { hour12: false });
  const cutoff = new Date(now - CONFIG.REFRESH_MS * 3);
  const count  = rows.filter(r => {
    const ts = r.created_at ?? r.timestamp ?? r.time;
    if (!ts) return false;
    const t = new Date(ts);
    return !isNaN(t) && t >= cutoff;
  }).length;
  chartLabels.push(label);
  chartData.push(count);
  if (chartLabels.length > CONFIG.CHART_POINTS) { chartLabels.shift(); chartData.shift(); }
  chart.update();
}

/* ============================================================
   FEED
   ============================================================ */
function renderFeed(rows) {
  dom.feedCount.textContent = `${rows.length} record${rows.length !== 1 ? 's' : ''}`;

  if (!rows.length) {
    dom.feedList.innerHTML = `<div class="feed-empty">
      <div class="feed-empty-icon"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg></div>
      No records found
    </div>`;
    return;
  }

  const newIds = new Set(rows.map(r => r.id ?? JSON.stringify(r)));

  dom.feedList.innerHTML = rows.map(row => {
    const rowId = row.id ?? JSON.stringify(row);
    const isNew = !knownIds.has(rowId);
    const sid   = row.sensor_id ?? row.sensor ?? row.id ?? 'N/A';
    const tsRaw = row.created_at ?? row.timestamp ?? row.time ?? '';
    const d     = tsRaw ? new Date(tsRaw) : null;
    const tsStr = d && !isNaN(d) ? d.toLocaleTimeString('en-GB', { hour12: false }) : '—';
    const val   = row.value !== undefined
      ? `<span class="feed-tag">${Number(row.value).toFixed(2)}</span>`
      : '';
    return `<div class="feed-row${isNew ? ' is-new' : ''}">
      <span class="feed-pip"></span>
      <div class="feed-meta">
        <div class="feed-id">${String(sid).toUpperCase()}</div>
        <div class="feed-ts">${tsStr}</div>
      </div>
      ${val}
    </div>`;
  }).join('');

  knownIds = newIds;
}

/* ============================================================
   REFRESH CYCLE
   ============================================================ */
async function refresh() {
  try {
    const rows = await fetchData();
    setStatus('online');
    updateKPIs(rows);
    pushChart(rows);
    renderFeed(rows);
  } catch (err) {
    console.error('[SenseIQ]', err);
    setStatus('error');
    showToast(`Error: ${err.message}`);
  }
}

/* ============================================================
   BOOT
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  setStatus('connecting');
  initChart();
  refresh();
  setInterval(refresh, CONFIG.REFRESH_MS);
});
