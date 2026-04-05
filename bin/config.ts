export const PIPELINE_NAME: string = "ms-argus-web";
export const ROOT_DOMAIN: string = "argus.pw";
export const SITE_DOMAIN: string = "argus.pw";

export const PIPELINE_GIT_REPO: string = "JWally/ms-argus-web";
export const PIPELINE_GIT_SECRET_MANAGER: string = "github-token/ms-argus-web";

export const AWS_ACCOUNT_ID: string = process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID || "";
export const PIPELINE_HOME_REGION: string = process.env.CDK_DEFAULT_REGION || process.env.AWS_REGION || "us-east-1";
