/**
 * root/archive — Cloudflare Workers Submission & Student Authentication Proxy
 *
 * Security & HTTP Status Code Contract:
 * - 200 OK: Successful OPTIONS preflight or POST /auth/verify authorization check
 * - 201 Created: Successful resource upload to R2 and GitHub PR creation
 * - 400 Bad Request: Malformed multipart body, unknown/duplicate fields, or failed input validation
 * - 401 Unauthorized: Missing, malformed, invalid, or expired Google ID token
 * - 403 Forbidden: Disallowed Origin, valid Google account outside @std.aum.edu.jo, or failed Turnstile
 * - 404 Not Found: Unsupported request path
 * - 405 Method Not Allowed: Any HTTP method other than POST or OPTIONS
 * - 413 Payload Too Large: Request body or uploaded file exceeds 25 MiB (26,214,400 bytes)
 * - 415 Unsupported Media Type: Content-Type is missing or does not start with multipart/form-data
 * - 500 Internal Server Error: Missing/invalid Worker environment bindings or unexpected runtime failure
 * - 502 Bad Gateway / 503 Service Unavailable: Upstream failure from Google JWKS, Turnstile, R2, or GitHub API
 */

import { createRemoteJWKSet, errors as joseErrors, jwtVerify } from "jose";
import rawCoursesCatalog from "../site/courses.json";

export interface R2HTTPMetadata {
  contentType?: string;
  contentLanguage?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  cacheControl?: string;
  cacheExpiry?: Date;
}

export interface R2PutOptions {
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
}

export interface R2Object {
  readonly key: string;
  readonly version: string;
  readonly size: number;
  readonly etag: string;
  readonly httpEtag: string;
  readonly uploaded: Date;
}

export interface R2Bucket {
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob,
    options?: R2PutOptions
  ): Promise<R2Object | null>;
  delete(keys: string | string[]): Promise<void>;
}

export interface Env {
  GITHUB_TOKEN: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  TURNSTILE_SECRET: string;
  ALLOWED_ORIGIN: string;
  GOOGLE_CLIENT_ID: string;
  BUCKET: R2Bucket;
  R2_PUBLIC_BASE_URL: string;
}

type ResourceType = "Test Bank" | "Past Paper" | "Summary" | "Other";

interface CourseCatalogEntry {
  id: string;
  name: string;
  tracks: string[];
}

interface VerifiedStudentIdentity {
  sub: string;
}

interface ValidatedSubmissionPayload {
  courseId: string;
  type: ResourceType;
  title: string;
  semester: string;
  contributor: string | null;
  turnstileToken: string;
  fileName: string;
  fileExtension: string;
  fileMimeType: string;
  fileBytes: Uint8Array;
}

interface StoredR2Asset {
  objectKey: string;
  assetUrl: string;
}

interface SubmissionRecord {
  id: string;
  course_id: string;
  type: ResourceType;
  title: string;
  semester: string;
  asset_url: string;
  contributor: string | null;
  created_at: string;
}

interface TurnstileVerifyResponse {
  success?: boolean;
  "error-codes"?: string[];
}

interface GitHubRefResponse {
  ref?: string;
  object?: {
    sha?: string;
    type?: string;
  };
}

interface GitHubContentResponse {
  content?: {
    name?: string;
    path?: string;
    sha?: string;
  };
}

interface GitHubPullRequestResponse {
  number?: number;
  html_url?: string;
}

const MAX_BODY_SIZE_BYTES = 25 * 1024 * 1024; // 26,214,400 bytes (25 MiB)
const UPSTREAM_TIMEOUT_MS = 15_000;
const TURNSTILE_VERIFY_ENDPOINT = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const GITHUB_API_BASE = "https://api.github.com";
const GITHUB_API_VERSION = "2022-11-28";
const WORKER_USER_AGENT = "root-archive-worker/1.0";

const GOOGLE_JWKS_URL = new URL("https://www.googleapis.com/oauth2/v3/certs");
const GOOGLE_JWKS = createRemoteJWKSet(GOOGLE_JWKS_URL, {
  timeoutDuration: UPSTREAM_TIMEOUT_MS,
  cooldownDuration: 30_000,
});
const GOOGLE_ALLOWED_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const PERMITTED_UNIVERSITY_DOMAIN = "std.aum.edu.jo";
const MIN_JWT_LENGTH = 64;
const MAX_JWT_LENGTH = 4096;
const COMPACT_JWS_REGEX = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const MIN_REASONABLE_IAT_SECONDS = 1700000000; // 2023-11-14T22:13:20Z
const MAX_TOKEN_AGE_SECONDS = 86400; // 24 hours
const CLOCK_SKEW_TOLERANCE_SECONDS = 30;

const COURSE_ID_REGEX = /^\d{6,7}$/;
const CONTROL_CHARS_REGEX = /[\x00-\x1F\x7F-\x9F]/;
const LOCALHOST_ORIGIN_REGEX = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;
const GIT_SHA_REGEX = /^[0-9a-f]{40}$/i;

