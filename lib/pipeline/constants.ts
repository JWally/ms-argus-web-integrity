export const PIPELINE = [
  { name: "QA", region: "us-east-1" },
  { name: "Uat", region: "us-east-1" },
  { name: "Prod", region: "us-east-1" },
];

// GitHub source via CodeStar Connection
export const GITHUB_REPO: string = "JWally/ms-argus-web";
export const GITHUB_BRANCH: string = "main";

// CodeStar Connection ARN - set via environment variable for portability
// Create a connection in AWS Console: CodePipeline -> Settings -> Connections
export const CODESTAR_CONNECTION_ARN: string | undefined = process.env.CODESTAR_CONNECTION_ARN;

// Optional: If you want to copy prod assets to a public CDN bucket after prod deploy
// export const DESTINATION_S3_BUCKET: string = "static.argus.pw";
// export const DESTINATION_CF_ID: string = "XXXXXXXXXXXXX";
