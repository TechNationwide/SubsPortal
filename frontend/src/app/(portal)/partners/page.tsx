"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PortalShell } from "@/components/PortalShell";
import { Modal } from "@/components/Modal";
import {
  BusinessOwnerLoanForm,
  emptyBusinessDetails,
  emptyLoanDetails,
  emptyOwnerDetails,
} from "@/components/BusinessOwnerLoanForm";
import { PartnerActionCard } from "@/components/PartnerActionCard";
import { api, authHeaders, downloadUrl } from "@/lib/api";
import { PARTNER_ROSTER } from "@/lib/partners";
import type {
  Brand,
  BusinessDetails,
  LoanDetails,
  OwnerDetails,
  PartnerBrandAssignments,
  PartnerFunderKey,
  PartnerIntegrationStatus,
  PartnerSubmission,
  ProcessedFile,
} from "@/lib/types";

type PartnerJobInfo = { jobId: string; brandName: string };

function jobIdFromDownloadPath(path: string): string | null {
  const match = path.match(/\/aquamark\/download\/([a-f0-9]{12})\//);
  return match ? match[1] : null;
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
  { id: "light", label: "Light", tag: "Minimal loss", detail: "85% JPEG quality." },
  { id: "balanced", label: "Balanced", tag: "Recommended", detail: "75% JPEG quality." },
  { id: "aggressive", label: "Aggressive", tag: "Big wins", detail: "60% JPEG quality." },
  { id: "maximum", label: "Maximum", tag: "Smallest file", detail: "45% JPEG quality." },
];

export default function ApiPartnersPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [loading, setLoading] = useState(true);
  const [partnerBrandAssignments, setPartnerBrandAssignments] = useState<PartnerBrandAssignments>({});
  const [dealName, setDealName] = useState("ABC Auto Repair LLC");
  const [selectedKeys, setSelectedKeys] = useState<PartnerFunderKey[]>([]);

  const [files, setFiles] = useState<File[]>([]);
  const [results, setResults] = useState<ProcessedFile[]>([]);
  const jobIdsRef = useRef<Set<string>>(new Set());
  const [partnerJobInfo, setPartnerJobInfo] = useState<Partial<Record<PartnerFunderKey, PartnerJobInfo>>>({});
  const [processing, setProcessing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [applicationFile, setApplicationFile] = useState<File | null>(null);
  const [applicationFileDragOver, setApplicationFileDragOver] = useState(false);
  const [toast, setToast] = useState("");
  const [aquamarkError, setAquamarkError] = useState("");
  const [errorModalOpen, setErrorModalOpen] = useState(false);

  const [business, setBusiness] = useState<BusinessDetails>(emptyBusinessDetails());
  const [owners, setOwners] = useState<OwnerDetails[]>([emptyOwnerDetails()]);
  const [loan, setLoan] = useState<LoanDetails>(emptyLoanDetails());

  const [zohoLeadId, setZohoLeadId] = useState("");
  const [zohoPulling, setZohoPulling] = useState(false);

  const pullFromZoho = useCallback(async () => {
    const leadId = zohoLeadId.trim();
    if (!leadId) return;
    setZohoPulling(true);
    try {
      const res = await api.zoho.getLead(leadId);
      setBusiness((prev) => ({ ...prev, ...res.data.business }));
      setOwners((prev) => {
        const merged = [...prev];
        merged[0] = { ...(merged[0] ?? emptyOwnerDetails()), ...res.data.owners[0] };
        return merged;
      });
      setLoan((prev) => ({ ...prev, ...res.data.loan }));
      setToast("Pulled from Zoho — double-check the fields below before submitting.");
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Failed to pull this lead from Zoho.");
    } finally {
      setZohoPulling(false);
    }
  }, [zohoLeadId]);

  const [partnersStatus, setPartnersStatus] = useState<Record<string, PartnerIntegrationStatus>>({});
  const [submissions, setSubmissions] = useState<Partial<Record<PartnerFunderKey, PartnerSubmission>>>({});
  // A set, not a single key - submitting to multiple partners at once is
  // expected (each is an independent request), and a single shared "busy"
  // value would clear partner A's busy/disabled state the moment partner B
  // starts, letting a double-click re-fire A's request while it's still in
  // flight.
  const [busyKeys, setBusyKeys] = useState<Set<PartnerFunderKey>>(new Set());
  const setBusy = useCallback((key: PartnerFunderKey, isBusy: boolean) => {
    setBusyKeys((prev) => {
      const next = new Set(prev);
      if (isBusy) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  const [compressModalFile, setCompressModalFile] = useState<ProcessedFile | null>(null);
  const [compressPreset, setCompressPreset] = useState<CompressPreset>("balanced");
  const [compressLoading, setCompressLoading] = useState(false);
  const [compressResult, setCompressResult] = useState<CompressResult | null>(null);
  const [batchPreset, setBatchPreset] = useState<CompressPreset>("balanced");
  const [batchCompressing, setBatchCompressing] = useState(false);

  useEffect(() => {
    return () => {
      // Intentionally read jobIdsRef.current live at unmount time (not a
      // snapshot from mount) so jobs created after mount still get cleaned
      // up — this is the point of using a ref here, not a bug.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      for (const id of jobIdsRef.current) {
        void api.deleteAquamarkJob(id).catch(() => undefined);
      }
    };
  }, []);

  const cleanupJobs = useCallback(async () => {
    const ids = Array.from(jobIdsRef.current);
    jobIdsRef.current.clear();
    await Promise.all(ids.map((id) => api.deleteAquamarkJob(id).catch(() => undefined)));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [brandsRes, statusRes, assignmentsRes] = await Promise.all([
        api.getBrands(),
        api.partners.getStatus(),
        api.partners.getBrandAssignments(),
      ]);
      setBrands(brandsRes.data);
      setPartnersStatus(statusRes.partners);
      setPartnerBrandAssignments(assignmentsRes.data);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selectedPartners = useMemo(
    () => PARTNER_ROSTER.filter((p) => selectedKeys.includes(p.key)),
    [selectedKeys],
  );

  function partnerBrand(key: PartnerFunderKey): Brand | null {
    const assignment = partnerBrandAssignments[key];
    if (!assignment) return null;
    return brands[assignment.brand_index] ?? null;
  }

  function partnerDisabledReason(key: PartnerFunderKey): string {
    const assignment = partnerBrandAssignments[key];
    if (!assignment) return "No brand assigned yet — set one in Funders setup.";
    const brand = brands[assignment.brand_index];
    if (!brand?.aquamark_email?.trim()) {
      return "Assigned brand has no Aquamark email set — configure it in Brands setup.";
    }
    return "";
  }

  function togglePartner(key: PartnerFunderKey) {
    if (partnerDisabledReason(key)) return;
    setSelectedKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  const step1Complete = dealName.trim().length > 0;
  const step2Complete = step1Complete && selectedPartners.length > 0;
  const step3Enabled = step2Complete;
  const outputCount = selectedPartners.length > 0 && files.length > 0 ? selectedPartners.length * files.length : 0;

  const canProcess = step3Enabled && files.length > 0 && !processing;

  const resultsByPartner = useMemo(() => {
    const map = new Map<string, ProcessedFile[]>();
    for (const file of results) {
      const key = file.recipient?.trim() || "Unassigned";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(file);
    }
    return map;
  }, [results]);

  async function downloadFile(downloadPath: string, filename: string) {
    const res = await fetch(downloadUrl(downloadPath), { headers: authHeaders() });
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
    setResults((prev) => prev.filter((f) => f.download !== file.download));
  }

  function addPdfFiles(incoming: File[]) {
    const pdfs = incoming.filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
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

  function setApplicationFileFromList(incoming: File[]) {
    const file = incoming[0];
    if (!file) return;
    setApplicationFile(file);
  }

  function onApplicationFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    setApplicationFileFromList(Array.from(e.target.files || []));
    e.target.value = "";
  }

  function onApplicationFileDrop(e: React.DragEvent) {
    e.preventDefault();
    setApplicationFileDragOver(false);
    setApplicationFileFromList(Array.from(e.dataTransfer.files));
  }

  async function onWatermark() {
    if (!canProcess) return;
    setProcessing(true);
    setToast("");
    try {
      await cleanupJobs();
      setResults([]);
      setSubmissions({});
      setPartnerJobInfo({});

      // Selected partners can be assigned to different brands - one Aquamark
      // call is required per distinct brand, since process_batch() takes a
      // single brand_name/user_email per call. Grouping here is what lets
      // "select OnDeck + CAN together" produce files under two different
      // brands simultaneously with no brand picking by the user.
      const groups = new Map<number, { brand: Brand; partners: typeof selectedPartners }>();
      for (const p of selectedPartners) {
        const assignment = partnerBrandAssignments[p.key];
        const brand = assignment ? brands[assignment.brand_index] : undefined;
        if (!assignment || !brand) continue;
        if (!groups.has(assignment.brand_index)) {
          groups.set(assignment.brand_index, { brand, partners: [] });
        }
        groups.get(assignment.brand_index)!.partners.push(p);
      }

      const newJobInfo: Partial<Record<PartnerFunderKey, PartnerJobInfo>> = {};
      let allFiles: ProcessedFile[] = [];

      for (const { brand, partners } of groups.values()) {
        const form = new FormData();
        form.append("brand_name", brand.name);
        form.append("deal_name", dealName);
        form.append("aquamark_user_email", brand.aquamark_email.trim());
        form.append("recipients", JSON.stringify(partners.map((p) => ({ name: p.label, email: "" }))));
        files.forEach((f) => form.append("files", f, f.name));

        const res = await api.processAquamark(form);
        jobIdsRef.current.add(res.job_id);
        allFiles = allFiles.concat(res.files);
        for (const p of partners) {
          newJobInfo[p.key] = { jobId: res.job_id, brandName: brand.name };
        }
      }

      setResults(allFiles);
      setPartnerJobInfo(newJobInfo);
      setToast(
        `${allFiles.length} file(s) watermarked and flattened (${files.length} PDF × ${selectedPartners.length} partner${selectedPartners.length === 1 ? "" : "s"} across ${groups.size} brand${groups.size === 1 ? "" : "s"}).`,
      );
    } catch (err) {
      await cleanupJobs();
      setResults([]);
      setPartnerJobInfo({});
      const message = err instanceof Error ? err.message : "Processing failed.";
      setAquamarkError(message);
      setErrorModalOpen(true);
    } finally {
      setProcessing(false);
    }
  }

  function processHint() {
    if (!step1Complete) return "Complete Step 1 first.";
    if (!selectedPartners.length) return "Select at least one partner in Step 2.";
    if (!files.length) return "Upload at least one PDF.";
    return "";
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

  async function runCompress() {
    const file = compressModalFile;
    const currentJobId = file ? jobIdFromDownloadPath(file.download) : null;
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
    setToast(`${file.name} replaced with the compressed version (−${result.reduction_percent}%).`);
    setCompressModalFile(null);
    setCompressResult(null);
  }

  async function compressAll() {
    const targets = results.filter((f) => !f.compressed);
    if (targets.length === 0) return;
    setBatchCompressing(true);
    let successCount = 0;
    let reductionSum = 0;
    try {
      await Promise.all(
        targets.map(async (file) => {
          const currentJobId = jobIdFromDownloadPath(file.download);
          if (!currentJobId) return;
          try {
            const filename = file.download.split("/").pop() || file.name;
            const result = await api.compressProcessedFile(currentJobId, filename, batchPreset);
            setResults((prev) =>
              prev.map((f) =>
                f.download === file.download
                  ? { ...f, name: result.name, size: result.compressed_size, download: result.download, compressed: true }
                  : f,
              ),
            );
            await api.deleteProcessedFile(file.download).catch(() => undefined);
            successCount += 1;
            reductionSum += result.reduction_percent;
          } catch {
            /* leave as-is */
          }
        }),
      );
    } finally {
      setBatchCompressing(false);
    }
    if (successCount > 0) {
      setToast(`Compressed ${successCount} file(s) (avg −${Math.round(reductionSum / successCount)}%).`);
    } else {
      setToast("Compression failed for all files.");
    }
  }

  function buildCreatePayload(key: PartnerFunderKey) {
    const info = partnerJobInfo[key];
    if (!info) return null;
    return {
      brand_name: info.brandName,
      deal_name: dealName,
      aquamark_job_id: info.jobId,
      business,
      owners,
      loan,
    };
  }

  function partnerFiles(label: string): ProcessedFile[] {
    return resultsByPartner.get(label) || [];
  }

  const CHANNEL_ENTITY_TYPES = ["corporation", "corp", "llc", "sole proprietorship", "sole prop"];

  // Every field checked here is one that at least one of the 5 funder APIs
  // will actually reject a submission over — CAN/PEAC/iDea return that as a
  // live 400 from their real API rather than catching it locally, so this
  // check has to run before the request ever goes out, not after.
  function validateForPartner(key: PartnerFunderKey, label: string): string | null {
    const missing: string[] = [];
    if (!business.legal_name.trim()) missing.push("legal business name");
    if (!business.phone.trim()) missing.push("business phone");
    if (!business.tax_id.trim()) missing.push("tax ID (EIN)");
    if (!business.entity_type.trim()) missing.push("entity type");
    if (!business.state_of_formation.trim()) missing.push("state of formation");
    if (!business.business_start_date.trim()) missing.push("business start date");
    if (!business.billing_street.trim()) missing.push("billing street");
    if (!business.billing_city.trim()) missing.push("billing city");
    if (!business.billing_state.trim()) missing.push("billing state");
    if (!business.billing_postal_code.trim()) missing.push("billing ZIP");

    owners.forEach((owner, i) => {
      const n = owners.length > 1 ? ` (owner ${i + 1})` : "";
      if (!owner.first_name.trim()) missing.push(`owner first name${n}`);
      if (!owner.last_name.trim()) missing.push(`owner last name${n}`);
      if (!owner.ssn.trim()) missing.push(`owner SSN${n}`);
      if (!owner.date_of_birth.trim()) missing.push(`owner date of birth${n}`);
      if (!owner.phone.trim()) missing.push(`owner phone${n}`);
      if (!owner.email.trim()) missing.push(`owner email${n}`);
      if (!owner.mailing_street.trim()) missing.push(`owner mailing street${n}`);
      if (!owner.mailing_city.trim()) missing.push(`owner mailing city${n}`);
      if (!owner.mailing_state.trim()) missing.push(`owner mailing state${n}`);
      if (!owner.mailing_postal_code.trim()) missing.push(`owner mailing ZIP${n}`);
      if (!owner.ownership_percentage) missing.push(`owner ownership %${n}`);
    });

    if (!loan.requested_amount) missing.push("requested amount");

    if (missing.length) {
      return `${label}: fill in ${missing.join(", ")} before submitting.`;
    }

    if (key === "ondeck") {
      const totalOwnership = owners.reduce((sum, o) => sum + (Number(o.ownership_percentage) || 0), 0);
      if (totalOwnership < 50) {
        return `OnDeck requires at least 50% combined owner ownership (currently ${totalOwnership.toFixed(0)}%) — it auto-declines below that.`;
      }
      if (loan.average_monthly_revenue == null || loan.average_daily_balance == null) {
        return "OnDeck requires both average monthly revenue and average daily balance.";
      }
    }

    if (key === "channel" && !CHANNEL_ENTITY_TYPES.includes(business.entity_type.trim().toLowerCase())) {
      return `Channel only supports Corporation, LLC, or Sole Proprietorship as entity type (got "${business.entity_type}").`;
    }

    return null;
  }

  async function onSubmitPartner(key: PartnerFunderKey) {
    const entry = PARTNER_ROSTER.find((p) => p.key === key);
    const payload = buildCreatePayload(key);
    if (!entry || !payload) {
      setToast("Watermark files for this partner first.");
      return;
    }
    const validationError = validateForPartner(key, entry.label);
    if (validationError) {
      setToast(validationError);
      return;
    }
    setBusy(key, true);
    setToast("");
    try {
      let res;
      if (key === "ondeck") {
        res = await api.partners.ondeckSubmit(payload);
      } else if (key === "peac" || key === "channel") {
        // Single-call submission - the watermarked bank-statement file(s)
        // for this partner and the shared application document go along
        // with the business/owner data in one request.
        const info = partnerJobInfo[key];
        const filenames = partnerFiles(entry.label).map((f) => f.download.split("/").pop() || f.name);
        const jobId = info?.jobId || "";
        res =
          key === "peac"
            ? await api.partners.peacSubmit(payload, jobId, filenames, applicationFile)
            : await api.partners.channelSubmit(payload, jobId, filenames, applicationFile);
      } else if (key === "idea") {
        res = await api.partners.ideaCreate(payload);
      } else {
        res = await api.partners.canCreate(payload);
      }
      setSubmissions((prev) => ({ ...prev, [key]: res.data }));
      setToast(`Submitted to ${entry.label}. Reference: ${res.data.external_id}.`);
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Submission failed.");
    } finally {
      setBusy(key, false);
    }
  }

  async function onSendDocumentsPartner(key: PartnerFunderKey) {
    const entry = PARTNER_ROSTER.find((p) => p.key === key);
    const submission = submissions[key];
    const info = partnerJobInfo[key];
    if (!entry || !submission || !info) return;
    const filenames = partnerFiles(entry.label).map((f) => f.download.split("/").pop() || f.name);
    if (!filenames.length) {
      setToast("No watermarked files for this partner yet.");
      return;
    }
    setBusy(key, true);
    setToast("");
    try {
      const res =
        key === "ondeck"
          ? await api.partners.ondeckSendDocuments(submission.id, info.jobId, filenames)
          : key === "idea"
            ? await api.partners.ideaSendDocuments(submission.id, info.jobId, filenames, applicationFile)
            : await api.partners.canSendDocuments(submission.id, info.jobId, filenames, applicationFile);
      setSubmissions((prev) => ({ ...prev, [key]: res.data }));
      const appNote = key !== "ondeck" && applicationFile ? " Application document included." : "";
      setToast(
        `Documents sent to ${entry.label}: ${filenames.length} bank statement${filenames.length === 1 ? "" : "s"}.${appNote}`,
      );
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Sending documents failed.");
    } finally {
      setBusy(key, false);
    }
  }

  async function onProcessPartner(key: PartnerFunderKey, consentAccepted: boolean) {
    const entry = PARTNER_ROSTER.find((p) => p.key === key);
    const submission = submissions[key];
    if (!entry || !submission) return;
    setBusy(key, true);
    setToast("");
    try {
      const res =
        key === "idea"
          ? await api.partners.ideaProcess(submission.id, consentAccepted)
          : await api.partners.canProcess(submission.id, consentAccepted);
      setSubmissions((prev) => ({ ...prev, [key]: res.data }));
      setToast(`${entry.label} application processed.`);
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Processing failed.");
    } finally {
      setBusy(key, false);
    }
  }

  return (
    <PortalShell
      title="API Partners"
      subtitle="Submit deals directly through each funder's own partner API — watermarked and handled separately per funder, same as email submissions."
    >
      <div className="aquamark-flow">
        <section className={`card panel aquamark-step${step1Complete ? " aquamark-step--complete" : ""}`}>
          <div className="aquamark-step-label">Step 1</div>
          <div className="panel-header">
            <h2>Deal name</h2>
            <p className="panel-sub">Enter the deal name used for watermark attribution and filenames.</p>
          </div>
          <div className="field">
            <label htmlFor="partnerDealName">Deal name</label>
            <input id="partnerDealName" value={dealName} onChange={(e) => setDealName(e.target.value)} />
          </div>
        </section>

        <section
          className={`card panel aquamark-step${step2Complete ? " aquamark-step--complete" : ""}${!step1Complete ? " aquamark-step--locked" : ""}`}
        >
          <div className="aquamark-step-label">Step 2</div>
          <div className="panel-header">
            <h2>Partners</h2>
            <p className="panel-sub">
              Pick which funder-partner APIs this deal goes to. Each partner already has a brand
              assigned in Funders setup, so its watermark account is applied automatically.
            </p>
          </div>

          {!step1Complete ? (
            <div className="aquamark-step-lock-notice" role="status">
              <span className="aquamark-step-lock-icon" aria-hidden>🔒</span>
              <p>Enter a deal name in Step 1 to choose partners.</p>
            </div>
          ) : loading ? (
            <p className="aquamark-hint">Loading partners…</p>
          ) : (
            <div className="partner-roster-grid">
              {PARTNER_ROSTER.map((p) => {
                const isSelected = selectedKeys.includes(p.key);
                const disabledReason = partnerDisabledReason(p.key);
                const brand = partnerBrand(p.key);
                return (
                  <label
                    key={p.key}
                    className={`partner-roster-toggle${isSelected ? " active" : ""}${disabledReason ? " disabled" : ""}`}
                    title={disabledReason || undefined}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={Boolean(disabledReason)}
                      onChange={() => togglePartner(p.key)}
                    />
                    <span className="partner-roster-toggle-check" aria-hidden>
                      {isSelected ? "✓" : ""}
                    </span>
                    <span className="partner-roster-toggle-body">
                      <span className="partner-roster-toggle-header">
                        <strong>{p.label}</strong>
                        {p.apiReady ? (
                          <span className="partner-ready-badge">Ready</span>
                        ) : (
                          <span className="config-badge">Coming soon</span>
                        )}
                      </span>
                      <span className="partner-roster-toggle-desc">
                        {disabledReason || (brand ? `Brand: ${brand.name}` : p.description)}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </section>

        <section
          className={`card panel aquamark-step${files.length > 0 ? " aquamark-step--complete" : ""}${!step3Enabled ? " aquamark-step--locked" : ""}`}
        >
          <div className="aquamark-step-label">Step 3</div>
          <div className="panel-header">
            <h2>Deal PDFs</h2>
            <p className="panel-sub">Upload the PDFs to watermark, flatten, and compress per partner.</p>
          </div>

          {!step3Enabled ? (
            <div className="aquamark-step-lock-notice" role="status">
              <span className="aquamark-step-lock-icon" aria-hidden>🔒</span>
              <p>Select at least one partner in Step 2 before uploading deal PDFs.</p>
            </div>
          ) : (
            <>
              <label
                className={`upload-zone${dragOver ? " is-dragover" : ""}`}
                onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false);
                }}
                onDrop={onUploadDrop}
              >
                <input type="file" accept="application/pdf,.pdf" multiple hidden onChange={onUploadChange} />
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
                  <span className="upload-zone-caption">Files are watermarked once per selected partner.</span>
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
              {files.length > 0 && outputCount > 0 && (
                <p className="aquamark-output-preview">
                  {outputCount} watermarked file{outputCount === 1 ? "" : "s"} will be generated ({files.length} PDF ×{" "}
                  {selectedPartners.length} partner{selectedPartners.length === 1 ? "" : "s"}).
                </p>
              )}
              <div className="aquamark-actions">
                <button type="button" className="btn btn-aquamark" disabled={!canProcess} onClick={onWatermark}>
                  {processing ? "Processing…" : "Watermark, Flatten & Compress"}
                </button>
                {!canProcess && !processing && processHint() && <p className="aquamark-hint">{processHint()}</p>}
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
                    <option key={preset.id} value={preset.id}>{preset.label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-secondary btn-xs"
                  onClick={compressAll}
                  disabled={batchCompressing || results.every((f) => f.compressed)}
                >
                  {batchCompressing ? "Compressing all…" : `Compress all (${results.filter((f) => !f.compressed).length})`}
                </button>
              </div>
            )}
          </div>
          {results.length === 0 ? (
            <p className="aquamark-hint">Watermarked files stay here until you submit them to a partner below.</p>
          ) : (
            <div className="aquamark-results-grid">
              {selectedPartners.map((p) => {
                const partnerResults = partnerFiles(p.label);
                if (!partnerResults.length) return null;
                return (
                  <div key={p.key} className="aquamark-results-column">
                    <h3 className="aquamark-results-funder">{p.label}</h3>
                    <ul className="aquamark-results-list">
                      {partnerResults.map((f) => (
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
                            <button type="button" className="btn btn-primary btn-xs" disabled={batchCompressing} onClick={() => onDownload(f)}>
                              Download
                            </button>
                            <button type="button" className="btn btn-secondary btn-xs" disabled={batchCompressing} onClick={() => openCompressModal(f)}>
                              Compress…
                            </button>
                            <button
                              type="button"
                              className="aquamark-file-remove"
                              disabled={batchCompressing}
                              onClick={() => onRemoveResult(f)}
                              title={`Remove ${f.name}`}
                              aria-label={`Remove ${f.name}`}
                            >
                              ×
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {results.length > 0 && (
          <section className="card panel aquamark-step">
            <div className="aquamark-step-label">Step 4</div>
            <div className="panel-header">
              <h2>Application document</h2>
              <p className="panel-sub">
                Optional. Sent as-is (no watermark, flatten, or compress) alongside bank statements
                to every selected partner except OnDeck &mdash; OnDeck&apos;s own submission already
                covers the application.
              </p>
            </div>
            <label
              className={`upload-zone${applicationFileDragOver ? " is-dragover" : ""}`}
              onDragEnter={(e) => { e.preventDefault(); setApplicationFileDragOver(true); }}
              onDragOver={(e) => { e.preventDefault(); setApplicationFileDragOver(true); }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setApplicationFileDragOver(false);
              }}
              onDrop={onApplicationFileDrop}
            >
              <input type="file" hidden onChange={onApplicationFileChange} />
              <div className="upload-zone-inner">
                <span className="upload-zone-icon" aria-hidden>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                </span>
                <strong>Drop the application document here or click to browse</strong>
                <small>Sent unmodified &mdash; no watermark, flatten, or compress</small>
              </div>
            </label>
            {applicationFile && (
              <ul className="aquamark-file-list">
                <li className="aquamark-file-item">
                  <span className="file-icon">DOC</span>
                  <span className="file-meta">
                    <strong>{applicationFile.name}</strong>
                    <small>{(applicationFile.size / 1024).toFixed(1)} KB</small>
                  </span>
                  <button
                    type="button"
                    className="aquamark-file-remove"
                    onClick={() => setApplicationFile(null)}
                    title="Remove application document"
                    aria-label="Remove application document"
                  >
                    ×
                  </button>
                </li>
              </ul>
            )}
          </section>
        )}

        {results.length > 0 && (
          <section className="card panel aquamark-step">
            <div className="aquamark-step-label">Step 5</div>
            <div className="panel-header">
              <h2>Business, owner & loan details</h2>
              <p className="panel-sub">
                Shared across all selected partners. OnDeck supports up to 2 owners; CAN Capital uses
                the first owner listed as the primary contact.
              </p>
            </div>
            <div className="crm-toolbar">
              <div className="crm-toolbar-left" style={{ flex: 1 }}>
                <input
                  type="text"
                  className="crm-search"
                  placeholder="Zoho Lead ID — pull to fill the fields below"
                  value={zohoLeadId}
                  onChange={(e) => setZohoLeadId(e.target.value)}
                  style={{ minWidth: 280 }}
                />
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={zohoPulling || !zohoLeadId.trim()}
                onClick={pullFromZoho}
              >
                {zohoPulling ? "Pulling…" : "Pull from Zoho"}
              </button>
            </div>
            <BusinessOwnerLoanForm
              business={business}
              onBusinessChange={setBusiness}
              owners={owners}
              onOwnersChange={setOwners}
              loan={loan}
              onLoanChange={setLoan}
            />
          </section>
        )}

        {results.length > 0 && (
          <section className="card panel aquamark-step">
            <div className="aquamark-step-label">Step 6</div>
            <div className="panel-header">
              <h2>Submit to partners</h2>
              <p className="panel-sub">
                Each partner handles its own submission flow and its own watermarked file(s).
              </p>
            </div>
            <div className="partner-card-grid">
              {selectedPartners.map((p) => (
                <PartnerActionCard
                  key={p.key}
                  entry={p}
                  configured={Boolean(partnersStatus[p.key]?.configured)}
                  submission={submissions[p.key] ?? null}
                  files={partnerFiles(p.label)}
                  busy={busyKeys.has(p.key)}
                  onSubmit={() => onSubmitPartner(p.key)}
                  onSendDocuments={() => onSendDocumentsPartner(p.key)}
                  onProcess={(consent) => onProcessPartner(p.key, consent)}
                  onDownload={onDownload}
                />
              ))}
            </div>
          </section>
        )}
      </div>

      <Modal
        open={errorModalOpen}
        title="Processing error"
        onClose={() => setErrorModalOpen(false)}
        footer={
          <button type="button" className="btn btn-primary" onClick={() => setErrorModalOpen(false)}>
            Close
          </button>
        }
      >
        <p className="aquamark-error-lead">Watermarking could not process this submission.</p>
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
              <button type="button" className="btn btn-secondary" onClick={closeCompressModal}>Cancel</button>
              <button type="button" className="btn btn-secondary" onClick={downloadCompressedCopy}>Download compressed copy</button>
              <button type="button" className="btn btn-primary" onClick={useCompressedForDeal}>Use compressed for this deal</button>
            </div>
          ) : (
            <div className="modal-footer-right">
              <button type="button" className="btn btn-secondary" onClick={closeCompressModal} disabled={compressLoading}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={runCompress} disabled={compressLoading}>
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
        <div className="compress-preset-grid">
          {COMPRESS_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`compress-preset-card${compressPreset === preset.id ? " active" : ""}`}
              disabled={compressLoading}
              onClick={() => { setCompressPreset(preset.id); setCompressResult(null); }}
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
            <span>Compressing with the {COMPRESS_PRESETS.find((p) => p.id === compressPreset)?.label} preset…</span>
          </div>
        )}
        {compressResult && (
          <div className="compress-result">
            <div className="compress-result-sizes">
              <span>{(compressResult.original_size / 1024).toFixed(1)} KB</span>
              <span className="compress-result-arrow">→</span>
              <span className="compress-result-after">{(compressResult.compressed_size / 1024).toFixed(1)} KB</span>
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