/**
 * Authoritative allowlist of official AUM course IDs imported directly from
 * ../site/courses.json at build time (127 unique courses across Cybersecurity, CS, and AI).
 */
const KNOWN_COURSE_IDS: ReadonlySet<string> = new Set<string>(
  Array.isArray(rawCoursesCatalog)
    ? (rawCoursesCatalog as CourseCatalogEntry[])
        .map((entry) => (typeof entry?.id === "string" ? entry.id.trim() : ""))
        .filter((id) => COURSE_ID_REGEX.test(id))
    : []
);

const PERMITTED_RESOURCE_TYPES: ReadonlySet<ResourceType> = new Set<ResourceType>([
  "Test Bank",
  "Past Paper",
  "Summary",
  "Other",
]);

const PERMITTED_FORM_FIELDS: ReadonlySet<string> = new Set<string>([
  "course_id",
  "type",
  "title",
  "semester",
  "file",
  "turnstile_token",
  "contributor",
]);

interface FileTypePolicy {
  canonicalMime: string;
  allowedMimes: ReadonlySet<string>;
  signature: readonly number[];
  disposition: "inline" | "attachment";
}

const FILE_TYPE_POLICIES: Readonly<Record<string, FileTypePolicy>> = {
  ".pdf": {
    canonicalMime: "application/pdf",
    allowedMimes: new Set(["application/pdf"]),
    signature: [0x25, 0x50, 0x44, 0x46, 0x2d], // %PDF-
    disposition: "inline",
  },
  ".docx": {
    canonicalMime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    allowedMimes: new Set([
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]),
    signature: [0x50, 0x4b, 0x03, 0x04], // PK.. (ZIP container)
    disposition: "attachment",
  },
  ".zip": {
    canonicalMime: "application/zip",
    allowedMimes: new Set([
      "application/zip",
      "application/x-zip-compressed",
      "multipart/x-zip",
    ]),
    signature: [0x50, 0x4b, 0x03, 0x04], // PK..
    disposition: "attachment",
  },
  ".png": {
    canonicalMime: "image/png",
    allowedMimes: new Set(["image/png"]),
    signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], // PNG header
    disposition: "inline",
  },
  ".jpg": {
    canonicalMime: "image/jpeg",
    allowedMimes: new Set(["image/jpeg", "image/pjpeg"]),
    signature: [0xff, 0xd8, 0xff], // JPEG SOI + marker
    disposition: "inline",
  },
};

class WorkerHttpError extends Error {
  public readonly status: number;
  public readonly clientMessage: string;

  constructor(status: number, clientMessage: string) {
    super(clientMessage);
    this.name = "WorkerHttpError";
    this.status = status;
    this.clientMessage = clientMessage;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let matchedCorsOrigin: string | null = null;

    try {
      // 1. Validate required Worker environment bindings and configured origin(s)
      const configuredOrigins = validateEnvBindingsAndGetOrigins(env);
      const requestOrigin = request.headers.get("Origin");
      matchedCorsOrigin = resolvePermittedOrigin(requestOrigin, configuredOrigins);

      if (!matchedCorsOrigin) {
        return createJsonErrorResponse(
          403,
          "Forbidden: Origin is missing or not permitted.",
          null
        );
      }

      const method = request.method.toUpperCase();
      if (method !== "OPTIONS" && method !== "POST") {
        return createJsonErrorResponse(
          405,
          "Method not allowed. Only POST and OPTIONS are supported.",
          matchedCorsOrigin,
          { Allow: "POST, OPTIONS" }
        );
      }

      // 2. Check that the request targets a supported endpoint
      const url = new URL(request.url);
      const pathname = url.pathname.replace(/\/+$/, "") || "/";
      const isAuthVerifyRoute = pathname === "/auth/verify";
      const isSubmissionRoute = pathname === "/" || pathname === "/submit";

      if (!isAuthVerifyRoute && !isSubmissionRoute) {
        return createJsonErrorResponse(
          404,
          "Endpoint not found.",
          matchedCorsOrigin
        );
      }

      // Handle CORS preflight without requiring a Google ID token
      if (method === "OPTIONS") {
        return createJsonResponse(200, { success: true }, matchedCorsOrigin);
      }

      // 3, 4 & 5. Validate Authorization header, verify Google ID token & check @std.aum.edu.jo eligibility
      await verifyGoogleStudentToken(request, env);

      // Minimal authorization-check endpoint (does not read multipart, write to R2, or mutate GitHub)
      if (isAuthVerifyRoute) {
        return createJsonResponse(
          200,
          {
            success: true,
            authorized: true,
          },
          matchedCorsOrigin
        );
      }

      // 6. Validate multipart Content-Type and request-size constraints
      const contentTypeHeader = request.headers.get("Content-Type");
      if (!isMultipartFormData(contentTypeHeader)) {
        return createJsonErrorResponse(
          415,
          "Unsupported Media Type: Content-Type must be multipart/form-data.",
          matchedCorsOrigin
        );
      }

      // 7. Read and validate multipart body (enforces 25 MiB limit before buffering past limit)
      const formData = await parseMultipartWithByteLimit(request, MAX_BODY_SIZE_BYTES);

      // 8 & 9. Validate submitted course against authoritative 127-course catalog, plus metadata and binary file
      const payload = await validateAndExtractPayload(formData);

      // 10. Verify Cloudflare Turnstile token server-side
      const clientIp = request.headers.get("CF-Connecting-IP");
      await verifyTurnstileToken(
        env.TURNSTILE_SECRET,
        payload.turnstileToken,
        clientIp
      );

      // 11. Store binary file in Cloudflare R2
      const timestamp = Date.now();
      const submissionId = `${timestamp}-${crypto.randomUUID().slice(0, 8)}`;
      const createdAt = new Date(timestamp).toISOString();

      const { objectKey, assetUrl } = await storeFileInR2(
        env,
        submissionId,
        createdAt,
        payload
      );

      const submissionRecord: SubmissionRecord = {
        id: submissionId,
        course_id: payload.courseId,
        type: payload.type,
        title: payload.title,
        semester: payload.semester,
        asset_url: assetUrl,
        contributor: payload.contributor,
        created_at: createdAt,
      };

      // 12. Create GitHub submission JSON and PR; roll back R2 object if GitHub fails
      let prUrl: string;
      try {
        prUrl = await orchestrateGitHubPullRequest(env, timestamp, submissionRecord);
      } catch (githubError: unknown) {
        await env.BUCKET.delete(objectKey).catch(() => undefined);
        throw githubError;
      }

      // 13. Return existing success response
      return createJsonResponse(
        201,
        {
          success: true,
          pr_url: prUrl,
          asset_url: assetUrl,
        },
        matchedCorsOrigin
      );
    } catch (error: unknown) {
      if (error instanceof WorkerHttpError) {
        return createJsonErrorResponse(
          error.status,
          error.clientMessage,
          matchedCorsOrigin
        );
      }

      return createJsonErrorResponse(
        500,
        "An unexpected internal server error occurred.",
        matchedCorsOrigin
      );
    }
  },
};

