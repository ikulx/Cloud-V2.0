import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { Readable } from 'stream'
import type { BackupTarget, BackupObject, BackupTargetId } from './index'

interface S3Config {
  id: BackupTargetId
  endpoint: string
  region: string
  bucket: string
  accessKey: string
  secretKey: string
}

export function createS3Target(cfg: S3Config): BackupTarget {
  const client = new S3Client({
    endpoint: cfg.endpoint,
    region: cfg.region,
    credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
    forcePathStyle: true,
  })

  return {
    id: cfg.id,

    async put(key: string, body: Readable): Promise<void> {
      const upload = new Upload({
        client,
        params: { Bucket: cfg.bucket, Key: key, Body: body },
        // 5 MB Parts – Default für lib-storage; reicht für unsere typischen
        // tar.gz-Grössen (wenige hundert MB).
        queueSize: 4,
        partSize: 5 * 1024 * 1024,
      })
      await upload.done()
    },

    async list(prefix: string): Promise<BackupObject[]> {
      const out: BackupObject[] = []
      let token: string | undefined = undefined
      do {
        const r: any = await client.send(new ListObjectsV2Command({
          Bucket: cfg.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }))
        for (const obj of r.Contents ?? []) {
          if (!obj.Key) continue
          out.push({
            key: obj.Key,
            size: Number(obj.Size ?? 0),
            mtime: obj.LastModified ?? new Date(0),
          })
        }
        token = r.IsTruncated ? r.NextContinuationToken : undefined
      } while (token)
      return out
    },

    async get(key: string): Promise<Readable> {
      const r = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }))
      const body = r.Body as Readable | undefined
      if (!body) throw new Error('S3: leerer Body')
      return body
    },

    async delete(key: string): Promise<void> {
      await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }))
    },

    async test(): Promise<void> {
      // ListObjectsV2 mit MaxKeys=1 statt HeadBucket – Swiss Backup antwortet
      // auf HEAD nicht immer sauber, und wir bekommen bei fehlenden Rechten
      // einen aussagekräftigeren Fehler (AccessDenied/NoSuchBucket/…) statt
      // eines generischen UnknownError.
      try {
        await client.send(new ListObjectsV2Command({ Bucket: cfg.bucket, MaxKeys: 1 }))
      } catch (e) {
        const err = e as { name?: string; Code?: string; message?: string; $metadata?: { httpStatusCode?: number } }
        const parts = [
          err.name || err.Code || 'S3-Fehler',
          err.message,
          err.$metadata?.httpStatusCode ? `HTTP ${err.$metadata.httpStatusCode}` : '',
        ].filter(Boolean)
        throw new Error(parts.join(' – '))
      }
    },
  }
}
