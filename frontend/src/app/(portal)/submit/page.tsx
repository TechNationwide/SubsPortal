"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PortalShell } from "@/components/PortalShell";
import { BrandSearchSelect } from "@/components/BrandSearchSelect";
import { FunderMultiSelect } from "@/components/FunderMultiSelect";
import { Modal } from "@/components/Modal";
import { api, downloadUrl } from "@/lib/api";
import type { Brand, Funder, ProcessedFile, Team } from "@/lib/types";

type EmailDraft = {
  from: string;
  to: string;
  cc: string;
  subject: string;
  body: string;
};

function lockedFunderIndices(funders: Funder[], brandIndex: number): number[] {
  return funders
    .map((funder, index) => ((funder.brands ?? []).includes(brandIndex) ? index : -1))
    .filter((index) => index >= 0);
}

function teamCcString(team: Team | null): string {
  if (!team) return "";
  return team.members
    .map((m) => m.email.trim())
    .filter(Boolean)
    .join(", ");
}

function mergeCcList(...parts: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    for (const email of part.split(/[,;]/).map((e) => e.trim()).filter(Boolean)) {
      const key = email.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(email);
      }
    }
  }
  return out.join(", ");
}

function funderCcEmails(funder: Funder | undefined): string[] {
  return (funder?.cc_members ?? []).map((m) => m.email.trim()).filter(Boolean);
}

function ccForFunder(funderName: string, selectedFunders: Funder[], teamCc: string): string {
  const funder = selectedFunders.find((f) => f.name === funderName);
  return mergeCcList(teamCc, funderCcEmails(funder).join(", "));
}

type CompressPreset = "light" | "balanced" | "aggressive" | "maximum";

type CompressResult = {
  ok: boolean;
  name: string;
  original_size: number;
  compressed_size: number;
  reduction_percent: number;
  download: string;
};

const COMPRESS_PRESETS: { id: CompressPreset; label: string; tag: string; detail: string }[] = [
  {
    id: "light",
    label: "Light",
    tag: "Minimal loss",
    detail: "85% JPEG quality. Virtually no visible loss, modest size savings.",
  },
  {
    id: "balanced",
    label: "Balanced",
    tag: "Recommended",
    detail: "75% JPEG quality. Sharp on screen and in email, noticeably smaller.",
  },
  {
    id: "aggressive",
    label: "Aggressive",
    tag: "Big wins",
    detail: "60% JPEG quality. Slight softness up close, bigger size savings.",
  },
  {
    id: "maximum",
    label: "Maximum",
    tag: "Smallest file",
    detail: "45% JPEG quality. Smallest output — visible softness in images.",
  },
];

function defaultEmailDraft(
  brand: Brand,
  deal: string,
  funderEmail: string,
  cc: string,
): EmailDraft {
  const dealLabel = deal.trim();
  return {
    from: brand.email || "",
    to: funderEmail,
    cc,
    subject: dealLabel ? `NEW DEAL - ${dealLabel}` : "NEW DEAL",
    body: "Please Underwrite",
  };
}