/**
 * Validates that all eight required environment bindings and the bundled course catalog are present.
 * Supports a single origin or comma-separated list of explicit origins in ALLOWED_ORIGIN.
 */
function validateEnvBindingsAndGetOrigins(env: Env): string[] {
  if (!env || typeof env !== "object" || KNOWN_COURSE_IDS.size === 0) {
    throw new WorkerHttpError(500, "Server configuration error.");
  }

  const requiredStrings: Array<keyof Omit<Env, "BUCKET">> = [
    "GITHUB_TOKEN",
    "GITHUB_OWNER",
    "GITHUB_REPO",
    "TURNSTILE_SECRET",
    "ALLOWED_ORIGIN",
    "GOOGLE_CLIENT_ID",
    "R2_PUBLIC_BASE_URL",
  ];

  for (const key of requiredStrings) {
    const value = env[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new WorkerHttpError(500, "Server configuration error.");
    }
  }

  if (
    !env.BUCKET ||
    typeof env.BUCKET.put !== "function" ||
    typeof env.BUCKET.delete !== "function"
  ) {
    throw new WorkerHttpError(500, "Server configuration error.");
  }

  try {
    const r2BaseUrl = new URL(env.R2_PUBLIC_BASE_URL.trim());
    if (r2BaseUrl.protocol !== "https:") {
      throw new Error("R2 public base URL must use HTTPS");
    }

    const rawOrigins = env.ALLOWED_ORIGIN.split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    if (rawOrigins.length === 0) {
      throw new Error("No allowed origins configured");
    }

    const validatedOrigins: string[] = [];
    for (const candidate of rawOrigins) {
      const originUrl = new URL(candidate);
      if (originUrl.protocol === "https:") {
        validatedOrigins.push(originUrl.origin);
      } else if (
        originUrl.protocol === "http:" &&
        LOCALHOST_ORIGIN_REGEX.test(originUrl.origin)
      ) {
        validatedOrigins.push(originUrl.origin);
      } else {
        throw new Error("Invalid origin protocol");
      }
    }

    return validatedOrigins;
  } catch {
    throw new WorkerHttpError(500, "Server configuration error.");
  }
}

/**
 * Resolves whether the incoming Origin header is explicitly permitted.
 * Localhost origins are only accepted if ALLOWED_ORIGIN explicitly includes a localhost origin
 * (e.g., in local .dev.vars), ensuring localhost exceptions never remain open in production.
 */
function resolvePermittedOrigin(
  requestOrigin: string | null,
  configuredOrigins: readonly string[]
): string | null {
  if (!requestOrigin || typeof requestOrigin !== "string") {
    return null;
  }

  const normalizedRequestOrigin = requestOrigin.trim().replace(/\/+$/, "");
  for (const configured of configuredOrigins) {
    if (normalizedRequestOrigin === configured) {
      return normalizedRequestOrigin;
    }

    // If a localhost development origin was explicitly configured, allow its 127.0.0.1/localhost equivalent on the same port
    if (
      LOCALHOST_ORIGIN_REGEX.test(configured) &&
      LOCALHOST_ORIGIN_REGEX.test(normalizedRequestOrigin)
    ) {
      const configuredUrl = new URL(configured);
      const requestUrl = new URL(normalizedRequestOrigin);
      if (configuredUrl.port === requestUrl.port) {
        return normalizedRequestOrigin;
      }
    }
  }

  return null;
}

