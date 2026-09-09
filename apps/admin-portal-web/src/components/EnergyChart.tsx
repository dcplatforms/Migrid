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

ChartJS.defaults.color = "rgba(226, 232, 240, 0.72)";
ChartJS.defaults.font.family =
  '"Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif';

interface EnergyChartProps {
  totalLoad: number;
  limit: number;
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

export const EnergyChart = ({ totalLoad, limit }: EnergyChartProps) => {
  const { labels, data } = generateChartData(totalLoad);

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
        ticks: { maxTicksLimit: 6, color: "rgba(148, 163, 184, 0.8)" },
        border: { color: "rgba(255, 255, 255, 0.10)" },
      },
      y: {
        beginAtZero: true,
        max: limit * 1.2,
        grid: { color: "rgba(255, 255, 255, 0.06)" },
        border: { display: false },
        ticks: { color: "rgba(148, 163, 184, 0.8)" },
        title: {
          display: true,
          text: "Power (kW)",
          color: "rgba(148, 163, 184, 0.9)",
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
          color: "rgba(226, 232, 240, 0.85)",
        },
      },
      tooltip: {
        backgroundColor: "rgba(9, 13, 22, 0.92)",
        borderColor: "rgba(255, 255, 255, 0.12)",
        borderWidth: 1,
        padding: 12,
        cornerRadius: 10,
        titleColor: "#e2e8f0",
        bodyColor: "#cbd5e1",
      },
    },
  };

  return (
    <div style={{ height: "320px" }}>
      <Line options={options} data={chartData} />
    </div>
  );
};
