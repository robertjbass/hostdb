/**
 * Shared Cloudflare R2 client utilities.
 *
 * R2 is S3-compatible, so we use the AWS SDK with a custom endpoint.
 */

import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export type R2Config = {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
}

export function loadR2Config(): R2Config {
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  const bucket = process.env.R2_BUCKET_NAME

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    const missing = [
      !accountId && 'R2_ACCOUNT_ID',
      !accessKeyId && 'R2_ACCESS_KEY_ID',
      !secretAccessKey && 'R2_SECRET_ACCESS_KEY',
      !bucket && 'R2_BUCKET_NAME',
    ].filter(Boolean)
    throw new Error(`Missing required R2 env vars: ${missing.join(', ')}`)
  }

  return { accountId, accessKeyId, secretAccessKey, bucket }
}

export function createR2Client(config: R2Config): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  })
}

export async function uploadToR2(options: {
  client: S3Client
  bucket: string
  key: string
  body: Buffer | Uint8Array | ReadableStream
  contentType?: string
  cacheControl?: string
}): Promise<void> {
  const { client, bucket, key, body, contentType, cacheControl } = options

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType ?? 'application/octet-stream',
      CacheControl: cacheControl ?? 'public, max-age=31536000, immutable',
    }),
  )
}

export async function objectExists(options: {
  client: S3Client
  bucket: string
  key: string
}): Promise<boolean> {
  const { client, bucket, key } = options

  try {
    await client.send(
      new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    )
    return true
  } catch (error: unknown) {
    const code =
      error instanceof Error && 'name' in error ? error.name : undefined
    if (code === 'NotFound' || code === '404') {
      return false
    }
    throw error
  }
}

export async function deleteFromR2(options: {
  client: S3Client
  bucket: string
  key: string
}): Promise<void> {
  const { client, bucket, key } = options

  await client.send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  )
}

export async function listR2Objects(options: {
  client: S3Client
  bucket: string
  prefix: string
}): Promise<string[]> {
  const { client, bucket, prefix } = options

  const result = await client.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
    }),
  )

  return (result.Contents ?? [])
    .map((obj) => obj.Key)
    .filter((key): key is string => key !== undefined)
}

export async function publishJsonToR2(options: {
  client: S3Client
  bucket: string
  rootDir: string
  filename: string
  cacheControl?: string
}): Promise<void> {
  const { client, bucket, rootDir, filename, cacheControl } = options
  const body = readFileSync(resolve(rootDir, filename))

  await uploadToR2({
    client,
    bucket,
    key: filename,
    body,
    contentType: 'application/json',
    cacheControl: cacheControl ?? 'public, max-age=60',
  })
}

export async function publishReleasesJson(options: {
  client: S3Client
  bucket: string
  rootDir: string
}): Promise<void> {
  await publishJsonToR2({ ...options, filename: 'releases.json' })
}