/**
 * Validates the Authorization header, cryptographically verifies the Google ID token via Google's
 * public JWKS, and enforces exact @std.aum.edu.jo institutional eligibility.
 */
async function verifyGoogleStudentToken(
  request: Request,
  env: Env
): Promise<VerifiedStudentIdentity> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || typeof authHeader !== "string" || CONTROL_CHARS_REGEX.test(authHeader)) {
    throw new WorkerHttpError(401, "Authentication required or invalid.");
  }

  const bearerMatch = /^Bearer\s+([^\s]+)$/.exec(authHeader.trim());
  if (!bearerMatch) {
    throw new WorkerHttpError(401, "Authentication required or invalid.");
  }

  const token = bearerMatch[1];
  if (
    token.length < MIN_JWT_LENGTH ||
    token.length > MAX_JWT_LENGTH ||
    !COMPACT_JWS_REGEX.test(token)
  ) {
    throw new WorkerHttpError(401, "Authentication required or invalid.");
  }

  let payload: Record<string, unknown>;
  try {
    const verificationResult = await jwtVerify(token, GOOGLE_JWKS, {
      algorithms: ["RS256"],
      issuer: GOOGLE_ALLOWED_ISSUERS,
      audience: env.GOOGLE_CLIENT_ID.trim(),
      clockTolerance: CLOCK_SKEW_TOLERANCE_SECONDS,
    });
    payload = verificationResult.payload as Record<string, unknown>;
  } catch (err: unknown) {
    if (
      err instanceof joseErrors.JWKSTimeout ||
      (err instanceof Error &&
        err.name === "TypeError" &&
        !(err instanceof joseErrors.JOSEError))
    ) {
      throw new WorkerHttpError(
        503,
        "Upstream Google authentication verification service is temporarily unavailable."
      );
    }
    throw new WorkerHttpError(401, "Authentication required or invalid.");
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const exp = payload.exp;
  const iat = payload.iat;
  const sub = payload.sub;
  const email = payload.email;
  const emailVerified = payload.email_verified;

  if (
    typeof exp !== "number" ||
    !Number.isFinite(exp) ||
    exp + CLOCK_SKEW_TOLERANCE_SECONDS <= nowSeconds
  ) {
    throw new WorkerHttpError(401, "Authentication required or invalid.");
  }

  if (
    typeof iat !== "number" ||
    !Number.isFinite(iat) ||
    iat < MIN_REASONABLE_IAT_SECONDS ||
    iat > nowSeconds + CLOCK_SKEW_TOLERANCE_SECONDS ||
    nowSeconds - iat > MAX_TOKEN_AGE_SECONDS
  ) {
    throw new WorkerHttpError(401, "Authentication required or invalid.");
  }

  if (
    typeof sub !== "string" ||
    sub.trim().length === 0 ||
    sub.length > 255 ||
    CONTROL_CHARS_REGEX.test(sub)
  ) {
    throw new WorkerHttpError(401, "Authentication required or invalid.");
  }

  if (
    typeof email !== "string" ||
    email.trim().length === 0 ||
    email.length > 320 ||
    CONTROL_CHARS_REGEX.test(email) ||
    emailVerified !== true
  ) {
    throw new WorkerHttpError(401, "Authentication required or invalid.");
  }

  const hd = payload.hd;
  if (
    typeof hd !== "string" ||
    hd.trim().toLowerCase() !== PERMITTED_UNIVERSITY_DOMAIN ||
    !isExactUniversityEmail(email, PERMITTED_UNIVERSITY_DOMAIN)
  ) {
    throw new WorkerHttpError(
      403,
      "Forbidden: Uploads require an authenticated @std.aum.edu.jo student account."
    );
  }

  return { sub: sub.trim() };
}

function isExactUniversityEmail(email: string, expectedDomain: string): boolean {
  const normalized = email.trim().toLowerCase();
  const atIndex = normalized.indexOf("@");
  if (atIndex <= 0 || atIndex !== normalized.lastIndexOf("@")) {
    return false;
  }
  const localPart = normalized.slice(0, atIndex);
  const domainPart = normalized.slice(atIndex + 1);
  if (localPart.length === 0 || CONTROL_CHARS_REGEX.test(normalized)) {
    return false;
  }
  return domainPart === expectedDomain;
}

/**
 * Builds standard response headers including strict CORS headers for the verified origin.
 */
function buildResponseHeaders(
  allowedOrigin: string | null,
  extraHeaders?: Record<string, string>
): Headers {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
    Vary: "Origin",
  });

  if (allowedOrigin) {
    headers.set("Access-Control-Allow-Origin", allowedOrigin);
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    headers.set("Access-Control-Max-Age", "86400");
  }

  if (extraHeaders) {
    for (const [key, value] of Object.entries(extraHeaders)) {
      headers.set(key, value);
    }
  }

  return headers;
}

