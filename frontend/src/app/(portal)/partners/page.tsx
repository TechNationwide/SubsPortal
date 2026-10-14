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
import { ECG_INDUSTRIES, PARTNER_ROSTER } from "@/lib/partners";
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
  const [toastTone, setToastTone] = useState<"success" | "error">("success");
  const showToast = useCallback((message: string, tone: "success" | "error" = "success") => {
    setToastTone(tone);
    setToast(message);
  }, []);
  const [aquamarkError, setAquamarkError] = useState("");
  const [errorModalOpen, setErrorModalOpen] = useState(false);

  const [business, setBusiness] = useState<BusinessDetails>(emptyBusinessDetails());
  const [owners, setOwners] = useState<OwnerDetails[]>([emptyOwnerDetails()]);
  const [loan, setLoan] = useState<LoanDetails>(emptyLoanDetails());

  const [zohoLeadId, setZohoLeadId] = useState("");
  const [zohoPulling, setZohoPulling] = useState(false);
  const [zohoPushing, setZohoPushing] = useState(false);

  /** Skip null/empty Zoho values so a pull cannot wipe fields the broker already filled. */
  function softMergeRecord<T extends Record<string, unknown>>(prev: T, incoming: Partial<T> | undefined): T {
    if (!incoming) return prev;
    const next: T = { ...prev };
    for (const [key, value] of Object.entries(incoming)) {
      if (value === null || value === undefined) continue;
      if (typeof value === "string" && !value.trim()) continue;
      // Zoho maps missing ownership to 0 — do not clobber a filled value with that sentinel.
      if (key === "ownership_percentage" && (Number(value) === 0 || value === "")) continue;
      (next as Record<string, unknown>)[key] = typeof value === "string" ? value : value;
      // Always store stringy CRM scalars as strings when they look numeric-only from JSON.
      if (
        typeof value === "number" &&
        key !== "ownership_percentage" &&
        key !== "requested_amount" &&
        key !== "desired_term_months" &&
        key !== "average_monthly_revenue" &&
        key !== "average_daily_balance" &&
        key !== "monthly_cc_sales"
      ) {
        (next as Record<string, unknown>)[key] = String(value);
      }
    }
    return next;
  }

  const pullFromZoho = useCallback(async () => {
    const leadId = zohoLeadId.trim();
    if (!leadId) return;
    setZohoPulling(true);
    try {
      const res = await api.zoho.getLead(leadId);
      setBusiness((prev) => softMergeRecord(prev, res.data.business as Partial<typeof prev>));
      setOwners((prev) => {
        const merged = [...prev];
        const base = merged[0] ?? emptyOwnerDetails();
        merged[0] = softMergeRecord(base, res.data.owners[0] as Partial<typeof base>);
        return merged;
      });
      setLoan((prev) => softMergeRecord(prev, res.data.loan as Partial<typeof prev>));
      showToast("Pulled from Zoho — double-check the fields below before submitting.", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to pull this lead from Zoho.", "error");
    } finally {
      setZohoPulling(false);
    }
  }, [zohoLeadId, showToast]);

  const [partnersStatus, setPartnersStatus] = useState<Record<string, PartnerIntegrationStatus>>({});
  const [submissions, setSubmissions] = useState<Partial<Record<PartnerFunderKey, PartnerSubmission>>>({});

  const pushToZoho = useCallback(async () => {
    const leadId = zohoLeadId.trim();
    if (!leadId) return;
    if (
      !window.confirm(
        `This will overwrite the mapped fields on Zoho Lead ${leadId} with the business/owner/loan values currently on this form, and write any OnDeck / CAN / iDea / Expansion IDs already submitted in this session. Continue?`,
      )
    ) {
      return;
    }
    setZohoPushing(true);
    try {
      const owner = owners[0] ?? emptyOwnerDetails();
      const partnerRefs: Record<string, string> = {};
      const ondeckId = String(submissions.ondeck?.external_id || "").trim();
      const canId = String(submissions.can?.external_id || "").trim();
      const ideaId = String(submissions.idea?.external_id || "").trim();
      const ecgId = String(submissions.ecg?.external_id || "").trim();
      if (ondeckId) partnerRefs.business_id = ondeckId;
      if (canId) {
        partnerRefs.canCapital_App_No = canId;
        partnerRefs.canCapital_App_No_1 = canId;
      }
      if (ideaId) partnerRefs.IdeaFinancial_App_ID = ideaId;
      if (ecgId) partnerRefs.Expansion_App_ID = ecgId;

      const res = await api.zoho.updateLead(leadId, {
        business: {
          legal_name: String(business.legal_name ?? ""),
          dba: String(business.dba ?? ""),
          phone: String(business.phone ?? ""),
          tax_id: String(business.tax_id ?? ""),
          entity_type: String(business.entity_type ?? ""),
          state_of_formation: String(business.state_of_formation ?? ""),
          business_start_date: String(business.business_start_date ?? ""),
          billing_street: String(business.billing_street ?? ""),
          billing_city: String(business.billing_city ?? ""),
          billing_state: String(business.billing_state ?? ""),
          billing_postal_code: String(business.billing_postal_code ?? ""),
        },
        owners: [
          {
            first_name: String(owner.first_name ?? ""),
            last_name: String(owner.last_name ?? ""),
            date_of_birth: String(owner.date_of_birth ?? ""),
            ssn: String(owner.ssn ?? ""),
            ownership_percentage: Number(owner.ownership_percentage) || 0,
            phone: String(owner.phone ?? ""),
            email: String(owner.email ?? ""),
            mailing_street: String(owner.mailing_street ?? ""),
            mailing_city: String(owner.mailing_city ?? ""),
            mailing_state: String(owner.mailing_state ?? ""),
            mailing_postal_code: String(owner.mailing_postal_code ?? ""),
          },
        ],
        loan: {
          average_monthly_revenue: loan.average_monthly_revenue,
          average_daily_balance: loan.average_daily_balance,
        },
        partner_refs: partnerRefs,
      });
      const pushedKeys = Object.keys(res.partner_refs || partnerRefs);
      showToast(
        pushedKeys.length
          ? `Pushed to Zoho successfully (including ${pushedKeys.length} funder ID field${pushedKeys.length === 1 ? "" : "s"}).`
          : "Pushed to Zoho successfully. No funder IDs in this session yet — submit a partner first, then push again.",
        "success",
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to push to Zoho.", "error");
    } finally {
      setZohoPushing(false);
    }
  }, [zohoLeadId, business, owners, loan, submissions, showToast]);

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
      const aquamarkWarnings: string[] = [];

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
        if (res.errors?.length) {
          aquamarkWarnings.push(...res.errors);
        }
        for (const p of partners) {
          newJobInfo[p.key] = { jobId: res.job_id, brandName: brand.name };
        }
      }

      setResults(allFiles);
      setPartnerJobInfo(newJobInfo);
      if (aquamarkWarnings.length) {
        showToast(
          `Watermarked ${allFiles.length} file(s), but some PDFs failed: ${aquamarkWarnings.join(" | ")}`,
          "error",
        );
        setAquamarkError(aquamarkWarnings.join("\n\n"));
        setErrorModalOpen(true);
      } else {
        showToast(
          `${allFiles.length} file(s) watermarked and flattened (${files.length} PDF × ${selectedPartners.length} partner${selectedPartners.length === 1 ? "" : "s"} across ${groups.size} brand${groups.size === 1 ? "" : "s"}).`,
          "success",
        );
      }
    } catch (err) {
      await cleanupJobs();
      setResults([]);
      setPartnerJobInfo({});
      const message = err instanceof Error ? err.message : "Aquamark processing failed.";
      setAquamarkError(message);
      setErrorModalOpen(true);
      showToast(message.split("\n")[0] || "Aquamark processing failed.", "error");
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
      // One file at a time — parallel compress spikes API RAM and causes Failed to fetch.
      for (const file of targets) {
        const currentJobId = jobIdFromDownloadPath(file.download);
        if (!currentJobId) continue;
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
      }
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
      zoho_lead_id: zohoLeadId.trim(),
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
    // Zoho JSON can deliver SSN / EIN / phones as numbers. Never call .trim()
    // on a non-string — that threw and made Submit look completely dead.
    const blank = (value: unknown) => !String(value ?? "").trim();
    const missing: string[] = [];
    if (blank(business.legal_name)) missing.push("legal business name");
    if (blank(business.phone)) missing.push("business phone");
    if (blank(business.tax_id)) missing.push("tax ID (EIN)");
    if (blank(business.entity_type)) missing.push("entity type");
    if (blank(business.state_of_formation)) missing.push("state of formation");
    if (blank(business.business_start_date)) missing.push("business start date");
    if (blank(business.billing_street)) missing.push("billing street");
    if (blank(business.billing_city)) missing.push("billing city");
    if (blank(business.billing_state)) missing.push("billing state");
    if (blank(business.billing_postal_code)) missing.push("billing ZIP");

    owners.forEach((owner, i) => {
      const n = owners.length > 1 ? ` (owner ${i + 1})` : "";
      if (blank(owner.first_name)) missing.push(`owner first name${n}`);
      if (blank(owner.last_name)) missing.push(`owner last name${n}`);
      if (blank(owner.ssn)) missing.push(`owner SSN${n}`);
      if (blank(owner.date_of_birth)) missing.push(`owner date of birth${n}`);
      if (blank(owner.phone)) missing.push(`owner phone${n}`);
      if (blank(owner.email)) missing.push(`owner email${n}`);
      if (blank(owner.mailing_street)) missing.push(`owner mailing street${n}`);
      if (blank(owner.mailing_city)) missing.push(`owner mailing city${n}`);
      if (blank(owner.mailing_state)) missing.push(`owner mailing state${n}`);
      if (blank(owner.mailing_postal_code)) missing.push(`owner mailing ZIP${n}`);
      const ownershipPct = Number(owner.ownership_percentage);
      if (!Number.isFinite(ownershipPct) || ownershipPct <= 0) {
        missing.push(`owner ownership %${n}`);
      }
    });

    if (!loan.requested_amount) missing.push("requested amount");

    if (missing.length) {
      return `${label}: fill in ${missing.join(", ")} before submitting.`;
    }

    if (key === "ondeck") {
      const totalOwnership = owners.reduce((sum, o) => sum + (Number(o.ownership_percentage) || 0), 0);
      if (totalOwnership < 50) {
        return `OnDeck — Owner ownership %: combined ownership is ${totalOwnership.toFixed(0)}% — OnDeck needs at least 50% or the application is auto-declined.`;
      }
      if (loan.average_monthly_revenue == null) {
        return "OnDeck — Average monthly revenue: required for OnDeck.";
      }
      if (loan.average_daily_balance == null) {
        return "OnDeck — Average daily balance: required for OnDeck.";
      }

      // Same rules as backend ondeck_client — catch bad fields before the API call
      // so the toast names the exact form field.
      const digitsOnly = (value: unknown) => String(value ?? "").replace(/\D/g, "");
      const phoneDigits = (value: unknown) => {
        let d = digitsOnly(value);
        if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
        return d;
      };
      const usStates = new Set([
        "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS",
        "KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC",
        "ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
      ]);
      const stateOk = (value: unknown) => {
        const raw = String(value ?? "").trim();
        if (!raw) return false;
        if (raw.length === 2 && usStates.has(raw.toUpperCase())) return true;
        // Full names are OK — backend normalizes them.
        return raw.length > 2;
      };

      const bizPhone = phoneDigits(business.phone);
      if (bizPhone.length !== 10) {
        return `OnDeck — Business phone: must be exactly 10 digits (got ${bizPhone.length || 0}). Fix this field before retrying.`;
      }
      const ein = digitsOnly(business.tax_id);
      if (ein.length !== 9) {
        return `OnDeck — Tax ID (EIN): must be exactly 9 digits (got ${ein.length || 0}). Fix this field before retrying.`;
      }
      const bizZip = digitsOnly(business.billing_postal_code);
      if (bizZip.length < 5) {
        return `OnDeck — Billing ZIP: must be exactly 5 digits (got ${bizZip.length || 0}).`;
      }
      if (!stateOk(business.billing_state)) {
        return `OnDeck — Billing state: "${String(business.billing_state ?? "").trim()}" is not a valid US state. Use a 2-letter code (e.g. VA).`;
      }

      for (let i = 0; i < owners.length; i++) {
        const owner = owners[i];
        const suffix = owners.length > 1 ? ` (owner ${i + 1})` : "";
        const oPhone = phoneDigits(owner.phone);
        if (oPhone.length !== 10) {
          return `OnDeck — Owner phone${suffix}: must be exactly 10 digits (got ${oPhone.length || 0}). Fix this field before retrying.`;
        }
        const ssn = digitsOnly(owner.ssn);
        if (ssn.length !== 9) {
          return `OnDeck — Owner SSN${suffix}: must be exactly 9 digits (got ${ssn.length || 0}). Fix this field before retrying.`;
        }
        const oZip = digitsOnly(owner.mailing_postal_code);
        if (oZip.length < 5) {
          return `OnDeck — Owner mailing ZIP${suffix}: must be exactly 5 digits (got ${oZip.length || 0}).`;
        }
        if (!stateOk(owner.mailing_state)) {
          return `OnDeck — Owner mailing state${suffix}: "${String(owner.mailing_state ?? "").trim()}" is not a valid US state. Use a 2-letter code (e.g. VA).`;
        }
      }
    }

    // Catch state codes pasted into Industry (EDWINS TREE deal: "va" → OnDeck/CAN 500).
    const industry = String(business.industry_naics_code ?? "").trim();
    const industryLooksLikeState =
      /^[A-Za-z]{2}$/.test(industry) &&
      industry.toUpperCase() === String(business.billing_state ?? "").trim().toUpperCase();
    const usStateCodes = new Set([
      "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA","KS",
      "KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC",
      "ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
    ]);
    const industryIsStateCode =
      /^[A-Za-z]{2}$/.test(industry) && usStateCodes.has(industry.toUpperCase());

    if ((key === "ondeck" || key === "can") && (industryLooksLikeState || industryIsStateCode)) {
      return `${label}: Industry / NAICS looks like a state code ("${industry}"). Use a NAICS code or industry name, or leave it blank — do not put the billing state there.`;
    }
    if (key === "ondeck" && industry) {
      const digits = industry.replace(/\D/g, "");
      if (digits.length < 2 || digits.length > 6) {
        return `OnDeck: Industry / NAICS must be a 2–6 digit NAICS code (got "${industry}"), or leave blank.`;
      }
    }

    if (key === "channel" && !CHANNEL_ENTITY_TYPES.includes(String(business.entity_type ?? "").trim().toLowerCase())) {
      return `Channel only supports Corporation, LLC, or Sole Proprietorship as entity type (got "${business.entity_type}").`;
    }

    if (key === "ecg") {
      const industry = String(business.ecg_industry ?? "").trim();
      if (!ECG_INDUSTRIES.includes(industry as (typeof ECG_INDUSTRIES)[number])) {
        return "Expansion: pick an Expansion industry from the list. A NAICS code will not work.";
      }
      if (owners.length > 2) {
        return "Expansion accepts at most 2 owners.";
      }
      const totalOwnership = owners.reduce((sum, o) => sum + (Number(o.ownership_percentage) || 0), 0);
      if (totalOwnership <= 0 || totalOwnership > 100) {
        return `Expansion owner percentages must add up to 100% or less (currently ${totalOwnership.toFixed(0)}%).`;
      }
    }

    return null;
  }


  async function onSubmitPartner(key: PartnerFunderKey) {
    const entry = PARTNER_ROSTER.find((p) => p.key === key);
    const payload = buildCreatePayload(key);
    if (!entry || !payload) {
      showToast("Watermark files for this partner first.", "error");
      return;
    }
    const validationError = validateForPartner(key, entry.label);
    if (validationError) {
      showToast(validationError, "error");
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
      } else if (key === "ecg") {
        res = await api.partners.ecgSubmit(payload);
      } else {
        res = await api.partners.canCreate(payload);
      }
      setSubmissions((prev) => ({ ...prev, [key]: res.data }));
      const zohoSync = "zoho_sync" in res ? String(res.zoho_sync || "") : "";
      let message = `Submitted to ${entry.label}. Reference: ${res.data.external_id}.`;
      if (key === "ecg" && "owners_warning" in res && res.owners_warning) {
        message += ` Owners were not added: ${res.owners_warning}`;
      }
      if (zohoSync === "ok") {
        message += " Zoho Lead updated.";
        showToast(message, "success");
      } else if (zohoSync === "skipped_no_lead_id") {
        message += " Zoho Lead ID was blank — funder IDs were not written to Zoho.";
        showToast(message, "error");
      } else if (zohoLeadId.trim() && zohoSync) {
        message += ` Zoho update: ${zohoSync}`;
        showToast(message, "error");
      } else {
        showToast(message, "success");
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Submission failed.", "error");
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
      if (key === "ecg") {
        // One PDF per request — keeps each call under Cloudflare's ~100s limit.
        // Use each file's own job id from its download path (compress can change jobs).
        let last = submission;
        const filesForPartner = partnerFiles(entry.label);
        for (const file of filesForPartner) {
          const rawName = file.download.split("/").pop() || file.name;
          const filename = decodeURIComponent(rawName);
          const fileJobId = jobIdFromDownloadPath(file.download) || info.jobId;
          const res = await api.partners.ecgSendDocuments(submission.id, fileJobId, [filename]);
          last = res.data;
        }
        if (applicationFile) {
          const res = await api.partners.ecgSendDocuments(
            submission.id,
            info.jobId,
            [],
            applicationFile,
          );
          last = res.data;
        }
        setSubmissions((prev) => ({ ...prev, [key]: last }));
        const appNote = applicationFile ? " Application document included." : "";
        setToast(
          `Documents sent to ${entry.label}: ${filesForPartner.length} bank statement${filesForPartner.length === 1 ? "" : "s"}.${appNote}`,
        );
      } else {
        // OnDeck: bank statements ONLY. Step 4 application PDF must never
        // be passed to ondeckSendDocuments (API has no application_document
        // field either). Toast must not claim it was included for OnDeck.
        const res =
          key === "ondeck"
            ? await api.partners.ondeckSendDocuments(submission.id, info.jobId, filenames)
            : key === "idea"
              ? await api.partners.ideaSendDocuments(submission.id, info.jobId, filenames, applicationFile)
              : await api.partners.canSendDocuments(submission.id, info.jobId, filenames, applicationFile);
        setSubmissions((prev) => ({ ...prev, [key]: res.data }));
        const appNote =
          key !== "ondeck" && applicationFile ? " Application document included." : "";
        setToast(
          `Documents sent to ${entry.label}: ${filenames.length} bank statement${filenames.length === 1 ? "" : "s"}.${appNote}`,
        );
      }
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Sending documents failed.");
    } finally {
      setBusy(key, false);
    }
  }

  async function onProcessPartner(key: PartnerFunderKey, consentAccepted: boolean) {
    const entry = PARTNER_ROSTER.find((p) => p.key === key);
    const submission = submissions[key];
    if (!entry || !submission || key === "ecg") return;
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

  async function onCheckStatusPartner(key: PartnerFunderKey) {
    const submission = submissions[key];
    if (key !== "ecg" || !submission) return;
    setBusy(key, true);
    setToast("");
    try {
      const res = await api.partners.ecgStatus(submission.id, zohoLeadId.trim() || undefined);
      const stage = res.data.status || "status returned";
      const notes = res.data.notes ? ` Notes: ${res.data.notes}` : "";
      let message = `Expansion status: ${stage}.${notes}`;
      const zohoSync = String(res.zoho_sync || "");
      if (zohoLeadId.trim() && zohoSync === "ok") {
        message += " Zoho Lead status updated.";
      } else if (zohoLeadId.trim() && zohoSync) {
        message += ` Zoho update: ${zohoSync}`;
      }
      showToast(message, "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Status check failed.", "error");
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
                disabled={zohoPulling || zohoPushing || !zohoLeadId.trim()}
                onClick={pullFromZoho}
              >
                {zohoPulling ? "Pulling…" : "Pull from Zoho"}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={zohoPulling || zohoPushing || !zohoLeadId.trim()}
                onClick={pushToZoho}
                title="Overwrite mapped fields on this Zoho Lead with the form below"
              >
                {zohoPushing ? "Pushing…" : "Push to Zoho"}
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
                  onCheckStatus={p.checkStatus ? () => onCheckStatusPartner(p.key) : undefined}
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
          <div className={`toast ${toastTone}`}>
            <span>•</span>
            <span>{toast}</span>
          </div>
        </div>
      )}
    </PortalShell>
  );
}
