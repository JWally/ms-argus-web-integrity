/**
 * Server-side state lookups for e2e tests.
 *
 * Reads DynamoDB directly rather than going through the merchant-facing
 * API. Coupling tests to storage shape is more stable than coupling them
 * to a public response shape that's planned to be tightened (see the
 * TODO(merchant-response-shaping) note in ms-argus-api).
 *
 * Requires AWS credentials available to the test runner via the default
 * credential chain (AWS_PROFILE, ~/.aws/credentials, env vars, IRSA/IMDS).
 *
 * Stage selection: ARGUS_E2E_STAGE env var, default "dev-jw". Determines
 * which deployed integrity-results table to read from.
 */

import { DynamoDBClient, GetItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const STAGE = process.env.ARGUS_E2E_STAGE ?? 'dev-jw';
const AWS_REGION = process.env.AWS_REGION ?? 'us-east-1';

/**
 * Table name pattern from ms-argus-api/lib/constructs/dynamodb.ts:136
 * (`${stackName}-integrity-results`) where stackName is per-stage
 * (ms-argus-api-dev-jw, ms-argus-api-prod, etc.).
 */
const INTEGRITY_RESULTS_TABLE = `ms-argus-api-${STAGE}-integrity-results`;

const ddb = new DynamoDBClient({ region: AWS_REGION });

/**
 * Fetch the full integrity record for a session id from DynamoDB.
 *
 * Returns the unmarshalled item (full storage shape — device fingerprint,
 * sigint blob, analyzer outputs, etc.) or null if no record exists for
 * the given id.
 *
 * Throws on AWS errors (creds missing, table missing, network) — caller
 * decides whether to swallow.
 */
export async function fetchIntegrityRecord(
  sessionId: string,
): Promise<Record<string, unknown> | null> {
  const resp = await ddb.send(
    new GetItemCommand({
      TableName: INTEGRITY_RESULTS_TABLE,
      Key: { session_id: { S: sessionId } },
    }),
  );
  return resp.Item ? unmarshall(resp.Item) : null;
}
