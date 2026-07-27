"use client";

import { useState } from "react";
import type { PartnerRosterEntry } from "@/lib/partners";
import type { PartnerSubmission, ProcessedFile } from "@/lib/types";

type Props = {
  entry: PartnerRosterEntry;
  configured: boolean;
  submission: PartnerSubmission | null;
  files: ProcessedFile[];
  busy: boolean;
  onSubmit: () => void;
  onSendDocuments: () => void;
  onProcess: (consentAccepted: boolean) => void;
  onDownload: (file: ProcessedFile) => void;
};

export function PartnerActionCard({
  entry,
  configured,
  submission,
  files,
  busy,
  onSubmit,
  onSendDocuments,
  onProcess,
  onDownload,
}: Props) {
  const [consent, setConsent] = useState(false);
  const status = submission?.status ?? "draft";

  const isThreeStep = entry.steps.length === 3;
  const canSubmit = !entry.apiReady ? false : status === "draft" || status === "error";
  const canSendDocs =
    entry.apiReady && (status === "submitted" || status === "docs_sent") && files.length > 0;
  const canProcess = entry.apiReady && isThreeStep && status === "docs_sent" && consent;

  return (
    <article className="partner-card">
      <div className="partner-card-header">
        <h3>{entry.label}</h3>
        {!entry.apiReady && <span className="config-badge">Coming soon</span>}
        {entry.apiReady && !configured && <span className="config-badge">Not configured</span>}
        {submission && <span className={`partner-status-pill status-${status}`}>{status.replace("_", " ")}</span>}
      </div>

      {!entry.apiReady && (
        <p className="aquamark-hint">Awaiting API documentation from the client — not available yet.</p>
      )}
      {entry.apiReady && !configured && (
        <p className="aquamark-hint">
          Credentials for {entry.label} are not set on this server yet. Buttons stay disabled until
          they are.
        </p>
      )}

      {submission?.external_id && (
        <p className="partner-external-id">Reference: <strong>{submission.external_id}</strong></p>
      )}
      {submission?.last_error && <p className="partner-error-text">{submission.last_error}</p>}

      {files.length > 0 && (
        <ul className="aquamark-file-list">
          {files.map((f) => (
            <li key={f.name} className="aquamark-file-item">
              <span className="file-icon">PDF</span>
              <span className="file-meta">
                <strong>{f.name}</strong>
              </span>
              <button type="button" className="btn btn-secondary btn-xs" onClick={() => onDownload(f)}>
                Download
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="partner-card-actions">
        <button
          type="button"
          className="btn btn-primary btn-xs"
          disabled={!canSubmit || busy}
          onClick={onSubmit}
          title={!entry.apiReady ? "Awaiting API documentation from the client." : undefined}
        >
          {entry.steps[0]}
        </button>
        {entry.steps[1] && (
          <button
            type="button"
            className="btn btn-secondary btn-xs"
            disabled={!canSendDocs || busy}
            onClick={onSendDocuments}
            title={!entry.apiReady ? "Awaiting API documentation from the client." : undefined}
          >
            {entry.steps[1]}
          </button>
        )}
        {entry.steps[2] && isThreeStep && (
          <>
            <label className="partner-consent-check">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                disabled={status !== "docs_sent"}
              />
              Consent to pull credit &amp; process
            </label>
            <button
              type="button"
              className="btn btn-secondary btn-xs"
              disabled={!canProcess || busy}
              onClick={() => onProcess(consent)}
            >
              {entry.steps[2]}
            </button>
          </>
        )}
        {entry.steps[2] && !isThreeStep && (
          <button type="button" className="btn btn-secondary btn-xs" disabled title="Not available for this partner.">
            {entry.steps[2]}
          </button>
        )}
      </div>
    </article>
  );
}
