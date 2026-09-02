import { useRef, useState } from "react";

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
        {item.carriedForward && (
          <div className="metadata-row">
            <dt>Status</dt>
            <dd className="metadata-copy">Carried forward from a previous issue; updated here rather than presented as new.</dd>
          </div>
        )}
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

export function Issue({ issue }) {
  const sourceDialog = useRef(null);

  const openSourceLog = () => sourceDialog.current?.showModal();
  const closeSourceLog = () => sourceDialog.current?.close();

  return (
    <main className="page-shell">
      <div className="digest">
        <header className="masthead">
          <p className="publication-name">BENEFITS SIGNAL</p>
          <p className="publication-subtitle">Health &amp; Welfare Regulatory Brief</p>
          <p className="issue-date">{issue.issueDate}</p>
          <p className="issue-summary">{issue.issueSummary}</p>
        </header>

        <section className="development-list" aria-label="Regulatory developments">
          {issue.developments.map((item, index) => (
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
          {issue.sourceLog.map((entry) => (
            <div className="source-table-row" role="row" key={`${entry.source}-${entry.scan}-${entry.result}`}>
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