function createJsonResponse(
  status: number,
  payload: Record<string, unknown>,
  allowedOrigin: string | null,
  extraHeaders?: Record<string, string>
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: buildResponseHeaders(allowedOrigin, extraHeaders),
  });
}

function createJsonErrorResponse(
  status: number,
  errorMessage: string,
  allowedOrigin: string | null,
  extraHeaders?: Record<string, string>
): Response {
  return createJsonResponse(
    status,
    {
      success: false,
      error: errorMessage,
    },
    allowedOrigin,
    extraHeaders
  );
}

function isMultipartFormData(contentTypeHeader: string | null): boolean {
  if (!contentTypeHeader || typeof contentTypeHeader !== "string") {
    return false;
  }

  const trimmed = contentTypeHeader.trim();
  const lower = trimmed.toLowerCase();
  if (!lower.startsWith("multipart/form-data")) {
    return false;
  }

  const nextChar = lower.charAt("multipart/form-data".length);
  if (nextChar !== "" && nextChar !== ";" && nextChar !== " ") {
    return false;
  }

  return /;\s*boundary=[^\s;]+/i.test(trimmed);
}

async function parseMultipartWithByteLimit(
  request: Request,
  maxBytes: number
): Promise<FormData> {
  const contentLengthHeader = request.headers.get("Content-Length");
  if (contentLengthHeader !== null && contentLengthHeader.trim() !== "") {
    if (!/^\d+$/.test(contentLengthHeader.trim())) {
      throw new WorkerHttpError(400, "Invalid Content-Length header.");
    }
    const declaredLength = Number(contentLengthHeader.trim());
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
      throw new WorkerHttpError(400, "Invalid Content-Length header.");
    }
    if (declaredLength > maxBytes) {
      throw new WorkerHttpError(
        413,
        "Payload Too Large: Request body exceeds the 25 MiB limit."
      );
    }
  }

  if (!request.body) {
    throw new WorkerHttpError(400, "Request body is empty.");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel("Payload exceeded maximum size of 25 MiB").catch(() => undefined);
          throw new WorkerHttpError(
            413,
            "Payload Too Large: Request body exceeds the 25 MiB limit."
          );
        }
        chunks.push(value);
      }
    }
  } catch (err: unknown) {
    if (err instanceof WorkerHttpError) {
      throw err;
    }
    throw new WorkerHttpError(400, "Failed to read request body stream.");
  }

  if (totalBytes === 0) {
    throw new WorkerHttpError(400, "Request body cannot be empty.");
  }

  const rawBody = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    rawBody.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const syntheticRequest = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: rawBody,
    });
    return await syntheticRequest.formData();
  } catch {
    throw new WorkerHttpError(400, "Malformed multipart/form-data payload.");
  }
}

