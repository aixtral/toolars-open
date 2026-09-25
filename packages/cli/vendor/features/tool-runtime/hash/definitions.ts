import type { ToolPrivacyContract } from "@/domain/privacy/types";

export const HASH_TOOL_SLUGS = [
  "md5-hash-checker",
  "sha1-hash-checker",
  "sha224-hash-checker",
  "sha256-hash-checker",
  "sha384-hash-checker",
  "sha512-hash-checker",
] as const;

export type HashToolSlug = (typeof HASH_TOOL_SLUGS)[number];

export type HashAlgorithm =
  "md5" | "sha1" | "sha224" | "sha256" | "sha384" | "sha512";

export const MAX_HASH_INPUT_BYTES = 1_048_576;
export const MAX_HASH_FILE_BYTES = 256 * 1024 * 1024;
export const HASH_FILE_CHUNK_BYTES = 1024 * 1024;

export const LOCAL_HASH_PRIVACY = {
  processingLocation: "browser",
  inputLeavesDevice: false,
  retention: "none",
} as const satisfies ToolPrivacyContract;

export type HashToolDefinition = Readonly<{
  slug: HashToolSlug;
  name: string;
  algorithm: HashAlgorithm;
  algorithmLabel: string;
  digestLength: number;
  sampleInput: string;
  sampleDigest: string;
  downloadFileName: string;
}>;

type HashToolDefinitions = {
  readonly [S in HashToolSlug]: HashToolDefinition & Readonly<{ slug: S }>;
};

export const HASH_TOOL_DEFINITIONS = {
  "md5-hash-checker": {
    slug: "md5-hash-checker",
    name: "MD5 Hash & Verify",
    algorithm: "md5",
    algorithmLabel: "MD5",
    digestLength: 32,
    sampleInput: "Toolars",
    sampleDigest: "92511797d229ab55bd7427e04b040fb8",
    downloadFileName: "toolars-md5-digest.txt",
  },
  "sha1-hash-checker": {
    slug: "sha1-hash-checker",
    name: "SHA-1 Hash & Verify",
    algorithm: "sha1",
    algorithmLabel: "SHA-1",
    digestLength: 40,
    sampleInput: "Toolars",
    sampleDigest: "7851163e1781f5c628c93a74dc19191a98ce7237",
    downloadFileName: "toolars-sha1-digest.txt",
  },
  "sha224-hash-checker": {
    slug: "sha224-hash-checker",
    name: "SHA-224 Hash & Verify",
    algorithm: "sha224",
    algorithmLabel: "SHA-224",
    digestLength: 56,
    sampleInput: "Toolars",
    sampleDigest: "530510bf3c11aa5dbd5ed0f115911cc49344f210a6cc08a329678bf8",
    downloadFileName: "toolars-sha224-digest.txt",
  },
  "sha256-hash-checker": {
    slug: "sha256-hash-checker",
    name: "SHA-256 Hash & Verify",
    algorithm: "sha256",
    algorithmLabel: "SHA-256",
    digestLength: 64,
    sampleInput: "Toolars",
    sampleDigest:
      "00dfd1fdb6e3ec5fa1a384778e503857d7594bdabf7ebe5365aa489a933bab98",
    downloadFileName: "toolars-sha256-digest.txt",
  },
  "sha384-hash-checker": {
    slug: "sha384-hash-checker",
    name: "SHA-384 Hash & Verify",
    algorithm: "sha384",
    algorithmLabel: "SHA-384",
    digestLength: 96,
    sampleInput: "Toolars",
    sampleDigest:
      "b9209bfde5ffe18e5890703abb038c57d0e6820ab854fd3958aefb5554b3b036627cd7226845cf2786957086be041e73",
    downloadFileName: "toolars-sha384-digest.txt",
  },
  "sha512-hash-checker": {
    slug: "sha512-hash-checker",
    name: "SHA-512 Hash & Verify",
    algorithm: "sha512",
    algorithmLabel: "SHA-512",
    digestLength: 128,
    sampleInput: "Toolars",
    sampleDigest:
      "ee0987b9305eab7030d71039d1f8d64065dad87a5082c1ae3f2148921f34f908e5396da87332b5654bece715a6be229c3ea7c456e0fa0716d7bd2e778e9273bf",
    downloadFileName: "toolars-sha512-digest.txt",
  },
} as const satisfies HashToolDefinitions;

const hashToolSlugSet = new Set<string>(HASH_TOOL_SLUGS);

export function isHashToolSlug(value: string): value is HashToolSlug {
  return hashToolSlugSet.has(value);
}

export function getHashToolDefinition<S extends HashToolSlug>(
  slug: S,
): (typeof HASH_TOOL_DEFINITIONS)[S] {
  return HASH_TOOL_DEFINITIONS[slug];
}

export const HASH_WORKER_PATH = "/generated/hash-worker.js";