export default function SubmitDealPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [funders, setFunders] = useState<Funder[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [brandsLoading, setBrandsLoading] = useState(true);
  const [brandIndex, setBrandIndex] = useState<number | null>(null);
  const [selectedFunderIndices, setSelectedFunderIndices] = useState<number[]>([]);
  const [teamId, setTeamId] = useState("");
  const [dealName, setDealName] = useState("ABC Auto Repair LLC");
  const [files, setFiles] = useState<File[]>([]);
  const [results, setResults] = useState<ProcessedFile[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const jobIdRef = useRef<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [toast, setToast] = useState("");
  const [aquamarkError, setAquamarkError] = useState("");
  const [errorModalOpen, setErrorModalOpen] = useState(false);
  const [emailDrafts, setEmailDrafts] = useState<Record<string, EmailDraft>>({});
  const [sendingFunder, setSendingFunder] = useState<string | null>(null);
  const [bodyModalFunder, setBodyModalFunder] = useState<string | null>(null);
  const [bodyModalText, setBodyModalText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [compressModalFile, setCompressModalFile] = useState<ProcessedFile | null>(null);
  const [compressPreset, setCompressPreset] = useState<CompressPreset>("balanced");
  const [compressLoading, setCompressLoading] = useState(false);
  const [compressResult, setCompressResult] = useState<CompressResult | null>(null);
  const [batchPreset, setBatchPreset] = useState<CompressPreset>("balanced");
  const [batchCompressing, setBatchCompressing] = useState(false);

  useEffect(() => {
    jobIdRef.current = jobId;
  }, [jobId]);

  useEffect(() => {
    return () => {
      const id = jobIdRef.current;
      if (id) {
        void api.deleteAquamarkJob(id).catch(() => undefined);
      }
    };
  }, []);

  const cleanupJob = useCallback(async (id: string | null) => {
    if (!id) return;
    try {
      await api.deleteAquamarkJob(id);
    } catch {
      /* already removed */
    }
    if (jobIdRef.current === id) {
      jobIdRef.current = null;
      setJobId(null);
    }
  }, []);

  const load = useCallback(async () => {
    setBrandsLoading(true);
    try {
      const [brandsRes, fundersRes, teamsRes] = await Promise.all([
        api.getBrands(),
        api.getFunders(),
        api.getTeams(),
      ]);
      setBrands(brandsRes.data);
      setFunders(fundersRes.data);
      setTeams(teamsRes.data);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setBrandsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const brandFunderIndices = useMemo(
    () => (brandIndex !== null ? lockedFunderIndices(funders, brandIndex) : []),
    [funders, brandIndex],
  );

  useEffect(() => {
    void cleanupJob(jobIdRef.current);
    setResults([]);
    setEmailDrafts({});
    setSelectedFunderIndices([]);
    setJobId(null);
  }, [brandIndex, cleanupJob]);

  const selected = brandIndex !== null ? brands[brandIndex] : null;

  const selectedTeam = useMemo(
    () => teams.find((t) => t.id === teamId) ?? null,
    [teams, teamId],
  );

  const teamCc = useMemo(() => teamCcString(selectedTeam), [selectedTeam]);

  const brandFunders = useMemo(
    () => selectedFunderIndices.map((i) => funders[i]).filter(Boolean),
    [funders, selectedFunderIndices],
  );

  const step1Complete = dealName.trim().length > 0;
  const step2Complete =
    step1Complete && brandIndex !== null && selectedFunderIndices.length > 0;
  const outputCount =
    brandFunders.length > 0 && files.length > 0
      ? brandFunders.length * files.length
      : 0;

  const step3Enabled = step2Complete;

  const canProcess =
    step3Enabled &&
    Boolean(selected?.aquamark_email?.trim()) &&
    files.length > 0 &&
    brandFunders.length > 0 &&
    !processing;

  const resultsByFunder = useMemo(() => {
    const map = new Map<string, ProcessedFile[]>();
    for (const file of results) {
      const key = file.recipient?.trim() || "Unassigned";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(file);
    }

    const groups: { funder: string; files: ProcessedFile[] }[] = [];
    const seen = new Set<string>();

    for (const funder of brandFunders) {
      const funderFiles = map.get(funder.name);
      if (funderFiles?.length) {
        groups.push({ funder: funder.name, files: funderFiles });
        seen.add(funder.name);
      }
    }

    for (const [funder, funderFiles] of map) {
      if (!seen.has(funder)) {
        groups.push({ funder, files: funderFiles });
      }
    }

    return groups;
  }, [results, brandFunders]);

  useEffect(() => {
    if (!selected || !resultsByFunder.length) return;
    setEmailDrafts((prev) => {
      const next = { ...prev };
      for (const group of resultsByFunder) {
        const funderMeta = brandFunders.find((f) => f.name === group.funder);
        const to =
          funderMeta?.email ||
          group.files[0]?.recipient_email ||
          "";
        if (!next[group.funder]) {
          next[group.funder] = defaultEmailDraft(
            selected,
            dealName,
            to,
            ccForFunder(group.funder, brandFunders, teamCc),
          );
        } else {
          const subject = dealName.trim() ? `NEW DEAL - ${dealName.trim()}` : "NEW DEAL";
          next[group.funder] = {
            ...next[group.funder],
            from: next[group.funder].from || selected.email || "",
            to: next[group.funder].to || to,
            cc: ccForFunder(group.funder, brandFunders, teamCc),
            subject,
          };
        }
      }
      return next;
    });
  }, [resultsByFunder, selected, dealName, brandFunders, teamCc]);

  useEffect(() => {
    if (!Object.keys(emailDrafts).length) return;
    setEmailDrafts((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        next[key] = { ...next[key], cc: ccForFunder(key, brandFunders, teamCc) };
      }
      return next;
    });
  }, [teamCc, brandFunders]);

  function updateEmailDraft(funder: string, patch: Partial<EmailDraft>) {
    setEmailDrafts((prev) => ({
      ...prev,
      [funder]: { ...prev[funder], ...patch },
    }));
  }

  function openBodyModal(funder: string) {
    setBodyModalFunder(funder);
    setBodyModalText(emailDrafts[funder]?.body ?? "");
  }

  function closeBodyModal() {
    setBodyModalFunder(null);
    setBodyModalText("");
  }

  function saveBodyModal() {
    if (bodyModalFunder) {
      updateEmailDraft(bodyModalFunder, { body: bodyModalText });
      setToast(`Email body saved for ${bodyModalFunder}.`);
    }
    closeBodyModal();
  }

  async function downloadFile(downloadPath: string, filename: string) {
    const res = await fetch(downloadUrl(downloadPath));
    if (!res.ok) throw new Error("Download failed.");
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(objectUrl);
  }

  async function onDownload(file: ProcessedFile) {
    try {
      await downloadFile(file.download, file.name);
      setToast(`${file.name} downloaded.`);
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Download failed.");
    }
  }

  async function onRemoveResult(file: ProcessedFile) {
    try {
      await api.deleteProcessedFile(file.download);
    } catch {
      /* already removed */
    }
    setResults((prev) => {
      const next = prev.filter((f) => f.download !== file.download);
      if (next.length === 0) {
        void cleanupJob(jobIdRef.current);
      }
      return next;
    });
  }

  function openCompressModal(file: ProcessedFile) {
    setCompressModalFile(file);
    setCompressResult(null);
    setCompressPreset("balanced");
  }

  function closeCompressModal() {
    if (compressLoading) return;
    setCompressModalFile(null);
    setCompressResult(null);
  }

  function selectCompressPreset(preset: CompressPreset) {
    setCompressPreset(preset);
    setCompressResult(null);
  }

  async function runCompress() {
    const file = compressModalFile;
    const currentJobId = jobIdRef.current;
    if (!file || !currentJobId) return;
    setCompressLoading(true);
    setCompressResult(null);
    try {
      const originalFilename = file.download.split("/").pop() || file.name;
      const result = await api.compressProcessedFile(currentJobId, originalFilename, compressPreset);
      setCompressResult(result);
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Compression failed.");
    } finally {
      setCompressLoading(false);
    }
  }

  async function downloadCompressedCopy() {
    const file = compressModalFile;
    const result = compressResult;
    if (!file || !result) return;
    try {
      await downloadFile(result.download, file.name.replace(/\.pdf$/i, "_compressed.pdf"));
      // Scratch copy only — the deal still uses the original, so drop the
      // one-off compressed file from the server without touching it.
      await api.deleteProcessedFile(result.download).catch(() => undefined);
      setToast(`${file.name} compressed by ${result.reduction_percent}% and downloaded.`);
      setCompressModalFile(null);
      setCompressResult(null);
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Download failed.");
    }
  }

  async function useCompressedForDeal() {
    const file = compressModalFile;
    const result = compressResult;
    if (!file || !result) return;
    setResults((prev) =>
      prev.map((f) =>
        f.download === file.download
          ? { ...f, name: result.name, size: result.compressed_size, download: result.download, compressed: true }
          : f,
      ),
    );
    await api.deleteProcessedFile(file.download).catch(() => undefined);
    setToast(`${file.name} replaced with the compressed version (−${result.reduction_percent}%) for this deal.`);
    setCompressModalFile(null);
    setCompressResult(null);
  }

  async function compressAll() {
    const currentJobId = jobIdRef.current;
    const targets = results.filter((f) => !f.compressed);
    if (!currentJobId || targets.length === 0) return;

    setBatchCompressing(true);
    let successCount = 0;
    let reductionSum = 0;
    try {
      await Promise.all(
        targets.map(async (file) => {
          try {
            const filename = file.download.split("/").pop() || file.name;
            const result = await api.compressProcessedFile(currentJobId, filename, batchPreset);
            setResults((prev) =>
              prev.map((f) =>
                f.download === file.download
                  ? {
                      ...f,
                      name: result.name,
                      size: result.compressed_size,
                      download: result.download,
                      compressed: true,
                    }
                  : f,
              ),
            );
            await api.deleteProcessedFile(file.download).catch(() => undefined);
            successCount += 1;
            reductionSum += result.reduction_percent;
          } catch {
            /* leave this one as-is; summary below reflects the shortfall */
          }
        }),
      );
    } finally {
      setBatchCompressing(false);
    }

    if (successCount > 0) {
      const avg = Math.round(reductionSum / successCount);
      setToast(
        `Compressed ${successCount} file${successCount === 1 ? "" : "s"} for this deal (avg −${avg}%).`,
      );
    } else {
      setToast("Compression failed for all files.");
    }
  }

  async function onSendEmail(funder: string) {
    const draft = emailDrafts[funder];
    const group = resultsByFunder.find((g) => g.funder === funder);
    if (!draft?.to.trim()) {
      setToast("Add a To address before sending.");
      return;
    }
    if (!draft.from.trim()) {
      setToast("Brand submission email is missing. Set it in Brands setup.");
      return;
    }
    if (!group?.files.length) {
      setToast("No watermarked attachments to send.");
      return;
    }
    setSendingFunder(funder);
    setToast("");
    try {
      await api.sendDealEmail({
        from_email: draft.from.trim(),
        to: draft.to.trim(),
        cc: draft.cc,
        subject: draft.subject,
        body: draft.body,
        attachments: group.files.map((f) => f.download),
      });
      const sentPaths = new Set(group.files.map((f) => f.download));
      setResults((prev) => {
        const next = prev.filter((f) => !sentPaths.has(f.download));
        if (next.length === 0) {
          void cleanupJob(jobIdRef.current);
        }
        return next;
      });
      setToast(`Email sent to ${draft.to.trim()} from ${draft.from.trim()}. Attachments removed from server.`);
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Email send failed.");
    } finally {
      setSendingFunder(null);
    }
  }

  async function onProcess() {
    if (!canProcess || brandIndex === null) return;
    setProcessing(true);
    setToast("");
    try {
      await cleanupJob(jobIdRef.current);
      setResults([]);
      const form = new FormData();
      form.append("brand_name", brands[brandIndex].name);
      form.append("deal_name", dealName);
      form.append("aquamark_user_email", brands[brandIndex].aquamark_email.trim());
      form.append(
        "recipients",
        JSON.stringify(
          brandFunders.map((f) => ({
            name: f.name.trim(),
            email: f.email || "",
          })),
        ),
      );
      files.forEach((f) => form.append("files", f, f.name));

      const res = await api.processAquamark(form);
      setJobId(res.job_id);
      jobIdRef.current = res.job_id;
      setResults(res.files);
      setToast(
        `${res.files.length} file(s) watermarked and flattened via Aquamark (${files.length} PDF × ${brandFunders.length} funder${brandFunders.length === 1 ? "" : "s"}).`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Aquamark processing failed.";
      setAquamarkError(message);
      setErrorModalOpen(true);
    } finally {
      setProcessing(false);
    }
  }

  function processHint() {
    if (!step1Complete) return "Complete Step 1 first.";
    if (brandIndex === null) return "Select a brand to continue.";
    if (!selected?.aquamark_email?.trim()) {
      return "Set an Aquamark user email on this brand in Brands setup.";
    }
    if (!selectedFunderIndices.length) return "Select at least one funder in Step 2.";
    if (!files.length) return "Upload at least one PDF.";
    return "";
  }

  function addPdfFiles(incoming: File[]) {
    const pdfs = incoming.filter(
      (f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"),
    );
    if (!pdfs.length) {
      setToast("Only PDF files can be uploaded.");
      return;
    }
    setFiles((prev) => [...prev, ...pdfs]);
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function onUploadChange(e: React.ChangeEvent<HTMLInputElement>) {
    addPdfFiles(Array.from(e.target.files || []));
    e.target.value = "";
  }

  function onUploadDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    addPdfFiles(Array.from(e.dataTransfer.files));
  }

  return (
    <PortalShell
      title="Submit Deal"
      subtitle="Complete each step in order: deal name → brand → upload PDFs. Team CC is optional."
    >
      <div className="aquamark-flow">
        <section
          className={`card panel aquamark-step${step1Complete ? " aquamark-step--complete" : ""}`}
        >
          <div className="aquamark-step-label">Step 1</div>
          <div className="panel-header">
            <h2>Deal name</h2>
            <p className="panel-sub">
              Enter the deal name. Optionally select a team to auto-fill CC on outgoing emails.
            </p>
          </div>
          <div className="aquamark-step1-fields">
            <div className="field">
              <label htmlFor="dealName">Deal name</label>
              <input id="dealName" value={dealName} onChange={(e) => setDealName(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="teamSelect">Team (CC on emails, optional)</label>
              <select
                id="teamSelect"
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
              >
                <option value="">No team — skip CC</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {selectedTeam && (
            <div className="aquamark-team-cc-preview">
              <span className="aquamark-team-cc-label">CC recipients</span>
              {selectedTeam.members.filter((m) => m.email.trim()).length > 0 ? (
                <ul className="aquamark-team-cc-list">
                  {selectedTeam.members
                    .filter((m) => m.email.trim())
                    .map((m) => (
                      <li key={m.email}>
                        <strong>{m.name || m.email}</strong>
                        {m.name ? <small>{m.email}</small> : null}
                      </li>
                    ))}
                </ul>
              ) : (
                <p className="aquamark-hint">This team has no member emails. Add them in Teams setup.</p>
              )}
            </div>
          )}
        </section>

        <section
          className={`card panel aquamark-step${step2Complete ? " aquamark-step--complete" : ""}${!step1Complete ? " aquamark-step--locked" : ""}`}
        >
          <div className="aquamark-step-label">Step 2</div>
          <div className="panel-header">
            <h2>Brand & funders</h2>
            <p className="panel-sub">
              Select the brand, then pick which funders to include. Only funders assigned to the
              brand on the Funders page appear in the list.
            </p>
          </div>

          {!step1Complete ? (
            <div className="aquamark-step-lock-notice" role="status">
              <span className="aquamark-step-lock-icon" aria-hidden>
                🔒
              </span>
              <p>Enter a deal name in Step 1 to choose a brand and funders.</p>
            </div>
          ) : (
            <>
          <BrandSearchSelect
            brands={brands}
            selectedIndex={brandIndex}
            onSelect={setBrandIndex}
            loading={brandsLoading}
            hint={`${brands.length} brand${brands.length === 1 ? "" : "s"} available`}
          />

          {brandIndex !== null ? (
          <FunderMultiSelect
            funders={funders}
            selected={selectedFunderIndices}
            onChange={setSelectedFunderIndices}
            availableIndices={brandFunderIndices}
            hint={
              brandFunderIndices.length
                ? `${brandFunderIndices.length} funder${brandFunderIndices.length === 1 ? "" : "s"} apply to this brand`
                : "No funders apply to this brand"
            }
          />
          ) : (
            <p className="aquamark-hint">Select a brand above to choose funders.</p>
          )}

          {selected && brandFunderIndices.length === 0 && (
            <p className="aquamark-hint">
              No funders are assigned to {selected.name}. Add brand assignments on the Funders page.
            </p>
          )}

          {selected && brandFunders.length > 0 && (
            <div className="aquamark-recipients">
              <h3>Watermark attribution</h3>
              <p className="panel-sub">
                Each selected funder name is applied as recipient attribution on every watermarked PDF
                for <strong>{selected.name}</strong>.
              </p>
              {files.length > 0 && (
                <p className="aquamark-output-preview">
                  {outputCount} watermarked file{outputCount === 1 ? "" : "s"} will be generated (
                  {files.length} PDF × {brandFunders.length} funder
                  {brandFunders.length === 1 ? "" : "s"}).
                </p>
              )}
              <ul className="aquamark-recipient-list">
                {brandFunders.map((funder) => (
                  <li key={funder.name} className="aquamark-recipient-item">
                    <span className="aquamark-recipient-icon" aria-hidden>
                      ✉
                    </span>
                    <span className="aquamark-recipient-meta">
                      <strong>{funder.name}</strong>
                      <small>{funder.email || "No email configured"}</small>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {selected && brandFunderIndices.length > 0 && brandFunders.length === 0 && (
            <p className="aquamark-hint">Pick at least one funder from the list above.</p>
          )}

          {selected && (
            <p className="aquamark-hint aquamark-aquamark-note">
              Watermarking uses Aquamark account{" "}
              <strong>{selected.aquamark_email || "not configured"}</strong>. Set the logo for that
              account in the Aquamark dashboard.
            </p>
          )}
            </>
          )}
        </section>

        <section
          className={`card panel aquamark-step${files.length > 0 ? " aquamark-step--complete" : ""}${!step3Enabled ? " aquamark-step--locked" : ""}`}
        >
          <div className="aquamark-step-label">Step 3</div>
          <div className="panel-header">
            <h2>Deal PDFs</h2>
            <p className="panel-sub">Upload the application PDFs to watermark and flatten via Aquamark.</p>
          </div>

          {!step3Enabled ? (
            <div className="aquamark-step-lock-notice" role="status">
              <span className="aquamark-step-lock-icon" aria-hidden>
                🔒
              </span>
              <p>Select a brand and at least one funder in Step 2 before uploading deal PDFs.</p>
            </div>
          ) : (
            <>
          <label
            className={`upload-zone${dragOver ? " is-dragover" : ""}`}
            onDragEnter={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setDragOver(false);
              }
            }}
            onDrop={onUploadDrop}
          >
            <input
              type="file"
              accept="application/pdf,.pdf"
              multiple
              hidden
              onChange={onUploadChange}
            />
            <div className="upload-zone-inner">
              <span className="upload-zone-icon" aria-hidden>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="12" y1="18" x2="12" y2="12" />
                  <polyline points="9 15 12 12 15 15" />
                </svg>
              </span>
              <strong>Drop PDFs here or click to browse</strong>
              <small>PDF files only · multiple files supported</small>
              <span className="upload-zone-caption">
                Files are watermarked once per selected funder.
              </span>
            </div>
          </label>
          {files.length > 0 && (
            <ul className="aquamark-file-list">
              {files.map((f, i) => (
                <li key={`${f.name}-${i}`} className="aquamark-file-item">
                  <span className="file-icon">PDF</span>
                  <span className="file-meta">
                    <strong>{f.name}</strong>
                    <small>{(f.size / 1024).toFixed(1)} KB</small>
                  </span>
                  <button
                    type="button"
                    className="aquamark-file-remove"
                    onClick={() => removeFile(i)}
                    title={`Remove ${f.name}`}
                    aria-label={`Remove ${f.name}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="aquamark-actions">
            <button
              type="button"
              className="btn btn-aquamark"
              disabled={!canProcess}
              onClick={onProcess}
            >
              {processing ? "Processing…" : "Aquamark & Flatten"}
            </button>
            {!canProcess && !processing && processHint() && (
              <p className="aquamark-hint">{processHint()}</p>
            )}
          </div>
            </>
          )}
        </section>

        <section className="card panel aquamark-step aquamark-results">
          <div className="aquamark-results-header">
            <h2>Processed files</h2>
            {results.length > 0 && (
              <div className="aquamark-batch-actions">
                <select
                  className="aquamark-batch-preset"
                  value={batchPreset}
                  onChange={(e) => setBatchPreset(e.target.value as CompressPreset)}
                  disabled={batchCompressing}
                  aria-label="Batch compression preset"
                >
                  {COMPRESS_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-secondary btn-xs"
                  onClick={compressAll}
                  disabled={batchCompressing || results.every((f) => f.compressed)}
                >
                  {batchCompressing
                    ? "Compressing all…"
                    : `Compress all (${results.filter((f) => !f.compressed).length})`}
                </button>
              </div>
            )}
          </div>
          {results.length === 0 ? (
            <p className="aquamark-hint">
              Watermarked files stay here — pick Download for the original, or Compress to shrink
              it (with the option to use the compressed version for this deal&apos;s email). Files
              are only removed when you send the email, remove them manually, or leave this page.
            </p>
          ) : (
            <div className="aquamark-results-grid">
              {resultsByFunder.map((group) => (
                <div key={group.funder} className="aquamark-results-column">
                  <h3 className="aquamark-results-funder">{group.funder}</h3>
                  <ul className="aquamark-results-list">
                    {group.files.map((f) => (
                      <li key={f.name} className="aquamark-result-item">
                        <span className="file-icon success">✓</span>
                        <span className="file-meta">
                          <strong>{f.name}</strong>
                          <small>
                            {(f.size / 1024).toFixed(1)} KB
                            {f.compressed && <span className="aquamark-result-badge">Compressed</span>}
                          </small>
                        </span>
                        <div className="aquamark-result-actions">
                          <button
                            type="button"
                            className="btn btn-primary btn-xs"
                            disabled={batchCompressing}
                            onClick={() => onDownload(f)}
                          >
                            Download
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-xs"
                            disabled={batchCompressing}
                            onClick={() => openCompressModal(f)}
                          >
                            Compress…
                          </button>
                          <button
                            type="button"
                            className="aquamark-file-remove"
                            disabled={batchCompressing}
                            onClick={() => onRemoveResult(f)}
                            title={`Remove ${f.name} from this deal`}
                            aria-label={`Remove ${f.name} from this deal`}
                          >
                            ×
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>

        {results.length > 0 && (
          <section className="card panel aquamark-step aquamark-email-section">
            <div className="aquamark-step-label">Step 4</div>
            <div className="panel-header">
              <h2>Email preview</h2>
              <p className="panel-sub">
                One outgoing email per funder with watermarked PDF attachments. Emails are sent via
                SendGrid using the brand submission email as the From address.
              </p>
            </div>
            <div
              className={`aquamark-email-grid${
                resultsByFunder.length <= 3
                  ? ` aquamark-email-grid--${resultsByFunder.length}`
                  : " aquamark-email-grid--many"
              }`}
            >
              {resultsByFunder.map((group) => {
                const draft = emailDrafts[group.funder];
                if (!draft) return null;
                return (
                  <article key={group.funder} className="aquamark-email-card">
                    <h3 className="aquamark-email-funder">{group.funder}</h3>
                    <div className="aquamark-email-compose">
                      <div className="field">
                        <label htmlFor={`email-from-${group.funder}`}>From</label>
                        <input
                          id={`email-from-${group.funder}`}
                          type="email"
                          value={draft.from}
                          readOnly
                          title="Brand submission email (SendGrid sender)"
                          placeholder="brand@company.com"
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`email-to-${group.funder}`}>To</label>
                        <input
                          id={`email-to-${group.funder}`}
                          type="email"
                          value={draft.to}
                          onChange={(e) =>
                            updateEmailDraft(group.funder, { to: e.target.value })
                          }
                          placeholder="funder@company.com"
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`email-cc-${group.funder}`}>CC</label>
                        <input
                          id={`email-cc-${group.funder}`}
                          type="text"
                          value={draft.cc}
                          onChange={(e) =>
                            updateEmailDraft(group.funder, { cc: e.target.value })
                          }
                          placeholder="Team CC + funder CC contacts"
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`email-subject-${group.funder}`}>Subject</label>
                        <input
                          id={`email-subject-${group.funder}`}
                          type="text"
                          value={draft.subject}
                          onChange={(e) =>
                            updateEmailDraft(group.funder, { subject: e.target.value })
                          }
                        />
                      </div>
                      <div className="field">
                        <label htmlFor={`email-body-${group.funder}`}>Body</label>
                        <button
                          type="button"
                          id={`email-body-${group.funder}`}
                          className="aquamark-email-body-trigger"
                          onClick={() => openBodyModal(group.funder)}
                        >
                          {draft.body.trim() ? (
                            <span className="aquamark-email-body-preview">{draft.body}</span>
                          ) : (
                            <span className="aquamark-email-body-placeholder">
                              Click to edit email body…
                            </span>
                          )}
                        </button>
                      </div>
                      <div className="aquamark-email-attachments">
                        <span className="aquamark-email-attachments-label">Attachments</span>
                        <ul className="aquamark-email-attachment-list">
                          {group.files.map((f) => (
                            <li key={f.name}>{f.name}</li>
                          ))}
                          {selected?.app && <li>{selected.app}</li>}
                        </ul>
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary aquamark-email-send"
                        disabled={sendingFunder === group.funder}
                        onClick={() => onSendEmail(group.funder)}
                      >
                        {sendingFunder === group.funder ? "Sending…" : "Send email"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        )}
      </div>

      <Modal
        open={bodyModalFunder !== null}
        title={bodyModalFunder ? `Email body — ${bodyModalFunder}` : "Email body"}
        wide
        onClose={closeBodyModal}
        footer={
          <div className="modal-footer-right">
            <button type="button" className="btn btn-secondary" onClick={closeBodyModal}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={saveBodyModal}>
              Save
            </button>
          </div>
        }
      >
        <div className="field">
          <label htmlFor="emailBodyModalText">Message</label>
          <textarea
            id="emailBodyModalText"
            className="aquamark-email-body-modal-text"
            rows={12}
            value={bodyModalText}
            onChange={(e) => setBodyModalText(e.target.value)}
            placeholder="Please Underwrite"
            autoFocus
          />
        </div>
      </Modal>

      <Modal
        open={errorModalOpen}
        title="Aquamark error"
        onClose={() => setErrorModalOpen(false)}
        footer={
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setErrorModalOpen(false)}
          >
            Close
          </button>
        }
      >
        <p className="aquamark-error-lead">Aquamark could not process this submission.</p>
        <pre className="aquamark-error-detail">{aquamarkError}</pre>
      </Modal>

      <Modal
        open={compressModalFile !== null}
        title={compressModalFile ? `Compress — ${compressModalFile.name}` : "Compress"}
        wide
        onClose={closeCompressModal}
        footer={
          compressResult ? (
            <div className="modal-footer-right">
              <button type="button" className="btn btn-secondary" onClick={closeCompressModal}>
                Cancel
              </button>
              <button type="button" className="btn btn-secondary" onClick={downloadCompressedCopy}>
                Download compressed copy
              </button>
              <button type="button" className="btn btn-primary" onClick={useCompressedForDeal}>
                Use compressed for this deal
              </button>
            </div>
          ) : (
            <div className="modal-footer-right">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={closeCompressModal}
                disabled={compressLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={runCompress}
                disabled={compressLoading}
              >
                {compressLoading ? "Compressing…" : "Compress"}
              </button>
            </div>
          )
        }
      >
        {compressModalFile && (
          <div className="compress-file-summary">
            <span className="file-icon">PDF</span>
            <span className="file-meta">
              <strong>{compressModalFile.name}</strong>
              <small>{(compressModalFile.size / 1024).toFixed(1)} KB original</small>
            </span>
          </div>
        )}

        <p className="aquamark-hint">
          Pick a compression preset, then compress. Once you see the result, either download a
          one-off compressed copy (the deal keeps using the original for sending), or replace this
          file with the compressed version so Step 4 sends the smaller one.
        </p>

        <div className="compress-preset-grid">
          {COMPRESS_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`compress-preset-card${compressPreset === preset.id ? " active" : ""}`}
              disabled={compressLoading}
              onClick={() => selectCompressPreset(preset.id)}
            >
              <span className="compress-preset-tag">{preset.tag}</span>
              <strong className="compress-preset-name">{preset.label}</strong>
              <span className="compress-preset-detail">{preset.detail}</span>
            </button>
          ))}
        </div>

        {compressLoading && (
          <div className="compress-progress">
            <span className="compress-spinner" aria-hidden />
            <span>
              Compressing with the{" "}
              {COMPRESS_PRESETS.find((p) => p.id === compressPreset)?.label} preset…
            </span>
          </div>
        )}

        {compressResult && (
          <div className="compress-result">
            <div className="compress-result-sizes">
              <span>{(compressResult.original_size / 1024).toFixed(1)} KB</span>
              <span className="compress-result-arrow">→</span>
              <span className="compress-result-after">
                {(compressResult.compressed_size / 1024).toFixed(1)} KB
              </span>
            </div>
            <span className="compress-result-badge">−{compressResult.reduction_percent}%</span>
          </div>
        )}
      </Modal>

      {toast && (
        <div className="toast-container">
          <div className="toast success">
            <span>•</span>
            <span>{toast}</span>
          </div>
        </div>
      )}
    </PortalShell>
  );
}
