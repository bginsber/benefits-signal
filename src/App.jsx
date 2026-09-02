import { useEffect, useState } from "react";
import { Issue } from "./Issue.jsx";

// The issue is data, not code: scripts/publish.mjs writes public/issue.json in the
// shape spec/issue-schema.json describes, and the page renders whatever it finds.
const ISSUE_URL = `${import.meta.env.BASE_URL}issue.json`;

export function App() {
  const [issue, setIssue] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetch(ISSUE_URL, { headers: { accept: "application/json" } })
      .then((response) => {
        if (!response.ok) throw new Error(`issue.json returned ${response.status}`);
        return response.json();
      })
      .then((data) => { if (!cancelled) setIssue(data); })
      .catch((err) => { if (!cancelled) setError(err); });
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return (
      <main className="page-shell">
        <div className="digest">
          <header className="masthead">
            <p className="publication-name">BENEFITS SIGNAL</p>
            <p className="publication-subtitle">Health &amp; Welfare Regulatory Brief</p>
            <p className="issue-summary">This issue could not be loaded.</p>
          </header>
        </div>
      </main>
    );
  }
  if (!issue) return null;
  return <Issue issue={issue} />;
}
