import { useRef, useState } from "react";

const developments = [
  {
    id: "cybersecurity-program",
    lane: "NOW",
    cue: "Attorney review",
    headline: "DOL proposes cybersecurity program requirements for employee benefit plans",
    status: "Proposed · Comments due September 30",
    summary: [
      "Would require plans to adopt, document, and annually review a written cybersecurity program and report certain incidents to DOL within 72 hours.",
      "The proposal would reach health and welfare plans, including multiemployer funds and their service providers, creating new governance, vendor, and breach-notification duties.",
    ],
    metadata: {
      "Plan type": ["Health & welfare", "Multiemployer"],
      Jurisdiction: ["Federal"],
      Topics: ["Cybersecurity", "Service providers", "Fiduciary process"],
      Confidence: ["High"],
    },
    confidenceNote: "The legal status and comment date were confirmed against the primary material.",
    scan: "Cybersecurity & Privacy",
    affected: "Multiemployer health and welfare plans and their service providers",
    action: "Confirm whether existing governance and vendor-review materials would need revision.",
    timing: "Attorney assessment before the comment deadline",
    mergedSources: ["EBIA Weekly", "Word on Benefits", "DOL/EBSA primary feed"],
    nextStep: "Prepare internal research assignment",
    completion: "Research assignment prepared for attorney review.",
    passage: "Plans would be expected to maintain a documented program proportionate to their systems, data, and service-provider relationships.",
    articleLabel: "EBIA Weekly analysis",
    articleUrl: "https://tax.thomsonreuters.com/en/checkpoint/ebia",
    authorityLabel: "DOL Employee Benefits Security Administration",
    authorityUrl: "https://www.dol.gov/agencies/ebsa",
  },
  {
    id: "aca-reporting",
    lane: "NEXT",
    cue: "September 30, 2026",
    headline: "ACA Forms 1094/1095 reporting deadline",
    status: "Deadline · September 30",
    summary: [
      "Applicable large employers and self-funded plans must file Forms 1094-C and 1095-C with the IRS and furnish statements to individuals.",
    ],
    metadata: {
      "Plan type": ["Health & welfare", "Self-funded"],
      Jurisdiction: ["Federal"],
      Topics: ["ACA", "Reporting", "IRS"],
      Confidence: ["High"],
    },
    confidenceNote: "The date and filing requirement were matched to current IRS instructions.",
    scan: "Federal Health & Welfare",
    affected: "Applicable large employers and self-funded health plans",
    action: "Confirm the filing calendar and responsible service provider.",
    timing: "Before September 30",
    mergedSources: ["Mercer Law & Policy Group", "Segal Compliance News", "IRS primary feed"],
    nextStep: "Add deadline to review queue",
    completion: "Deadline review item prepared for paralegal confirmation.",
    passage: "The filing obligation applies to applicable large employers and providers of minimum essential coverage, subject to the governing instructions.",
    articleLabel: "Mercer Law & Policy Group",
    articleUrl: "https://www.mercer.com/en-us/insights/law-and-policy/",
    authorityLabel: "IRS: About Form 1094-C",
    authorityUrl: "https://www.irs.gov/forms-pubs/about-form-1094-c",
  },
  {
    id: "mhpaea-review",
    lane: "WATCH",
    cue: "No action yet",
    headline: "Ninth Circuit to reconsider MHPAEA standard of review",
    status: "Decision pending · Briefing schedule not set",
    summary: [
      "The court granted rehearing en banc in a MHPAEA matter challenging application of the “de novo unless deferential” standard.",
    ],
    uncertainty: "Uncertain — the briefing schedule has not been set.",
    metadata: {
      "Plan type": ["Health & welfare"],
      Jurisdiction: ["Ninth Circuit"],
      Topics: ["MHPAEA", "Litigation", "Standard of review"],
      Confidence: ["Medium"],
    },
    confidenceNote: "The procedural development is clear, but its eventual effect on plan administration remains open.",
    scan: "California & Ninth Circuit",
    affected: "Health plans defending MHPAEA benefit determinations in the Ninth Circuit",
    action: "Monitor the briefing schedule and eventual standard articulated by the en banc court.",
    timing: "No operational change yet",
    mergedSources: ["Groom: In Brief", "Ninth Circuit primary feed"],
    nextStep: "Create monitoring follow-up",
    completion: "Monitoring follow-up prepared for attorney review.",
    passage: "The en banc court will reconsider the framework used to review the challenged mental-health benefit determination.",
    articleLabel: "Groom: In Brief",
    articleUrl: "https://www.groom.com/resources/",
    authorityLabel: "U.S. Court of Appeals for the Ninth Circuit",
    authorityUrl: "https://www.ca9.uscourts.gov/",
  },
];

