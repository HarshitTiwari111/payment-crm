/*
 * Chart.js wrapper.
 *
 * Axis and grid colours are read from the CSS theme tokens at render time and the
 * charts are keyed on the theme, so switching to dark mode redraws them properly
 * instead of leaving dark-grey text on a dark panel.
 */
import React from "react";
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, PointElement,
  LineElement, Title, Tooltip, Legend, Filler, ArcElement,
} from "chart.js";
import { Bar, Line, Doughnut } from "react-chartjs-2";
import { useTheme } from "../context/ThemeContext";

ChartJS.register(
  CategoryScale, LinearScale, BarElement, PointElement, LineElement,
  Title, Tooltip, Legend, Filler, ArcElement
);

function tokens() {
  const cs = getComputedStyle(document.documentElement);
  const get = (n, fallback) => (cs.getPropertyValue(n) || "").trim() || fallback;
  return {
    text: get("--muted", "#6b7280"),
    grid: get("--grid-line", "#eceef2"),
    panel: get("--panel", "#ffffff"),
  };
}

export const chartOpts = (extra = {}) => {
  const t = tokens();
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { labels: { boxWidth: 12, font: { size: 11 }, color: t.text } },
      tooltip: { padding: 10, boxPadding: 4 },
    },
    scales: {
      x: { grid: { display: false }, ticks: { font: { size: 11 }, color: t.text } },
      y: { grid: { color: t.grid }, ticks: { font: { size: 11 }, color: t.text } },
    },
    ...extra,
  };
};

export const ds = (label, data, color, filled = false) => ({
  label,
  data,
  backgroundColor: filled ? color : color + "33",
  borderColor: color,
  borderWidth: 2,
  borderRadius: 5,
  tension: 0.3,
  pointRadius: 2,
});

export function BarChart({ labels, datasets, height = 260, options }) {
  const { theme } = useTheme();
  return (
    <div className="chartbox" style={{ height }}>
      <Bar key={theme} data={{ labels, datasets }} options={chartOpts(options)} />
    </div>
  );
}

export function LineChart({ labels, datasets, height = 260, options }) {
  const { theme } = useTheme();
  return (
    <div className="chartbox" style={{ height }}>
      <Line key={theme} data={{ labels, datasets }} options={chartOpts(options)} />
    </div>
  );
}

export function DonutChart({ labels, data, colors, height = 260 }) {
  const { theme } = useTheme();
  const t = tokens();
  return (
    <div className="chartbox" style={{ height }}>
      <Doughnut
        key={theme}
        data={{ labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0 }] }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: "right", labels: { boxWidth: 12, font: { size: 11 }, color: t.text } } },
        }}
      />
    </div>
  );
}
