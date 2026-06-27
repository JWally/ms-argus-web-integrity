// lib/constructs/sdk-refresh.ts

import { Construct } from 'constructs';
import { Duration, Stack } from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as logs from 'aws-cdk-lib/aws-logs';

export interface SdkRefreshProps {
  /** Bucket the built SDK gets synced to. */
  siteBucket: s3.IBucket;
  /** CloudFront distribution to invalidate after sync. */
  distribution: cloudfront.IDistribution;
  /** GitHub owner. */
  githubOwner: string;
  /** GitHub repo name. */
  githubRepo: string;
  /**
   * CodeConnections (CodeStar Connections) ARN granting CodeBuild access
   * to the private GitHub repo. The CodeBuild project role gets
   * `codeconnections:UseConnection` on this ARN. Verify the connection
   * with: aws codeconnections list-connections --region us-east-1
   */
  githubConnectionArn: string;
  /** Branch to build. Default: "main". */
  branch?: string;
  /** Cron schedule. Default: nightly 08:00 UTC. */
  schedule?: events.Schedule;
}

/**
 * Nightly SDK refresh.
 *
 * The integrity bundle (`argus-integrity-iframe.iife.js`) embeds a time-bucket
 * in its packed VM bytecode at build time. The unpacker accepts ±3 buckets
 * (~7-day window). Bundles older than ~7 days fail to unpack and the iframe
 * surfaces an opaque `submission_failed` to the loader — see
 * [feedback_argus_sdk_timebomb_first.md] in user memory.
 *
 * This construct schedules a nightly CodeBuild that pulls the latest commit
 * on `main`, runs `npm run build:prod`, syncs `dist/` to S3, and invalidates
 * CloudFront. Side effect: each build picks a new random VM key so the
 * rotation property the time-bucket was built to enforce is preserved.
 *
 * Auth: relies on the AWS account having CodeBuild GitHub credentials of
 * type CODECONNECTIONS already imported (i.e. the github-jwally CodeStar
 * connection). Verify with:
 *   aws codebuild list-source-credentials --region us-east-1
 */
export class SdkRefreshConstruct extends Construct {
  public readonly project: codebuild.Project;

  constructor(scope: Construct, id: string, props: SdkRefreshProps) {
    super(scope, id);

    const {
      siteBucket,
      distribution,
      githubOwner,
      githubRepo,
      githubConnectionArn,
      branch = 'main',
      schedule = events.Schedule.cron({ hour: '8', minute: '0' }),
    } = props;

    const logGroup = new logs.LogGroup(this, 'BuildLogs', {
      logGroupName: `/aws/codebuild/${Stack.of(this).stackName}-sdk-refresh`,
      retention: logs.RetentionDays.ONE_MONTH,
    });

    this.project = new codebuild.Project(this, 'Project', {
      projectName: `${Stack.of(this).stackName}-sdk-refresh`,
      description:
        'Nightly rebuild + S3 sync of the integrity SDK to keep the VM bytecode time-bucket fresh',
      source: codebuild.Source.gitHub({
        owner: githubOwner,
        repo: githubRepo,
        branchOrRef: branch,
        cloneDepth: 1,
      }),
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_7_0,
        computeType: codebuild.ComputeType.SMALL,
      },
      timeout: Duration.minutes(15),
      logging: { cloudWatch: { logGroup } },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          install: {
            'runtime-versions': { nodejs: '22' },
            commands: ['node --version', 'npm --version'],
          },
          // --legacy-peer-deps: rollup-obfuscator@4.1.1 demands
          // javascript-obfuscator@^4 but the lockfile pins ^5. Same flag the
          // local install uses.
          pre_build: { commands: ['npm ci --legacy-peer-deps'] },
          build: { commands: ['npm run build:prod'] },
          post_build: {
            commands: [
              `aws s3 sync dist/ s3://${siteBucket.bucketName}/ --cache-control "public, max-age=0, must-revalidate"`,
              `aws cloudfront create-invalidation --distribution-id ${distribution.distributionId} --paths "/argus-manifest.json" "/argus-sri.json" "/argus-bootstrap.v1.iife.js"`,
              'echo "SDK refresh complete: $(date -u +%FT%TZ)"',
            ],
          },
        },
      }),
    });

    siteBucket.grantReadWrite(this.project);
    this.project.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cloudfront:CreateInvalidation'],
        resources: [
          `arn:aws:cloudfront::${Stack.of(this).account}:distribution/${distribution.distributionId}`,
        ],
      }),
    );
    // CodeBuild's CodeConnections-backed source needs all three; UseConnection
    // alone is not enough — the source download retrieves a token.
    this.project.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'codeconnections:GetConnectionToken',
          'codeconnections:GetConnection',
          'codeconnections:UseConnection',
          'codestar-connections:UseConnection',
        ],
        resources: [githubConnectionArn],
      }),
    );

    new events.Rule(this, 'NightlyRule', {
      ruleName: `${Stack.of(this).stackName}-sdk-refresh-nightly`,
      description:
        'Trigger SDK rebuild + S3 sync nightly so the integrity bundle never crosses its ~7-day time-bucket window',
      schedule,
      targets: [new targets.CodeBuildProject(this.project)],
    });
  }
}
