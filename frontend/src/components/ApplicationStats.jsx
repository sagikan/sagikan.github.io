import { useMemo } from "react";
import { STATUSES } from "../api";
import { PulseChart, WorkMix } from "./StatCharts";

function ApplicationStats({ applications }) {
  const total = applications.length;

  const overall = useMemo(() => {
    const result = Object.fromEntries(STATUSES.map((status) => [status, 0]));
    applications.forEach((job) => {
      result[job.status] = (result[job.status] || 0) + 1;
    });
    return result;
  }, [applications]);

  const active = overall.Applied + overall.Interview;
  const responded = overall.Interview + overall.Offer + overall.Rejected;
  const responseRate = total ? Math.round((responded / total) * 100) : 0;

  const stats = [
    { label: "Total", value: total },
    { label: "In Progress", value: active },
    { label: "Response Rate", value: `${responseRate}%` }
  ];

  return (
    <>
      <section className="stats">
        {stats.map((stat) => (
          <div key={stat.label} className="stat-card">
            <span className="stat-label">{stat.label}</span>
            <strong className="stat-value">{stat.value}</strong>
          </div>
        ))}
        <PulseChart applications={applications} />
        <WorkMix applications={applications} />
      </section>

      {total > 0 && (
        <section className="pipeline" aria-label="Status breakdown">
          {STATUSES.filter((status) => overall[status] > 0).map((status) => (
            <span
              key={status}
              className={`pipeline-segment seg-${status.toLowerCase()}`}
              style={{ flexGrow: overall[status] }}
              title={`${status}: ${overall[status]}`}
            />
          ))}
        </section>
      )}
    </>
  );
}

export default ApplicationStats;
