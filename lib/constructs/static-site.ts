import { Construct } from 'constructs';
import { RemovalPolicy, Duration, CfnOutput } from 'aws-cdk-lib';
import {
  Bucket,
  BucketEncryption,
  BlockPublicAccess,
} from 'aws-cdk-lib/aws-s3';
import {
  Distribution,
  ViewerProtocolPolicy,
  SecurityPolicyProtocol,
  HttpVersion,
  PriceClass,
  AllowedMethods,
  CachePolicy,
  CacheHeaderBehavior,
  CacheCookieBehavior,
  CacheQueryStringBehavior,
  ResponseHeadersPolicy,
  HeadersFrameOption,
  HeadersReferrerPolicy,
} from 'aws-cdk-lib/aws-cloudfront';
import { OriginAccessIdentity } from 'aws-cdk-lib/aws-cloudfront';
import { S3Origin } from 'aws-cdk-lib/aws-cloudfront-origins';
import { PolicyStatement, CanonicalUserPrincipal } from 'aws-cdk-lib/aws-iam';
import {
  BucketDeployment,
  Source,
  CacheControl,
} from 'aws-cdk-lib/aws-s3-deployment';
import { HostedZone, ARecord, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { CloudFrontTarget } from 'aws-cdk-lib/aws-route53-targets';
import {
  Certificate,
  CertificateValidation,
  ICertificate,
} from 'aws-cdk-lib/aws-certificatemanager';
import * as path from 'path';

export interface SimpleStaticSiteProps {
  /**
   * (Optional) Full domain name you want to use, e.g. "dev.my-example.com"
   */
  customDomain?: string;

  /**
   * (Optional) The parent/root domain, e.g. "my-example.com".
   * Required if you specify a customDomain and you want an auto-managed certificate + Route53 record.
   */
  rootDomain?: string;

  /**
   * Removal policy for the S3 bucket. Defaults to `DESTROY` for dev/test.
   */
  removalPolicy?: RemovalPolicy;

  /**
   * Logical stage name (e.g. 'qa', 'uat', 'prod')
   */
  stage: string;
}

/**
 * A simpler, faster-deploying static site construct that:
 *  - Creates an S3 bucket
 *  - Wraps it in a CloudFront distribution
 *  - Optionally sets up a custom domain + certificate if provided
 *  - Deploys local /dist folder to the bucket, invalidates everything
 */
export class StaticSiteConstruct extends Construct {
  public readonly bucket: Bucket;
  public readonly distribution: Distribution;
  public readonly domainUrl: string; // final domain (custom or CF)

  constructor(scope: Construct, id: string, props: SimpleStaticSiteProps) {
    super(scope, id);

    const removalPolicy = props.removalPolicy ?? RemovalPolicy.DESTROY;

    // 1) Create a private S3 bucket for the site
    this.bucket = new Bucket(this, 'SiteBucket', {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      autoDeleteObjects: removalPolicy === RemovalPolicy.DESTROY,
      removalPolicy,
    });

    // 2) Create an Origin Access Identity (OAI) to allow CloudFront to read from the bucket
    const oai = new OriginAccessIdentity(this, 'SiteOAI');
    this.bucket.addToResourcePolicy(
      new PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [this.bucket.arnForObjects('*')],
        principals: [
          new CanonicalUserPrincipal(
            oai.cloudFrontOriginAccessIdentityS3CanonicalUserId,
          ),
        ],
      }),
    );

    // 3) (Optional) If we have a custom domain + root domain, create or validate a cert in us-east-1
    let certificate: ICertificate | undefined;
    if (props.customDomain && props.rootDomain) {
      const zone = HostedZone.fromLookup(this, 'HostedZone', {
        domainName: props.rootDomain,
      });

      certificate = new Certificate(this, 'SiteCertificate', {
        domainName: props.customDomain,
        validation: CertificateValidation.fromDns(zone),
      });
    }

    // 4) Create the CloudFront distribution with minimal config
    // Create cache policies
    const staticAssetsCachePolicy = new CachePolicy(
      this,
      'StaticAssetsCachePolicy',
      {
        cachePolicyName: `${props.stage}-argus-static-assets-cache`,
        comment: 'Cache policy for static assets with compression',
        defaultTtl: Duration.days(30),
        maxTtl: Duration.days(365),
        minTtl: Duration.seconds(0),
        enableAcceptEncodingBrotli: true,
        enableAcceptEncodingGzip: true,
        headerBehavior: CacheHeaderBehavior.none(),
        cookieBehavior: CacheCookieBehavior.none(),
        queryStringBehavior: CacheQueryStringBehavior.none(),
      },
    );

    const htmlCachePolicy = new CachePolicy(this, 'HtmlCachePolicy', {
      cachePolicyName: `${props.stage}-argus-html-no-cache`,
      comment: 'No cache policy for HTML files with compression',
      defaultTtl: Duration.seconds(0),
      maxTtl: Duration.seconds(86400), // 1 day max
      minTtl: Duration.seconds(0),
      enableAcceptEncodingBrotli: true,
      enableAcceptEncodingGzip: true,
      headerBehavior: CacheHeaderBehavior.none(),
      cookieBehavior: CacheCookieBehavior.none(),
      queryStringBehavior: CacheQueryStringBehavior.none(),
    });

    // Response headers policy with CORS for cross-origin script loading
    const corsResponseHeadersPolicy = new ResponseHeadersPolicy(
      this,
      'CorsResponseHeadersPolicy',
      {
        responseHeadersPolicyName: `${props.stage}-argus-cors-policy`,
        comment: 'CORS headers for cross-origin script loading',
        corsBehavior: {
          accessControlAllowCredentials: false,
          accessControlAllowHeaders: ['*'],
          accessControlAllowMethods: ['GET', 'HEAD', 'OPTIONS'],
          accessControlAllowOrigins: ['*'],
          accessControlMaxAge: Duration.seconds(86400),
          originOverride: true,
        },
        securityHeadersBehavior: {
          contentTypeOptions: { override: true },
          frameOptions: {
            frameOption: HeadersFrameOption.DENY,
            override: true,
          },
          referrerPolicy: {
            referrerPolicy:
              HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
            override: true,
          },
          strictTransportSecurity: {
            accessControlMaxAge: Duration.seconds(31536000),
            includeSubdomains: true,
            override: true,
          },
        },
      },
    );

    this.distribution = new Distribution(this, 'SiteDistribution', {
      defaultBehavior: {
        origin: new S3Origin(this.bucket, { originAccessIdentity: oai }),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: htmlCachePolicy,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
      },
      additionalBehaviors: {
        // JavaScript files - cached, compressed, with CORS headers
        '*.js': {
          origin: new S3Origin(this.bucket, { originAccessIdentity: oai }),
          cachePolicy: staticAssetsCachePolicy,
          responseHeadersPolicy: corsResponseHeadersPolicy,
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
        // CSS files - cached and compressed
        '*.css': {
          origin: new S3Origin(this.bucket, { originAccessIdentity: oai }),
          cachePolicy: staticAssetsCachePolicy,
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
        // Font files - cached and compressed
        '*.woff*': {
          origin: new S3Origin(this.bucket, { originAccessIdentity: oai }),
          cachePolicy: staticAssetsCachePolicy,
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
        // Images - cached and compressed
        '*.png': {
          origin: new S3Origin(this.bucket, { originAccessIdentity: oai }),
          cachePolicy: staticAssetsCachePolicy,
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
        '*.jpg': {
          origin: new S3Origin(this.bucket, { originAccessIdentity: oai }),
          cachePolicy: staticAssetsCachePolicy,
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
        '*.svg': {
          origin: new S3Origin(this.bucket, { originAccessIdentity: oai }),
          cachePolicy: staticAssetsCachePolicy,
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
        // WASM files - cached
        '*.wasm': {
          origin: new S3Origin(this.bucket, { originAccessIdentity: oai }),
          cachePolicy: staticAssetsCachePolicy,
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        },
      },
      // Attach custom domain if provided
      domainNames:
        certificate && props.customDomain ? [props.customDomain] : undefined,
      certificate,
      // Minimal encryption & latest config
      minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
      httpVersion: HttpVersion.HTTP2,
      priceClass: PriceClass.PRICE_CLASS_100,
      defaultRootObject: 'index.html',

      // This makes sure that everything resolves to index.html
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: Duration.seconds(0),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: Duration.seconds(0),
        },
      ],
    });

    // 5) If a custom domain was provided, create a Route53 A-record
    if (certificate && props.customDomain && props.rootDomain) {
      const zone = HostedZone.fromLookup(this, 'AliasHostedZone', {
        domainName: props.rootDomain,
      });

      new ARecord(this, 'AliasRecord', {
        zone,
        recordName: props.customDomain,
        target: RecordTarget.fromAlias(new CloudFrontTarget(this.distribution)),
      });

      this.domainUrl = `https://${props.customDomain}`;
    } else {
      this.domainUrl = `https://${this.distribution.distributionDomainName}`;
    }

    // 6) Deploy your compiled site from /dist -> S3, with full cache invalidation
    const distPath = path.join(__dirname, '../../dist');
    new BucketDeployment(this, 'DeployStaticSite', {
      sources: [Source.asset(distPath)],
      destinationBucket: this.bucket,
      distribution: this.distribution,
      // Invalidate all paths to ensure fresh content after deployment
      // This is critical for JavaScript files that may be cached at edge locations
      distributionPaths: ['/*'],
      memoryLimit: 2096,
      cacheControl: [
        CacheControl.fromString('public, max-age=0, must-revalidate'),
      ],
    });

    // 7) Provide a CloudFormation output for the site URL
    new CfnOutput(this, 'SiteURL', {
      value: this.domainUrl,
      description: 'The URL of the deployed site',
    });
  }
}
