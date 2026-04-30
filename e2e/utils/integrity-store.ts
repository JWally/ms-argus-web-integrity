/**
 * Server-side state lookups for e2e tests.
 *
 * Reads DynamoDB directly rather than going through the merchant-facing
 * API. Coupling tests to storage shape is more stable than coupling them
 * to a public response shape that's planned to be tightened.
 *
 * Requires AWS credentials available to the test runner via the default
 * credential chain (AWS_PROFILE, ~/.aws/credentials, env vars, IRSA/IMDS).
 *
 * Stage selection: ARGUS_E2E_STAGE env var, default "dev-jw".
 * CPI selection: ARGUS_TEST_CPI env var (no default — required, since the
 * table's PK is composite (cpi, session_id)).
 */

import { DynamoDBClient, QueryCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

const STAGE = process.env.ARGUS_E2E_STAGE ?? 'dev-jw';
const AWS_REGION = process.env.AWS_REGION ?? 'us-east-1';

/**
 * Table name from ms-argus-api/lib/constructs/dynamodb.ts. The `-v2`
 * suffix marks the dual-key migration where PK changed from session_id
 * to (cpi, session_id) — see ms-argus-api PR #132.
 */
const INTEGRITY_RESULTS_TABLE = `ms-argus-api-${STAGE}-integrity-results-v2`;

const ddb = new DynamoDBClient({ region: AWS_REGION });

/**
 * Fetch the full integrity record for a session id from DynamoDB.
 *
 * The table is partitioned on cpi, so this scans the merchant's
 * partition for a matching session_id. Tests must export ARGUS_TEST_CPI
 * before running so the lookup knows which partition to query.
 *
 * Returns the unmarshalled item or null if no record exists.
 */
export async function fetchIntegrityRecord(
  sessionId: string,
): Promise<Record<string, unknown> | null> {
  const cpi = process.env.ARGUS_TEST_CPI;
  if (!cpi) {
    throw new Error(
      'ARGUS_TEST_CPI must be set — table PK is (cpi, session_id), no fallback partition',
    );
  }
  const resp = await ddb.send(
    new QueryCommand({
      TableName: INTEGRITY_RESULTS_TABLE,
      KeyConditionExpression: 'cpi = :c AND session_id = :s',
      ExpressionAttributeValues: {
        ':c': { S: cpi },
        ':s': { S: sessionId },
      },
      Limit: 1,
    }),
  );
  return resp.Items?.[0] ? unmarshall(resp.Items[0]) : null;
}