async function validateAndExtractPayload(
  formData: FormData
): Promise<ValidatedSubmissionPayload> {
  const seenKeys = new Set<string>();
  for (const [key] of formData.entries()) {
    if (!PERMITTED_FORM_FIELDS.has(key)) {
      throw new WorkerHttpError(400, `Unexpected form field: ${sanitizeFieldName(key)}.`);
    }
    if (seenKeys.has(key)) {
      throw new WorkerHttpError(
        400,
        `Duplicate form field is not allowed: ${sanitizeFieldName(key)}.`
      );
    }
    seenKeys.add(key);
  }

  // 1. Validate course_id format (6-7 digits) AND membership in the official 127-course catalog
  const rawCourseId = formData.get("course_id");
  if (typeof rawCourseId !== "string") {
    throw new WorkerHttpError(400, "Field 'course_id' is required and must be a string.");
  }
  const courseId = rawCourseId.trim();
  if (
    courseId.length < 6 ||
    courseId.length > 7 ||
    CONTROL_CHARS_REGEX.test(courseId) ||
    !COURSE_ID_REGEX.test(courseId) ||
    !KNOWN_COURSE_IDS.has(courseId)
  ) {
    throw new WorkerHttpError(
      400,
      "Invalid 'course_id'. Course ID must exist in the official course catalog."
    );
  }

  // 2. Validate type
  const rawType = formData.get("type");
  if (typeof rawType !== "string") {
    throw new WorkerHttpError(400, "Field 'type' is required and must be a string.");
  }
  if (!PERMITTED_RESOURCE_TYPES.has(rawType as ResourceType)) {
    throw new WorkerHttpError(
      400,
      "Invalid 'type'. Must be one of: Test Bank, Past Paper, Summary, Other."
    );
  }
  const resourceType = rawType as ResourceType;

  // 3. Validate title
  const rawTitle = formData.get("title");
  if (typeof rawTitle !== "string") {
    throw new WorkerHttpError(400, "Field 'title' is required and must be a string.");
  }
  if (CONTROL_CHARS_REGEX.test(rawTitle)) {
    throw new WorkerHttpError(
      400,
      "Field 'title' must not contain line breaks or control characters."
    );
  }
  const title = rawTitle.trim().replace(/[ \t]+/g, " ");
  if (title.length < 3 || title.length > 120) {
    throw new WorkerHttpError(
      400,
      "Field 'title' must be between 3 and 120 characters after trimming."
    );
  }

  // 4. Validate semester
  const rawSemester = formData.get("semester");
  if (typeof rawSemester !== "string") {
    throw new WorkerHttpError(400, "Field 'semester' is required and must be a string.");
  }
  if (CONTROL_CHARS_REGEX.test(rawSemester)) {
    throw new WorkerHttpError(
      400,
      "Field 'semester' must not contain line breaks or control characters."
    );
  }
  const semester = rawSemester.trim().replace(/[ \t]+/g, " ");
  if (semester.length < 4 || semester.length > 20) {
    throw new WorkerHttpError(
      400,
      "Field 'semester' must be between 4 and 20 characters after trimming."
    );
  }

  // 5. Validate contributor (optional public display handle; never used for authentication)
  let contributor: string | null = null;
  if (formData.has("contributor")) {
    const rawContributor = formData.get("contributor");
    if (rawContributor !== null) {
      if (typeof rawContributor !== "string") {
        throw new WorkerHttpError(400, "Field 'contributor' must be a string if provided.");
      }
      if (CONTROL_CHARS_REGEX.test(rawContributor)) {
        throw new WorkerHttpError(
          400,
          "Field 'contributor' must not contain line breaks or control characters."
        );
      }
      const normalizedContributor = rawContributor.trim().replace(/[ \t]+/g, " ");
      if (normalizedContributor.length > 40) {
        throw new WorkerHttpError(
          400,
          "Field 'contributor' must not exceed 40 characters."
        );
      }
      contributor = normalizedContributor.length > 0 ? normalizedContributor : null;
    }
  }

  // 6. Validate turnstile_token
  const rawTurnstileToken = formData.get("turnstile_token");
  if (typeof rawTurnstileToken !== "string") {
    throw new WorkerHttpError(400, "Field 'turnstile_token' is required and must be a string.");
  }
  const turnstileToken = rawTurnstileToken.trim();
  if (
    turnstileToken.length === 0 ||
    turnstileToken.length > 2048 ||
    CONTROL_CHARS_REGEX.test(turnstileToken)
  ) {
    throw new WorkerHttpError(400, "Field 'turnstile_token' is missing or invalid.");
  }

  // 7. Validate file
  const rawFile = formData.get("file");
  if (!(rawFile instanceof File)) {
    throw new WorkerHttpError(400, "Field 'file' is required and must be an uploaded file.");
  }
  if (rawFile.size <= 0) {
    throw new WorkerHttpError(400, "Uploaded file cannot be empty.");
  }
  if (rawFile.size > MAX_BODY_SIZE_BYTES) {
    throw new WorkerHttpError(
      413,
      "Payload Too Large: Uploaded file exceeds the 25 MiB limit."
    );
  }

  const originalName = rawFile.name ? rawFile.name.trim() : "";
  if (originalName.length === 0 || CONTROL_CHARS_REGEX.test(originalName)) {
    throw new WorkerHttpError(400, "Uploaded file must have a valid filename.");
  }

  const extensionMatch = /\.[a-zA-Z0-9]+$/.exec(originalName);
  if (!extensionMatch) {
    throw new WorkerHttpError(
      400,
      "Uploaded file must have a valid extension (.pdf, .docx, .zip, .png, .jpg)."
    );
  }

  const extension = extensionMatch[0].toLowerCase();
  const policy = FILE_TYPE_POLICIES[extension];
  if (!policy) {
    throw new WorkerHttpError(
      400,
      "Unsupported file extension. Permitted extensions are: .pdf, .docx, .zip, .png, .jpg."
    );
  }

  const submittedMime = rawFile.type.split(";")[0].trim().toLowerCase();
  if (!policy.allowedMimes.has(submittedMime)) {
    throw new WorkerHttpError(
      400,
      "File MIME type does not match the permitted type for its file extension."
    );
  }

  let fileBuffer: ArrayBuffer;
  try {
    fileBuffer = await rawFile.arrayBuffer();
  } catch {
    throw new WorkerHttpError(400, "Failed to read uploaded file content.");
  }

  if (fileBuffer.byteLength <= 0) {
    throw new WorkerHttpError(400, "Uploaded file cannot be empty.");
  }
  if (fileBuffer.byteLength > MAX_BODY_SIZE_BYTES) {
    throw new WorkerHttpError(
      413,
      "Payload Too Large: Uploaded file exceeds the 25 MiB limit."
    );
  }

  const fileBytes = new Uint8Array(fileBuffer);
  if (!matchesFileSignature(fileBytes, policy.signature)) {
    throw new WorkerHttpError(
      400,
      "Uploaded file content does not match the expected binary signature for its extension."
    );
  }

  return {
    courseId,
    type: resourceType,
    title,
    semester,
    contributor,
    turnstileToken,
    fileName: originalName,
    fileExtension: extension,
    fileMimeType: policy.canonicalMime,
    fileBytes,
  };
}