const sourceLog = [
  { source: "DOL/EBSA primary feed", scan: "Cybersecurity & Privacy", result: "Verified", note: "Confirmed status and comment deadline for the NOW item." },
  { source: "EBIA Weekly", scan: "Cybersecurity & Privacy", result: "Kept", note: "Lead practical analysis supporting the NOW item." },
  { source: "Word on Benefits", scan: "Multiemployer & Taft-Hartley", result: "Merged", note: "Added plan-administration context to the same development." },
  { source: "IRS primary feed", scan: "Federal Health & Welfare", result: "Verified", note: "Confirmed filing requirement and operative date." },
  { source: "Mercer Law & Policy Group", scan: "Federal Health & Welfare", result: "Kept", note: "Best deadline treatment for the NEXT item." },
  { source: "Segal Compliance News", scan: "Federal Health & Welfare", result: "Merged", note: "Duplicate coverage retained as supporting evidence." },
  { source: "Ninth Circuit primary feed", scan: "California & Ninth Circuit", result: "Verified", note: "Confirmed the procedural posture of the WATCH item." },
  { source: "Groom", scan: "California & Ninth Circuit", result: "Kept", note: "Clearest explanation of the pending appellate issue." },
  { source: "Trucker Huss Benefits Report", scan: "California & Ninth Circuit", result: "Omitted", note: "No additional in-scope development in this illustrative issue." },
  { source: "Wagner Law Group Law Alerts", scan: "Federal Health & Welfare", result: "Omitted", note: "Items reviewed did not clear the relevance threshold." },
];

function Metadata({ item }) {
  const [prepared, setPrepared] = useState(false);

  return (
    <div className="briefing-detail">
      <div className="horizon-assessment">
        <p className="detail-label">Horizon assessment</p>
        <dl>
          <div>
            <dt>Who</dt>
            <dd>{item.affected}</dd>
          </div>
          <div>
            <dt>What</dt>
            <dd>{item.action}</dd>
          </div>
          <div>
            <dt>By when</dt>
            <dd>{item.timing}</dd>
          </div>
        </dl>
      </div>

      <dl className="metadata-list">
        <div className="metadata-row">
          <dt>Matched scan</dt>
          <dd><span className="tag">{item.scan}</span></dd>
        </div>
        {Object.entries(item.metadata).map(([label, values]) => (
          <div className="metadata-row" key={label}>
            <dt>{label}</dt>
            <dd>
              {values.map((value) => (
                <span className="tag" key={value}>{value}</span>
              ))}
            </dd>
          </div>
        ))}
        <div className="metadata-row">
          <dt>Merged evidence</dt>
          <dd className="metadata-copy">{item.mergedSources.join(" · ")}</dd>
        </div>
      </dl>

      <div className="confidence-note">
        <p className="detail-label">Confidence rationale</p>
        <p>{item.confidenceNote}</p>
      </div>

      <figure className="supporting-passage">
        <figcaption>Supporting passage</figcaption>
        <blockquote>“{item.passage}”</blockquote>
      </figure>

      <div className="evidence-links" aria-label="Evidence links">
        <a href={item.articleUrl} target="_blank" rel="noreferrer">{item.articleLabel}</a>
        <a href={item.authorityUrl} target="_blank" rel="noreferrer">{item.authorityLabel}</a>
      </div>

      <div className="next-step">
        <div>
          <p className="detail-label">Suggested next step</p>
          <p>{item.nextStep}. Nothing is sent or changed automatically.</p>
        </div>
        <button type="button" className="quiet-action" onClick={() => setPrepared(true)} disabled={prepared}>
          {prepared ? "Prepared" : item.nextStep}
        </button>
        {prepared && <p className="action-status" role="status">{item.completion}</p>}
      </div>
    </div>
  );
}

