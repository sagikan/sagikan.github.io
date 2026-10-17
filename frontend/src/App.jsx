
import { useEffect, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL;

function App() {
  const [status, setStatus] = useState("Checking API...");
  const [applications, setApplications] = useState([]);

  useEffect(() => {
    async function loadData() {
      try {
        const health = await fetch(`${API_URL}/api/health`);

        if (!health.ok) {
          throw new Error("API request failed");
        }

        const result = await health.json();
        setStatus(`API status: ${result.status}`);

        const response = await fetch(
          `${API_URL}/api/applications`
        );

        if (!response.ok) {
          throw new Error("Could not load applications");
        }

        setApplications(await response.json());
      } catch (error) {
        setStatus(`Connection error: ${error.message}`);
      }
    }

    loadData();
  }, []);

  return (
    <main>
      <h1>Job Tracker</h1>
      <p>{status}</p>
      <h2>My Applications</h2>
      {applications.length === 0
        ? <p>No applications yet.</p>
        : <ul>{applications.map((job) =>
            <li key={job.id}>{job.company} — {job.position}</li>
          )}</ul>}
    </main>
  );
}

export default App;
