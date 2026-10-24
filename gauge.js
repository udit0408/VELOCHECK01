/* ============================================================
   VELOCHECK — gauge.js
   Lightweight SVG gauge + trend-line renderer with:
   - Smooth requestAnimationFrame needle & arc animations
   - Smooth numeric counter interpolation
   - High-contrast glowing cybernetic automotive visuals
   - Clickable interactive pie / donut chart with slice inspection
   ============================================================ */

const VC = (() => {
  const NS = "http://www.w3.org/2000/svg";
  const activeAnimations = new WeakMap();
  const stateMemory = new WeakMap();

  function el(tag, attrs = {}, textContent = null) {
    const node = document.createElementNS(NS, tag);
    for (const k in attrs) {
      node.setAttribute(k, attrs[k]);
    }
    if (textContent !== null && textContent !== undefined) {
      node.textContent = textContent;
    }
    return node;
  }

  function statusFor(value, warnAt, critAt, higherIsWorse) {
    if (value === undefined || value === null || !Number.isFinite(value)) return "ok";
    if (higherIsWorse) {
      if (critAt !== undefined && critAt !== null && value >= critAt) return "crit";
      if (warnAt !== undefined && warnAt !== null && value >= warnAt) return "warn";
      return "ok";
    } else {
      if (critAt !== undefined && critAt !== null && value <= critAt) return "crit";
      if (warnAt !== undefined && warnAt !== null && value <= warnAt) return "warn";
      return "ok";
    }
  }

  const STATUS_COLOR = {
    ok:   "#0ea5e9",
    warn: "#f59e0b",
    crit: "#ef4444"
  };

  const STATUS_GLOW = {
    ok:   "rgba(14, 165, 233, 0.15)",
    warn: "rgba(245, 158, 11, 0.15)",
    crit: "rgba(239, 68, 68, 0.18)"
  };

  function polarToCartesian(cx, cy, r, angleDeg) {
    const a = (angleDeg - 90) * Math.PI / 180;
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  }

  function arcPathData(cx, cy, r, startDeg, endDeg) {
    // Avoid full 360 singularity
    const safeEnd = Math.min(endDeg, startDeg + 359.99);
    const start = polarToCartesian(cx, cy, r, safeEnd);
    const end = polarToCartesian(cx, cy, r, startDeg);
    const largeArc = (safeEnd - startDeg) <= 180 ? 0 : 1;
    return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
  }

  function tickMark(cx, cy, r, angleDeg, color = "var(--bg-void)", width = 2) {
    const inner = polarToCartesian(cx, cy, r - 8, angleDeg);
    const outer = polarToCartesian(cx, cy, r + 8, angleDeg);
    return el("line", {
      x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y,
      stroke: color, "stroke-width": width, "stroke-linecap": "round"
    });
  }

  // Smooth cubic ease out curve
  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  /**
   * Renders a 270° radial gauge into `container` with real-time smooth animation.
   * opts: { min, max, value, warnAt, critAt, higherIsWorse, unit, decimals, label }
   */
  function radialGauge(container, opts) {
    if (!container) return "ok";

    const {
      min = 0, max = 100, value = 0,
      warnAt, critAt, higherIsWorse = true,
      unit = "", decimals = 1, label = ""
    } = opts;

    const size = 136;
    const cx = size / 2, cy = size / 2, r = 50;
    const startAngle = -225; // 270 deg total arc (-225 to +45)
    const sweep = 270;

    const targetValue = Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
    const targetFrac = (targetValue - min) / (max - min || 1);

    // Cancel existing in-flight animation for this container
    if (activeAnimations.has(container)) {
      cancelAnimationFrame(activeAnimations.get(container));
      activeAnimations.delete(container);
    }

    const prevState = stateMemory.get(container) || {
      currentValue: min,
      currentFrac: 0,
      initialized: false
    };

    const startVal = prevState.initialized ? prevState.currentValue : min;
    const startFracVal = prevState.initialized ? prevState.currentFrac : 0;

    let svg = container.querySelector("svg.vc-radial-gauge");
    let trackArc, valueArc, needleHead, readoutText, unitText;

    if (!svg || !prevState.initialized) {
      container.innerHTML = "";
      svg = el("svg", {
        viewBox: `0 0 ${size} ${size}`,
        width: size,
        height: size,
        class: "vc-radial-gauge"
      });

      // Filter for glow effect
      const defs = el("defs");
      const filter = el("filter", { id: `glow-${Math.random().toString(36).substr(2, 6)}`, x: "-20%", y: "-20%", width: "140%", height: "140%" });
      filter.appendChild(el("feGaussianBlur", { stdDeviation: "3", result: "blur" }));
      filter.appendChild(el("feMerge", {}));
      filter.lastChild.appendChild(el("feMergeNode", { in: "blur" }));
      filter.lastChild.appendChild(el("feMergeNode", { in: "SourceGraphic" }));
      defs.appendChild(filter);
      svg.appendChild(defs);

      // Background track arc
      trackArc = el("path", {
        d: arcPathData(cx, cy, r, startAngle, startAngle + sweep),
        fill: "none",
        stroke: "rgba(255, 255, 255, 0.08)",
        "stroke-width": "10",
        "stroke-linecap": "round"
      });
      svg.appendChild(trackArc);

      // Warn / Crit threshold tick marks
      [warnAt, critAt].forEach((t) => {
        if (t === undefined || t === null || !Number.isFinite(t)) return;
        const tf = (t - min) / (max - min);
        if (tf < 0 || tf > 1) return;
        const a = startAngle + sweep * tf;
        const tickColor = t === critAt ? STATUS_COLOR.crit : STATUS_COLOR.warn;
        svg.appendChild(tickMark(cx, cy, r, a, tickColor, 2.5));
      });

      // Animated value arc
      valueArc = el("path", {
        d: arcPathData(cx, cy, r, startAngle, startAngle + Math.max(0.1, sweep * startFracVal)),
        fill: "none",
        stroke: STATUS_COLOR.ok,
        "stroke-width": "10",
        "stroke-linecap": "round",
        class: "gauge-value-arc"
      });
      svg.appendChild(valueArc);

      // Glowing needle head indicator at arc tip
      const tipPos = polarToCartesian(cx, cy, r, startAngle + sweep * startFracVal);
      needleHead = el("circle", {
        cx: tipPos.x,
        cy: tipPos.y,
        r: "4.5",
        fill: "#ffffff",
        stroke: STATUS_COLOR.ok,
        "stroke-width": "2",
        class: "gauge-needle-glow"
      });
      svg.appendChild(needleHead);

      // Center readout value
      readoutText = el("text", {
        x: cx,
        y: cy - 2,
        "text-anchor": "middle",
        "font-family": "Rajdhani, -apple-system, sans-serif",
        "font-weight": "700",
        "font-size": "24",
        fill: STATUS_COLOR.ok,
        class: "gauge-readout"
      }, startVal.toFixed(decimals));
      svg.appendChild(readoutText);

      // Unit text
      unitText = el("text", {
        x: cx,
        y: cy + 18,
        "text-anchor": "middle",
        "font-family": "Inter, -apple-system, sans-serif",
        "font-weight": "600",
        "font-size": "11",
        fill: "var(--text-tertiary)",
        letterSpacing: "0.5px"
      }, unit);
      svg.appendChild(unitText);

      container.appendChild(svg);
    } else {
      valueArc = svg.querySelector(".gauge-value-arc");
      needleHead = svg.querySelector(".gauge-needle-glow");
      readoutText = svg.querySelector(".gauge-readout");
    }

    const duration = 650; // ms
    const startTime = performance.now();
    const finalStatus = statusFor(targetValue, warnAt, critAt, higherIsWorse);
    const finalColor = STATUS_COLOR[finalStatus];

    function animate(now) {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      const ease = easeOutCubic(progress);

      const curVal = startVal + (targetValue - startVal) * ease;
      const curFrac = startFracVal + (targetFrac - startFracVal) * ease;

      const sweepAngle = Math.max(0.1, sweep * curFrac);
      const curAngle = startAngle + sweepAngle;

      // Update arc path
      if (valueArc) {
        valueArc.setAttribute("d", arcPathData(cx, cy, r, startAngle, curAngle));
        valueArc.setAttribute("stroke", finalColor);
        valueArc.style.filter = `drop-shadow(0 0 6px ${STATUS_GLOW[finalStatus]})`;
      }

      // Update needle head
      if (needleHead) {
        const p = polarToCartesian(cx, cy, r, curAngle);
        needleHead.setAttribute("cx", p.x);
        needleHead.setAttribute("cy", p.y);
        needleHead.setAttribute("stroke", finalColor);
      }

      // Update readout text
      if (readoutText) {
        readoutText.textContent = curVal.toFixed(decimals);
        readoutText.setAttribute("fill", finalColor);
      }

      stateMemory.set(container, {
        currentValue: curVal,
        currentFrac: curFrac,
        initialized: true
      });

      if (progress < 1) {
        const reqId = requestAnimationFrame(animate);
        activeAnimations.set(container, reqId);
      } else {
        activeAnimations.delete(container);
      }
    }

    const reqId = requestAnimationFrame(animate);
    activeAnimations.set(container, reqId);

    return finalStatus;
  }

  /**
   * Renders an interactive donut/pie chart with clickable slices.
   * `parts`: [{ label, value, color, key }]
   * `onSelect`: callback(part, allParts)
   */
  function donutChart(container, parts, onSelect) {
    if (!container) return;

    const size = 150, cx = size / 2, cy = size / 2, radius = 54;
    const total = Math.max(parts.reduce((sum, p) => sum + (p.value || 0), 0), 1);
    const circumference = 2 * Math.PI * radius;

    const svg = el("svg", {
      viewBox: `0 0 ${size} ${size}`,
      width: size,
      height: size,
      class: "health-donut"
    });

    let offset = 0;
    parts.forEach((part, idx) => {
      const sliceFrac = (part.value || 0) / total;
      const dashLength = sliceFrac * circumference;
      const gapLength = circumference;

      const slice = el("circle", {
        cx, cy, r: radius,
        fill: "none",
        stroke: part.color || "#00e5ff",
        "stroke-width": "18",
        "stroke-dasharray": `${dashLength} ${gapLength}`,
        "stroke-dashoffset": -offset,
        transform: `rotate(-90 ${cx} ${cy})`,
        class: "pie-slice",
        tabindex: "0",
        role: "button",
        "aria-label": `${part.label}: ${part.value}`
      });

      // Hover and click interaction
      slice.style.transition = "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)";
      slice.addEventListener("click", (e) => {
        e.stopPropagation();
        if (typeof onSelect === "function") onSelect(part, parts);
      });

      slice.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (typeof onSelect === "function") onSelect(part, parts);
        }
      });

      svg.appendChild(slice);
      offset += dashLength;
    });

    // Center total readout
    const totalText = el("text", {
      x: cx, y: cy + 2,
      "text-anchor": "middle",
      "font-size": "22",
      "font-family": "Rajdhani, -apple-system, sans-serif",
      "font-weight": "700",
      fill: "var(--text-primary)"
    }, total.toString());
    svg.appendChild(totalText);

    const subText = el("text", {
      x: cx, y: cy + 18,
      "text-anchor": "middle",
      "font-size": "9",
      "font-family": "Inter, -apple-system, sans-serif",
      "font-weight": "600",
      "letter-spacing": "1px",
      fill: "var(--text-tertiary)"
    }, "METRICS");
    svg.appendChild(subText);

    // Clicking center also triggers select
    svg.style.cursor = "pointer";
    svg.addEventListener("click", () => {
      if (typeof onSelect === "function") onSelect(parts[0], parts);
    });

    container.innerHTML = "";
    container.appendChild(svg);
  }

  /**
   * Multi-series SVG trend chart with neon grid and points.
   */
  function trendChart(container, opts) {
    if (!container) return;

    const {
      width = 600, height = 180,
      series = [], yMin, yMax, xLabels = []
    } = opts;

    const padL = 36, padR = 14, padT = 16, padB = 26;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const allVals = series.flatMap(s => s.data).filter(Number.isFinite);
    if (!allVals.length) {
      container.innerHTML = '<p class="trend-empty-note">Waiting for telemetry history</p>';
      return;
    }

    const min = yMin !== undefined ? yMin : Math.min(...allVals);
    const max = yMax !== undefined ? yMax : Math.max(...allVals);
    const span = (max - min) || 1;

    const svg = el("svg", {
      viewBox: `0 0 ${width} ${height}`,
      width: "100%",
      height
    });

    // Horizontal gridlines
    const gridLines = 4;
    for (let i = 0; i <= gridLines; i++) {
      const y = padT + (plotH / gridLines) * i;
      svg.appendChild(el("line", {
        x1: padL, y1: y, x2: width - padR, y2: y,
        stroke: "rgba(255, 255, 255, 0.07)", "stroke-width": 1
      }));
      const val = max - (span / gridLines) * i;
      const label = el("text", {
        x: padL - 8, y: y + 3.5, "text-anchor": "end",
        "font-family": "Inter, sans-serif", "font-size": "9.5",
        fill: "var(--text-tertiary)"
      }, val.toFixed(1));
      svg.appendChild(label);
    }

    const n = Math.max(...series.map(s => s.data.length), 0);
    const stepX = n > 1 ? plotW / (n - 1) : plotW / 2;

    series.forEach((s) => {
      if (!s.data.length) return;
      const points = s.data.map((v, i) => {
        const x = padL + stepX * i;
        const y = padT + plotH - ((v - min) / span) * plotH;
        return `${x},${y}`;
      });

      // Glowing stroke
      svg.appendChild(el("polyline", {
        points: points.join(" "),
        fill: "none",
        stroke: s.color || "#00e5ff",
        "stroke-width": "2.2",
        "stroke-linejoin": "round",
        "stroke-linecap": "round",
        style: `filter: drop-shadow(0 0 5px ${s.color || '#00e5ff'});`
      }));

      // Data dots
      s.data.forEach((v, i) => {
        const x = padL + stepX * i;
        const y = padT + plotH - ((v - min) / span) * plotH;
        svg.appendChild(el("circle", {
          cx: x, cy: y, r: "2.8",
          fill: "#ffffff",
          stroke: s.color || "#00e5ff",
          "stroke-width": "1.5"
        }));
      });
    });

    // X labels
    if (xLabels.length) {
      const showIdx = [0, Math.floor((xLabels.length - 1) / 2), xLabels.length - 1];
      showIdx.forEach((i) => {
        if (xLabels[i] === undefined) return;
        const x = padL + stepX * i;
        svg.appendChild(el("text", {
          x, y: height - 6,
          "text-anchor": i === 0 ? "start" : (i === xLabels.length - 1 ? "end" : "middle"),
          "font-family": "Inter, sans-serif", "font-size": "9.5",
          fill: "var(--text-tertiary)"
        }, xLabels[i]));
      });
    }

    container.innerHTML = "";
    container.appendChild(svg);
  }

  return { radialGauge, donutChart, trendChart, statusFor, STATUS_COLOR };
})();