function sanitizeFieldName(fieldName: string): string {
  return fieldName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 32);
}

function matchesFileSignature(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.byteLength < signature.length) {
    return false;
  }
  for (let i = 0; i < signature.length; i++) {
    if (bytes[i] !== signature[i]) {
      return false;
    }
  }
  return true;
}

async function verifyTurnstileToken(
  secret: string,
  token: string,
  clientIp: string | null
): Promise<void> {
  const formBody = new URLSearchParams();
  formBody.set("secret", secret);
  formBody.set("response", token);
  if (clientIp && clientIp.trim().length > 0) {
    formBody.set("remoteip", clientIp.trim());
  }

  let response: Response;
  try {
    response = await fetch(TURNSTILE_VERIFY_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": WORKER_USER_AGENT,
      },
      body: formBody.toString(),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    throw new WorkerHttpError(
      502,
      "Upstream error while contacting Turnstile verification service."
    );
  }

  if (!response.ok) {
    throw new WorkerHttpError(
      502,
      "Turnstile verification service returned an unexpected HTTP status."
    );
  }

  let data: TurnstileVerifyResponse;
  try {
    data = (await response.json()) as TurnstileVerifyResponse;
  } catch {
    throw new WorkerHttpError(
      502,
      "Received malformed response from Turnstile verification service."
    );
  }

  if (!data || typeof data !== "object" || data.success !== true) {
    throw new WorkerHttpError(403, "Turnstile verification failed.");
  }
}

function sanitizeFilename(originalFilename: string): string {
  const baseName = originalFilename.split(/[/\\]/).pop() ?? "resource";

  const extMatch = /\.[a-zA-Z0-9]+$/.exec(baseName);
  const ext = extMatch ? extMatch[0].toLowerCase() : "";
  const rawStem = extMatch ? baseName.slice(0, -ext.length) : baseName;

  let sanitizedStem = rawStem
    .replace(/[^a-zA-Z0-9.-]/g, "_")
    .replace(/\.{2,}/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 100);

  if (sanitizedStem.length === 0) {
    sanitizedStem = "resource";
  }

  return `${sanitizedStem}${ext}`;
}

/**
 * Stores the validated file in Cloudflare R2 and returns both the objectKey (for rollback)
 * and the public HTTPS assetUrl. Does not store student email or Google identifiers.
 */
async function storeFileInR2(
  env: Env,
  submissionId: string,
  createdAt: string,
  payload: ValidatedSubmissionPayload
): Promise<StoredR2Asset> {
  const sanitizedFilename = sanitizeFilename(payload.fileName);
  const objectKey = `assets/${payload.courseId}/${submissionId}-${sanitizedFilename}`;
  const policy = FILE_TYPE_POLICIES[payload.fileExtension];
  const dispositionType = policy ? policy.disposition : "attachment";

  try {
    const putResult = await env.BUCKET.put(objectKey, payload.fileBytes, {
      httpMetadata: {
        contentType: payload.fileMimeType,
        contentDisposition: `${dispositionType}; filename="${sanitizedFilename}"`,
      },
      customMetadata: {
        submission_id: submissionId,
        course_id: payload.courseId,
        resource_type: payload.type,
        created_at: createdAt,
      },
    });

    if (!putResult) {
      throw new Error("R2 put returned null");
    }
  } catch {
    throw new WorkerHttpError(502, "Failed to store uploaded file in object storage.");
  }

  const normalizedBaseUrl = env.R2_PUBLIC_BASE_URL.trim().replace(/\/+$/, "");
  const assetUrl = `${normalizedBaseUrl}/assets/${payload.courseId}/${submissionId}-${sanitizedFilename}`;

  try {
    const parsed = new URL(assetUrl);
    if (parsed.protocol !== "https:") {
      throw new Error("Non-HTTPS asset URL");
    }
  } catch {
    await env.BUCKET.delete(objectKey).catch(() => undefined);
    throw new WorkerHttpError(500, "Failed to construct a valid public asset URL.");
  }

  return { objectKey, assetUrl };
}

function encodeUtf8ToBase64(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const chunkSize = 0x8000;
  const chunks: string[] = [];

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    let binaryChunk = "";
    for (let j = 0; j < slice.length; j++) {
      binaryChunk += String.fromCharCode(slice[j]);
    }
    chunks.push(binaryChunk);
  }

  return btoa(chunks.join(""));
}

