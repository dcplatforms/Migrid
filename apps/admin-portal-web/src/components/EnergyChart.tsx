import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  TimeSeriesScale,
  type ScriptableContext,
} from "chart.js";
import "chartjs-adapter-date-fns";
import { useThemeMode } from "../theme/ThemeContext";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
  TimeSeriesScale
);

ChartJS.defaults.font.family =
  '"Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif';

export interface ChartPoint {
  t: string;
  totalLoadKw: number;
}

interface EnergyChartProps {
  totalLoad: number;
  limit: number;
  points?: ChartPoint[];
}

const generateChartData = (currentLoad: number) => {
  const labels: Date[] = [];
  const data: number[] = [];
  const now = new Date();
  for (let i = 22; i >= 0; i--) {
    labels.push(new Date(now.getTime() - i * 5000));
    const wave = Math.sin(i / 2.4) * 14;
    data.push(
      Math.max(0, currentLoad - wave - Math.random() * 8 - i * 0.6)
    );
  }
  return { labels, data };
};

export const EnergyChart = ({ totalLoad, limit, points }: EnergyChartProps) => {
  const { mode } = useThemeMode();
  const dark = mode === "dark";
  const c = {
    text: dark ? "rgba(226, 232, 240, 0.85)" : "rgba(30, 41, 59, 0.9)",
    axis: dark ? "rgba(148, 163, 184, 0.8)" : "rgba(71, 85, 105, 0.85)",
    grid: dark ? "rgba(255, 255, 255, 0.06)" : "rgba(15, 23, 42, 0.08)",
    border: dark ? "rgba(255, 255, 255, 0.10)" : "rgba(15, 23, 42, 0.12)",
    tooltipBg: dark ? "rgba(9, 13, 22, 0.92)" : "rgba(255, 255, 255, 0.96)",
    tooltipBorder: dark ? "rgba(255, 255, 255, 0.12)" : "rgba(15, 23, 42, 0.12)",
    tooltipTitle: dark ? "#e2e8f0" : "#0f172a",
    tooltipBody: dark ? "#cbd5e1" : "#334155",
  };

  const live =
    points && points.length > 0
      ? {
          labels: points.map((p) => new Date(p.t)),
          data: points.map((p) => p.totalLoadKw),
        }
      : null;
  const { labels, data } = live ?? generateChartData(totalLoad);

  const chartData = {
    labels,
    datasets: [
      {
        label: "Total Site Load (kW)",
        data,
        borderColor: "#34d399",
        borderWidth: 2.5,
        tension: 0.4,
        pointStyle: false as const,
        fill: true,
        backgroundColor: (ctx: ScriptableContext<"line">) => {
          const { chart } = ctx;
          const { ctx: c, chartArea } = chart;
          if (!chartArea) return "rgba(52, 211, 153, 0.18)";
          const g = c.createLinearGradient(
            0,
            chartArea.top,
            0,
            chartArea.bottom
          );
          g.addColorStop(0, "rgba(52, 211, 153, 0.42)");
          g.addColorStop(1, "rgba(52, 211, 153, 0.02)");
          return g;
        },
      },
      {
        label: "Grid Connection Limit (kW)",
        data: Array(labels.length).fill(limit),
        borderColor: "#f87171",
        borderWidth: 1.5,
        borderDash: [6, 6],
        pointStyle: false as const,
        fill: false,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index" as const, intersect: false },
    scales: {
      x: {
        type: "timeseries" as const,
        time: {
          unit: "second" as const,
          displayFormats: { second: "h:mm:ss a" },
        },
        grid: { display: false },
        ticks: { maxTicksLimit: 6, color: c.axis },
        border: { color: c.border },
      },
      y: {
        beginAtZero: true,
        max: limit * 1.2,
        grid: { color: c.grid },
        border: { display: false },
        ticks: { color: c.axis },
        title: {
          display: true,
          text: "Power (kW)",
          color: c.axis,
        },
      },
    },
    plugins: {
      legend: {
        position: "top" as const,
        align: "end" as const,
        labels: {
          usePointStyle: true,
          pointStyle: "circle",
          boxWidth: 8,
          padding: 16,
          color: c.text,
        },
      },
      tooltip: {
        backgroundColor: c.tooltipBg,
        borderColor: c.tooltipBorder,
        borderWidth: 1,
        padding: 12,
        cornerRadius: 10,
        titleColor: c.tooltipTitle,
        bodyColor: c.tooltipBody,
      },
    },
  };

  return (
    <div style={{ height: "320px" }}>
      <Line options={options} data={chartData} />
    </div>
  );
};
