// bin/ms-argus-web.ts
import { App, CliCredentialsStackSynthesizer } from "aws-cdk-lib";
import { PipelineStack } from "../lib/pipeline/pipeline-stack";
import { TheStack as AppStack } from "../lib/stacks/app-stack";
import {
  ROOT_DOMAIN,
  SITE_DOMAIN,
  PIPELINE_NAME,
  AWS_ACCOUNT_ID,
  PIPELINE_HOME_REGION,
} from "./config";
import { CODESTAR_CONNECTION_ARN } from "../lib/pipeline/constants";

const app = new App();

// Pipeline: QA -> UAT -> Prod
// Only create if we have a CodeStar connection ARN
if (CODESTAR_CONNECTION_ARN) {
  new PipelineStack(app, PIPELINE_NAME, {
    rootDomain: ROOT_DOMAIN,
    siteDomain: SITE_DOMAIN,
    env: {
      account: AWS_ACCOUNT_ID,
      region: PIPELINE_HOME_REGION,
    },
  });
}

// /////////////////////////////////
// Personal dev stacks
// : add your details
// : run `cdk bootstrap` (just do 1x / region)
// : then `cdk deploy ms-argus-web-dev-jw`
// /////////////////////////////////

new AppStack(app, "ms-argus-web-dev-jw", {
  env: { account: AWS_ACCOUNT_ID, region: "us-east-1" },
  environment: "dev-jw",
  stackName: "ms-argus-web-dev-jw",
  rootDomain: ROOT_DOMAIN,
  stage: "dev-jw",
  region: "us-east-1",
  account: AWS_ACCOUNT_ID,
  siteDomain: SITE_DOMAIN,
  // Use CLI credentials directly for dev stack deployments
  synthesizer: new CliCredentialsStackSynthesizer(),
});

// Isolated e2e static stack — serves loader/iframe/worker same-origin from
// static-integrity-e2e.argus.pw so e2e tests exercise the real Worker path
// (the dev-jw split serves the static bundle on localhost while the worker is
// on the CDN, which never tested the worker submission). Build it with
// `ARGUS_STAGE=e2e ARGUS_API_STAGE=dev-jw` (see `npm run deploy:e2e`) so the
// bundle submits to the existing dev-jw API — no standalone API stack needed.
new AppStack(app, "ms-argus-web-e2e", {
  env: { account: AWS_ACCOUNT_ID, region: "us-east-1" },
  environment: "e2e",
  stackName: "ms-argus-web-e2e",
  rootDomain: ROOT_DOMAIN,
  stage: "e2e",
  region: "us-east-1",
  account: AWS_ACCOUNT_ID,
  siteDomain: SITE_DOMAIN,
  synthesizer: new CliCredentialsStackSynthesizer(),
});

app.synth();
