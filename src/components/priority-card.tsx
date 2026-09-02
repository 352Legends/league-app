type PriorityCardProps = {
  rank: number;
  title: string;
  summary: string;
  impact: string;
  tag: string;
};

export function PriorityCard({ rank, title, summary, impact, tag }: PriorityCardProps) {
  return (
    <article className="priority-card">
      <div className="priority-rank">{rank}</div>
      <div className="priority-body">
        <div className="priority-meta">
          <span>{tag}</span>
          <strong>{impact}</strong>
        </div>
        <h3>{title}</h3>
        <p>{summary}</p>
      </div>
      <span className="priority-arrow" aria-hidden="true">↗</span>
    </article>
  );
}
