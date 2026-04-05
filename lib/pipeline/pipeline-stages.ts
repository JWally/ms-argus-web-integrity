// pipeline/pipeline-stages.ts
import * as cdk from "aws-cdk-lib";
import { Stage, StageProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { TheStack } from "../stacks/app-stack";

export class AppStage extends Stage {
  /** Live bucket object for anything inside the stage */
  public readonly STACK_S3_BUCKET: Bucket;

  /** Safe output the pipeline can reference without crossing stage boundaries */
  public readonly bucketNameOutput: cdk.CfnOutput;

  constructor(
    scope: Construct,
    id: string,
    rootDomain: string,
    props?: StageProps,
    siteDomain?: string,
  ) {
    super(scope, id, props);

    // App stack for this stage (QA, Uat, Prod, ...)
    const stageStack = new TheStack(this, "ms-argus-web", {
      env: props?.env,
      environment: id.toLowerCase(), // e.g. 'qa'
      stackName: `ms-argus-web-${id.toLowerCase()}-stack`,
      rootDomain,
      stage: id.toLowerCase().split("-")[0],
      region: props?.env?.region ?? "us-east-1",
      account: props?.env?.account ?? process.env.CDK_DEFAULT_ACCOUNT ?? "",
      siteDomain,
    });

    // expose internals
    this.STACK_S3_BUCKET = stageStack.STACK_S3_BUCKET;
    this.bucketNameOutput = stageStack.bucketNameOutput;
  }
}
