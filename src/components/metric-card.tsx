type MetricCardProps = {
  label: string;
  value: string;
  detail: string;
  tone?: "default" | "positive" | "warning";
};

export function MetricCard({ label, value, detail, tone = "default" }: MetricCardProps) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <p className="eyebrow">{label}</p>
      <strong className="metric-value">{value}</strong>
      <p className="metric-detail">{detail}</p>
    </article>
  );
}