function Development({ item, featured = false }) {
  return (
    <article className={`development ${featured ? "development-featured" : ""}`} aria-labelledby={`${item.id}-title`}>
      <div className="lane-line">
        <span>{item.lane}</span>
        <span aria-hidden="true">·</span>
        <span className="lane-cue">{item.cue}</span>
      </div>

      <h2 id={`${item.id}-title`}>{item.headline}</h2>
      <p className="status-line">{item.status}</p>

      <div className="summary-copy">
        {item.summary.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      </div>

      {item.uncertainty && <p className="uncertainty">{item.uncertainty}</p>}

      <details className="briefing-disclosure">
        <summary>Read briefing and evidence</summary>
        <Metadata item={item} />
      </details>
    </article>
  );
}

export function App() {
  const sourceDialog = useRef(null);

  const openSourceLog = () => sourceDialog.current?.showModal();
  const closeSourceLog = () => sourceDialog.current?.close();

  return (
    <main className="page-shell">
      <div className="digest">
        <header className="masthead">
          <p className="publication-name">BENEFITS SIGNAL</p>
          <p className="publication-subtitle">Health &amp; Welfare Regulatory Brief</p>
          <p className="issue-date">Wednesday, August 26, 2026</p>
          <p className="issue-summary">Three developments worth your time. One needs a legal read.</p>
        </header>

        <section className="development-list" aria-label="Regulatory developments">
          {developments.map((item, index) => (
            <Development item={item} featured={index === 0} key={item.id} />
          ))}
        </section>

        <footer className="digest-footer">
          <p>
            Curated from EBIA Weekly, Mercer, Segal, Groom, Trucker Huss, Wagner Law Group,
            and <strong>Word on Benefits</strong> by the International Foundation of Employee Benefit Plans.
          </p>
          <button className="text-button" type="button" onClick={openSourceLog}>View source log</button>
          <p className="prototype-note">Illustrative pilot issue; development text is not legal advice.</p>
        </footer>
      </div>

      <dialog className="source-dialog" ref={sourceDialog} aria-labelledby="source-log-title">
        <div className="dialog-header">
          <div>
            <p className="dialog-kicker">Paralegal quality control</p>
            <h2 id="source-log-title">Source log</h2>
            <p>Seven publications and primary-authority feeds checked. The log preserves what the model verified, kept, merged, or omitted.</p>
          </div>
          <button className="close-button" type="button" onClick={closeSourceLog}>Close</button>
        </div>

        <div className="source-table" role="table" aria-label="Source review results">
          <div className="source-table-head" role="row">
            <span role="columnheader">Publication</span>
            <span role="columnheader">Matched scan</span>
            <span role="columnheader">Result</span>
            <span role="columnheader">Reason</span>
          </div>
          {sourceLog.map((entry) => (
            <div className="source-table-row" role="row" key={entry.source}>
              <span role="cell">{entry.source}</span>
              <span role="cell" className="scan-name">{entry.scan}</span>
              <span role="cell" className={`result result-${entry.result.toLowerCase()}`}>{entry.result}</span>
              <span role="cell">{entry.note}</span>
            </div>
          ))}
        </div>

        <div className="rubric-note">
          <h3>What the model checked</h3>
          <p>Who is affected, what may need to happen, by when, legal status, source support, duplication, and uncertainty. Every omission remains available for recall sampling.</p>
        </div>
      </dialog>
    </main>
  );
}