function generateRandomHex(byteCount: number): string {
  const randomBytes = new Uint8Array(byteCount);
  crypto.getRandomValues(randomBytes);
  let hex = "";
  for (let i = 0; i < randomBytes.length; i++) {
    hex += randomBytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

function escapeMarkdownTableCell(value: string): string {
  return value
    .replace(/[\r\n]+/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/`/g, "\\`")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .trim();
}

function buildPullRequestBody(record: SubmissionRecord): string {
  const safeId = escapeMarkdownTableCell(record.id);
  const safeCourseId = escapeMarkdownTableCell(record.course_id);
  const safeType = escapeMarkdownTableCell(record.type);
  const safeTitle = escapeMarkdownTableCell(record.title);
  const safeSemester = escapeMarkdownTableCell(record.semester);
  const safeContributor = record.contributor
    ? escapeMarkdownTableCell(record.contributor)
    : "Anonymous";
  const safeCreatedAt = escapeMarkdownTableCell(record.created_at);

  const safeAssetUrl = record.asset_url
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/\|/g, "%7C");

  return [
    "### New Resource Submission",
    "",
    "| Field | Value |",
    "| :--- | :--- |",
    `| **Submission ID** | \`${safeId}\` |`,
    `| **Course ID** | \`${safeCourseId}\` |`,
    `| **Resource Type** | ${safeType} |`,
    `| **Title** | ${safeTitle} |`,
    `| **Semester** | ${safeSemester} |`,
    `| **Contributor** | ${safeContributor} |`,
    `| **Creation Timestamp** | \`${safeCreatedAt}\` |`,
    `| **Asset URL (R2)** | [Verify Uploaded File](${safeAssetUrl}) |`,
    "",
    "---",
    "*Automated submission generated by `root-archive-worker`.*",
  ].join("\n");
}

async function githubApiRequest<T>(
  env: Env,
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: Record<string, unknown>
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${env.GITHUB_TOKEN.trim()}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": GITHUB_API_VERSION,
    "User-Agent": WORKER_USER_AGENT,
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json; charset=utf-8";
  }

  let response: Response;
  try {
    response = await fetch(`${GITHUB_API_BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    throw new WorkerHttpError(
      502,
      "Upstream network error while communicating with GitHub API."
    );
  }

  if (!response.ok) {
    throw new WorkerHttpError(502, "Upstream GitHub API operation failed.");
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new WorkerHttpError(
      502,
      "Received malformed JSON response from GitHub API."
    );
  }
}

async function orchestrateGitHubPullRequest(
  env: Env,
  timestamp: number,
  record: SubmissionRecord
): Promise<string> {
  const encodedOwner = encodeURIComponent(env.GITHUB_OWNER.trim());
  const encodedRepo = encodeURIComponent(env.GITHUB_REPO.trim());
  const repoBasePath = `/repos/${encodedOwner}/${encodedRepo}`;

  // Step 1: Retrieve the main branch commit SHA
  const refData = await githubApiRequest<GitHubRefResponse>(
    env,
    "GET",
    `${repoBasePath}/git/ref/heads/main`
  );

  const mainSha = refData?.object?.sha;
  if (typeof mainSha !== "string" || !GIT_SHA_REGEX.test(mainSha)) {
    throw new WorkerHttpError(
      502,
      "Unable to verify main branch commit SHA from GitHub."
    );
  }

  // Step 2: Create a dedicated submission branch
  const randomHex = generateRandomHex(6);
  const branchName = `submission-${timestamp}-${randomHex}`;
  const fullRefName = `refs/heads/${branchName}`;

  const createdRef = await githubApiRequest<GitHubRefResponse>(
    env,
    "POST",
    `${repoBasePath}/git/refs`,
    {
      ref: fullRefName,
      sha: mainSha,
    }
  );

  if (!createdRef || typeof createdRef.ref !== "string") {
    throw new WorkerHttpError(
      502,
      "Failed to confirm new submission branch creation on GitHub."
    );
  }

  // Step 3: Commit the submission JSON file to repository-root submissions/
  const submissionFilePath = `submissions/${timestamp}-${record.id}.json`;
  const serializedJson = JSON.stringify(record, null, 2);
  const base64Content = encodeUtf8ToBase64(serializedJson);
  const commitMessage = `feat(submission): add ${record.type} for ${record.course_id} - ${record.title}`;

  const contentResponse = await githubApiRequest<GitHubContentResponse>(
    env,
    "PUT",
    `${repoBasePath}/contents/${submissionFilePath}`,
    {
      message: commitMessage,
      content: base64Content,
      branch: branchName,
    }
  );

  if (!contentResponse?.content?.sha) {
    throw new WorkerHttpError(
      502,
      "Failed to confirm submission file commit on GitHub."
    );
  }

  // Step 4: Open a pull request
  const prTitle = `[Submission] ${record.course_id}: ${record.title} (${record.type})`;
  const prBody = buildPullRequestBody(record);

  const prResponse = await githubApiRequest<GitHubPullRequestResponse>(
    env,
    "POST",
    `${repoBasePath}/pulls`,
    {
      title: prTitle,
      head: branchName,
      base: "main",
      body: prBody,
    }
  );

  const prUrl = prResponse?.html_url;
  if (typeof prUrl !== "string" || !prUrl.startsWith("https://github.com/")) {
    throw new WorkerHttpError(
      502,
      "Failed to retrieve a valid pull request URL from GitHub."
    );
  }

  return prUrl;
}
