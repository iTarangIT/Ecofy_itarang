# S3 object storage for staging (`itarang-ecofy-staging`, ap-south-1)

Documents, quotes and lead-import files are stored as private objects; the app only hands out 5-minute presigned
URLs and the browser PUTs/GETs straight to S3 (M15). Run once from a machine with admin AWS credentials:

```bash
B=itarang-ecofy-staging
aws s3api put-public-access-block --bucket $B --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-encryption --bucket $B --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-bucket-cors      --bucket $B --cors-configuration file://deploy/aws/s3-cors.json
aws s3api put-bucket-policy    --bucket $B --policy file://deploy/aws/s3-bucket-policy.json

# Least-privilege identity for the VPS (no instance role on Hostinger)
aws iam create-user   --user-name ecofy-staging-app
aws iam put-user-policy --user-name ecofy-staging-app --policy-name ecofy-staging-s3 --policy-document file://deploy/aws/s3-iam-policy.json
aws iam create-access-key --user-name ecofy-staging-app   # -> AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
```

Then in the `STAGING_ENV_FILE` secret set `STORAGE_DRIVER=s3`, `S3_BUCKET=itarang-ecofy-staging`,
`S3_PREFIX=ecofy/staging/`, `AWS_REGION=ap-south-1`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and re-run the
staging workflow. `GET /api/v1/health` reports `checks.s3: true` once the keys work (HeadBucket).

Files uploaded while the dev driver was active live in `/srv/ecofy/shared/data/storage` on the VPS and are not
moved automatically; copy them if they matter: `aws s3 sync /srv/ecofy/shared/data/storage s3://$B/ecofy/staging/`.

Notes
- The IAM policy is scoped to the `ecofy/staging/` prefix, so `S3_PREFIX` must stay `ecofy/staging/`. The
  `ListBucket` condition is `StringLikeIfExists` on purpose: HeadBucket (the health check) sends no prefix, and a plain
  `StringLike` would deny it.
- A lifecycle rule that expires objects (e.g. `staging-cleanup`) will break download of older documents and the
  File anchored to an accepted quote; acceptable in the sandbox, never in production.
- Production uses its own bucket/prefix (`ecofy/prod/`) and a separate IAM identity.
