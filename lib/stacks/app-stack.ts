// stacks/app-stack.ts
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { StaticSiteConstruct } from '../constructs/static-site';
import { SdkRefreshConstruct } from '../constructs/sdk-refresh';

interface AppStackProps extends cdk.StackProps {
  environment: string;
  stackName: string;
  rootDomain: string;
  stage: string;
  region: string;
  account: string;
  siteDomain?: string;
}

export class TheStack extends cdk.Stack {
  /** bucket object (still useful inside the stage) */
  public readonly STACK_S3_BUCKET: Bucket;

  /** CF output that the pipeline can reference without crossing stage boundaries */
  public readonly bucketNameOutput: cdk.CfnOutput;

  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);

    const { stage, siteDomain } = props;

    if (!siteDomain) {
      throw new Error('SITE DOMAIN NOT PROVIDED - EXITING');
    }

    /* --------------------------------------------------
     *  Static-site construct (S3 + CloudFront)
     * -------------------------------------------------- */
    // Note: dev-jw uses legacy construct name for CloudFormation resource stability
    const constructName = stage === 'dev-jw'
      ? `${stage}-argus-web-static-multi`
      : `${stage}-argus-web-static-${siteDomain}`;
    const stageLower = stage.toLowerCase();
    const customDomain =
      stageLower === 'prod'
        ? `static-integrity.${siteDomain}`
        : `static-integrity-${stageLower}.${siteDomain}`;
    const site = new StaticSiteConstruct(this, constructName, {
      customDomain,
      rootDomain: siteDomain,
      stage,
    });

    // expose the bucket for intra-stage use
    this.STACK_S3_BUCKET = site.bucket;

    // expose only the bucket *name* for the pipeline stack
    this.bucketNameOutput = new cdk.CfnOutput(this, 'SiteBucketName', {
      value: site.bucket.bucketName,
      description: 'S3 bucket name of the compiled static site',
    });

    // Nightly SDK refresh — rebuilds + redeploys the bundle so the embedded
    // VM-bytecode time-bucket never crosses its ~7-day window. See
    // SdkRefreshConstruct for full rationale.
    new SdkRefreshConstruct(this, 'SdkRefresh', {
      siteBucket: site.bucket,
      distribution: site.distribution,
      githubOwner: 'JWally',
      githubRepo: 'ms-argus-web-integrity',
      githubConnectionArn:
        'arn:aws:codeconnections:us-east-1:263318538229:connection/924cf09a-f021-420d-b85b-073544f4eead',
    });
  }
}
