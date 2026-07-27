import { getSession } from "./auth";
import type {
  Brand,
  BusinessDetails,
  Funder,
  LoanDetails,
  OwnerDetails,
  PartnerBrandAssignments,
  PartnerFunderKey,
  PartnerIntegrationStatus,
  PartnerSubmission,
  ProcessedFile,
  Team,
  User,
} from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export function authHeaders(): Record<string, string> {
  const session = getSession();
  return session?.token ? { Authorization: `Bearer ${session.token}` } : {};
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (data as { detail?: unknown }).detail;
    let message = res.statusText;
    if (typeof detail === "string") message = detail;
    else if (Array.isArray(detail) && detail[0]?.msg) message = detail[0].msg;
    else if ((data as { error?: string }).error) message = (data as { error: string }).error;
    throw new Error(message);
  }
  return data as T;
}

export const api = {
  login(email: string, password: string) {
    return request<{
      ok: boolean;
      token: string;
      user: { id: number; name: string; email: string; role: "admin" | "employee" };
    }>("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  },
  logout() {
    return request<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
  },

  getBrands() {
    return request<{ ok: boolean; data: Brand[] }>("/api/brands");
  },
  createBrand(brand: Brand) {
    return request<{ ok: boolean; data: Brand[] }>("/api/brands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(brand),
    });
  },
  updateBrand(index: number, brand: Brand) {
    return request<{ ok: boolean; data: Brand[] }>(`/api/brands/${index}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(brand),
    });
  },
  deleteBrand(index: number) {
    return request<{ ok: boolean; data: Brand[] }>(`/api/brands/${index}`, {
      method: "DELETE",
    });
  },

  getFunders() {
    return request<{ ok: boolean; data: Funder[] }>("/api/funders").then((res) => ({
      ...res,
      data: res.data.map((funder) => ({
        ...funder,
        brands: funder.brands ?? [],
        cc_members: funder.cc_members ?? [],
      })),
    }));
  },
  createFunder(funder: Funder) {
    return request<{ ok: boolean; data: Funder[] }>("/api/funders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(funder),
    });
  },
  updateFunder(index: number, funder: Funder) {
    return request<{ ok: boolean; data: Funder[] }>(`/api/funders/${index}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(funder),
    });
  },
  deleteFunder(index: number) {
    return request<{ ok: boolean; data: Funder[] }>(`/api/funders/${index}`, {
      method: "DELETE",
    });
  },

  getTeams() {
    return request<{ ok: boolean; data: Team[] }>("/api/teams");
  },
  createTeam(team: Omit<Team, "id">) {
    return request<{ ok: boolean; data: Team[] }>("/api/teams", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(team),
    });
  },
  updateTeam(id: string, team: Omit<Team, "id">) {
    return request<{ ok: boolean; data: Team[] }>(`/api/teams/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(team),
    });
  },
  deleteTeam(id: string) {
    return request<{ ok: boolean; data: Team[] }>(`/api/teams/${id}`, {
      method: "DELETE",
    });
  },

  getUsers() {
    return request<{ ok: boolean; data: User[] }>("/api/users");
  },
  createUser(user: { name: string; email: string; role: string; password: string }) {
    return request<{ ok: boolean; data: User[] }>("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(user),
    });
  },
  updateUser(id: number, user: { name: string; email: string; role: string }) {
    return request<{ ok: boolean; data: User[] }>(`/api/users/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(user),
    });
  },
  deleteUser(id: number) {
    return request<{ ok: boolean; data: User[] }>(`/api/users/${id}`, {
      method: "DELETE",
    });
  },
  resetUserPassword(id: number, password: string) {
    return request<{ ok: boolean }>(`/api/users/${id}/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
  },

  async processAquamark(form: FormData) {
    const res = await fetch(`${API_BASE}/api/aquamark/process`, {
      method: "POST",
      headers: { ...authHeaders() },
      body: form,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = (data as { detail?: unknown }).detail;
      let message = "Aquamark processing failed.";
      if (typeof detail === "string") message = detail;
      else if (Array.isArray(detail) && detail[0]?.msg) message = detail[0].msg;
      else if ((data as { error?: string }).error) message = (data as { error: string }).error;
      throw new Error(message);
    }
    return data as {
      ok: boolean;
      job_id: string;
      files: ProcessedFile[];
      errors: string[];
      source: string;
      recipients: string[];
    };
  },

  sendDealEmail(payload: {
    from_email: string;
    to: string;
    cc: string;
    subject: string;
    body: string;
    attachments: string[];
  }) {
    return request<{ ok: boolean; status_code: number }>("/api/emails/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },

  deleteAquamarkJob(jobId: string) {
    return request<{ ok: boolean }>(`/api/aquamark/job/${jobId}`, {
      method: "DELETE",
    });
  },

  deleteProcessedFile(downloadPath: string) {
    return request<{ ok: boolean }>(downloadPath, { method: "DELETE" });
  },

  compressProcessedFile(jobId: string, filename: string, preset: string = "balanced") {
    return request<{
      ok: boolean;
      name: string;
      original_size: number;
      compressed_size: number;
      reduction_percent: number;
      download: string;
    }>(`/api/aquamark/compress/${jobId}/${encodeURIComponent(filename)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preset }),
    });
  },

  partners: {
    getStatus() {
      return request<{ ok: boolean; partners: Record<string, PartnerIntegrationStatus> }>(
        "/api/partners/status",
      );
    },
    getBrandAssignments() {
      return request<{ ok: boolean; data: PartnerBrandAssignments }>("/api/partners/brand-assignments");
    },
    setBrandAssignment(funderKey: PartnerFunderKey, brandIndex: number | null) {
      return request<{ ok: boolean; data: PartnerBrandAssignments }>(
        `/api/partners/brand-assignments/${funderKey}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ brand_index: brandIndex }),
        },
      );
    },
    listSubmissions(statusIn?: string[]) {
      const qs = statusIn?.length ? `?status_in=${statusIn.join(",")}` : "";
      return request<{ ok: boolean; data: PartnerSubmission[] }>(`/api/partners/submissions${qs}`);
    },
    deleteSubmission(id: number) {
      return request<{ ok: boolean }>(`/api/partners/submissions/${id}`, { method: "DELETE" });
    },

    ondeckSubmit(payload: PartnerSubmissionCreatePayload) {
      return request<{ ok: boolean; data: PartnerSubmission }>(
        "/api/partners/ondeck/submit-application",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
      );
    },
    ondeckSendDocuments(submissionId: number, jobId: string, filenames: string[]) {
      return request<{ ok: boolean; data: PartnerSubmission }>(
        `/api/partners/ondeck/${submissionId}/send-documents`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ job_id: jobId, filenames }),
        },
      );
    },

    canCreate(payload: PartnerSubmissionCreatePayload) {
      return request<{ ok: boolean; data: PartnerSubmission }>(
        "/api/partners/can/create-application",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
      );
    },
    canSendDocuments(
      submissionId: number,
      jobId: string,
      filenames: string[],
      applicationDocument?: File | null,
    ) {
      const form = new FormData();
      form.append("job_id", jobId);
      form.append("filenames", JSON.stringify(filenames));
      if (applicationDocument) {
        form.append("application_document", applicationDocument, applicationDocument.name);
      }
      return request<{ ok: boolean; data: PartnerSubmission }>(
        `/api/partners/can/${submissionId}/send-documents`,
        { method: "POST", body: form },
      );
    },
    canProcess(submissionId: number, consentAccepted: boolean) {
      return request<{ ok: boolean; data: PartnerSubmission }>(
        `/api/partners/can/${submissionId}/process-application`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ consent_accepted: consentAccepted }),
        },
      );
    },

    // PEAC and Channel are single-call submissions - business/owner data
    // plus every file (bank statements + application doc) all go in one
    // request, so these take the same job_id/filenames/applicationDocument
    // shape as canSendDocuments, merged with the create payload.
    peacSubmit(
      payload: PartnerSubmissionCreatePayload,
      jobId: string,
      filenames: string[],
      applicationDocument?: File | null,
    ) {
      const form = new FormData();
      form.append("payload", JSON.stringify(payload));
      form.append("job_id", jobId);
      form.append("filenames", JSON.stringify(filenames));
      if (applicationDocument) {
        form.append("application_document", applicationDocument, applicationDocument.name);
      }
      return request<{ ok: boolean; data: PartnerSubmission }>(
        "/api/partners/peac/submit-application",
        { method: "POST", body: form },
      );
    },
    channelSubmit(
      payload: PartnerSubmissionCreatePayload,
      jobId: string,
      filenames: string[],
      applicationDocument?: File | null,
    ) {
      const form = new FormData();
      form.append("payload", JSON.stringify(payload));
      form.append("job_id", jobId);
      form.append("filenames", JSON.stringify(filenames));
      if (applicationDocument) {
        form.append("application_document", applicationDocument, applicationDocument.name);
      }
      return request<{ ok: boolean; data: PartnerSubmission }>(
        "/api/partners/channel/submit-application",
        { method: "POST", body: form },
      );
    },

    ideaCreate(payload: PartnerSubmissionCreatePayload) {
      return request<{ ok: boolean; data: PartnerSubmission }>(
        "/api/partners/idea/create-application",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
      );
    },
    ideaSendDocuments(
      submissionId: number,
      jobId: string,
      filenames: string[],
      applicationDocument?: File | null,
    ) {
      const form = new FormData();
      form.append("job_id", jobId);
      form.append("filenames", JSON.stringify(filenames));
      if (applicationDocument) {
        form.append("application_document", applicationDocument, applicationDocument.name);
      }
      return request<{ ok: boolean; data: PartnerSubmission }>(
        `/api/partners/idea/${submissionId}/send-documents`,
        { method: "POST", body: form },
      );
    },
    ideaProcess(submissionId: number, consentAccepted: boolean) {
      return request<{ ok: boolean; data: PartnerSubmission }>(
        `/api/partners/idea/${submissionId}/process-application`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ consent_accepted: consentAccepted }),
        },
      );
    },
  },
};

export type PartnerSubmissionCreatePayload = {
  brand_name: string;
  deal_name: string;
  aquamark_job_id: string;
  business: BusinessDetails;
  owners: OwnerDetails[];
  loan: LoanDetails;
};

export function downloadUrl(path: string) {
  if (path.startsWith("http")) return path;
  return `${API_BASE}${path}`;
}
