#!/usr/bin/env node
/**
 * Deploy Argus demo to S3 for testing with proxied bots
 * Usage: node scripts/deploy-s3.mjs [bucket-name]
 */

import { S3Client, CreateBucketCommand, PutBucketWebsiteCommand, PutBucketPolicyCommand, PutPublicAccessBlockCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { lookup } from 'mime-types';

const BUCKET_NAME = process.argv[2] || 'argus-fingerprint-demo';
const REGION = 'us-east-1';

const s3 = new S3Client({ region: REGION });

const uploadDir = async (localDir, s3Prefix = '') => {
  const files = readdirSync(localDir);

  for (const file of files) {
    const localPath = join(localDir, file);
    const stat = statSync(localPath);

    if (stat.isDirectory()) {
      await uploadDir(localPath, s3Prefix ? `${s3Prefix}/${file}` : file);
    } else {
      const key = s3Prefix ? `${s3Prefix}/${file}` : file;
      const contentType = lookup(file) || 'application/octet-stream';

      console.log(`  📄 ${key}`);
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: readFileSync(localPath),
        ContentType: contentType,
      }));
    }
  }
};

(async () => {
  try {
    console.log(`🚀 Deploying Argus to S3: ${BUCKET_NAME}\n`);

    // Create bucket
    console.log('📦 Creating bucket...');
    try {
      await s3.send(new CreateBucketCommand({ Bucket: BUCKET_NAME }));
    } catch (e) {
      if (e.name !== 'BucketAlreadyOwnedByYou' && e.name !== 'BucketAlreadyExists') {
        throw e;
      }
      console.log('   (bucket already exists)');
    }

    // Disable block public access
    console.log('🔓 Configuring public access...');
    await s3.send(new PutPublicAccessBlockCommand({
      Bucket: BUCKET_NAME,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: false,
        IgnorePublicAcls: false,
        BlockPublicPolicy: false,
        RestrictPublicBuckets: false,
      },
    }));

    // Enable website hosting
    console.log('🌐 Enabling static website hosting...');
    await s3.send(new PutBucketWebsiteCommand({
      Bucket: BUCKET_NAME,
      WebsiteConfiguration: {
        IndexDocument: { Suffix: 'index.html' },
        ErrorDocument: { Key: 'index.html' },
      },
    }));

    // Bucket policy
    console.log('📜 Setting bucket policy...');
    await s3.send(new PutBucketPolicyCommand({
      Bucket: BUCKET_NAME,
      Policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [{
          Sid: 'PublicReadGetObject',
          Effect: 'Allow',
          Principal: '*',
          Action: 's3:GetObject',
          Resource: `arn:aws:s3:::${BUCKET_NAME}/*`,
        }],
      }),
    }));

    // Upload files
    console.log('📤 Uploading public/...');
    await uploadDir('./public');

    console.log('📤 Uploading dist/...');
    await uploadDir('./dist', 'dist');

    const url = `http://${BUCKET_NAME}.s3-website-${REGION}.amazonaws.com`;

    console.log(`
✅ Deployed!
🔗 URL: ${url}

To test with bots:
  cd ../bots && node bot.mjs --mode stealth --url ${url}
  cd ../bots && node bot.mjs --mode naive --url ${url}
  cd ../bots && node bot.mjs --mode vanilla --proxy --url ${url}
`);

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
})();
