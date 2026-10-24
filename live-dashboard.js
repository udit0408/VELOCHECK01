/* ============================================================
   VELOCHECK — live-dashboard.js
   Direct ESP32 Wi-Fi Telemetry & Mobile App Controller
   - Direct connection to ESP32 SoftAP (http://192.168.4.1) or Custom IP
   - Real-time gauge animation rendering
   - Interactive Clickable Pie / Donut Chart with full telemetry inspection:
     * Previous record
     * Measuring time
     * Avg 20 measuring values
     * Next predicted data
   - Automatic connection retry & simulated offline fallback
   ============================================================ */

const VeloCheckLive = (() => {
  const statusOrder = { ok: 0, warn: 1, crit: 2 };
  const hasNumber = (v) => typeof v === "number" && Number.isFinite(v);

  // Resolves the backend base URL (Default: Direct ESP32 SoftAP IP http://192.168.4.1)
  function getApiBase() {
    let base = localStorage.getItem("velocheck.apiBase");
    if (!base || base.trim() === "") {
      // If served directly from ESP32 webserver:
      if (window.location.protocol.startsWith("http") && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
        base = window.location.origin;
      } else {
        // Direct ESP32 Default SoftAP Wi-Fi address
        base = "http://192.168.4.1";
      }
    }
    return base.replace(/\/$/, "");
  }

  const endpoint = () => getApiBase() + "/api/readings";

  const titleCase = (w) => (w || "").replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const fmt = (v, u = "") => (hasNumber(v) ? `${v.toFixed(1)}${u ? " " + u : ""}` : "—");

  function timeText(v) {
    if (typeof v === "number") return `ESP uptime ${v.toFixed(0)}s`;
    if (!v) return "—";
    const d = new Date(v);
    return isNaN(d.getTime()) ? String(v) : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  let currentVehicle = "bike";
  let activeWheels = ["front", "rear"];
  let cachedLatest = null;
  let cachedHistory = [];
  let isOfflineSimulated = false;

  // Local simulated fallback for demo/testing when ESP32 is powered down
  let simHistory = [];
  let simTick = 0;

  function generateSimulatedPayload(vehicle) {
    simTick++;
    const now = new Date().toISOString();
    const wheels = vehicle === "car" ? ["front_left", "front_right", "rear_left", "rear_right"] : ["front", "rear"];
    const readings = {};

    wheels.forEach((w, idx) => {
      // Simulate realistic fluctuation with small drift
      const baseP = 32 + (idx * 1.5) + Math.sin(simTick * 0.2 + idx) * 1.8;
      const baseT = 36 + (idx * 2) + Math.cos(simTick * 0.15 + idx) * 4.2;
      const baseD = Math.max(1.8, 5.5 - (idx * 0.4) - (simTick * 0.005));

      readings[w] = {
        pressure_psi: parseFloat(baseP.toFixed(1)),
        temperature_c: parseFloat(baseT.toFixed(1)),
        tread_depth_mm: parseFloat(baseD.toFixed(1)),
        recorded_at: now
      };

      simHistory.push({
        vehicle_type: vehicle,
        wheel: w,
        ...readings[w]
      });
    });

    if (simHistory.length > 80) simHistory = simHistory.slice(-80);
    return { latest: readings, history: simHistory };
  }

  function computeLocalAnalytics(vehicle, wheel) {
    const wheelRows = simHistory.filter((r) => r.wheel === wheel).slice(-20);
    const count = wheelRows.length;
    if (count === 0) {
      return {
        vehicle_type: vehicle,
        wheel: wheel,
        count: 0,
        measuring_time: new Date().toISOString(),
        previous_record: null,
        average_last_20: null,
        next_predicted_data: null
      };
    }

    const latest = wheelRows[wheelRows.length - 1];
    const prev = count > 1 ? wheelRows[wheelRows.length - 2] : latest;

    const avgP = wheelRows.reduce((acc, r) => acc + r.pressure_psi, 0) / count;
    const avgT = wheelRows.reduce((acc, r) => acc + r.temperature_c, 0) / count;
    const avgD = wheelRows.reduce((acc, r) => acc + r.tread_depth_mm, 0) / count;

    // Linear regression next-step prediction
    function predictNext(arr) {
      const n = arr.length;
      if (n < 2) return arr[0];
      let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
      for (let i = 0; i < n; i++) {
        sumX += i;
        sumY += arr[i];
        sumXY += i * arr[i];
        sumX2 += i * i;
      }
      const denom = (n * sumX2 - sumX * sumX);
      if (denom === 0) return arr[n - 1];
      const slope = (n * sumXY - sumX * sumY) / denom;
      const intercept = (sumY - slope * sumX) / n;
      return slope * n + intercept;
    }

    const predP = predictNext(wheelRows.map((r) => r.pressure_psi));
    const predT = predictNext(wheelRows.map((r) => r.temperature_c));
    const predD = predictNext(wheelRows.map((r) => r.tread_depth_mm));

    return {
      vehicle_type: vehicle,
      wheel: wheel,
      count: count,
      measuring_time: latest.recorded_at,
      previous_record: prev,
      average_last_20: {
        pressure_psi: parseFloat(avgP.toFixed(2)),
        temperature_c: parseFloat(avgT.toFixed(2)),
        tread_depth_mm: parseFloat(avgD.toFixed(2))
      },
      next_predicted_data: {
        pressure_psi: parseFloat(Math.max(0, predP).toFixed(2)),
        temperature_c: parseFloat(predT.toFixed(2)),
        tread_depth_mm: parseFloat(Math.max(0, predD).toFixed(2))
      }
    };
  }

  function drawGauge(id, value, opts, wheel) {
    const el = document.getElementById(id);
    if (!el) return null;
    if (!hasNumber(value)) {
      el.innerHTML = '<p class="trend-empty-note">Waiting for sensor</p>';
      return null;
    }
    const status = VC.radialGauge(el, { ...opts, value });
    const card = el.closest(".gauge-card");
    if (card) {
      card.onclick = () => showDetail(wheel, opts.label);
      card.title = "Tap to view previous record, 20-reading avg & prediction";
    }
    return status;
  }

  function statusChip(statuses) {
    const valid = statuses.filter(Boolean);
    const worst = valid.reduce((a, b) => (statusOrder[b] > statusOrder[a] ? b : a), "ok");
    const chip = document.getElementById("overallStatus");
    if (!chip) return;
    chip.textContent = valid.length ? (worst === "ok" ? "Normal" : worst === "warn" ? "Check Recommended" : "Action Required") : "Data Unavailable";
    chip.className = "status-chip" + (worst === "ok" ? "" : " " + worst);
  }

  async function loadData(vehicle) {
    const api = endpoint();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2400);

      const [resLatest, resHistory] = await Promise.all([
        fetch(`${api}/latest?vehicle_type=${vehicle}`, { cache: "no-store", signal: controller.signal }),
        fetch(`${api}/history?vehicle_type=${vehicle}&limit=40`, { cache: "no-store", signal: controller.signal })
      ]);
      clearTimeout(timeoutId);

      if (!resLatest.ok || !resHistory.ok) throw new Error("ESP32 server returned error");
      const dataLatest = await resLatest.json();
      const dataHistory = await resHistory.json();
      isOfflineSimulated = false;
      return { latest: dataLatest.readings || {}, history: dataHistory.readings || [] };
    } catch (err) {
      // If ESP32 is offline and offline mock is enabled in settings or as fallback
      const allowSim = localStorage.getItem("velocheck.simFallback") !== "false";
      if (allowSim) {
        isOfflineSimulated = true;
        return generateSimulatedPayload(vehicle);
      }
      throw err;
    }
  }

  function trend(id, rows, wheels, key, min, max, colors) {
    const series = wheels
      .map((wheel, i) => ({
        label: wheel,
        color: colors[i % colors.length],
        data: rows.filter((r) => r.wheel === wheel).map((r) => r[key]).filter(hasNumber).slice(-20)
      }))
      .filter((s) => s.data.length);

    const el = document.getElementById(id);
    if (!el) return;
    if (!series.length) {
      el.innerHTML = '<p class="trend-empty-note">Waiting for telemetry history</p>';
      return;
    }
    VC.trendChart(el, {
      width: 600,
      height: 170,
      yMin: min,
      yMax: max,
      xLabels: Array.from({ length: Math.max(...series.map((s) => s.data.length)) }, (_, i) => `${i + 1}`),
      series
    });
  }

  /**
   * Health Overview Donut Chart:
   * Displays distribution and allows clicking any slice or the donut
   * to inspect detailed telemetry, averages and predictions.
   */
  function mountOverview(readings, wheels) {
    const box = document.getElementById("healthOverview");
    if (!box) return;
    const count = { ok: 0, warn: 0, crit: 0 };

    wheels.forEach((w) => {
      const r = readings[w];
      if (!r) return;
      [
        [r.pressure_psi, 28, 24, false],
        [r.temperature_c, 60, 80, true],
        [r.tread_depth_mm, 3, 1.6, false]
      ].forEach((x) => {
        if (hasNumber(x[0])) count[VC.statusFor(...x)]++;
      });
    });

    const parts = [
      { label: "Normal", value: count.ok, color: "#0ea5e9", status: "ok" },
      { label: "Check Recommended", value: count.warn, color: "#f59e0b", status: "warn" },
      { label: "Action Required", value: count.crit, color: "#ef4444", status: "crit" }
    ].filter((x) => x.value > 0);

    const chartContainer = box.querySelector(".health-chart");
    VC.donutChart(
      chartContainer,
      parts.length ? parts : [{ label: "Data Unavailable", value: 1, color: "#334155", status: "waiting" }],
      (selectedPart) => {
        // When user clicks the pie chart or a slice, open the detail modal!
        showDetail(wheels[0], selectedPart ? `${selectedPart.label} Slice` : "Health Overview");
      }
    );

    const summaryEl = box.querySelector(".health-summary");
    if (summaryEl) {
      summaryEl.textContent = parts.length
        ? `${count.ok} Normal · ${count.warn} Check Recommended · ${count.crit} Action Required`
        : "Data Unavailable (Awaiting Sensor Link)";
    }

    // Add click listener on entire overview card for tapability
    box.onclick = (e) => {
      if (e.target.closest("dialog")) return;
      showDetail(wheels[0], "Health Overview");
    };
  }

  /**
   * Detailed Telemetry Modal
   * Required fields:
   * 1. Previous record
   * 2. Measuring time
   * 3. Avg 20 measuring values
   * 4. Next predicted data
   */
  async function showDetail(selectedWheel, label) {
    const dialog = document.getElementById("readingDetail");
    if (!dialog) return;

    let modal = dialog.querySelector(".detail-modal");
    if (!modal) {
      dialog.innerHTML = `<div class="detail-modal"><header><h2></h2><button class="icon-btn" aria-label="Close">×</button></header><div class="wheel-tabs"></div><div class="detail-modal-grid"></div></div>`;
      modal = dialog.querySelector(".detail-modal");
    }

    const titleEl = modal.querySelector("h2");
    const tabsContainer = modal.querySelector(".wheel-tabs") || document.createElement("div");
    tabsContainer.className = "wheel-tabs";
    if (!tabsContainer.parentElement) {
      modal.insertBefore(tabsContainer, modal.querySelector(".detail-modal-grid"));
    }

    const content = modal.querySelector(".detail-modal-grid");
    const closeBtn = modal.querySelector(".icon-btn");
    closeBtn.onclick = () => dialog.close();

    // Render wheel selector tabs inside modal
    tabsContainer.innerHTML = activeWheels
      .map(
        (w) => `<button type="button" class="wheel-tab ${w === selectedWheel ? "active" : ""}" data-wheel="${w}">${titleCase(w)}</button>`
      )
      .join("");

    tabsContainer.querySelectorAll(".wheel-tab").forEach((btn) => {
      btn.onclick = (e) => {
        e.stopPropagation();
        showDetail(btn.dataset.wheel, label);
      };
    });

    titleEl.textContent = `${titleCase(selectedWheel)} — Telemetry Analytics`;
    content.innerHTML = '<p class="trend-empty-note full-width">Fetching sensor records and running predictions…</p>';
    if (!dialog.open) dialog.showModal();

    try {
      let data;
      if (isOfflineSimulated) {
        data = computeLocalAnalytics(currentVehicle, selectedWheel);
      } else {
        const res = await fetch(
          `${endpoint()}/analytics?vehicle_type=${currentVehicle}&wheel=${encodeURIComponent(selectedWheel)}&limit=20`
        );
        if (!res.ok) throw new Error("Analytics API error");
        data = await res.json();
      }

      const p = data.previous_record || {};
      const a = data.average_last_20 || {};
      const n = data.next_predicted_data || {};
      const cur = cachedLatest && cachedLatest[selectedWheel] ? cachedLatest[selectedWheel] : {};

      // Calculate directional trends
      const pDiff = hasNumber(n.pressure_psi) && hasNumber(cur.pressure_psi) ? n.pressure_psi - cur.pressure_psi : 0;
      const tDiff = hasNumber(n.temperature_c) && hasNumber(cur.temperature_c) ? n.temperature_c - cur.temperature_c : 0;

      const pTrend = Math.abs(pDiff) < 0.1 ? "→ Stable" : pDiff > 0 ? "↗ Rising (+ " + pDiff.toFixed(1) + " psi)" : "↘ Dropping (" + pDiff.toFixed(1) + " psi)";
      const tTrend = Math.abs(tDiff) < 0.2 ? "→ Stable" : tDiff > 0 ? "↗ Warming (+ " + tDiff.toFixed(1) + " °C)" : "↘ Cooling (" + tDiff.toFixed(1) + " °C)";

      content.innerHTML = `
        <div class="detail-stat full-width" style="border-left: 3px solid var(--signal-cyan);">
          <div class="label">Measuring Time (Current Sensor Record)</div>
          <div class="value">${timeText(data.measuring_time || cur.recorded_at)}</div>
          <div style="font-size: 11px; color: var(--text-secondary); margin-top: 4px;">
            Current Telemetry: <strong>${fmt(cur.pressure_psi, "psi")}</strong> · <strong>${fmt(cur.temperature_c, "°C")}</strong> · <strong>${fmt(cur.tread_depth_mm, "mm")}</strong>
          </div>
        </div>

        <div class="detail-stat">
          <div class="label">Previous Record</div>
          <div class="value">${fmt(p.pressure_psi, "psi")} · ${fmt(p.temperature_c, "°C")}</div>
          <div style="font-size: 10.5px; color: var(--text-tertiary); margin-top: 3px;">
            Tread: ${fmt(p.tread_depth_mm, "mm")} | Recorded: ${timeText(p.recorded_at)}
          </div>
        </div>

        <div class="detail-stat">
          <div class="label">Avg 20 Measuring Values</div>
          <div class="value">${fmt(a.pressure_psi, "psi")} · ${fmt(a.temperature_c, "°C")}</div>
          <div style="font-size: 10.5px; color: var(--text-tertiary); margin-top: 3px;">
            Avg Tread: ${fmt(a.tread_depth_mm, "mm")} (${data.count || 0} samples)
          </div>
        </div>

        <div class="detail-stat full-width" style="background: rgba(0, 229, 255, 0.08); border-color: var(--line-bright);">
          <div class="label" style="color: var(--signal-cyan);">Next Predicted Data (Linear Regression Trend)</div>
          <div class="value" style="font-size: 20px; color: var(--signal-cyan);">
            ${fmt(n.pressure_psi, "psi")} · ${fmt(n.temperature_c, "°C")} · ${fmt(n.tread_depth_mm, "mm")}
          </div>
          <div class="trend-badge" style="color: var(--text-secondary); margin-top: 6px;">
            Pressure Trend: <span style="color: ${pDiff > 0.1 ? 'var(--signal-amber)' : 'var(--signal-cyan)'}">${pTrend}</span> &nbsp;|&nbsp; 
            Temp: <span style="color: ${tDiff > 0.2 ? 'var(--signal-red)' : 'var(--signal-cyan)'}">${tTrend}</span>
          </div>
        </div>
      `;
    } catch (err) {
      content.innerHTML = `
        <div class="detail-stat full-width">
          <div class="label" style="color: var(--signal-amber);">Connection Notice</div>
          <div style="font-size: 13px; color: var(--text-secondary); margin-top: 6px;">
            Unable to fetch detailed records from ESP32 at <code>${getApiBase()}</code>.<br><br>
            • Ensure your phone is connected to <strong>VELOCHECK-WIFI</strong> or ESP32 Hotspot.<br>
            • You can update the ESP32 IP or toggle simulation mode in <strong>Settings</strong>.
          </div>
        </div>
      `;
    }
  }

  function renderBike(data) {
    const r = data.latest || {};
    cachedLatest = r;
    cachedHistory = data.history || [];

    const p = { min: 0, max: 45, warnAt: 28, critAt: 24, higherIsWorse: false, unit: "psi", label: "Pressure" };
    const t = { min: 0, max: 100, warnAt: 60, critAt: 80, higherIsWorse: true, unit: "°C", label: "Temperature" };
    const d = { min: 0, max: 8, warnAt: 3, critAt: 1.6, higherIsWorse: false, unit: "mm", label: "Tread Depth" };

    const statuses = [
      drawGauge("pressureFront", r.front?.pressure_psi, p, "front"),
      drawGauge("pressureRear", r.rear?.pressure_psi, p, "rear"),
      drawGauge("tempFront", r.front?.temperature_c, t, "front"),
      drawGauge("tempRear", r.rear?.temperature_c, t, "rear"),
      drawGauge("treadFront", r.front?.tread_depth_mm, d, "front"),
      drawGauge("treadRear", r.rear?.tread_depth_mm, d, "rear")
    ];

    trend("pressureTrend", cachedHistory, ["front", "rear"], "pressure_psi", 20, 45, ["#00e5ff", "#ffb300"]);
    trend("tempTrend", cachedHistory, ["front", "rear"], "temperature_c", 20, 100, ["#00e5ff", "#ffb300"]);

    renderCommon(r, statuses, ["front", "rear"]);
  }

  function renderCar(data) {
    const r = data.latest || {};
    cachedLatest = r;
    cachedHistory = data.history || [];

    const w = ["front_left", "front_right", "rear_left", "rear_right"];
    const ids = ["FL", "FR", "RL", "RR"];

    const p = { min: 0, max: 45, warnAt: 28, critAt: 24, higherIsWorse: false, unit: "psi", label: "Pressure" };
    const t = { min: 0, max: 100, warnAt: 60, critAt: 80, higherIsWorse: true, unit: "°C", label: "Temperature" };
    const d = { min: 0, max: 8, warnAt: 3, critAt: 1.6, higherIsWorse: false, unit: "mm", label: "Tread Depth" };

    const statuses = [];
    w.forEach((x, i) => statuses.push(drawGauge(`p${ids[i]}`, r[x]?.pressure_psi, p, x)));
    w.forEach((x, i) => statuses.push(drawGauge(`t${ids[i]}`, r[x]?.temperature_c, t, x)));
    w.forEach((x, i) => statuses.push(drawGauge(`d${ids[i]}`, r[x]?.tread_depth_mm, d, x)));

    trend("pressureTrend", cachedHistory, w, "pressure_psi", 20, 45, ["#0ea5e9", "#10b981", "#f59e0b", "#ef4444"]);
    trend("tempTrend", cachedHistory, w, "temperature_c", 20, 100, ["#0ea5e9", "#10b981", "#f59e0b", "#ef4444"]);

    renderCommon(r, statuses, w);
  }

  function renderCommon(readings, statuses, wheels) {
    const newest = Object.values(readings)
      .map((r) => r && r.recorded_at)
      .filter(Boolean)
      .sort()
      .pop();

    const timeEl = document.getElementById("lastReadingTime");
    const srcBadge = document.getElementById("dataSourceBadge");

    if (srcBadge) {
      if (isOfflineSimulated) {
        srcBadge.innerHTML = '○ Simulated Demo Mode';
        srcBadge.style.color = 'var(--signal-amber)';
        srcBadge.style.borderColor = 'rgba(245, 158, 11, 0.3)';
        srcBadge.style.background = 'rgba(245, 158, 11, 0.08)';
      } else {
        srcBadge.innerHTML = '● Live ESP32 Sensor';
        srcBadge.style.color = 'var(--signal-green)';
        srcBadge.style.borderColor = 'rgba(16, 185, 129, 0.3)';
        srcBadge.style.background = 'rgba(16, 185, 129, 0.08)';
      }
    }

    if (timeEl) {
      if (isOfflineSimulated) {
        timeEl.innerHTML = '<span style="color: var(--signal-amber);">Simulated Demo</span>';
      } else if (newest) {
        timeEl.textContent = typeof newest === "number" ? `ESP ${newest}s` : new Date(newest).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      } else {
        timeEl.textContent = "Connecting";
      }
    }

    statusChip(statuses);
    mountOverview(readings, wheels);
  }

  function start(vehicle, renderFn) {
    currentVehicle = vehicle;
    activeWheels = vehicle === "car" ? ["front_left", "front_right", "rear_left", "rear_right"] : ["front", "rear"];
    document.body.dataset.vehicle = vehicle;

    // Attach modal close handler
    const dialog = document.getElementById("readingDetail");
    if (dialog) {
      const closeBtn = dialog.querySelector(".icon-btn");
      if (closeBtn) closeBtn.onclick = () => dialog.close();
      dialog.onclick = (e) => {
        if (e.target === dialog) dialog.close();
      };
    }

    const refresh = async () => {
      try {
        const payload = await loadData(vehicle);
        renderFn(payload);
      } catch (err) {
        const timeEl = document.getElementById("lastReadingTime");
        if (timeEl) timeEl.textContent = "Offline (Check Wi-Fi)";
        statusChip(["crit"]);
      }
    };

    refresh();
    setInterval(refresh, 2000);
  }

  return {
    startBike: () => start("bike", renderBike),
    startCar: () => start("car", renderCar),
    showDetail: showDetail,
    getApiBase: getApiBase
  };
})();
