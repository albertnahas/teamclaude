import type { SprintRecord } from "./analytics.js";

interface VelocityOptions {
  width?: number;
  height?: number;
}

const PADDING = { top: 24, right: 16, bottom: 36, left: 44 };

function barColor(rate: number): string {
  if (rate >= 80) return "#22c55e"; // green
  if (rate >= 50) return "#eab308"; // yellow
  return "#ef4444";                 // red
}

function noDataSvg(width: number, height: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#f8fafc" rx="6"/>
  <text x="${width / 2}" y="${height / 2 + 5}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" fill="#94a3b8">No sprint data yet</text>
</svg>`;
}

export function generateVelocitySvg(
  records: SprintRecord[],
  options: VelocityOptions = {}
): string {
  const width = options.width ?? 600;
  const height = options.height ?? 200;

  if (!records.length) return noDataSvg(width, height);

  const chartW = width - PADDING.left - PADDING.right;
  const chartH = height - PADDING.top - PADDING.bottom;

  const n = records.length;
  const barGap = Math.max(2, Math.floor(chartW / n / 6));
  const barW = Math.max(4, Math.floor(chartW / n) - barGap);

  // Y-axis: 0-100%
  const yScale = (rate: number) => chartH - (rate / 100) * chartH;

  // Dashed line: avgReviewRoundsPerTask scaled to 0-100 by assuming max ~5 rounds
  const MAX_ROUNDS = 5;
  const roundsScale = (r: number) => chartH - Math.min(r / MAX_ROUNDS, 1) * chartH;

  const computeRate = (rec: SprintRecord) =>
    rec.totalTasks > 0 ? Math.round((rec.completedTasks / rec.totalTasks) * 100) : 0;
  const latestRate = computeRate(records[n - 1]);

  // Build bar elements
  const bars = records.map((rec, i) => {
    const rate = computeRate(rec);
    const x = PADDING.left + i * (barW + barGap) + Math.floor(barGap / 2);
    const barH = Math.max(1, (rate / 100) * chartH);
    const y = PADDING.top + chartH - barH;
    const color = barColor(rate);

    // X-axis label: sprint index
    const label = String(i + 1);
    const labelX = x + barW / 2;
    const labelY = height - PADDING.bottom + 14;

    return [
      `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${color}" rx="2"/>`,
      `<text x="${labelX}" y="${labelY}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10" fill="#64748b">${label}</text>`,
    ].join("\n  ");
  }).join("\n  ");

  // Dashed review-rounds line
  const linePoints = records.map((rec, i) => {
    const x = PADDING.left + i * (barW + barGap) + Math.floor(barGap / 2) + barW / 2;
    const y = PADDING.top + roundsScale(rec.avgReviewRoundsPerTask ?? 0);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  const roundsLine = n > 1
    ? `<polyline points="${linePoints}" fill="none" stroke="#6366f1" stroke-width="1.5" stroke-dasharray="4 3" opacity="0.7"/>`
    : "";

  // Y-axis ticks: 0%, 50%, 100%
  const yTicks = [0, 50, 100].map((pct) => {
    const y = PADDING.top + yScale(pct);
    return [
      `<line x1="${PADDING.left - 4}" y1="${y}" x2="${PADDING.left + chartW}" y2="${y}" stroke="#e2e8f0" stroke-width="1"/>`,
      `<text x="${PADDING.left - 6}" y="${y + 4}" text-anchor="end" font-family="system-ui,sans-serif" font-size="9" fill="#94a3b8">${pct}%</text>`,
    ].join("\n  ");
  }).join("\n  ");

  // Summary labels (top-right)
  const labelText = [
    `Sprints: ${n}`,
    `Latest: ${latestRate}%`,
  ];
  const summaryLabels = labelText.map((text, i) =>
    `<text x="${width - PADDING.right}" y="${PADDING.top + i * 13}" text-anchor="end" font-family="system-ui,sans-serif" font-size="10" fill="#64748b">${text}</text>`
  ).join("\n  ");

  // Legend
  const legendY = height - 8;
  const legend = `<circle cx="${PADDING.left + 6}" cy="${legendY}" r="4" fill="#22c55e"/>
  <text x="${PADDING.left + 13}" y="${legendY + 4}" font-family="system-ui,sans-serif" font-size="9" fill="#64748b">≥80%</text>
  <circle cx="${PADDING.left + 48}" cy="${legendY}" r="4" fill="#eab308"/>
  <text x="${PADDING.left + 55}" y="${legendY + 4}" font-family="system-ui,sans-serif" font-size="9" fill="#64748b">≥50%</text>
  <circle cx="${PADDING.left + 90}" cy="${legendY}" r="4" fill="#ef4444"/>
  <text x="${PADDING.left + 97}" y="${legendY + 4}" font-family="system-ui,sans-serif" font-size="9" fill="#64748b">&lt;50%</text>
  <line x1="${PADDING.left + 128}" y1="${legendY}" x2="${PADDING.left + 144}" y2="${legendY}" stroke="#6366f1" stroke-width="1.5" stroke-dasharray="4 3"/>
  <text x="${PADDING.left + 147}" y="${legendY + 4}" font-family="system-ui,sans-serif" font-size="9" fill="#64748b">Review rounds</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#f8fafc" rx="6"/>
  ${yTicks}
  <line x1="${PADDING.left}" y1="${PADDING.top}" x2="${PADDING.left}" y2="${PADDING.top + chartH}" stroke="#cbd5e1" stroke-width="1"/>
  ${bars}
  ${roundsLine}
  ${summaryLabels}
  ${legend}
</svg>`;
}
